-- Delidome migration 44: "Store Courier" delivery price (flat, per kg or per cookie) and free-delivery promos for several box sizes.
--  * scheduled delivery has no surcharge of its own: the price is the chosen courier's, or the Store Courier's (also the fallback when courier prices can't load)
--  * Store Courier price: flat (settings.deliveryFee), per started kg (weight = cookies x grams + box grams) or per cookie
--  * a free-delivery promo can apply to every size, one size (old style) or a list of sizes (+ custom boxes)
-- Safe to run more than once. Run after migration 43.

create or replace function public.store_fee(p_size int, s jsonb) returns numeric
language plpgsql stable set search_path = public as $$
declare m text := coalesce(s ->> 'scMode', 'flat'); g numeric;
begin
  if m = 'pcs' then return round(p_size * coalesce((s ->> 'scPerPcs')::numeric, 0), 2); end if;
  if m = 'kg' then
    g := p_size * coalesce((s ->> 'scGrams')::numeric, 100) + coalesce((s ->> 'scBoxG')::numeric, 200);
    return round(ceil(g / 1000.0) * coalesce((s ->> 'scPerKg')::numeric, 0), 2);
  end if;
  return coalesce((s ->> 'deliveryFee')::numeric, 0);
end $$;

create or replace function public.free_del_live(p_n integer, p_at bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.coll s
                 where s.coll = 'sales' and s.data ->> 'type' = 'freedelivery'
                   and (s.data ->> 'start')::bigint <= p_at and p_at < (s.data ->> 'end')::bigint
                   and (s.data ->> 'appliesTo' = 'all' or (s.data ->> 'appliesTo') = p_n::text
                        or (s.data ->> 'appliesTo' = 'list' and (
                              coalesce(s.data -> 'sizes', '[]'::jsonb) @> to_jsonb(p_n)
                              or (coalesce((s.data ->> 'custom')::boolean, false)
                                  and not exists (select 1 from public.coll z where z.coll = 'sizes' and (z.data ->> 'n') = p_n::text))))))
$$;

-- place_order: the delivery price when no Biteship courier was picked is the Store Courier price (scheduled) or the sameday fee
do $$
declare d text; d0 text; o1 text; n1 text; o2 text; n2 text;
begin
  d0 := pg_get_functiondef('public.place_order(jsonb)'::regprocedure); d := d0;
  o1 := 'if ship is null and not coalesce((s #>> ''{biteship,fallback}'')::boolean, true) then';
  n1 := 'if ship is null and (not coalesce((s #>> ''{biteship,fallback}'')::boolean, true) or not coalesce((s ->> ''scOn'')::boolean, true)) then';
  o2 := 'else fee := case when v_speed = ''sameday'' then coalesce((s ->> ''samedayFee'')::numeric, (s ->> ''deliveryFee'')::numeric, 0) else coalesce((s ->> ''deliveryFee'')::numeric, 0) end; end if;';
  n2 := 'else fee := case when v_speed = ''sameday'' then coalesce((s ->> ''samedayFee'')::numeric, (s ->> ''deliveryFee'')::numeric, 0) else public.store_fee(v_size, s) end; end if;';
  if position(o1 in d) = 0 or position(o2 in d) = 0 then
    if position('store_fee' in d) > 0 then return; end if;
    raise exception 'place_order did not match the expected text';
  end if;
  d := replace(replace(d, o1, n1), o2, n2);
  execute d;
end $$;

-- team members need the owner password to change the new prices too
create or replace function public.docs_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text := coalesce(new.key, old.key); perm text; o jsonb; n jsonb; ch text; lbl text;
begin
  if coalesce(current_setting('dd.op', true), '') <> 'team' then return coalesce(new, old); end if;
  if tg_op = 'INSERT' and exists (select 1 from public.docs x where x.key = new.key) then return new; end if;
  if tg_op <> 'INSERT' then o := old.data; end if;
  if tg_op in ('INSERT','UPDATE') then n := new.data; end if;
  perm := case when k in ('settings','payMethods','thanks','proofpop') then 'settings' when k in ('page','marquee','announcer') then 'design'
               when k = 'badges' then 'badges' when k = 'label' then 'labels' when k = 'alerts' then null else 'settings' end;
  if perm is not null and not public.has_perm(perm) then raise exception 'You don''t have access to change this. Ask the owner.' using errcode = '42501'; end if;
  if k = 'settings' and tg_op = 'UPDATE' and not public.sudo_ok() and
     ((o -> 'deliveryFee') is distinct from (n -> 'deliveryFee') or (o -> 'customPer') is distinct from (n -> 'customPer')
      or (o ? 'samedayFee' and (o -> 'samedayFee') is distinct from (n -> 'samedayFee'))
      or coalesce(o ->> 'scPerKg', '0') is distinct from coalesce(n ->> 'scPerKg', '0') or coalesce(o ->> 'scPerPcs', '0') is distinct from coalesce(n ->> 'scPerPcs', '0')
      or coalesce(o ->> 'scMode', 'flat') is distinct from coalesce(n ->> 'scMode', 'flat')) then
    raise exception 'Owner password needed to change a price.' using errcode = 'P0001'; end if;
  if k = 'alerts' then return coalesce(new, old); end if;
  lbl := case k when 'settings' then 'shop settings' when 'payMethods' then 'payment methods' when 'thanks' then 'order placed page'
                when 'proofpop' then 'payment popup' when 'page' then 'landing page / top banner' when 'marquee' then 'marquee banner'
                when 'announcer' then 'announcer' when 'badges' then 'badges' when 'label' then 'shipping label' else k end;
  if k = 'settings' then ch := public.chg_list(o, n, array['deliveryFee','samedayFee','customPer','currency','payWindowH','cutoffHour','lowStockAt','menuSort','samedayOn','samedayLeadH','samedayCutoff','pickupOn','pickupLeadH','schedOn','schedLeadH','scMode','scPerKg','scPerPcs','scOn']);
  else ch := ''; end if;
  if (o is distinct from n) then perform public.log_act('Edited ' || lbl, ch); end if;
  return coalesce(new, old);
end $$;
