-- BakeByCulture migration 30: early warnings, owner alerts and resetting the limits (Security tab).
--  * a visitor who has used most of their allowance (default 70%, Security tab "warnPct") gets a friendly warning:
--    place_order / track_order / check_coupon answers carry "_warn" (the shop shows the warning pop-up)
--  * owner alerts: a whole-shop limit was reached, or a daily courier cap passed 70% / was reached (Security tab + badge)
--  * the owner can reset the counters (all, or one limit) with Owner mode on
--  * per-visitor daily courier limits are handled by the biteship function (throttle_n)
-- Safe to run more than once. Run after migration 29.

-- owner alerts (newest first, at most 30); p_every_ms: the same alert at most once in that time
create or replace function public.sec_alert(p_name text, p_lvl int, p_every_ms bigint) returns void
language plpgsql security definer set search_path = public as $$
declare a jsonb; s jsonb;
begin
  if not public.throttle_ok('alert:' || p_name || ':' || p_lvl, 1, p_every_ms) then return; end if;
  select data -> 'list', data -> 'seen' into a, s from public.private_kv where key = 'sec_alerts';
  a := jsonb_build_array(jsonb_build_object('at', public.now_ms(), 'k', p_name, 'lvl', p_lvl)) || coalesce(a, '[]'::jsonb);
  a := (select coalesce(jsonb_agg(x order by i), '[]'::jsonb) from jsonb_array_elements(a) with ordinality t(x, i) where i <= 30);
  insert into public.private_kv (key, data, updated_at) values ('sec_alerts', jsonb_build_object('list', a, 'seen', coalesce(s, '0'::jsonb)), public.now_ms())
    on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
end $$;

-- a limit for the whole shop; when it is reached the owner is told (at most once an hour)
create or replace function public.lim_ok(p_key text, p_name text, p_dflt int, p_window_ms bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare m int := public.sec_lim(p_name, p_dflt);
begin
  if m <= 0 or public.throttle_ok(p_key, m, p_window_ms) then return true; end if;
  if p_name in ('orderAll', 'trackAll', 'cpAll', 'visitAll') then perform public.sec_alert(p_name, 100, 3600000); end if;
  return false;
end $$;

-- a limit per visitor; past the warning point the answer is marked so the shop can show the friendly warning
create or replace function public.lim_ip(p_key text, p_name text, p_dflt int, p_window_ms bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare m int := public.sec_lim(p_name, p_dflt); ip text; v_k text; n int; t bigint := public.now_ms(); w int;
begin
  if m <= 0 then return true; end if;
  ip := public.client_ip();
  if ip = 'unknown' then return true; end if;
  v_k := p_key || ':' || ip;
  select count(*) into n from public.throttle where throttle.k = v_k and throttle.at > t - p_window_ms;
  if n >= m then return false; end if;
  insert into public.throttle values (v_k, t);
  w := public.sec_lim('warnPct', 70);
  if w > 0 and w < 100 and n + 1 >= ceil(m * w / 100.0) then perform set_config('dd.warn', p_name, true); end if;
  return true;
end $$;

-- adds the warning mark to an answer
create or replace function public.with_warn(j jsonb) returns jsonb
language sql stable set search_path = public as $$
  select case when coalesce(current_setting('dd.warn', true), '') <> '' and jsonb_typeof(j) = 'object'
              then j || jsonb_build_object('_warn', current_setting('dd.warn', true)) else j end
$$;

-- for the courier function: like throttle_ok, but returns how many were used (with this one), or -1 when the limit is reached
create or replace function public.throttle_n(p_key text, p_max int, p_window_ms bigint) returns int
language plpgsql security definer set search_path = public as $$
declare n int; t bigint := public.now_ms();
begin
  select count(*) into n from public.throttle where k = p_key and at > t - p_window_ms;
  if n >= p_max then return -1; end if;
  insert into public.throttle values (p_key, t);
  return n + 1;
end $$;

revoke all on function public.sec_alert(text, int, bigint), public.lim_ok(text, text, int, bigint), public.lim_ip(text, text, int, bigint),
  public.with_warn(jsonb), public.throttle_n(text, int, bigint) from public, anon, authenticated;
grant execute on function public.sec_alert(text, int, bigint), public.throttle_n(text, int, bigint) to service_role;

-- the shop's answers carry the warning mark
do $$
declare
  r text[][] := array[
    ['place_order',  'return jsonb_build_object(''order'', od, ''token'', tok);', 'return public.with_warn(jsonb_build_object(''order'', od, ''token'', tok));'],
    ['track_order',  'return jsonb_build_object(''found'', false);', 'return public.with_warn(jsonb_build_object(''found'', false));'],
    ['track_order',  'return jsonb_build_object(''found'', true, ''order'', o.data, ''token'', tok);', 'return public.with_warn(jsonb_build_object(''found'', true, ''order'', o.data, ''token'', tok));'],
    ['check_coupon', 'return r;', 'return public.with_warn(r);']];
  i int; f text; d text; n text;
begin
  for f in select unnest(array['place_order','track_order','check_coupon']) loop
    select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f limit 1;
    if d is null then continue; end if;
    n := d;
    for i in 1 .. array_length(r, 1) loop
      if r[i][1] = f and position(r[i][3] in n) = 0 then n := replace(n, r[i][2], r[i][3]); end if;
    end loop;
    if n <> d then execute n; end if;
  end loop;
end $$;

-- owner: the limits, Owner mode, usage of the daily caps (last 24 hours) and the alerts
create or replace function public.admin_security_get() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.admins := public.team_me(); em text := lower(coalesce(auth.jwt() ->> 'email', '')); t bigint := public.now_ms(); al jsonb;
begin
  perform public.assert_admin();
  if me.role is distinct from 'owner' then perform public.bad('Only an owner can see Security.'); end if;
  select data into al from public.private_kv where key = 'sec_alerts';
  return jsonb_build_object(
    'cfg', coalesce((select data from public.private_kv where key = 'security'), '{}'::jsonb),
    'until', coalesce((select until from public.order_unlock where order_id = '__security__' and email = em and until > t), 0),
    'alerts', coalesce(al -> 'list', '[]'::jsonb), 'seen', coalesce(al -> 'seen', '0'::jsonb),
    'used', jsonb_build_object(
      'rates',   (select count(*) from public.throttle where k = 'bs-day-rates'   and at > t - 86400000),
      'geocode', (select count(*) from public.throttle where k = 'bs-day-geocode' and at > t - 86400000),
      'areas',   (select count(*) from public.throttle where k = 'bs-day-areas'   and at > t - 86400000),
      'orders',  (select count(*) from public.orders where created_at > t - 86400000)));
end $$;

-- owner: how many alerts are new, and the newest one (checked every minute by the team site)
create or replace function public.admin_security_alerts() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.admins := public.team_me(); al jsonb; s bigint;
begin
  perform public.assert_admin();
  if me.role is distinct from 'owner' then return jsonb_build_object('n', 0); end if;
  select data into al from public.private_kv where key = 'sec_alerts';
  s := coalesce((al ->> 'seen')::bigint, 0);
  return jsonb_build_object('n', (select count(*) from jsonb_array_elements(coalesce(al -> 'list', '[]'::jsonb)) x where (x ->> 'at')::bigint > s),
                            'last', coalesce(al -> 'list' -> 0, 'null'::jsonb));
end $$;

-- owner: mark the alerts as seen
create or replace function public.admin_security_seen() returns void
language plpgsql security definer set search_path = public as $$
declare me public.admins := public.team_me();
begin
  perform public.assert_admin();
  if me.role is distinct from 'owner' then return; end if;
  update public.private_kv set data = jsonb_set(data, '{seen}', to_jsonb(public.now_ms())) where key = 'sec_alerts';
end $$;

-- owner (Owner mode on): save the limits
create or replace function public.admin_security_set(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.admins := public.team_me(); out jsonb := '{}'::jsonb; k text; v text;
  names text[] := array['orderAll','orderIpH','orderIpD','phoneOpen','trackAll','trackIpM','trackIpH','cpAll','cpIpM','visitAll','visitIpM',
                        'proofH','complaintH','placeH','bsAreasIpM','bsAreasIpD','bsGeoIpM','bsGeoIpH','bsGeoIpD','bsRatesIpM','bsRatesIpH','bsRatesIpD',
                        'capRates','capGeo','capAreas','cacheMin','warnPct','alertPct'];
begin
  perform public.assert_admin();
  if me.role is distinct from 'owner' then perform public.bad('Only an owner can change Security.'); end if;
  if not public.owner_unlocked('__security__') then perform public.bad('Turn on Owner mode first (owner password).'); end if;
  foreach k in array names loop
    v := btrim(coalesce(p ->> k, ''));
    if v = '' then continue; end if;
    if v !~ '^\d{1,7}$' or v::int > 1000000 then perform public.bad('"' || k || '" must be a whole number from 0 to 1,000,000.'); end if;
    if k in ('warnPct', 'alertPct') and v::int > 99 then perform public.bad('Warning points must be from 0 to 99 (%).'); end if;
    out := out || jsonb_build_object(k, v::int);
  end loop;
  if coalesce((p ->> 'courierOff')::boolean, false) then out := out || '{"courierOff":true}'::jsonb; end if;
  insert into public.private_kv (key, data, updated_at) values ('security', out, public.now_ms())
    on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
  perform public.log_act('Security limits changed', case when out ? 'courierOff' then 'courier prices paused' else 'saved' end);
  return out;
end $$;

-- owner (Owner mode on): start counting again from zero, for one limit or for everything (the owner-password lockout is kept)
create or replace function public.admin_security_reset(p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.admins := public.team_me(); pat text; n int;
  m jsonb := '{"orderAll":"order","orderIpH":"order-h:%","orderIpD":"order-d:%","trackAll":"track","trackIpM":"track-m:%","trackIpH":"track-h:%",
    "cpAll":"cp","cpIpM":"cp-m:%","visitAll":"visit","visitIpM":"visit-m:%","proofH":"proof:%","complaintH":"complaint:%","placeH":"place:%",
    "bsAreasIpM":"bs-areas:%","bsAreasIpD":"bs-areas-d:%","bsGeoIpM":"bs-geo-m:%","bsGeoIpH":"bs-geo-h:%","bsGeoIpD":"bs-geo-d:%",
    "bsRatesIpM":"bs-rates-m:%","bsRatesIpH":"bs-rates-h:%","bsRatesIpD":"bs-rates-d:%","capRates":"bs-day-rates","capGeo":"bs-day-geocode","capAreas":"bs-day-areas"}';
begin
  perform public.assert_admin();
  if me.role is distinct from 'owner' then perform public.bad('Only an owner can reset Security.'); end if;
  if not public.owner_unlocked('__security__') then perform public.bad('Turn on Owner mode first (owner password).'); end if;
  if p_name = 'all' then
    update public.throttle set at = 0 where at > 0 and k not like 'sudo:%' and k not like 'logclr:%';
  else
    pat := m ->> p_name;
    if pat is null then perform public.bad('Unknown limit.'); end if;
    update public.throttle set at = 0 where at > 0 and k like pat;
    if p_name like 'cap%' then update public.throttle set at = 0 where at > 0 and k like 'alert:' || p_name || ':%'; end if;
  end if;
  get diagnostics n = row_count;
  perform public.log_act('Security counters reset', case when p_name = 'all' then 'everything' else p_name end);
  return jsonb_build_object('ok', true, 'n', n);
end $$;

revoke all on function public.admin_security_get(), public.admin_security_alerts(), public.admin_security_seen(), public.admin_security_set(jsonb), public.admin_security_reset(text) from public, anon, authenticated;
grant execute on function public.admin_security_get(), public.admin_security_alerts(), public.admin_security_seen(), public.admin_security_set(jsonb), public.admin_security_reset(text) to authenticated;
