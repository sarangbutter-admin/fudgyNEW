-- Delidome migration 67: a delivery promo can be limited to chosen delivery options.
-- A "freedelivery" sale may carry kinds = a list of: store (the Store Courier), sameday, instant, car (instant car). Empty or missing = every option.
-- Old promos with scope = 'store' behave as kinds = ['store']. Biteship services are sorted by their (signed) courier and service codes, the same way as in the shop.
-- Safe to run more than once.
create or replace function public.bs_kind(p_ship jsonb) returns text
language sql immutable set search_path = public as $$
  select case
    when lower(coalesce(p_ship ->> 'courier', '') || ' ' || coalesce(p_ship ->> 'service', '')) ~ '(^|[^a-z])(car|mpv|van|truck|pickup|mobil)([^a-z]|$)' then 'car'
    when lower(coalesce(p_ship ->> 'courier', '') || ' ' || coalesce(p_ship ->> 'service', '')) ~ 'same[ _-]?day' then 'sameday'
    when lower(coalesce(p_ship ->> 'courier', '') || ' ' || coalesce(p_ship ->> 'service', '')) ~ 'instant|gojek|grab|lalamove|borzo|deliveree|bike|motor|ojek' then 'instant'
    else 'regular' end $$;

create or replace function public.del_promo_apply(p_n integer, p_at bigint, p_fee numeric, p_src text, p_kind text) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare s record; best numeric := p_fee; v numeric; kinds jsonb; key text;
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
    if coalesce(s.data ->> 'kind', 'free') = 'amount' then v := greatest(0, p_fee - coalesce(nullif(s.data ->> 'amount', '')::numeric, 0)); else v := 0; end if;
    best := least(best, v);
  end loop;
  return best;
end $$;
revoke all on function public.del_promo_apply(integer, bigint, numeric, text, text) from public, anon, authenticated;
grant execute on function public.del_promo_apply(integer, bigint, numeric, text, text) to service_role;

do $$ declare d text; begin
  select pg_get_functiondef('public.place_order(jsonb)'::regprocedure) into d;
  if d not like '%bs_kind(ship)%' then
    d := replace(d, $a$public.del_promo_apply(v_size, t, (ship ->> 'price')::numeric, 'bite')$a$, $a$public.del_promo_apply(v_size, t, (ship ->> 'price')::numeric, 'bite', public.bs_kind(ship))$a$);
    d := replace(d, $a$ end, 'store'); end if;$a$, $a$ end, 'store', ''); end if;$a$);
    execute d;
  end if;
end $$;
