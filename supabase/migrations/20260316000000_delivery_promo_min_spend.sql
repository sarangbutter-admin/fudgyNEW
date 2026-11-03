-- Delidome migration 75: a delivery promo (free delivery / amount off delivery) can need a minimum purchase.
-- The promo carries minSpend (0 = none) and minBasis: 'before' = box + extras at full price, 'after' (default) = after the flash sale and coupon discount.
-- The delivery fee itself is never part of it. Under the minimum the customer pays the normal delivery price. Safe to run more than once.
create or replace function public.del_promo_apply(p_n integer, p_at bigint, p_fee numeric, p_src text, p_kind text, p_before numeric, p_after numeric) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare s record; best numeric := p_fee; v numeric; kinds jsonb; key text; mn numeric;
begin
  key := case when p_src = 'store' then 'store' else coalesce(nullif(p_kind, ''), 'regular') end;
  for s in select c.data from public.coll c
           where c.coll = 'sales' and c.data ->> 'type' = 'freedelivery'
             and (c.data ->> 'start')::bigint <= p_at and p_at < (c.data ->> 'end')::bigint
             and (c.data ->> 'appliesTo' = 'all' or (c.data ->> 'appliesTo') = p_n::text
                  or (c.data ->> 'appliesTo' = 'list' and (
                        coalesce(c.data -> 'sizes', '[]'::jsonb) @> to_jsonb(p_n)
                        or (coalesce((c.data ->> 'custom')::boolean, false)
                            and not exists (select 1 from public.coll z where z.coll = 'sizes' and (z.data ->> 'n') = p_n::text))))) loop
    kinds := coalesce(s.data -> 'kinds', case when coalesce(s.data ->> 'scope', 'all') = 'store' then '["store"]'::jsonb else '[]'::jsonb end);
    if jsonb_typeof(kinds) = 'array' and jsonb_array_length(kinds) > 0 and not (kinds ? key) then continue; end if;
    begin mn := coalesce(nullif(s.data ->> 'minSpend', '')::numeric, 0); exception when others then mn := 0; end;
    if mn > 0 and (case when s.data ->> 'minBasis' = 'before' then p_before else p_after end) < mn then continue; end if;
    if coalesce(s.data ->> 'kind', 'free') = 'amount' then v := greatest(0, p_fee - coalesce(nullif(s.data ->> 'amount', '')::numeric, 0)); else v := 0; end if;
    best := least(best, v);
  end loop;
  return best;
end $$;
revoke all on function public.del_promo_apply(integer, bigint, numeric, text, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.del_promo_apply(integer, bigint, numeric, text, text, numeric, numeric) to service_role;

do $$ declare d text; begin
  select pg_get_functiondef('public.place_order(jsonb)'::regprocedure) into d;
  if d not like '%round(base + surcharge + addons_total, 2)%' then
    d := replace(d, $a$'bite', public.bs_kind(ship))$a$, $a$'bite', public.bs_kind(ship), round(base + surcharge + addons_total, 2), round(base - sd - cdisc + surcharge + addons_total, 2))$a$);
    d := replace(d, $a$ end, 'store', '')$a$, $a$ end, 'store', '', round(base + surcharge + addons_total, 2), round(base - sd - cdisc + surcharge + addons_total, 2))$a$);
    if d not like '%round(base + surcharge + addons_total, 2)%' then raise exception 'place_order did not match the expected text'; end if;
    execute d;
  end if;
end $$;
