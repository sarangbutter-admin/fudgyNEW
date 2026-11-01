-- Delidome migration 68: stop delivery orders outside the delivery radius.
-- Shop settings (Delivery & courier): orpOn, orpBlock (default on), shopLat, shopLng, deliveryKm.
-- The address comes from the signed Biteship quote (lat / lng are part of its signature). For Store Courier orders the shop sends the map position it found (loc).
-- Straight-line distance. If there is no position, or the shop location is not set, nothing is blocked. Safe to run more than once.
create or replace function public.radius_check(s jsonb, ship jsonb, p jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
declare lim numeric; la numeric; lo numeric; dla numeric; dlo numeric; km numeric;
begin
  if coalesce(s ->> 'orpOn', 'true') = 'false' or coalesce(s ->> 'orpBlock', 'true') = 'false' then return; end if;
  begin
    la := nullif(s ->> 'shopLat', '')::numeric; lo := nullif(s ->> 'shopLng', '')::numeric; lim := nullif(s ->> 'deliveryKm', '')::numeric;
    if ship is not null then dla := nullif(ship ->> 'lat', '')::numeric; dlo := nullif(ship ->> 'lng', '')::numeric;
    else dla := nullif(p #>> '{loc,lat}', '')::numeric; dlo := nullif(p #>> '{loc,lng}', '')::numeric; end if;
  exception when others then return; end;
  if la is null or lo is null or lim is null or lim <= 0 or dla is null or dlo is null then return; end if;
  if abs(la) > 90 or abs(dla) > 90 or abs(lo) > 180 or abs(dlo) > 180 then return; end if;
  km := 6371 * 2 * asin(least(1, sqrt(power(sin(radians(dla - la) / 2), 2) + cos(radians(la)) * cos(radians(dla)) * power(sin(radians(dlo - lo) / 2), 2))));
  if km > lim then
    perform public.bad('Sorry, that address is outside our delivery area (about ' || round(km)::text || ' km away, we deliver within ' || trim(trailing '.' from trim(trailing '0' from lim::text)) || ' km). Please choose pickup, or contact us.');
  end if;
end $$;
revoke all on function public.radius_check(jsonb, jsonb, jsonb) from public, anon, authenticated;

do $$ declare d text; begin
  select pg_get_functiondef('public.place_order(jsonb)'::regprocedure) into d;
  if d not like '%radius_check(%' then
    d := replace(d, $a$  if v_mode = 'delivery' and not coalesce((cp ->> 'freeDel')::boolean, false) then
    if ship is not null then fee := public.del_promo_apply($a$, $a$  if v_mode = 'delivery' then perform public.radius_check(s, ship, p); end if;
  if v_mode = 'delivery' and not coalesce((cp ->> 'freeDel')::boolean, false) then
    if ship is not null then fee := public.del_promo_apply($a$);
    execute d;
  end if;
end $$;
