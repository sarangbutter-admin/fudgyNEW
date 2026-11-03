-- Delidome migration 74: Store Courier distance fee.
-- Settings: scKmOn (on/off), scPerKm (price for each km), scKmFree (km already included in the starter price, default 0).
-- Delivery fee = starter price (flat / per kg / per cookie) + scPerKm x every started km beyond scKmFree.
-- Distance = straight line from the shop (shopLat / shopLng) to the address position the shop sends (loc). No position or no shop location = starter price only.
-- Sameday keeps its own fee. Safe to run more than once.

create or replace function public.store_fee_km(p_size int, s jsonb, p jsonb) returns numeric
language plpgsql stable set search_path = public as $$
declare base numeric := public.store_fee(p_size, s); la numeric; lo numeric; dla numeric; dlo numeric; km numeric; per numeric; fr numeric;
begin
  if coalesce(s ->> 'scKmOn', 'false') <> 'true' then return base; end if;
  begin
    per := coalesce(nullif(s ->> 'scPerKm', '')::numeric, 0); fr := greatest(0, coalesce(nullif(s ->> 'scKmFree', '')::numeric, 0));
    la := nullif(s ->> 'shopLat', '')::numeric; lo := nullif(s ->> 'shopLng', '')::numeric;
    dla := nullif(p #>> '{loc,lat}', '')::numeric; dlo := nullif(p #>> '{loc,lng}', '')::numeric;
  exception when others then return base; end;
  if per <= 0 or la is null or lo is null or dla is null or dlo is null then return base; end if;
  if abs(la) > 90 or abs(dla) > 90 or abs(lo) > 180 or abs(dlo) > 180 then return base; end if;
  km := 6371 * 2 * asin(least(1, sqrt(power(sin(radians(dla - la) / 2), 2) + cos(radians(la)) * cos(radians(dla)) * power(sin(radians(dlo - lo) / 2), 2))));
  return round(base + per * ceil(greatest(0, km - fr)), 2);
end $$;
revoke all on function public.store_fee_km(int, jsonb, jsonb) from public, anon, authenticated;

do $$ declare d text; begin
  select pg_get_functiondef('public.place_order(jsonb)'::regprocedure) into d;
  if d not like '%store_fee_km(%' then
    d := replace(d, 'else public.store_fee(v_size, s) end, ''store'', '''')', 'else public.store_fee_km(v_size, s, p) end, ''store'', '''')');
    if d not like '%store_fee_km(%' then raise exception 'place_order did not match the expected text'; end if;
    execute d;
  end if;
end $$;

-- the owner password is needed to change the new prices too
do $$ declare d text; begin
  select pg_get_functiondef('public.docs_guard()'::regprocedure) into d;
  if d not like '%scPerKm%' then
    d := replace(d, 'or coalesce(o ->> ''scPerKg'', ''0'')', 'or coalesce(o ->> ''scPerKm'', ''0'') is distinct from coalesce(n ->> ''scPerKm'', ''0'') or coalesce(o ->> ''scKmFree'', ''0'') is distinct from coalesce(n ->> ''scKmFree'', ''0'') or coalesce(o ->> ''scKmOn'', ''false'') is distinct from coalesce(n ->> ''scKmOn'', ''false'') or coalesce(o ->> ''scPerKg'', ''0'')');
    d := replace(d, '''scPerPcs'',''scOn'']', '''scPerPcs'',''scOn'',''scPerKm'',''scKmFree'',''scKmOn'']');
    if d not like '%scPerKm%' then raise exception 'docs_guard did not match the expected text'; end if;
    execute d;
  end if;
end $$;
