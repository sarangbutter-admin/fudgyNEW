-- Delidome migration 57: delivery promos can take an amount off (not only free) and can be limited to the Store Courier.
-- A "freedelivery" sale may carry: kind = 'free' (default) | 'amount' (amount = money off the delivery price), scope = 'all' (default) | 'store' (the Biteship couriers keep their price).
-- Old promos have neither field and behave as before (free, every courier). Safe to run more than once.
create or replace function public.del_promo_apply(p_n integer, p_at bigint, p_fee numeric, p_src text) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare s record; best numeric := p_fee; v numeric;
begin
  for s in select c.data from public.coll c
           where c.coll = 'sales' and c.data ->> 'type' = 'freedelivery'
             and (c.data ->> 'start')::bigint <= p_at and p_at < (c.data ->> 'end')::bigint
             and (c.data ->> 'appliesTo' = 'all' or (c.data ->> 'appliesTo') = p_n::text
                  or (c.data ->> 'appliesTo' = 'list' and (
                        coalesce(c.data -> 'sizes', '[]'::jsonb) @> to_jsonb(p_n)
                        or (coalesce((c.data ->> 'custom')::boolean, false)
                            and not exists (select 1 from public.coll z where z.coll = 'sizes' and (z.data ->> 'n') = p_n::text))))) loop
    if coalesce(s.data ->> 'scope', 'all') = 'store' and p_src = 'bite' then continue; end if;
    if coalesce(s.data ->> 'kind', 'free') = 'amount' then v := greatest(0, p_fee - coalesce(nullif(s.data ->> 'amount', '')::numeric, 0)); else v := 0; end if;
    best := least(best, v);
  end loop;
  return best;
end $$;
revoke all on function public.del_promo_apply(integer, bigint, numeric, text) from public, anon, authenticated;
grant execute on function public.del_promo_apply(integer, bigint, numeric, text) to service_role;

do $$ declare d text; begin
  select pg_get_functiondef('public.place_order(jsonb)'::regprocedure) into d;
  if d not like '%del_promo_apply%' then
    d := replace(d, $a$  if v_mode = 'delivery' and not coalesce((cp ->> 'freeDel')::boolean, false) and not public.free_del_live(v_size, t) then
    if ship is not null then fee := (ship ->> 'price')::numeric;
    else fee := case when v_speed = 'sameday' then coalesce((s ->> 'samedayFee')::numeric, (s ->> 'deliveryFee')::numeric, 0) else public.store_fee(v_size, s) end; end if;
  end if;$a$, $a$  if v_mode = 'delivery' and not coalesce((cp ->> 'freeDel')::boolean, false) then
    if ship is not null then fee := public.del_promo_apply(v_size, t, (ship ->> 'price')::numeric, 'bite');
    else fee := public.del_promo_apply(v_size, t, case when v_speed = 'sameday' then coalesce((s ->> 'samedayFee')::numeric, (s ->> 'deliveryFee')::numeric, 0) else public.store_fee(v_size, s) end, 'store'); end if;
  end if;$a$);
    execute d;
  end if;
end $$;
