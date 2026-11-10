-- BakeByCulture migration 18: optional Biteship courier delivery (rates at checkout, booking, tracking).
-- Safe to run more than once. Run after migration 17. Does nothing until the owner switches it on in Shop settings.

create table if not exists public.private_kv (
  key text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at bigint not null default 0
);
alter table public.private_kv enable row level security;
revoke all on public.private_kv from public, anon, authenticated;   -- only the owner functions below and the Edge Functions (service role) can touch it

insert into public.private_kv (key, data, updated_at)
  values ('quote_secret', jsonb_build_object('v', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')), 0)
  on conflict (key) do nothing;
insert into public.private_kv (key, data, updated_at)
  values ('webhook_secret', jsonb_build_object('v', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')), 0)
  on conflict (key) do nothing;

-- owner: read the (private) courier settings. The API key itself is never returned.
create or replace function public.admin_biteship_get() returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text; c jsonb; w text;
begin
  perform public.assert_owner();
  select data ->> 'v' into k from public.private_kv where key = 'biteship_key';
  select data into c from public.private_kv where key = 'biteship_cfg';
  select data ->> 'v' into w from public.private_kv where key = 'webhook_secret';
  return jsonb_build_object('hasKey', k is not null and k <> '',
    'mode', case when k like 'biteship\_test%' then 'test' when k like 'biteship\_live%' then 'live' when k is null then '' else 'unknown' end,
    'cfg', coalesce(c, '{}'::jsonb), 'webhookSecret', coalesce(w, ''));
end $$;

-- owner: save the API key (p.key, empty text removes it) and/or the private courier settings (p.cfg)
create or replace function public.admin_biteship_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_owner();
  if length(p::text) > 30000 then perform public.bad('That is too large.'); end if;
  if p ? 'key' then
    if btrim(coalesce(p ->> 'key', '')) = '' then delete from public.private_kv where key = 'biteship_key';
    else
      if length(btrim(p ->> 'key')) < 20 or length(btrim(p ->> 'key')) > 400 then perform public.bad('That does not look like a Biteship API key.'); end if;
      insert into public.private_kv (key, data, updated_at) values ('biteship_key', jsonb_build_object('v', btrim(p ->> 'key')), public.now_ms())
        on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
    end if;
  end if;
  if p ? 'cfg' then
    insert into public.private_kv (key, data, updated_at) values ('biteship_cfg', p -> 'cfg', public.now_ms())
      on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
  end if;
end $$;

-- who is calling: 'owner', 'staff' or '' (used by the Edge Function; does not write to the activity log)
create or replace function public.biteship_who() returns text
language plpgsql stable security definer set search_path = public as $$
declare me public.admins := public.team_me();
begin
  if me.email is null then return ''; end if;
  return coalesce(me.role, 'staff');
end $$;

-- checks a courier quote signed by the Edge Function (so nobody can invent a delivery price). Returns the safe fields, or null when none was sent.
create or replace function public.biteship_check(p_size int, p jsonb, p_at bigint) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare secret text; msg text; price numeric; ex bigint;
begin
  if p is null or jsonb_typeof(p) <> 'object' or p = '{}'::jsonb then return null; end if;
  price := nullif(p ->> 'price', '')::numeric; ex := nullif(p ->> 'exp', '')::bigint;
  if price is null or ex is null or price < 0 or price > 5000000 or price <> trunc(price) then perform public.bad('That courier price is not valid. Please choose a courier again.'); end if;
  if coalesce((p ->> 'size')::int, -1) <> p_size then perform public.bad('The box size changed. Please choose a courier again.'); end if;
  select data ->> 'v' into secret from public.private_kv where key = 'quote_secret';
  msg := p_size::text || '|' || coalesce(p ->> 'courier', '') || '|' || coalesce(p ->> 'service', '') || '|' || price::bigint::text || '|' || ex::text
         || '|' || coalesce(p ->> 'lat', '') || '|' || coalesce(p ->> 'lng', '') || '|' || coalesce(p ->> 'postal', '');
  if secret is null or encode(hmac(msg, secret, 'sha256'), 'hex') <> coalesce(p ->> 'sig', '') then
    perform public.bad('That courier price is not valid. Please choose a courier again.'); end if;
  if p_at > ex then perform public.bad('The courier price expired. Please choose a courier again.'); end if;
  return jsonb_build_object('size', p_size, 'courier', left(p ->> 'courier', 30), 'service', left(p ->> 'service', 40),
    'courierName', left(coalesce(p ->> 'courierName', p ->> 'courier'), 40), 'serviceName', left(coalesce(p ->> 'serviceName', p ->> 'service'), 60),
    'type', left(coalesce(p ->> 'type', ''), 20), 'eta', left(coalesce(p ->> 'eta', ''), 30), 'price', price,
    'lat', p ->> 'lat', 'lng', p ->> 'lng', 'postal', left(coalesce(p ->> 'postal', ''), 12), 'areaId', left(coalesce(p ->> 'areaId', ''), 60),
    'areaName', left(coalesce(p ->> 'areaName', ''), 160), 'quotedAt', p_at);
end $$;

revoke all on function public.admin_biteship_get(), public.admin_biteship_save(jsonb), public.biteship_check(int, jsonb, bigint), public.biteship_who() from public, anon, authenticated;
grant execute on function public.admin_biteship_get(), public.admin_biteship_save(jsonb), public.biteship_who() to authenticated;

create or replace function public.place_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  lim int; s jsonb := public.cfg(); t bigint := public.now_ms();
  v_size int; v_mode text; v_day text; v_time text; v_note text; v_notify text; v_coupon text; v_expect numeric;
  v_name text; v_email text; v_phone text; v_addr text; items jsonb := '{}'::jsonb; addon_ids jsonb := '[]'::jsonb;
  edit_id text := nullif(p ->> 'editId', ''); edit_tok text := p ->> 'editToken'; eo public.orders;
  k text; n int; total_items int := 0; prod record; surcharge numeric := 0; addons_total numeric := 0; a record; aid text;
  base numeric; sale jsonb; sd numeric := 0; cp jsonb; cdisc numeric := 0; fee numeric := 0; total numeric;
  win int := coalesce((s ->> 'payWindowH')::int, 24); today date; dte date; v_code text; oid text; tok text;
  v_speed text; lead numeric; sh int; earliest date; exp_ms bigint; smin int; startms bigint; minpay int; od jsonb; ms jsonb := '[]'::jsonb; msg text; ch text; sale_txt text := ''; gifts jsonb := '[]'::jsonb; ship jsonb; tries int := 0; open_n int; own_stock int;
begin
  perform public.sweep_orders();
  if length(p::text) > 20000 then perform public.bad('That order is too large.'); end if;

  -- basic fields
  v_size := coalesce((p ->> 'size')::int, 0);
  v_mode := p ->> 'mode';        if v_mode not in ('pickup','delivery') then perform public.bad('Choose pickup or delivery.'); end if;
  v_speed := case when v_mode = 'pickup' then 'pickup' when p ->> 'speed' = 'sameday' then 'sameday' else 'scheduled' end;
  v_day := p ->> 'day';          v_time := p ->> 'time';
  v_note := left(coalesce(p ->> 'note', ''), 300);
  v_notify := coalesce(p ->> 'notify', 'both'); if v_notify not in ('whatsapp','email','both','none') then v_notify := 'both'; end if;
  v_coupon := upper(regexp_replace(coalesce(p ->> 'coupon', ''), '[^A-Za-z0-9_-]', '', 'g'));
  v_expect := nullif(p ->> 'expectTotal', '')::numeric;
  v_name  := btrim(coalesce(p #>> '{customer,name}', ''));
  v_email := btrim(coalesce(p #>> '{customer,email}', ''));
  v_phone := regexp_replace(coalesce(p #>> '{customer,phone}', ''), '\D', '', 'g');
  v_addr  := btrim(coalesce(p #>> '{customer,address}', ''));
  if length(v_name) < 1 or length(v_name) > 80 then perform public.bad('Please enter your name.'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 120 then perform public.bad('Please enter a valid email address.'); end if;
  if v_phone !~ '^\d{8,15}$' then perform public.bad('WhatsApp number: use numbers only, 8 to 15 digits.'); end if;
  if v_mode = 'delivery' then
    if length(v_addr) < 5 or length(v_addr) > 300 then perform public.bad('Please enter your delivery address.'); end if;
  else v_addr := ''; end if;

  -- schedule: pickup, scheduled delivery and sameday shipment each have an on/off switch and their own lead time
  today := (now() at time zone public.shop_tz())::date;
  sh := extract(hour from (now() at time zone public.shop_tz()))::int;
  if (v_speed = 'pickup' and not coalesce((s ->> 'pickupOn')::boolean, true))
     or (v_speed = 'scheduled' and not coalesce((s ->> 'schedOn')::boolean, true))
     or (v_speed = 'sameday' and not coalesce((s ->> 'samedayOn')::boolean, false)) then
    perform public.bad('That option isn''t available right now. Please choose another way to get your order.'); end if;
  if v_speed = 'sameday' then
    if sh >= coalesce((s ->> 'samedayCutoff')::int, 15) then
      perform public.bad('Sameday shipment is closed for today. Please choose another option.'); end if;
    if exists (select 1 from jsonb_array_elements_text(coalesce(s -> 'closedWeekdays', '[]'::jsonb)) w where w::int = extract(dow from today)::int) then
      perform public.bad('We''re closed today. Please choose another option.'); end if;
    dte := today; v_day := today::text; v_time := 'Same day';
  else
    if v_day !~ '^\d{4}-\d{2}-\d{2}$' then perform public.bad('Please pick a day.'); end if;
    begin dte := v_day::date; exception when others then perform public.bad('Please pick a day.'); end;
    lead := greatest(0, least(720, coalesce((s ->> case v_speed when 'pickup' then 'pickupLeadH' else 'schedLeadH' end)::numeric, 24)));
    earliest := ((now() at time zone public.shop_tz()) + make_interval(hours => ceil(lead)::int))::date;
    if sh >= coalesce((s ->> 'cutoffHour')::int, 20) then earliest := earliest + 1; end if;
    if dte < earliest or dte > earliest + 6 then perform public.bad('Please pick another day.'); end if;
    if exists (select 1 from jsonb_array_elements_text(coalesce(s -> 'closedWeekdays', '[]'::jsonb)) w where w::int = extract(dow from dte)::int) then
      perform public.bad('We''re closed that day. Please pick another day.'); end if;
    if not exists (select 1 from jsonb_array_elements_text(coalesce(s -> 'times', '[]'::jsonb)) w where w = v_time) then
      perform public.bad('Please pick a time.'); end if;
    -- a time slot with a daily limit: only orders whose payment is confirmed use it up
    lim := coalesce((select (w ->> 'limit')::int from jsonb_array_elements(coalesce(s -> 'slots', '[]'::jsonb)) w where w ->> 't' = v_time limit 1), 0);
    if lim > 0 and (select count(*) from public.orders o2 where o2.data ->> 'day' = v_day and o2.data ->> 'time' = v_time
                      and o2.data ? 'paidAt' and o2.status <> 'cancelled' and o2.id is distinct from edit_id) >= lim then
      perform public.bad('Sorry, that time slot is full. Please pick another time.'); end if;
  end if;

  -- pay deadline: never later than (pickup/delivery time - lead time), and sameday orders get a short window
  minpay := greatest(1, coalesce((s ->> 'minPayMin')::int, 30));
  exp_ms := t + win * 3600000::bigint;
  if v_speed = 'sameday' then
    exp_ms := least(exp_ms, t + greatest(minpay, coalesce((s ->> 'samedayPayMin')::int, 60)) * 60000::bigint);
  else
    smin := public.slot_start_min(v_time);
    startms := (extract(epoch from ((dte + make_interval(mins => coalesce(smin, 540)))::timestamp at time zone public.shop_tz())) * 1000)::bigint;
    if smin is not null and startms < t + (lead * 3600000)::bigint + minpay * 60000::bigint then
      perform public.bad('That time is too soon for your order. Please pick a later time or day.'); end if;
    exp_ms := least(exp_ms, startms - (lead * 3600000)::bigint);
  end if;
  exp_ms := greatest(exp_ms, t + minpay * 60000::bigint);

  -- editing an existing unpaid order?
  if edit_id is not null then
    select * into eo from public.orders where id = edit_id for update;
    if not found or not exists (select 1 from public.order_tokens where order_id = edit_id and hash = public.tok_hash(edit_tok)) then
      perform public.bad('We couldn''t find that order.'); end if;
    if eo.status <> 'awaiting' then perform public.bad('This order can''t be edited any more.'); end if;
  else
    if not public.throttle_ok('order', 60, 60000) then perform public.bad('We''re very busy right now. Please try again in a minute.'); end if;
    select count(*) into open_n from public.orders where phone_norm = public.norm_phone(v_phone) and status = 'awaiting';
    if open_n >= 3 then perform public.bad('You already have 3 unpaid orders. Please pay or cancel one first.'); end if;
    if (select count(*) from public.orders where status = 'awaiting') >= coalesce((s ->> 'maxOpenOrders')::int, 150) then
      perform public.bad('We''re very busy right now. Please try again a little later.'); end if;
  end if;

  -- items
  if jsonb_typeof(p -> 'items') <> 'object' then perform public.bad('Your box is empty.'); end if;
  for k, n in select key, (value)::int from jsonb_each_text(p -> 'items') loop
    if n < 1 or n > 100 then perform public.bad('Please check your box.'); end if;
    items := items || jsonb_build_object(k, n); total_items := total_items + n;
  end loop;
  base := public.base_price(v_size);
  if base <= 0 then perform public.bad('That box size isn''t available.'); end if;
  if total_items <> v_size then perform public.bad('Please fill every spot in your box.'); end if;

  -- give back this order's own hold first, so stock checks see it
  if edit_id is not null and coalesce((eo.data ->> 'holds')::boolean, false) then
    for k, n in select key, value::int from jsonb_each_text(eo.data -> 'items') loop
      update public.coll set data = jsonb_set(data, '{stock}', to_jsonb(coalesce((data ->> 'stock')::int, 0) + n)), updated_at = t
      where coll = 'products' and id = k and coalesce((data ->> 'track')::boolean, false);
    end loop;
  end if;

  for k, n in select key, value::int from jsonb_each_text(items) order by key loop
    select * into prod from public.coll where coll = 'products' and id = k for update;
    if not found or prod.data ->> 'status' <> 'available' then
      perform public.bad('Sorry, ' || coalesce(prod.data ->> 'name', 'that flavor') || ' just sold out. Please change your box.'); end if;
    if coalesce((prod.data ->> 'track')::boolean, false) then
      own_stock := coalesce((prod.data ->> 'stock')::int, 0);
      if n > own_stock then
        perform public.bad(case when own_stock > 0 then 'Sorry, only ' || own_stock || ' ' || (prod.data ->> 'name') || ' left. Please change your box.'
                                else 'Sorry, ' || (prod.data ->> 'name') || ' just sold out. Please change your box.' end);
      end if;
    end if;
    surcharge := surcharge + coalesce((prod.data ->> 'surcharge')::numeric, 0) * n;
  end loop;
  surcharge := round(surcharge, 2);

  -- extras
  if jsonb_typeof(p -> 'addons') = 'array' then
    for aid in select distinct value from jsonb_array_elements_text(p -> 'addons') loop
      select * into a from public.coll where coll = 'addons' and id = aid;
      if found and coalesce((a.data ->> 'active')::boolean, true) then
        addons_total := addons_total + (a.data ->> 'price')::numeric; addon_ids := addon_ids || to_jsonb(aid);
      end if;
    end loop;
  end if;
  addons_total := round(addons_total, 2);

  -- sale + coupon + delivery fee
  sale := public.best_sale(v_size, base, t);
  if sale is not null then sd := (sale ->> 'discount')::numeric; sale_txt := sale ->> 'text'; end if;
  if edit_id is not null and eo.data ? 'gifts' and coalesce((eo.data ->> 'size')::int, -1) = v_size then gifts := eo.data -> 'gifts';
  else gifts := public.gifts_for(v_size, t); end if;
  if v_coupon <> '' then
    cp := public.cp_eval(v_coupon, v_size, v_phone, edit_id, base, sd);
    if not (cp ->> 'ok')::boolean then perform public.bad((cp ->> 'err') || ' Remove the coupon to continue.'); end if;
    cdisc := (cp ->> 'discount')::numeric;
  end if;
  -- optional Biteship courier price: only when the owner switched it on and the customer picked a courier (signed quote)
  ship := null;
  if v_mode = 'delivery' and coalesce((s #>> '{biteship,on}')::boolean, false) then
    ship := public.biteship_check(v_size, p -> 'ship', t);
    if ship is null and not coalesce((s #>> '{biteship,fallback}')::boolean, true) then
      perform public.bad('Please choose a courier to see your delivery price.'); end if;
  end if;
  if v_mode = 'delivery' and not coalesce((cp ->> 'freeDel')::boolean, false) and not public.free_del_live(v_size, t) then
    if ship is not null then fee := (ship ->> 'price')::numeric;
    else fee := case when v_speed = 'sameday' then coalesce((s ->> 'samedayFee')::numeric, (s ->> 'deliveryFee')::numeric, 0) else coalesce((s ->> 'deliveryFee')::numeric, 0) end; end if;
  end if;
  total := round(base - sd - cdisc + surcharge + addons_total + fee, 2);
  if v_expect is not null and abs(v_expect - total) > 0.015 then
    perform public.bad('Prices changed while you were checking out. The new total is ' || public.money_txt(total) || '. Please review and place your order again.'); end if;

  -- take stock
  for k, n in select key, value::int from jsonb_each_text(items) loop
    update public.coll set data = jsonb_set(data, '{stock}', to_jsonb(coalesce((data ->> 'stock')::int, 0) - n)), updated_at = t
    where coll = 'products' and id = k and coalesce((data ->> 'track')::boolean, false);
  end loop;

  if edit_id is not null then
    od := eo.data || jsonb_build_object('notify', v_notify, 'size', v_size, 'items', items, 'mode', v_mode, 'speed', v_speed, 'day', v_day, 'time', v_time,
      'note', v_note, 'addons', addon_ids, 'sale', sale_txt, 'gifts', gifts, 'bship', ship, 'base', base, 'discount', sd, 'coupon', v_coupon, 'couponDisc', cdisc,
      'surcharge', surcharge, 'addonsTotal', addons_total, 'fee', fee, 'total', total, 'holds', true, 'tracked', true, 'editedAt', t,
      'shuffled', coalesce((p ->> 'shuffled')::boolean, false),
      'customer', jsonb_build_object('name', v_name, 'email', v_email, 'phone', v_phone, 'address', v_addr));
    update public.orders set data = od where id = edit_id;
    return jsonb_build_object('order', od);
  end if;

  loop
    v_code := 'DD-' || (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 6));
    exit when not exists (select 1 from public.orders where orders.code = v_code);
    tries := tries + 1; if tries > 20 then perform public.bad('Please try again.'); end if;
  end loop;
  oid := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  tok := public.new_token();

  msg := 'Hi ' || coalesce(nullif(split_part(v_name, ' ', 1), ''), 'there') || ', your BakeByCulture order ' || v_code || ' (' || public.money_txt(total)
         || ') is waiting for payment. Please pay and send your proof in My orders before it is cancelled automatically.';
  for ch in select unnest(case v_notify when 'both' then array['whatsapp','email'] when 'none' then array[]::text[] else array[v_notify] end) loop
    ms := ms || jsonb_build_array(jsonb_build_object('at', t, 'channel', ch, 'status', 'awaiting', 'text', msg, 'by', 'system'));
  end loop;

  od := jsonb_build_object('id', oid, 'code', v_code, 'tracked', true, 'holds', true, 'createdAt', t, 'expiresAt', exp_ms,
    'status', 'awaiting', 'notify', v_notify, 'size', v_size, 'items', items, 'mode', v_mode, 'speed', v_speed, 'day', v_day, 'time', v_time, 'note', v_note,
    'addons', addon_ids, 'sale', sale_txt, 'gifts', gifts, 'bship', ship, 'base', base, 'discount', sd, 'coupon', v_coupon, 'couponDisc', cdisc, 'surcharge', surcharge,
    'addonsTotal', addons_total, 'fee', fee, 'total', total, 'shuffled', coalesce((p ->> 'shuffled')::boolean, false),
    'customer', jsonb_build_object('name', v_name, 'email', v_email, 'phone', v_phone, 'address', v_addr), 'msgs', ms);
  insert into public.orders (id, code, status, phone_norm, created_at, updated_at, expires_at, data)
    values (oid, v_code, 'awaiting', public.norm_phone(v_phone), t, t, exp_ms, od);
  insert into public.order_tokens values (oid, public.tok_hash(tok), t);
  return jsonb_build_object('order', od, 'token', tok);
end $$;

