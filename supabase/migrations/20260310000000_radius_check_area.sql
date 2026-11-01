-- Delidome migration 69: the delivery radius also works when the customer only picked an AREA (the quote has no map position).
-- The shop then sends the area's position (loc); it is used when the signed quote carries none.
create or replace function public.radius_check(s jsonb, ship jsonb, p jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
declare lim numeric; la numeric; lo numeric; dla numeric; dlo numeric; km numeric;
begin
  if coalesce(s ->> 'orpOn', 'true') = 'false' or coalesce(s ->> 'orpBlock', 'true') = 'false' then return; end if;
  begin
    la := nullif(s ->> 'shopLat', '')::numeric; lo := nullif(s ->> 'shopLng', '')::numeric; lim := nullif(s ->> 'deliveryKm', '')::numeric;
    if ship is not null then dla := nullif(ship ->> 'lat', '')::numeric; dlo := nullif(ship ->> 'lng', '')::numeric; end if;
    if dla is null or dlo is null then dla := nullif(p #>> '{loc,lat}', '')::numeric; dlo := nullif(p #>> '{loc,lng}', '')::numeric; end if;
  exception when others then return; end;
  if la is null or lo is null or lim is null or lim <= 0 or dla is null or dlo is null then return; end if;
  if abs(la) > 90 or abs(dla) > 90 or abs(lo) > 180 or abs(dlo) > 180 then return; end if;
  km := 6371 * 2 * asin(least(1, sqrt(power(sin(radians(dla - la) / 2), 2) + cos(radians(la)) * cos(radians(dla)) * power(sin(radians(dlo - lo) / 2), 2))));
  if km > lim then
    perform public.bad('Sorry, that address is outside our delivery area (about ' || round(km)::text || ' km away, we deliver within ' || trim(trailing '.' from trim(trailing '0' from lim::text)) || ' km). Please choose pickup, or contact us.');
  end if;
end $$;
revoke all on function public.radius_check(jsonb, jsonb, jsonb) from public, anon, authenticated;
