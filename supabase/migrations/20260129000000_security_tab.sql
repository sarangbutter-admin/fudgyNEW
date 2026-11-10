-- BakeByCulture migration 29: Security tab (owner only).
--  * every abuse limit and daily courier cap can be changed by the owner (stored privately in private_kv 'security';
--    a missing value uses the built-in default, 0 turns that limit off)
--  * fixes migration 28: the per-visitor checks now sit right after the shop-wide checks
--    (before, the per-visitor order limit only ran when an order code collided, and visits were counted after saving)
--  * changing the limits needs Owner mode (owner password, 5 minutes)
-- Safe to run more than once. Run after migration 28.

create or replace function public.sec_lim(p_name text, p_dflt int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select case when (data ->> p_name) ~ '^\d{1,7}$' then (data ->> p_name)::int end
                   from public.private_kv where key = 'security'), p_dflt)
$$;
create or replace function public.lim_ok(p_key text, p_name text, p_dflt int, p_window_ms bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare m int := public.sec_lim(p_name, p_dflt);
begin return m <= 0 or public.throttle_ok(p_key, m, p_window_ms); end $$;
create or replace function public.lim_ip(p_key text, p_name text, p_dflt int, p_window_ms bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare m int := public.sec_lim(p_name, p_dflt);
begin return m <= 0 or public.throttle_ip(p_key, m, p_window_ms); end $$;
revoke all on function public.sec_lim(text, int), public.lim_ok(text, text, int, bigint), public.lim_ip(text, text, int, bigint) from public, anon, authenticated;

-- rewrite the limit checks in the live functions (exact text swaps; already-swapped text is left alone)
do $$
declare
  r text[][] := array[
    -- function, old text, new text
    ['place_order', ' if not public.throttle_ip(''order-h'', 10, 3600000) or not public.throttle_ip(''order-d'', 30, 86400000) then perform public.bad(''Too many orders from this connection. Please try again later.''); end if;', ''],
    ['place_order', 'if not public.throttle_ok(''order'', 60, 60000) then perform public.bad(''We''''re very busy right now. Please try again in a minute.''); end if;',
                    'if not public.lim_ok(''order'', ''orderAll'', 60, 60000) then perform public.bad(''We''''re very busy right now. Please try again in a minute.''); end if;
    if not public.lim_ip(''order-h'', ''orderIpH'', 10, 3600000) or not public.lim_ip(''order-d'', ''orderIpD'', 30, 86400000) then perform public.bad(''Too many orders from this connection. Please try again later.''); end if;'],
    ['place_order', 'if open_n >= 3 then perform public.bad(''You already have 3 unpaid orders. Please pay or cancel one first.''); end if;',
                    'if public.sec_lim(''phoneOpen'', 3) > 0 and open_n >= public.sec_lim(''phoneOpen'', 3) then perform public.bad(''You already have '' || open_n || '' unpaid orders. Please pay or cancel one first.''); end if;'],
    ['track_order', ' if not public.throttle_ip(''track-m'', 12, 60000) or not public.throttle_ip(''track-h'', 120, 3600000) then perform public.bad(''Too many tries. Please wait a minute.''); end if;', ''],
    ['track_order', 'if not public.throttle_ok(''track'', 30, 60000) then perform public.bad(''Too many tries. Please wait a minute.''); end if;',
                    'if not public.lim_ok(''track'', ''trackAll'', 30, 60000) then perform public.bad(''Too many tries. Please wait a minute.''); end if;
  if not public.lim_ip(''track-m'', ''trackIpM'', 12, 60000) or not public.lim_ip(''track-h'', ''trackIpH'', 120, 3600000) then perform public.bad(''Too many tries. Please wait a minute.''); end if;'],
    ['check_coupon', ' if not public.throttle_ip(''cp-m'', 20, 60000) then return jsonb_build_object(''ok'', false, ''err'', ''Too many tries. Please wait a moment.''); end if;', ''],
    ['check_coupon', 'if not public.throttle_ok(''cp'', 120, 60000) then return jsonb_build_object(''ok'', false, ''err'', ''Too many tries. Please wait a moment.''); end if;',
                     'if not public.lim_ok(''cp'', ''cpAll'', 120, 60000) or not public.lim_ip(''cp-m'', ''cpIpM'', 20, 60000) then return jsonb_build_object(''ok'', false, ''err'', ''Too many tries. Please wait a moment.''); end if;'],
    ['log_visit', ' if not public.throttle_ip(''visit-m'', 120, 60000) then return; end if;', ''],
    ['log_visit', 'if not public.throttle_ok(''visit'', 600, 60000) then return; end if;',
                  'if not public.lim_ok(''visit'', ''visitAll'', 600, 60000) or not public.lim_ip(''visit-m'', ''visitIpM'', 120, 60000) then return; end if;'],
    ['submit_proof', 'public.throttle_ok(''proof:'' || p_id, 8, 3600000)', 'public.lim_ok(''proof:'' || p_id, ''proofH'', 8, 3600000)'],
    ['submit_complaint', 'public.throttle_ok(''complaint:'' || p_id, 4, 3600000)', 'public.lim_ok(''complaint:'' || p_id, ''complaintH'', 4, 3600000)'],
    ['submit_place', 'public.throttle_ok(''place:'' || p_id, 12, 3600000)', 'public.lim_ok(''place:'' || p_id, ''placeH'', 12, 3600000)']];
  i int; f text; d text; n text;
begin
  for f in select distinct x from unnest(array['place_order','track_order','check_coupon','log_visit','submit_proof','submit_complaint','submit_place']) x loop
    select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f limit 1;
    if d is null then continue; end if;
    n := d;
    for i in 1 .. array_length(r, 1) loop
      if r[i][1] = f then n := replace(n, r[i][2], r[i][3]); end if;
    end loop;
    if n <> d then execute n; end if;
  end loop;
end $$;

-- owner: read the limits, Owner mode state and how much of each daily courier cap was used in the last 24 hours
create or replace function public.admin_security_get() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.admins := public.team_me(); em text := lower(coalesce(auth.jwt() ->> 'email', '')); t bigint := public.now_ms();
begin
  perform public.assert_admin();
  if me.role is distinct from 'owner' then perform public.bad('Only an owner can see Security.'); end if;
  return jsonb_build_object(
    'cfg', coalesce((select data from public.private_kv where key = 'security'), '{}'::jsonb),
    'until', coalesce((select until from public.order_unlock where order_id = '__security__' and email = em and until > t), 0),
    'used', jsonb_build_object(
      'rates',   (select count(*) from public.throttle where k = 'bs-day-rates'   and at > t - 86400000),
      'geocode', (select count(*) from public.throttle where k = 'bs-day-geocode' and at > t - 86400000),
      'areas',   (select count(*) from public.throttle where k = 'bs-day-areas'   and at > t - 86400000),
      'orders',  (select count(*) from public.orders where created_at > t - 86400000)));
end $$;

-- owner: Owner mode for the Security tab (5 minutes); empty password = turn it off
create or replace function public.admin_security_mode(p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.admins := public.team_me(); em text := lower(coalesce(auth.jwt() ->> 'email', '')); u bigint := public.now_ms() + 300000;
begin
  perform public.assert_admin();
  if me.role is distinct from 'owner' then perform public.bad('Only an owner can use Owner mode.'); end if;
  if coalesce(p_password, '') = '' then
    update public.order_unlock set until = 0 where order_id = '__security__' and email = em;
    return jsonb_build_object('ok', true, 'until', 0);
  end if;
  if not public.throttle_ok('sudo:' || em, 8, 600000) then
    return jsonb_build_object('ok', false, 'err', 'Too many tries. Please wait 10 minutes.'); end if;
  if not public.owner_pw_ok(p_password) then
    perform public.log_act('Owner password wrong', 'Owner mode on Security');
    return jsonb_build_object('ok', false, 'err', 'That owner password isn''t right.'); end if;
  insert into public.order_unlock (order_id, email, until) values ('__security__', em, u)
    on conflict (order_id, email) do update set until = excluded.until;
  perform public.log_act('Owner mode on: Security', 'for 5 minutes');
  return jsonb_build_object('ok', true, 'until', u);
end $$;

-- owner (Owner mode on): save the limits. Unknown names are dropped; numbers are whole, 0 to 1,000,000 (0 = no limit)
create or replace function public.admin_security_set(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.admins := public.team_me(); out jsonb := '{}'::jsonb; k text; v text;
  names text[] := array['orderAll','orderIpH','orderIpD','phoneOpen','trackAll','trackIpM','trackIpH','cpAll','cpIpM','visitAll','visitIpM',
                        'proofH','complaintH','placeH','bsAreasIpM','bsGeoIpM','bsGeoIpH','bsRatesIpM','bsRatesIpH','capRates','capGeo','capAreas','cacheMin'];
begin
  perform public.assert_admin();
  if me.role is distinct from 'owner' then perform public.bad('Only an owner can change Security.'); end if;
  if not public.owner_unlocked('__security__') then perform public.bad('Turn on Owner mode first (owner password).'); end if;
  foreach k in array names loop
    v := btrim(coalesce(p ->> k, ''));
    if v = '' then continue; end if;
    if v !~ '^\d{1,7}$' or v::int > 1000000 then perform public.bad('"' || k || '" must be a whole number from 0 to 1,000,000.'); end if;
    out := out || jsonb_build_object(k, v::int);
  end loop;
  if coalesce((p ->> 'courierOff')::boolean, false) then out := out || '{"courierOff":true}'::jsonb; end if;
  insert into public.private_kv (key, data, updated_at) values ('security', out, public.now_ms())
    on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
  perform public.log_act('Security limits changed', case when out ? 'courierOff' then 'courier prices paused' else 'saved' end);
  return out;
end $$;

revoke all on function public.admin_security_get(), public.admin_security_mode(text), public.admin_security_set(jsonb) from public, anon, authenticated;
grant execute on function public.admin_security_get(), public.admin_security_mode(text), public.admin_security_set(jsonb) to authenticated;
