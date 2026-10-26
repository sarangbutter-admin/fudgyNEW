-- Delidome migration 45: review rewards.
--  * after an order is delivered the customer has N days to rate every flavor; when all are rated the shop draws once per order
--  * only orders of at least a minimum box size whose flavors were ALL rated 5 stars can win; everybody else gets a "sad" or "no reward" message (the page decides what to show)
--  * the pool holds existing coupon codes and free gifts (with stock). Coupons that are missing, off, used up or ending too soon, and gifts out of stock, are never drawn
--  * a won gift becomes a personal code (RV-XXXXXX, tied to the WhatsApp number) that the checkout accepts like the pre-launch gift code; only one gift code per order
-- Safe to run more than once. Run after migration 44.

create table if not exists public.review_rewards (
  id text primary key default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  order_id text unique not null, phone_norm text not null default '', rcode text unique, coupon text,
  item jsonb not null default '{}'::jsonb, at bigint not null, exp bigint, used_order text, used_at bigint);
alter table public.review_rewards enable row level security;
revoke all on public.review_rewards from anon, authenticated;

create or replace function public.rv_cfg() returns jsonb
language sql stable security definer set search_path = public as $$ select coalesce((select data from public.docs where key = 'revrew'), '{}'::jsonb) $$;

-- is this pool item still worth drawing?
create or replace function public.rv_item_ok(it jsonb, cfg jsonb) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare t bigint := public.now_ms(); c jsonb; en bigint; st bigint; need bigint := public.now_ms() + coalesce((cfg ->> 'validDays')::int, 7) * 86400000::bigint; stock int; used int; un bigint;
begin
  if it ->> 'type' = 'coupon' then
    select data into c from public.coll where coll = 'coupons' and data ->> 'code' = upper(coalesce(it ->> 'code', '')) limit 1;
    if c is null or not coalesce((c ->> 'on')::boolean, false) then return false; end if;
    en := public.cp_ms(c ->> 'endsAt'); st := public.cp_ms(c ->> 'startsAt');
    if en is not null and en < need then return false; end if;
    if st is not null and st > t then return false; end if;
    if coalesce((c ->> 'maxUses')::int, 0) > 0 and public.cp_uses(upper(it ->> 'code'), null) >= (c ->> 'maxUses')::int then return false; end if;
    return true;
  end if;
  un := nullif(it ->> 'until', '')::bigint;
  if un is not null and un < need then return false; end if;
  stock := case when (it ->> 'stock') ~ '^[0-9]{1,6}$' then (it ->> 'stock')::int end;
  if stock is null then return true; end if;
  select count(*) into used from public.review_rewards r where r.item ->> 'id' = it ->> 'id' and (r.used_order is not null or coalesce(r.exp, 0) > t);
  return stock - used > 0;
end $$;

create or replace function public.rv_label(it jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c jsonb; nm text;
begin
  if it ->> 'type' = 'coupon' then
    select data into c from public.coll where coll = 'coupons' and data ->> 'code' = upper(coalesce(it ->> 'code', '')) limit 1;
    nm := coalesce(nullif(btrim(it ->> 'name'), ''), case c ->> 'type' when 'percent' then (c ->> 'value') || '% off your box' when 'amount' then public.money_txt((c ->> 'value')::numeric) || ' off your box' else 'Free delivery' end);
  else nm := coalesce(nullif(btrim(it ->> 'name'), ''), 'Surprise gift'); end if;
  return jsonb_build_object('id', it ->> 'id', 'type', it ->> 'type', 'name', left(nm, 60), 'img', coalesce(it ->> 'img', ''));
end $$;

-- the draw (once per order, after the last flavor is rated)
create or replace function public.rv_claim(p_id text, p_token text, p_choice text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; c jsonb := public.rv_cfg(); t bigint := public.now_ms(); items jsonb; rated jsonb; k text; all5 boolean := true; ends bigint; mn int; cap int; todayn int; day0 bigint;
  pool jsonb; it jsonb; valid jsonb := '[]'::jsonb; pick jsonb; tot numeric := 0; r numeric; acc numeric := 0; rc text; ex bigint; lab jsonb; rv jsonb; opts jsonb := '[]'::jsonb; ph text; w numeric;
begin
  if not public.owns(p_id, p_token) then perform public.bad('We couldn''t find that order.'); end if;
  if not coalesce((c ->> 'on')::boolean, false) then return jsonb_build_object('state', 'off'); end if;
  perform pg_advisory_xact_lock(hashtext('delidome-rvclaim'));
  select * into o from public.orders where id = p_id for update;
  if o.status <> 'completed' then return jsonb_build_object('state', 'pending'); end if;
  if o.data ? 'rv' then return jsonb_build_object('state', 'done', 'rv', o.data -> 'rv'); end if;
  items := coalesce(o.data -> 'items', '{}'::jsonb); rated := coalesce(o.data -> 'rated', '{}'::jsonb);
  for k in select jsonb_object_keys(items) loop
    if not exists (select 1 from public.coll where coll = 'products' and id = k) then continue; end if;   -- a flavor removed from the shop never blocks the draw
    if not rated ? k then return jsonb_build_object('state', 'pending'); end if;
    if (rated ->> k)::int < 5 then all5 := false; end if;
  end loop;
  ends := coalesce((o.data ->> 'completedAt')::bigint, o.updated_at, o.created_at) + coalesce((c ->> 'days')::int, 7) * 86400000::bigint;
  mn := coalesce((c ->> 'minBox')::int, 6); cap := coalesce((c ->> 'daily')::int, 0);
  if not all5 then rv := jsonb_build_object('st', 'sad', 'at', t);
  elsif t > ends then rv := jsonb_build_object('st', 'none', 'why', 'late', 'at', t);
  elsif coalesce((o.data ->> 'size')::int, 0) < mn then rv := jsonb_build_object('st', 'none', 'why', 'small', 'at', t);
  else
    day0 := (extract(epoch from (date_trunc('day', now() at time zone public.shop_tz()) at time zone public.shop_tz())) * 1000)::bigint;
    select count(*) into todayn from public.review_rewards where at >= day0;
    if cap > 0 and todayn >= cap then rv := jsonb_build_object('st', 'none', 'why', 'cap', 'at', t);
    else
      pool := coalesce((select data -> 'items' from public.docs where key = 'revpool'), '[]'::jsonb);
      for it in select * from jsonb_array_elements(pool) loop
        if public.rv_item_ok(it, c) then valid := valid || jsonb_build_array(it); tot := tot + greatest(1, coalesce((it ->> 'weight')::numeric, 1)); end if;
      end loop;
      if jsonb_array_length(valid) = 0 then rv := jsonb_build_object('st', 'none', 'why', 'empty', 'at', t);
      else
        if coalesce(c ->> 'mode', 'random') = 'choose' then
          if coalesce(p_choice, '') = '' then
            for it in select * from jsonb_array_elements(valid) loop opts := opts || jsonb_build_array(public.rv_label(it)); end loop;
            return jsonb_build_object('state', 'choose', 'options', opts);
          end if;
          select e into pick from jsonb_array_elements(valid) e where e ->> 'id' = p_choice limit 1;
          if pick is null then perform public.bad('That gift isn''t available any more. Please pick another.'); end if;
        else
          r := random() * tot;
          for it in select * from jsonb_array_elements(valid) loop acc := acc + greatest(1, coalesce((it ->> 'weight')::numeric, 1)); if r <= acc then pick := it; exit; end if; end loop;
          if pick is null then pick := valid -> 0; end if;
        end if;
        lab := public.rv_label(pick); ph := coalesce(o.phone_norm, '');
        if pick ->> 'type' = 'coupon' then
          insert into public.review_rewards (order_id, phone_norm, coupon, item, at) values (o.id, ph, upper(pick ->> 'code'), lab, t);
          rv := jsonb_build_object('st', 'win', 'item', lab, 'code', upper(pick ->> 'code'), 'kind', 'coupon', 'at', t);
        else
          ex := t + coalesce((c ->> 'redeemDays')::int, 30) * 86400000::bigint;
          loop
            rc := 'RV-' || (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 6));
            exit when not exists (select 1 from public.review_rewards where rcode = rc);
          end loop;
          insert into public.review_rewards (order_id, phone_norm, rcode, item, at, exp) values (o.id, ph, rc, lab, t, ex);
          rv := jsonb_build_object('st', 'win', 'item', lab, 'code', rc, 'kind', 'gift', 'exp', ex, 'at', t);
        end if;
      end if;
    end if;
  end if;
  update public.orders set data = data || jsonb_build_object('rv', rv) where id = o.id;
  return jsonb_build_object('state', 'done', 'rv', rv);
end $$;

-- a review-reward gift code at checkout (called from pre_gift_check / pre_gift_claim when the code isn't a pre-launch code)
create or replace function public.rv_gift_check(cd text, pn text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.review_rewards;
begin
  select * into r from public.review_rewards where rcode = cd;
  if r.id is null then return jsonb_build_object('ok', false, 'gift', false); end if;
  if r.used_order is not null then return jsonb_build_object('ok', false, 'gift', true, 'err', 'This reward code was already used.'); end if;
  if r.exp is not null and r.exp < public.now_ms() then return jsonb_build_object('ok', false, 'gift', true, 'err', 'This reward code has expired.'); end if;
  if length(pn) >= 7 and r.phone_norm <> '' and pn <> r.phone_norm then return jsonb_build_object('ok', false, 'gift', true, 'err', 'This reward code belongs to another WhatsApp number.'); end if;
  return jsonb_build_object('ok', true, 'gift', true, 'code', r.rcode, 'exp', r.exp, 'info', jsonb_build_object('title', 'Your review reward', 'tag', 'REVIEW REWARD', 'mode', 'set',
    'items', jsonb_build_array(jsonb_build_object('name', r.item ->> 'name', 'img', coalesce(r.item ->> 'img', ''))), 'pool', 1, 'soldOut', false));
end $$;

create or replace function public.rv_gift_claim(o public.orders, cd text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.review_rewards; g jsonb; t bigint := public.now_ms();
begin
  select * into r from public.review_rewards where rcode = cd;
  if r.id is null then return jsonb_build_object('ok', false, 'err', 'That gift code isn''t valid.'); end if;
  if r.used_order is not null and r.used_order <> o.code then return jsonb_build_object('ok', false, 'err', 'This reward code was already used.'); end if;
  if r.exp is not null and r.exp < t then return jsonb_build_object('ok', false, 'err', 'This reward code has expired.'); end if;
  if r.phone_norm <> '' and r.phone_norm <> o.phone_norm then return jsonb_build_object('ok', false, 'err', 'This reward code belongs to another WhatsApp number.'); end if;
  g := jsonb_build_object('title', 'Your review reward', 'tag', 'REVIEW REWARD', 'mode', 'set', 'src', 'review', 'code', r.rcode, 'at', t, 'drawn', true, 'drawnAt', t, 'pool', 1, 'soldOut', false,
    'items', jsonb_build_array(jsonb_build_object('name', r.item ->> 'name', 'img', coalesce(r.item ->> 'img', ''))));
  update public.review_rewards set used_order = o.code, used_at = t where id = r.id;
  update public.orders set data = data || jsonb_build_object('preGift', g) where id = o.id;
  return jsonb_build_object('ok', true, 'gift', g);
end $$;

-- the existing checks fall back to review rewards when the code is not a pre-launch code
create or replace function public.pre_gift_check(p_code text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.prelaunch_regs; cd text := upper(btrim(coalesce(p_code, ''))); pn text := public.norm_phone(coalesce(p_phone, '')); m text;
begin
  if cd = '' or length(cd) > 24 then return jsonb_build_object('ok', false, 'gift', false); end if;
  if not public.lim_ip('pg-m', 'cpIpM', 20, 60000) then return jsonb_build_object('ok', false, 'gift', true, 'err', 'Too many tries. Please wait a moment.'); end if;
  select * into r from public.prelaunch_regs where code = cd;
  if r.id is null then return public.rv_gift_check(cd, pn); end if;
  if r.used_order is not null then return jsonb_build_object('ok', false, 'gift', true, 'err', 'This gift code was already used.'); end if;
  if r.exp is not null and r.exp < public.now_ms() then return jsonb_build_object('ok', false, 'gift', true, 'err', 'This gift code expired on ' || to_char(to_timestamp(r.exp / 1000.0) at time zone public.shop_tz(), 'DD Mon YYYY') || '.'); end if;
  if length(pn) >= 7 and pn <> r.phone_norm then return jsonb_build_object('ok', false, 'gift', true, 'err', 'This gift code belongs to another WhatsApp number.'); end if;
  m := public.pre_gift_avail(r);
  if m is not null then return jsonb_build_object('ok', false, 'gift', true, 'err', m); end if;
  return jsonb_build_object('ok', true, 'gift', true, 'code', r.code, 'exp', r.exp, 'info', public.pre_gift_json());
end $$;

create or replace function public.pre_gift_claim(p_id text, p_token text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; r public.prelaunch_regs; cd text := upper(btrim(coalesce(p_code, ''))); g jsonb; t bigint := public.now_ms(); m text;
begin
  if not public.owns(p_id, p_token) then return jsonb_build_object('ok', false, 'err', 'Please try again.'); end if;
  select * into o from public.orders where id = p_id;
  if o.id is null or o.data ? 'preGift' or o.created_at < t - 900000 then return jsonb_build_object('ok', false, 'err', 'Please try again.'); end if;
  perform pg_advisory_xact_lock(hashtext('delidome-pregift'));
  select * into r from public.prelaunch_regs where code = cd;
  if r.id is null then return public.rv_gift_claim(o, cd); end if;
  if r.used_order is not null and r.used_order <> o.code then return jsonb_build_object('ok', false, 'err', 'This gift code was already used.'); end if;
  if r.exp is not null and r.exp < t then return jsonb_build_object('ok', false, 'err', 'This gift code has expired.'); end if;
  if r.phone_norm <> o.phone_norm then return jsonb_build_object('ok', false, 'err', 'This gift code belongs to another WhatsApp number.'); end if;
  m := public.pre_gift_avail(r);
  if m is not null then return jsonb_build_object('ok', false, 'err', m); end if;
  g := public.pre_gift_json() || jsonb_build_object('code', r.code, 'at', t, 'drawn', false);
  update public.prelaunch_regs set used_order = o.code, used_at = t where id = r.id;
  update public.orders set data = data || jsonb_build_object('preGift', g) where id = o.id;
  return jsonb_build_object('ok', true, 'gift', g);
end $$;

-- a cancelled order gives its review reward back too
create or replace function public.orders_pre_release() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and coalesce(old.status, '') <> 'cancelled' and new.data ? 'preGift' then
    update public.prelaunch_regs set used_order = null, used_at = null, gift_res = '[]'::jsonb where used_order = new.code;
    update public.review_rewards set used_order = null, used_at = null where used_order = new.code;
  end if;
  return new;
end $$;

-- owner: how many rewards were given today and per gift
create or replace function public.admin_rv_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare day0 bigint := (extract(epoch from (date_trunc('day', now() at time zone public.shop_tz()) at time zone public.shop_tz())) * 1000)::bigint;
begin
  perform public.assert_admin();
  return jsonb_build_object('today', (select count(*) from public.review_rewards where at >= day0), 'total', (select count(*) from public.review_rewards),
    'used', coalesce((select jsonb_object_agg(k, n) from (select item ->> 'id' k, count(*) n from public.review_rewards where used_order is not null or coalesce(exp, 0) > public.now_ms() group by 1) z), '{}'::jsonb),
    'ok', coalesce((select jsonb_object_agg(e ->> 'id', public.rv_item_ok(e, public.rv_cfg())) from jsonb_array_elements(coalesce((select data -> 'items' from public.docs where key = 'revpool'), '[]'::jsonb)) e), '{}'::jsonb));
end $$;

-- the public settings (messages, banner) travel with shop_public
do $$
declare d text;
begin
  d := pg_get_functiondef('public.shop_public()'::regprocedure);
  if position('''revrew''' in d) > 0 then return; end if;
  d := replace(d, '''badges'',''prelaunch'')', '''badges'',''prelaunch'',''revrew'')');
  if position('''revrew''' in d) = 0 then raise exception 'shop_public did not match the expected text'; end if;
  execute d;
end $$;

revoke all on function public.rv_cfg(), public.rv_item_ok(jsonb, jsonb), public.rv_label(jsonb), public.rv_gift_check(text, text), public.rv_gift_claim(public.orders, text), public.orders_pre_release() from public, anon, authenticated;
revoke all on function public.rv_claim(text, text, text), public.admin_rv_status() from public;
grant execute on function public.rv_claim(text, text, text) to anon, authenticated;
grant execute on function public.admin_rv_status() to authenticated;
revoke all on function public.pre_gift_check(text, text), public.pre_gift_claim(text, text, text) from public;
grant execute on function public.pre_gift_check(text, text), public.pre_gift_claim(text, text, text) to anon, authenticated;

-- patch for databases that already ran this file: skip flavors that no longer exist
do $$ declare d text; begin
  select pg_get_functiondef('public.rv_claim(text,text,text)'::regprocedure) into d;
  if d not like '%removed from the shop%' then
    d := replace(d, E'    if not rated ? k then return jsonb_build_object(''state'', ''pending''); end if;', E'    if not exists (select 1 from public.coll where coll = ''products'' and id = k) then continue; end if;\n    if not rated ? k then return jsonb_build_object(''state'', ''pending''); end if;');
    execute d;
  end if;
end $$;
