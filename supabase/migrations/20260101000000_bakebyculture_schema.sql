-- =====================================================================
-- BakeByCulture — Supabase schema
--
-- Security model
--   * Every table has row level security ON and NO policies, and all table
--     privileges are revoked from the public roles (anon / authenticated).
--     Nobody can read or write a table directly through the API.
--   * All access goes through SECURITY DEFINER functions (RPC):
--       - public functions (shop_public, place_order, my_orders, ...) only ever
--         return public shop data, or the caller's OWN orders (proved by a
--         secret token that only the customer's browser holds);
--       - admin_* functions check is_admin() (a signed-in Supabase user whose
--         email is listed in public.admins).
--   * The server recomputes every price, checks stock, coupons and delivery
--     dates when an order is placed; the browser can't set its own total.
--
-- Run this whole file once in: Supabase Dashboard > SQL Editor > New query.
-- It is safe to run again (create or replace / if not exists).
-- =====================================================================

-- ---------- tables ----------------------------------------------------
create table if not exists public.admins (
  email text primary key
);

create table if not exists public.docs (            -- one JSON document per setting block
  key        text primary key,
  data       jsonb not null,
  updated_at bigint not null default 0
);

create table if not exists public.coll (            -- rows of a collection (products, sizes, ...)
  coll       text   not null,
  id         text   not null,
  pos        int    not null default 0,
  data       jsonb  not null,
  updated_at bigint not null default 0,
  primary key (coll, id)
);

create table if not exists public.orders (
  id         text primary key,
  code       text not null unique,
  status     text not null,
  phone_norm text not null default '',
  created_at bigint not null,
  updated_at bigint not null,
  expires_at bigint,
  data       jsonb not null                          -- the whole order (customer, items, totals, messages ...)
);
create index if not exists orders_status_exp_idx on public.orders (status, expires_at);
create index if not exists orders_updated_idx    on public.orders (updated_at);
create index if not exists orders_phone_idx      on public.orders (phone_norm);

create table if not exists public.order_tokens (    -- a customer proves ownership with a secret token (stored hashed)
  order_id   text not null references public.orders(id) on delete cascade,
  hash       text not null,
  created_at bigint not null,
  primary key (order_id, hash)
);

create table if not exists public.order_files (     -- payment proof / complaint photos (kept out of the order JSON)
  order_id text   not null references public.orders(id) on delete cascade,
  kind     text   not null check (kind in ('proof','complaint')),
  idx      int    not null default 0,
  data     text   not null,
  at       bigint not null,
  primary key (order_id, kind, idx)
);

create table if not exists public.visits (
  vid    text   not null,
  bucket bigint not null,
  t      bigint not null,
  primary key (vid, bucket)
);
create index if not exists visits_t_idx on public.visits (t);

create table if not exists public.throttle (        -- tiny rate limiter used by the public functions
  k  text   not null,
  at bigint not null
);
create index if not exists throttle_idx on public.throttle (k, at);

-- lock every table down
alter table public.admins       enable row level security;
alter table public.docs         enable row level security;
alter table public.coll         enable row level security;
alter table public.orders       enable row level security;
alter table public.order_tokens enable row level security;
alter table public.order_files  enable row level security;
alter table public.visits       enable row level security;
alter table public.throttle     enable row level security;
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public;

-- ---------- small helpers --------------------------------------------
create or replace function public.now_ms() returns bigint
language sql stable as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
     and exists (select 1 from public.admins a
                 where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create or replace function public.assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Please sign in as the shop owner.' using errcode = '42501';
  end if;
end $$;

create or replace function public.cfg() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select data from public.docs where key = 'settings'), '{}'::jsonb)
$$;

create or replace function public.shop_tz() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select n.name from pg_timezone_names n where n.name = public.cfg() ->> 'tz' limit 1), 'Asia/Jakarta')
$$;

create or replace function public.money_txt(v numeric) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(public.cfg() ->> 'currency', '$') || to_char(round(v, 2), 'FM999999990.00')
$$;

create or replace function public.norm_phone(p text) returns text
language sql immutable as $$
  select regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^(0|62)', '')
$$;

create or replace function public.valid_img(s text) returns boolean
language sql immutable as $$
  select s ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$' and length(s) <= 1500000
$$;

create or replace function public.bad(msg text) returns void
language plpgsql as $$ begin raise exception '%', msg using errcode = 'P0001'; end $$;

create or replace function public.throttle_ok(p_key text, p_max int, p_window_ms bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int; t bigint := public.now_ms();
begin
  if random() < 0.02 then delete from public.throttle where at < t - 86400000; end if;
  select count(*) into n from public.throttle where k = p_key and at > t - p_window_ms;
  if n >= p_max then return false; end if;
  insert into public.throttle values (p_key, t);
  return true;
end $$;

-- hashed secret for customer tokens
create or replace function public.tok_hash(p text) returns text
language sql immutable as $$ select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex') $$;

create or replace function public.new_token() returns text
language sql volatile as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;

create or replace function public.coll_arr(p_coll text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(data order by pos, id), '[]'::jsonb) from public.coll where coll = p_coll
$$;

-- ---------- pricing (mirrors quote() in the web app) ------------------
create or replace function public.base_price(p_n int) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare s jsonb := public.cfg(); sz record;
begin
  select * into sz from public.coll where coll = 'sizes' and id = p_n::text;
  if found then
    if coalesce((sz.data ->> 'active')::boolean, true) then return (sz.data ->> 'price')::numeric; end if;
    return 0;
  end if;
  if coalesce((s ->> 'customOn')::boolean, false)
     and p_n between (s ->> 'customMin')::int and (s ->> 'customMax')::int
     and (p_n - (s ->> 'customMin')::int) % greatest(1, (s ->> 'customStep')::int) = 0 then
    return round(p_n * (s ->> 'customPer')::numeric, 2);
  end if;
  return 0;
end $$;

create or replace function public.best_sale(p_n int, p_price numeric, p_at bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  select jsonb_build_object('id', s.data ->> 'id', 'name', s.data ->> 'name', 'discount', d,
           'text', (s.data ->> 'name') || ' (' ||
                   case when s.data ->> 'type' = 'percent' then (s.data ->> 'value') || '% off'
                        else public.money_txt((s.data ->> 'value')::numeric) || ' off' end || ')')
    into r
  from (select s2.data,
               case when s2.data ->> 'type' = 'percent'
                    then round(p_price * (s2.data ->> 'value')::numeric / 100, 2)
                    else round(least((s2.data ->> 'value')::numeric, p_price), 2) end as d
        from public.coll s2
        where s2.coll = 'sales'
          and (s2.data ->> 'start')::bigint <= p_at and p_at < (s2.data ->> 'end')::bigint
          and (s2.data ->> 'appliesTo' = 'all' or (s2.data ->> 'appliesTo') = p_n::text)) s
  order by d desc limit 1;
  return r;
end $$;

create or replace function public.cp_ms(p_local text) returns bigint     -- "2026-10-13T09:00" in shop time -> epoch ms
language sql stable security definer set search_path = public as $$
  select case when coalesce(p_local, '') = '' then null
         else (extract(epoch from (replace(p_local, 'T', ' ')::timestamp at time zone public.shop_tz())) * 1000)::bigint end
$$;

create or replace function public.cp_uses(p_code text, p_excl text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.orders
  where data ->> 'coupon' = p_code and status <> 'cancelled' and id <> coalesce(p_excl, '')
$$;

create or replace function public.cp_live(c jsonb) returns boolean   -- usable right now (ignoring who is asking)
language plpgsql stable security definer set search_path = public as $$
declare t bigint := public.now_ms(); st bigint := public.cp_ms(c ->> 'startsAt'); en bigint := public.cp_ms(c ->> 'endsAt');
begin
  if not coalesce((c ->> 'on')::boolean, false) then return false; end if;
  if st is not null and t < st then return false; end if;
  if en is not null and t >= en then return false; end if;
  if coalesce((c ->> 'maxUses')::int, 0) > 0 and public.cp_uses(c ->> 'code', null) >= (c ->> 'maxUses')::int then return false; end if;
  return true;
end $$;

create or replace function public.cp_eval(p_code text, p_size int, p_phone text, p_excl text, p_base numeric, p_saledisc numeric) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9_-]', '', 'g'));
  c jsonb; t bigint := public.now_ms(); st bigint; en bigint; room numeric; disc numeric := 0; ph text;
begin
  select data into c from public.coll where coll = 'coupons' and data ->> 'code' = v_code limit 1;
  if c is null then return jsonb_build_object('ok', false, 'err', 'That code isn''t valid. Check the spelling and try again.'); end if;
  st := public.cp_ms(c ->> 'startsAt'); en := public.cp_ms(c ->> 'endsAt');
  if not coalesce((c ->> 'on')::boolean, false) or (en is not null and t >= en) then
    return jsonb_build_object('ok', false, 'err', 'This coupon has expired.'); end if;
  if st is not null and t < st then return jsonb_build_object('ok', false, 'err', 'This coupon isn''t active yet.'); end if;
  if coalesce((c ->> 'maxUses')::int, 0) > 0 and public.cp_uses(v_code, p_excl) >= (c ->> 'maxUses')::int then
    return jsonb_build_object('ok', false, 'err', 'Sorry, this coupon has been fully claimed.'); end if;
  if coalesce(c ->> 'appliesTo', 'all') <> 'all' and (c ->> 'appliesTo') <> p_size::text then
    return jsonb_build_object('ok', false, 'err', 'This coupon is for boxes of ' || (c ->> 'appliesTo') || ' only.'); end if;
  if coalesce((c ->> 'minSpend')::numeric, 0) > 0 and p_base < (c ->> 'minSpend')::numeric then
    return jsonb_build_object('ok', false, 'err', 'Spend at least ' || public.money_txt((c ->> 'minSpend')::numeric) || ' on the box to use this coupon.'); end if;
  if p_saledisc > 0 and not coalesce((c ->> 'stack')::boolean, true) then
    return jsonb_build_object('ok', false, 'err', 'This coupon can''t be combined with the flash sale.'); end if;
  ph := public.norm_phone(p_phone);
  if coalesce((c ->> 'onePerPhone')::boolean, false) and ph <> '' and exists
     (select 1 from public.orders o where o.data ->> 'coupon' = v_code and o.status <> 'cancelled' and o.id <> coalesce(p_excl, '') and o.phone_norm = ph) then
    return jsonb_build_object('ok', false, 'err', 'You''ve already used this coupon.'); end if;
  room := greatest(0, p_base - p_saledisc);
  if c ->> 'type' = 'percent' then disc := round(room * (c ->> 'value')::numeric / 100, 2);
  elsif c ->> 'type' = 'amount' then disc := round(least((c ->> 'value')::numeric, room), 2); end if;
  return jsonb_build_object('ok', true, 'discount', disc, 'freeDel', c ->> 'type' = 'freedelivery',
    'coupon', jsonb_build_object('id', c ->> 'id', 'code', v_code, 'desc', coalesce(c ->> 'desc', ''), 'type', c ->> 'type',
      'value', coalesce((c ->> 'value')::numeric, 0), 'minSpend', coalesce((c ->> 'minSpend')::numeric, 0),
      'appliesTo', coalesce(c ->> 'appliesTo', 'all'), 'stack', coalesce((c ->> 'stack')::boolean, true),
      'onePerPhone', coalesce((c ->> 'onePerPhone')::boolean, false), 'show', coalesce((c ->> 'show')::boolean, false), 'on', true,
      'startsAt', coalesce(c ->> 'startsAt', ''), 'endsAt', coalesce(c ->> 'endsAt', ''), 'maxUses', 0));
end $$;

-- ---------- customer-visible shop data --------------------------------
create or replace function public.sweep_orders() returns void
language plpgsql security definer set search_path = public as $$
declare r record; it record; t bigint := public.now_ms(); win int := coalesce((public.cfg() ->> 'payWindowH')::int, 24);
        msg text; ch text; ms jsonb;
begin
  for r in select id, data from public.orders
           where status = 'awaiting' and expires_at is not null and expires_at <= t order by id for update skip locked loop
    if coalesce((r.data ->> 'holds')::boolean, false) then
      for it in select key as pid, value::int as n from jsonb_each_text(r.data -> 'items') loop
        update public.coll set data = jsonb_set(data, '{stock}', to_jsonb(coalesce((data ->> 'stock')::int, 0) + it.n)), updated_at = t
        where coll = 'products' and id = it.pid and coalesce((data ->> 'track')::boolean, false);
      end loop;
    end if;
    msg := 'Hi ' || coalesce(nullif(split_part(r.data #>> '{customer,name}', ' ', 1), ''), 'there') || ', your order ' || (r.data ->> 'code')
           || ' was cancelled. Not paid within ' || win || ' hours, so it was cancelled automatically. Contact us if you have questions.';
    ms := '[]'::jsonb;
    for ch in select unnest(case coalesce(r.data ->> 'notify', 'both') when 'both' then array['whatsapp','email'] when 'none' then array[]::text[] else array[r.data ->> 'notify'] end) loop
      ms := ms || jsonb_build_array(jsonb_build_object('at', t, 'channel', ch, 'status', 'cancelled', 'text', msg, 'by', 'system'));
    end loop;
    update public.orders set data = (r.data || jsonb_build_object(
        'status', 'cancelled', 'holds', false,
        'cancelReason', 'Not paid within ' || win || ' hours, so it was cancelled automatically.',
        'msgs', coalesce(r.data -> 'msgs', '[]'::jsonb) || ms)) where id = r.id;
  end loop;
end $$;

create or replace function public.shop_public() returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  perform public.sweep_orders();
  select jsonb_build_object(
    'now', public.now_ms(),
    'docs', coalesce((select jsonb_object_agg(key, data) from public.docs
                      where key in ('settings','page','marquee','announcer','thanks','proofpop','payMethods')), '{}'::jsonb),
    'sizes', public.coll_arr('sizes'),
    'categories', public.coll_arr('categories'),
    'addons', public.coll_arr('addons'),
    'sales', public.coll_arr('sales'),
    'broadcasts', public.coll_arr('broadcasts'),
    'products', coalesce((select jsonb_agg(
        (c.data - 'reviews') || jsonb_build_object('reviews', coalesce(
          (select jsonb_agg(r - 'orderId') from jsonb_array_elements(coalesce(c.data -> 'reviews', '[]'::jsonb)) r), '[]'::jsonb))
        order by c.pos, c.id) from public.coll c where c.coll = 'products' and c.data ->> 'status' <> 'hidden'), '[]'::jsonb),
    'coupons', coalesce((select jsonb_agg((c.data - 'maxUses') order by c.pos, c.id) from public.coll c
                         where c.coll = 'coupons' and coalesce((c.data ->> 'show')::boolean, false) and public.cp_live(c.data)), '[]'::jsonb)
  ) into res;
  return res;
end $$;

create or replace function public.check_coupon(p_code text, p_size int, p_phone text default '', p_edit_id text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare base numeric := public.base_price(p_size); sale jsonb; sd numeric := 0; r jsonb;
begin
  if not public.throttle_ok('cp', 120, 60000) then return jsonb_build_object('ok', false, 'err', 'Too many tries. Please wait a moment.'); end if;
  if base <= 0 then return jsonb_build_object('ok', false, 'err', 'That box size isn''t available.'); end if;
  sale := public.best_sale(p_size, base, public.now_ms());
  if sale is not null then sd := (sale ->> 'discount')::numeric; end if;
  r := public.cp_eval(p_code, p_size, p_phone, p_edit_id, base, sd);
  return r;
end $$;

-- ---------- placing / editing an order --------------------------------
create or replace function public.place_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s jsonb := public.cfg(); t bigint := public.now_ms();
  v_size int; v_mode text; v_day text; v_time text; v_note text; v_notify text; v_coupon text; v_expect numeric;
  v_name text; v_email text; v_phone text; v_addr text; items jsonb := '{}'::jsonb; addon_ids jsonb := '[]'::jsonb;
  edit_id text := nullif(p ->> 'editId', ''); edit_tok text := p ->> 'editToken'; eo public.orders;
  k text; n int; total_items int := 0; prod record; surcharge numeric := 0; addons_total numeric := 0; a record; aid text;
  base numeric; sale jsonb; sd numeric := 0; cp jsonb; cdisc numeric := 0; fee numeric := 0; total numeric;
  win int := coalesce((s ->> 'payWindowH')::int, 24); today date; dte date; v_code text; oid text; tok text;
  od jsonb; ms jsonb := '[]'::jsonb; msg text; ch text; sale_txt text := ''; tries int := 0; open_n int; own_stock int;
begin
  perform public.sweep_orders();
  if length(p::text) > 20000 then perform public.bad('That order is too large.'); end if;

  -- basic fields
  v_size := coalesce((p ->> 'size')::int, 0);
  v_mode := p ->> 'mode';        if v_mode not in ('pickup','delivery') then perform public.bad('Choose pickup or delivery.'); end if;
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

  -- schedule
  if v_day !~ '^\d{4}-\d{2}-\d{2}$' then perform public.bad('Please pick a day.'); end if;
  begin dte := v_day::date; exception when others then perform public.bad('Please pick a day.'); end;
  today := (now() at time zone public.shop_tz())::date;
  if extract(hour from (now() at time zone public.shop_tz()))::int >= coalesce((s ->> 'cutoffHour')::int, 20) then today := today + 1; end if;
  if dte < today + 1 or dte > today + 7 then perform public.bad('Please pick another day.'); end if;
  if exists (select 1 from jsonb_array_elements_text(coalesce(s -> 'closedWeekdays', '[]'::jsonb)) w where w::int = extract(dow from dte)::int) then
    perform public.bad('We''re closed that day. Please pick another day.'); end if;
  if not exists (select 1 from jsonb_array_elements_text(coalesce(s -> 'times', '[]'::jsonb)) w where w = v_time) then
    perform public.bad('Please pick a time.'); end if;

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
  if v_coupon <> '' then
    cp := public.cp_eval(v_coupon, v_size, v_phone, edit_id, base, sd);
    if not (cp ->> 'ok')::boolean then perform public.bad((cp ->> 'err') || ' Remove the coupon to continue.'); end if;
    cdisc := (cp ->> 'discount')::numeric;
  end if;
  if v_mode = 'delivery' and not coalesce((cp ->> 'freeDel')::boolean, false) then fee := coalesce((s ->> 'deliveryFee')::numeric, 0); end if;
  total := round(base - sd - cdisc + surcharge + addons_total + fee, 2);
  if v_expect is not null and abs(v_expect - total) > 0.015 then
    perform public.bad('Prices changed while you were checking out. The new total is ' || public.money_txt(total) || '. Please review and place your order again.'); end if;

  -- take stock
  for k, n in select key, value::int from jsonb_each_text(items) loop
    update public.coll set data = jsonb_set(data, '{stock}', to_jsonb(coalesce((data ->> 'stock')::int, 0) - n)), updated_at = t
    where coll = 'products' and id = k and coalesce((data ->> 'track')::boolean, false);
  end loop;

  if edit_id is not null then
    od := eo.data || jsonb_build_object('notify', v_notify, 'size', v_size, 'items', items, 'mode', v_mode, 'day', v_day, 'time', v_time,
      'note', v_note, 'addons', addon_ids, 'sale', sale_txt, 'base', base, 'discount', sd, 'coupon', v_coupon, 'couponDisc', cdisc,
      'surcharge', surcharge, 'addonsTotal', addons_total, 'fee', fee, 'total', total, 'holds', true, 'tracked', true, 'editedAt', t,
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

  od := jsonb_build_object('id', oid, 'code', v_code, 'tracked', true, 'holds', true, 'createdAt', t, 'expiresAt', t + win * 3600000::bigint,
    'status', 'awaiting', 'notify', v_notify, 'size', v_size, 'items', items, 'mode', v_mode, 'day', v_day, 'time', v_time, 'note', v_note,
    'addons', addon_ids, 'sale', sale_txt, 'base', base, 'discount', sd, 'coupon', v_coupon, 'couponDisc', cdisc, 'surcharge', surcharge,
    'addonsTotal', addons_total, 'fee', fee, 'total', total,
    'customer', jsonb_build_object('name', v_name, 'email', v_email, 'phone', v_phone, 'address', v_addr), 'msgs', ms);
  insert into public.orders (id, code, status, phone_norm, created_at, updated_at, expires_at, data)
    values (oid, v_code, 'awaiting', public.norm_phone(v_phone), t, t, t + win * 3600000::bigint, od);
  insert into public.order_tokens values (oid, public.tok_hash(tok), t);
  return jsonb_build_object('order', od, 'token', tok);
end $$;

-- ---------- customer: read / act on own orders ------------------------
create or replace function public.owns(p_id text, p_token text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.order_tokens where order_id = p_id and hash = public.tok_hash(p_token))
$$;

create or replace function public.my_orders(p_refs jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if jsonb_typeof(p_refs) <> 'array' or jsonb_array_length(p_refs) > 40 then return '[]'::jsonb; end if;
  perform public.sweep_orders();
  select coalesce(jsonb_agg(o.data order by o.created_at desc), '[]'::jsonb) into res
  from public.orders o
  join (select r ->> 'id' as id, r ->> 'token' as token from jsonb_array_elements(p_refs) r) x on x.id = o.id
  where exists (select 1 from public.order_tokens t where t.order_id = o.id and t.hash = public.tok_hash(x.token));
  return res;
end $$;

create or replace function public.track_order(p_code text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; tok text := public.new_token(); t bigint := public.now_ms();
begin
  if not public.throttle_ok('track', 30, 60000) then perform public.bad('Too many tries. Please wait a minute.'); end if;
  perform public.sweep_orders();
  select * into o from public.orders
   where code = upper(btrim(coalesce(p_code, ''))) and phone_norm = public.norm_phone(p_phone) and public.norm_phone(p_phone) <> '';
  if not found then
    perform pg_sleep(0.4);
    return jsonb_build_object('found', false);
  end if;
  if (select count(*) from public.order_tokens where order_id = o.id) >= 8 then
    delete from public.order_tokens where order_id = o.id and hash in
      (select hash from public.order_tokens where order_id = o.id order by created_at limit 1);
  end if;
  insert into public.order_tokens values (o.id, public.tok_hash(tok), t);
  return jsonb_build_object('found', true, 'order', o.data, 'token', tok);
end $$;

create or replace function public.order_files(p_id text, p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.owns(p_id, p_token) then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'proof', (select data from public.order_files where order_id = p_id and kind = 'proof' and idx = 0),
    'photos', coalesce((select jsonb_agg(data order by idx) from public.order_files where order_id = p_id and kind = 'complaint'), '[]'::jsonb));
end $$;

create or replace function public.cancel_order(p_id text, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; t bigint := public.now_ms(); k text; n int;
begin
  if not public.owns(p_id, p_token) then perform public.bad('We couldn''t find that order.'); end if;
  select * into o from public.orders where id = p_id for update;
  if o.status <> 'awaiting' then perform public.bad('This order can''t be cancelled any more.'); end if;
  if coalesce((o.data ->> 'holds')::boolean, false) then
    for k, n in select key, value::int from jsonb_each_text(o.data -> 'items') loop
      update public.coll set data = jsonb_set(data, '{stock}', to_jsonb(coalesce((data ->> 'stock')::int, 0) + n)), updated_at = t
      where coll = 'products' and id = k and coalesce((data ->> 'track')::boolean, false);
    end loop;
  end if;
  update public.orders set data = data || jsonb_build_object('status', 'cancelled', 'holds', false, 'cancelReason', 'You cancelled this order.') where id = p_id
    returning data into o.data;
  return o.data;
end $$;

create or replace function public.submit_proof(p_id text, p_token text, p_name text, p_img text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; t bigint := public.now_ms(); nm text := btrim(coalesce(p_name, '')); ms jsonb := '[]'::jsonb; ch text; msg text; d jsonb;
begin
  if not public.owns(p_id, p_token) then perform public.bad('We couldn''t find that order.'); end if;
  if length(nm) < 2 or length(nm) > 80 then perform public.bad('Please enter the name on the payment.'); end if;
  if not public.valid_img(p_img) then perform public.bad('Please attach a photo or screenshot (JPG, PNG or WebP, under 1 MB).'); end if;
  if not public.throttle_ok('proof:' || p_id, 8, 3600000) then perform public.bad('Too many tries. Please wait a while.'); end if;
  select * into o from public.orders where id = p_id for update;
  if o.status <> 'awaiting' then perform public.bad('This order is no longer waiting for payment.'); end if;
  insert into public.order_files (order_id, kind, idx, data, at) values (p_id, 'proof', 0, p_img, t)
    on conflict (order_id, kind, idx) do update set data = excluded.data, at = excluded.at;
  msg := 'Hi ' || coalesce(nullif(split_part(o.data #>> '{customer,name}', ' ', 1), ''), 'there') || ', we got your payment proof for order ' || (o.data ->> 'code') || ' and we''re checking it now.';
  for ch in select unnest(case coalesce(o.data ->> 'notify', 'both') when 'both' then array['whatsapp','email'] when 'none' then array[]::text[] else array[o.data ->> 'notify'] end) loop
    ms := ms || jsonb_build_array(jsonb_build_object('at', t, 'channel', ch, 'status', 'review', 'text', msg, 'by', 'system'));
  end loop;
  d := (o.data - 'rejected') || jsonb_build_object('status', 'review', 'proof', jsonb_build_object('name', nm, 'at', t, 'img', ''),
         'msgs', coalesce(o.data -> 'msgs', '[]'::jsonb) || ms);
  update public.orders set data = d where id = p_id;
  return d;
end $$;

create or replace function public.submit_complaint(p_id text, p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; t bigint := public.now_ms(); win int := coalesce((public.cfg() ->> 'complaintWindowH')::int, 24);
        reason text := coalesce(p ->> 'reason', ''); scope text := coalesce(p ->> 'scope', 'order'); txt text := btrim(coalesce(p ->> 'text', ''));
        its jsonb := '[]'::jsonb; photos jsonb := coalesce(p -> 'photos', '[]'::jsonb); i int := 0; ph text; pid text; d jsonb;
begin
  if not public.owns(p_id, p_token) then perform public.bad('We couldn''t find that order.'); end if;
  if reason not in ('Damaged product','Wrong item','Missing item','Product quality','Late delivery','Other') then perform public.bad('Please choose what went wrong.'); end if;
  if scope not in ('order','items') then scope := 'order'; end if;
  if length(txt) < 10 or length(txt) > 600 then perform public.bad('Please describe the problem (at least 10 characters).'); end if;
  if jsonb_typeof(photos) <> 'array' or jsonb_array_length(photos) > 3 then perform public.bad('You can add up to 3 photos.'); end if;
  if not public.throttle_ok('complaint:' || p_id, 4, 3600000) then perform public.bad('Too many tries. Please wait a while.'); end if;
  select * into o from public.orders where id = p_id for update;
  if o.status <> 'completed' or o.data ? 'complaint' and o.data -> 'complaint' <> 'null'::jsonb then perform public.bad('The complaint window for this order has closed.'); end if;
  if coalesce((o.data ->> 'completedAt')::bigint, 0) + win * 3600000::bigint <= t then perform public.bad('The complaint window for this order has closed.'); end if;
  if scope = 'items' then
    for pid in select value from jsonb_array_elements_text(coalesce(p -> 'items', '[]'::jsonb)) loop
      if o.data -> 'items' ? pid then its := its || to_jsonb(pid); end if;
    end loop;
    if jsonb_array_length(its) = 0 then perform public.bad('Choose which flavors have the problem, or pick Whole order.'); end if;
  end if;
  for ph in select value from jsonb_array_elements_text(photos) loop
    if not public.valid_img(ph) then perform public.bad('One of the photos isn''t a valid image.'); end if;
  end loop;
  for ph in select value from jsonb_array_elements_text(photos) loop
    insert into public.order_files (order_id, kind, idx, data, at) values (p_id, 'complaint', i, ph, t)
      on conflict (order_id, kind, idx) do update set data = excluded.data, at = excluded.at;
    i := i + 1;
  end loop;
  d := o.data || jsonb_build_object('complaint', jsonb_build_object('at', t, 'reason', reason, 'scope', scope, 'items', its,
        'text', txt, 'photos', '[]'::jsonb, 'photoCount', i, 'status', 'open', 'reply', '', 'updatedAt', t));
  update public.orders set data = d where id = p_id;
  return d;
end $$;

create or replace function public.submit_rating(p_id text, p_token text, p_ratings jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; t bigint := public.now_ms(); pid text; r jsonb; stars int; cm text; d jsonb; rated jsonb; usr text; prod record; cnt int := 0;
begin
  if not public.owns(p_id, p_token) then perform public.bad('We couldn''t find that order.'); end if;
  select * into o from public.orders where id = p_id for update;
  if o.status <> 'completed' then perform public.bad('You can rate your cookies after the order is completed.'); end if;
  rated := coalesce(o.data -> 'rated', '{}'::jsonb);
  usr := left(coalesce(nullif(split_part(o.data #>> '{customer,name}', ' ', 1), ''), 'Customer'), 30);
  if jsonb_typeof(p_ratings) <> 'object' then perform public.bad('Tap the stars to rate at least one flavor.'); end if;
  for pid, r in select key, value from jsonb_each(p_ratings) loop
    stars := coalesce((r ->> 'n')::int, 0);
    if stars < 1 or stars > 5 or not (o.data -> 'items' ? pid) or rated ? pid then continue; end if;
    cm := left(btrim(coalesce(r ->> 'comment', '')), 200);
    select * into prod from public.coll where coll = 'products' and id = pid for update;
    if not found then continue; end if;
    update public.coll set data = jsonb_set(data, '{reviews}', coalesce(data -> 'reviews', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'id', substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), 'user', usr, 'text', coalesce(nullif(cm, ''), 'Rated ' || stars || ' out of 5'),
        'stars', stars, 'at', t, 'src', 'customer', 'orderId', p_id))), updated_at = t
      where coll = 'products' and id = pid;
    rated := rated || jsonb_build_object(pid, stars); cnt := cnt + 1;
  end loop;
  if cnt = 0 then perform public.bad('Tap the stars to rate at least one flavor.'); end if;
  d := o.data || jsonb_build_object('rated', rated);
  update public.orders set data = d where id = p_id;
  return d;
end $$;

create or replace function public.submit_review(p_pid text, p_user text, p_stars int, p_text text, p_vid text default '') returns void
language plpgsql security definer set search_path = public as $$
declare t bigint := public.now_ms(); u text := left(btrim(coalesce(p_user, '')), 30); tx text := left(btrim(coalesce(p_text, '')), 280);
begin
  if length(u) < 1 then perform public.bad('Please add your name.'); end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then perform public.bad('Tap a star rating.'); end if;
  if length(tx) < 3 then perform public.bad('Write a few words about the cookie.'); end if;
  if not public.throttle_ok('review', 30, 600000) or not public.throttle_ok('review:' || left(coalesce(p_vid, ''), 40), 3, 86400000) then
    perform public.bad('Thanks! You''ve reached the review limit for today.'); end if;
  perform 1 from public.coll where coll = 'products' and id = p_pid and data ->> 'status' <> 'hidden' for update;
  if not found then perform public.bad('That flavor isn''t available.'); end if;
  update public.coll set data = jsonb_set(data, '{reviews}', coalesce(data -> 'reviews', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'id', substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), 'user', u, 'text', tx, 'stars', p_stars, 'at', t, 'src', 'customer'))), updated_at = t
    where coll = 'products' and id = p_pid;
end $$;

create or replace function public.log_visit(p_vid text) returns void
language plpgsql security definer set search_path = public as $$
declare nowt bigint := public.now_ms();
begin
  if p_vid is null or p_vid !~ '^[A-Za-z0-9]{6,40}$' then return; end if;
  if not public.throttle_ok('visit', 600, 60000) then return; end if;
  insert into public.visits values (p_vid, nowt / 1800000, nowt) on conflict do nothing;
  if random() < 0.01 then delete from public.visits where visits.t < public.now_ms() - 60 * 86400000::bigint; end if;
end $$;

-- ---------- admin (owner only) ----------------------------------------
create or replace function public.admin_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('admin', public.is_admin(), 'email', auth.jwt() ->> 'email')
$$;

create or replace function public.admin_load() returns jsonb
language plpgsql security definer set search_path = public as $$
declare nowt bigint := public.now_ms();
begin
  perform public.assert_admin();
  perform public.sweep_orders();
  return jsonb_build_object(
    'now', nowt,
    'docs', coalesce((select jsonb_object_agg(key, data) from public.docs), '{}'::jsonb),
    'colls', coalesce((select jsonb_object_agg(c, a) from (
        select coll as c, jsonb_agg(jsonb_build_object('id', id, 'pos', pos, 'data', data) order by pos, id) as a from public.coll group by coll) q), '{}'::jsonb),
    'orders', coalesce((select jsonb_agg(data order by created_at desc) from public.orders
                        where created_at > nowt - 180 * 86400000::bigint or status in ('awaiting','review','new','baking','ready')), '[]'::jsonb),
    'visits', coalesce((select jsonb_agg(jsonb_build_object('t', t2, 'v', vid)) from
        (select visits.t as t2, vid from public.visits where visits.t > nowt - 40 * 86400000::bigint order by t desc limit 4000) v), '[]'::jsonb));
end $$;

create or replace function public.admin_poll(p_since bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t bigint := public.now_ms();
begin
  perform public.assert_admin();
  perform public.sweep_orders();
  return jsonb_build_object(
    'now', t,
    'orders', coalesce((select jsonb_agg(data order by created_at desc) from public.orders where updated_at > coalesce(p_since, 0)), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'stock', data -> 'stock', 'reviews', coalesce(data -> 'reviews', '[]'::jsonb)))
                          from public.coll where coll = 'products' and updated_at > coalesce(p_since, 0)), '[]'::jsonb),
    'visits', coalesce((select jsonb_agg(jsonb_build_object('t', v.t, 'v', v.vid)) from public.visits v where v.t > coalesce(p_since, 0)), '[]'::jsonb));
end $$;

create or replace function public.admin_put_doc(p_key text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if p_key !~ '^[a-zA-Z]{2,30}$' then perform public.bad('Bad key'); end if;
  insert into public.docs (key, data, updated_at) values (p_key, p_data, public.now_ms())
    on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
end $$;

-- rows: [{id, pos, data}]  (whole-row replace; used for every collection except products)
create or replace function public.admin_put_rows(p_coll text, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.assert_admin();
  if p_coll not in ('sizes','categories','addons','sales','coupons','broadcasts') then perform public.bad('Bad collection'); end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    insert into public.coll (coll, id, pos, data, updated_at) values (p_coll, r ->> 'id', coalesce((r ->> 'pos')::int, 0), r -> 'data', public.now_ms())
      on conflict (coll, id) do update set pos = excluded.pos, data = excluded.data, updated_at = excluded.updated_at;
  end loop;
end $$;

create or replace function public.admin_del_rows(p_coll text, p_ids jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  delete from public.coll where coll = p_coll and id in (select value from jsonb_array_elements_text(p_ids));
end $$;

-- products: [{id,pos,create?:{full data}, set?:{fields}, replace?:true, stockAdd?:+/-n, revDel?:[ids], revAdd?:[...]}]
create or replace function public.admin_put_products(p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb; cur jsonb; t bigint := public.now_ms(); revs jsonb; rv jsonb;
begin
  perform public.assert_admin();
  for r in select value from jsonb_array_elements(p_rows) loop
    select data into cur from public.coll where coll = 'products' and id = r ->> 'id' for update;
    if cur is null then
      insert into public.coll (coll, id, pos, data, updated_at) values ('products', r ->> 'id', coalesce((r ->> 'pos')::int, 0), coalesce(r -> 'create', r -> 'set'), t);
    else
      if coalesce((r ->> 'replace')::boolean, false) then
        cur := coalesce(r -> 'set', '{}'::jsonb) || jsonb_build_object('stock', coalesce(cur -> 'stock', '0'::jsonb), 'reviews', coalesce(cur -> 'reviews', '[]'::jsonb));
      else
        cur := cur || coalesce(r -> 'set', '{}'::jsonb);
      end if;
      if r ? 'stockAdd' then cur := jsonb_set(cur, '{stock}', to_jsonb(greatest(0, coalesce((cur ->> 'stock')::int, 0) + (r ->> 'stockAdd')::int))); end if;
      revs := coalesce(cur -> 'reviews', '[]'::jsonb);
      if r ? 'revDel' then
        revs := coalesce((select jsonb_agg(x) from jsonb_array_elements(revs) x where not (x ->> 'id' in (select value from jsonb_array_elements_text(r -> 'revDel')))), '[]'::jsonb);
      end if;
      if r ? 'revAdd' then
        for rv in select value from jsonb_array_elements(r -> 'revAdd') loop revs := revs || jsonb_build_array(rv); end loop;
      end if;
      cur := jsonb_set(cur, '{reviews}', revs);
      update public.coll set data = cur, pos = coalesce((r ->> 'pos')::int, pos), updated_at = t where coll = 'products' and id = r ->> 'id';
    end if;
  end loop;
end $$;

-- change an order: whitelisted fields only. Stock follows the status automatically.
create or replace function public.admin_patch_order(p_id text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; t bigint := public.now_ms(); d jsonb; k text; allowed text[] := array[
          'status','expiresAt','cancelReason','paidAt','completedAt','labelAt','courier','awb','rejected','items','total','surcharge','notify'];
        old_hold boolean; new_hold boolean; pid text; n int; ms jsonb; c jsonb;
begin
  perform public.assert_admin();
  select * into o from public.orders where id = p_id for update;
  if not found then perform public.bad('Order not found'); end if;
  if p_patch ? 'status' and (p_patch ->> 'status') not in ('awaiting','review','new','baking','ready','completed','cancelled') then perform public.bad('Unknown status'); end if;
  d := o.data; old_hold := coalesce((d ->> 'holds')::boolean, false);
  for k in select key from jsonb_each(p_patch) loop
    if k = any (allowed) then
      if p_patch -> k = 'null'::jsonb then d := d - k; else d := jsonb_set(d, array[k], p_patch -> k); end if;
    end if;
  end loop;
  if (d ->> 'status') = 'completed' and o.status <> 'completed' and coalesce((d ->> 'completedAt')::bigint, 0) = 0 then d := jsonb_set(d, '{completedAt}', to_jsonb(t)); end if;
  if (d ->> 'status') = 'new' and o.status <> 'new' and not d ? 'paidAt' then d := jsonb_set(d, '{paidAt}', to_jsonb(t)); end if;
  if p_patch ? 'msgsAdd' then
    ms := coalesce(d -> 'msgs', '[]'::jsonb);
    ms := ms || coalesce((select jsonb_agg(m) from jsonb_array_elements(p_patch -> 'msgsAdd') m
                          where jsonb_typeof(m) = 'object' and (m ->> 'channel') in ('whatsapp','email')
                            and length(coalesce(m ->> 'text', '')) <= 800 and (m ->> 'by') in ('staff','system')), '[]'::jsonb);
    d := jsonb_set(d, '{msgs}', ms);
  end if;
  if p_patch ? 'complaint' and d ? 'complaint' then
    c := d -> 'complaint';
    if (p_patch #>> '{complaint,status}') in ('open','review','resolved','rejected') then c := jsonb_set(c, '{status}', p_patch #> '{complaint,status}'); end if;
    if p_patch #> '{complaint,reply}' is not null then c := jsonb_set(c, '{reply}', to_jsonb(left(coalesce(p_patch #>> '{complaint,reply}', ''), 600))); end if;
    c := jsonb_set(c, '{updatedAt}', to_jsonb(t));
    d := jsonb_set(d, '{complaint}', c);
  end if;
  -- stock follows status: an order holds cookies unless it is cancelled
  new_hold := coalesce((d ->> 'tracked')::boolean, true) and (d ->> 'status') <> 'cancelled';
  if coalesce((d ->> 'tracked')::boolean, true) then
    if old_hold then
      for pid, n in select key, value::int from jsonb_each_text(o.data -> 'items') loop
        update public.coll set data = jsonb_set(data, '{stock}', to_jsonb(coalesce((data ->> 'stock')::int, 0) + n)), updated_at = t
        where coll = 'products' and id = pid and coalesce((data ->> 'track')::boolean, false);
      end loop;
    end if;
    if new_hold then
      for pid, n in select key, value::int from jsonb_each_text(d -> 'items') loop
        update public.coll set data = jsonb_set(data, '{stock}', to_jsonb(greatest(0, coalesce((data ->> 'stock')::int, 0) - n))), updated_at = t
        where coll = 'products' and id = pid and coalesce((data ->> 'track')::boolean, false);
      end loop;
    end if;
    d := jsonb_set(d, '{holds}', to_jsonb(new_hold));
  end if;
  update public.orders set data = d where id = p_id;
  return d;
end $$;

create or replace function public.admin_order_files(p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return jsonb_build_object(
    'proof', (select data from public.order_files where order_id = p_id and kind = 'proof' and idx = 0),
    'photos', coalesce((select jsonb_agg(data order by idx) from public.order_files where order_id = p_id and kind = 'complaint'), '[]'::jsonb));
end $$;

create or replace function public.admin_delete_order(p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; k text; n int; t bigint := public.now_ms();
begin
  perform public.assert_admin();
  select * into o from public.orders where id = p_id for update;
  if not found then return; end if;
  if coalesce((o.data ->> 'holds')::boolean, false) then
    for k, n in select key, value::int from jsonb_each_text(o.data -> 'items') loop
      update public.coll set data = jsonb_set(data, '{stock}', to_jsonb(coalesce((data ->> 'stock')::int, 0) + n)), updated_at = t
      where coll = 'products' and id = k and coalesce((data ->> 'track')::boolean, false);
    end loop;
  end if;
  delete from public.orders where id = p_id;
end $$;

-- keep denormalised columns + timestamps in step with the order JSON
create or replace function public.orders_sync() returns trigger
language plpgsql as $$
begin
  new.status     := coalesce(new.data ->> 'status', new.status);
  new.expires_at := nullif(new.data ->> 'expiresAt', '')::bigint;
  new.phone_norm := public.norm_phone(new.data #>> '{customer,phone}');
  new.updated_at := public.now_ms();
  return new;
end $$;
drop trigger if exists orders_sync_trg on public.orders;
create trigger orders_sync_trg before insert or update on public.orders
  for each row execute function public.orders_sync();

-- ---------- who may call what -----------------------------------------
revoke all on function
  public.now_ms(), public.is_admin(), public.assert_admin(), public.cfg(), public.shop_tz(), public.money_txt(numeric), public.norm_phone(text),
  public.valid_img(text), public.bad(text), public.throttle_ok(text,int,bigint), public.tok_hash(text), public.new_token(), public.coll_arr(text),
  public.base_price(int), public.best_sale(int,numeric,bigint), public.cp_ms(text), public.cp_uses(text,text), public.cp_live(jsonb),
  public.cp_eval(text,int,text,text,numeric,numeric), public.sweep_orders(), public.owns(text,text),
  public.orders_sync()
  from public, anon, authenticated;

-- used by the storage policies (returns only true/false)
grant execute on function public.is_admin() to authenticated;

-- public (visitors)
grant execute on function
  public.shop_public(), public.check_coupon(text,int,text,text), public.place_order(jsonb), public.my_orders(jsonb),
  public.track_order(text,text), public.order_files(text,text), public.cancel_order(text,text), public.submit_proof(text,text,text,text),
  public.submit_complaint(text,text,jsonb), public.submit_rating(text,text,jsonb), public.submit_review(text,text,int,text,text),
  public.log_visit(text)
  to anon, authenticated;
-- owner only (the function itself also checks is_admin())
grant execute on function
  public.admin_me(), public.admin_load(), public.admin_poll(bigint), public.admin_put_doc(text,jsonb), public.admin_put_rows(text,jsonb),
  public.admin_del_rows(text,jsonb), public.admin_put_products(jsonb), public.admin_patch_order(text,jsonb), public.admin_order_files(text),
  public.admin_delete_order(text)
  to authenticated;
revoke all on function
  public.shop_public(), public.check_coupon(text,int,text,text), public.place_order(jsonb), public.my_orders(jsonb),
  public.track_order(text,text), public.order_files(text,text), public.cancel_order(text,text), public.submit_proof(text,text,text,text),
  public.submit_complaint(text,text,jsonb), public.submit_rating(text,text,jsonb), public.submit_review(text,text,int,text,text),
  public.log_visit(text),
  public.admin_me(), public.admin_load(), public.admin_poll(bigint), public.admin_put_doc(text,jsonb), public.admin_put_rows(text,jsonb),
  public.admin_del_rows(text,jsonb), public.admin_put_products(jsonb), public.admin_patch_order(text,jsonb), public.admin_order_files(text),
  public.admin_delete_order(text)
  from public;
grant execute on function
  public.shop_public(), public.check_coupon(text,int,text,text), public.place_order(jsonb), public.my_orders(jsonb),
  public.track_order(text,text), public.order_files(text,text), public.cancel_order(text,text), public.submit_proof(text,text,text,text),
  public.submit_complaint(text,text,jsonb), public.submit_rating(text,text,jsonb), public.submit_review(text,text,int,text,text),
  public.log_visit(text)
  to anon, authenticated;
grant execute on function
  public.admin_me(), public.admin_load(), public.admin_poll(bigint), public.admin_put_doc(text,jsonb), public.admin_put_rows(text,jsonb),
  public.admin_del_rows(text,jsonb), public.admin_put_products(jsonb), public.admin_patch_order(text,jsonb), public.admin_order_files(text),
  public.admin_delete_order(text)
  to authenticated;

-- ---------- storage bucket for the owner's uploaded pictures ----------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('shop-media', 'shop-media', true, 10485760,
            array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','audio/mpeg','audio/wav','audio/ogg','audio/mp4',
                  'font/woff2','font/woff','font/ttf','font/otf','application/font-woff','application/font-woff2','application/octet-stream'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

    drop policy if exists "shop-media owner insert" on storage.objects;
    drop policy if exists "shop-media owner update" on storage.objects;
    drop policy if exists "shop-media owner delete" on storage.objects;
    drop policy if exists "shop-media owner select" on storage.objects;
    create policy "shop-media owner select" on storage.objects for select to authenticated
      using (bucket_id = 'shop-media' and public.is_admin());
    create policy "shop-media owner insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'shop-media' and public.is_admin());
    create policy "shop-media owner update" on storage.objects for update to authenticated
      using (bucket_id = 'shop-media' and public.is_admin()) with check (bucket_id = 'shop-media' and public.is_admin());
    create policy "shop-media owner delete" on storage.objects for delete to authenticated
      using (bucket_id = 'shop-media' and public.is_admin());
  end if;
end $$;

-- ---------- optional: sweep unpaid orders every minute ----------------
-- Unpaid orders are also cancelled whenever anyone opens the shop or the admin,
-- so this is only a bonus. To enable it: Dashboard > Database > Extensions > pg_cron, then run:
--   select cron.schedule('bakebyculture-sweep', '* * * * *', $$select public.sweep_orders()$$);
