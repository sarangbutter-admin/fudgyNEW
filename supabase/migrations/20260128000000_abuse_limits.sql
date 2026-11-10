-- BakeByCulture migration 28: abuse protection.
--  * limits per visitor (by the connection's IP address) on placing orders, tracking, coupon tries and visit logging,
--    on top of the old shop-wide limits (one visitor can no longer use up everyone's allowance, and can't place unlimited orders)
--  * a small cache for courier price and address lookups, so repeated requests don't cost Biteship / Google calls
-- Safe to run more than once. Run after migration 27.

-- the caller's IP address as seen by the API gateway (Cloudflare's header can't be faked by the visitor)
create or replace function public.client_ip() returns text
language plpgsql stable set search_path = public as $$
declare h jsonb;
begin
  begin h := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then h := null; end;
  return coalesce(nullif(btrim(split_part(coalesce(h ->> 'cf-connecting-ip', h ->> 'x-forwarded-for', ''), ',', 1)), ''), 'unknown');
end $$;

-- the same kind of limit as throttle_ok, but counted per IP address (no limit when the address is unknown)
create or replace function public.throttle_ip(p_key text, p_max int, p_window_ms bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare ip text := public.client_ip();
begin
  if ip = 'unknown' then return true; end if;
  return public.throttle_ok(p_key || ':' || ip, p_max, p_window_ms);
end $$;
revoke all on function public.client_ip(), public.throttle_ip(text, int, bigint) from public, anon, authenticated;

create table if not exists public.quote_cache (
  k   text primary key,
  exp bigint not null,
  data jsonb not null
);
alter table public.quote_cache enable row level security;      -- only the server functions use it

do $$
declare
  rows text[][] := array[
    array['place_order',  'order', 'if not public.throttle_ip(''order-h'', 10, 3600000) or not public.throttle_ip(''order-d'', 30, 86400000) then perform public.bad(''Too many orders from this connection. Please try again later.''); end if;'],
    array['track_order',  'track', 'if not public.throttle_ip(''track-m'', 12, 60000) or not public.throttle_ip(''track-h'', 120, 3600000) then perform public.bad(''Too many tries. Please wait a minute.''); end if;'],
    array['check_coupon', 'cp',    'if not public.throttle_ip(''cp-m'', 20, 60000) then return jsonb_build_object(''ok'', false, ''err'', ''Too many tries. Please wait a moment.''); end if;'],
    array['log_visit',    'visit', 'if not public.throttle_ip(''visit-m'', 120, 60000) then return; end if;']];
  i int; d text; n text;
begin
  for i in 1 .. 4 loop
    select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = rows[i][1] limit 1;
    if d is null or position(rows[i][3] in d) > 0 then continue; end if;      -- missing, or already patched
    n := regexp_replace(d, '(if not public\.throttle_ok\(''' || rows[i][2] || ''', \d+, 60000\) then .*?end if;)', '\1 ' || replace(rows[i][3], '\', '\\'), 's');
    if n <> d then execute n; end if;
  end loop;
end $$;
