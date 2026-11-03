-- Delidome migration 73: lifetime numbers for every customer (by WhatsApp number), for the Customers tab, the order tags (NEW / #Repeatx2) and the downloads.
--  * orders (not cancelled), first and last order, total spent (paid orders minus refunds)
--  * where the customer first came from: an affiliator (name and code) or direct
--  * the 3 flavors they order most
--  * coupons claimed + coupon discount, delivery discount (promo or free-delivery coupon), flash sales used + flash discount
-- Safe to run more than once.
create or replace function public.admin_customer_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s jsonb := public.cfg();
begin
  perform public.assert_admin();
  return coalesce((
    with o as (
      select o.phone_norm, o.created_at, o.status, o.id, o.data,
        case when o.data ->> 'mode' = 'delivery' then greatest(0,
          coalesce(nullif((o.data -> 'bship' ->> 'price')::numeric, 0),
                   case when o.data ->> 'speed' = 'sameday' then coalesce(nullif(s ->> 'samedayFee', '')::numeric, nullif(s ->> 'deliveryFee', '')::numeric, 0)
                        else public.store_fee(coalesce(nullif(o.data ->> 'size', '')::int, 6), s) end) - coalesce((o.data ->> 'fee')::numeric, 0)) else 0 end as del_saved
        from public.orders o where o.phone_norm <> '' and o.status <> 'cancelled'),
    ag as (
      select phone_norm, count(*) n, min(created_at) first_at, max(created_at) last_at,
        coalesce(sum((data ->> 'total')::numeric) filter (where status in ('new', 'baking', 'ready', 'completed')), 0) - coalesce(sum((data -> 'refund' ->> 'amount')::numeric), 0) spent,
        count(*) filter (where coalesce(btrim(data ->> 'coupon'), '') <> '') coupons,
        coalesce(sum((data ->> 'couponDisc')::numeric) filter (where coalesce(btrim(data ->> 'coupon'), '') <> ''), 0) coupon_disc,
        coalesce(sum(del_saved), 0) del_disc,
        count(*) filter (where coalesce(data ->> 'sale', '') <> '' and coalesce((data ->> 'discount')::numeric, 0) > 0) flash_n,
        coalesce(sum((data ->> 'discount')::numeric) filter (where coalesce(data ->> 'sale', '') <> ''), 0) flash_disc
        from o group by phone_norm),
    fst as (select distinct on (phone_norm) phone_norm, data -> 'aff' ->> 'id' aff_id from o order by phone_norm, created_at, id),
    fa as (select f.phone_norm, a.name aname, a.username auser, a.code acode from fst f join public.affiliates a on a.id = f.aff_id),
    fl as (select x.phone_norm, e.key pid, sum(coalesce(nullif(e.value::text, 'null')::numeric, 0)) q
             from o x, jsonb_each(coalesce(x.data -> 'items', '{}'::jsonb)) e where jsonb_typeof(x.data -> 'items') = 'object' group by 1, 2),
    top as (select phone_norm, jsonb_agg(jsonb_build_object('id', pid, 'name', coalesce(pn, 'Removed flavor'), 'q', q) order by q desc) fav
              from (select fl.phone_norm, fl.pid, fl.q, (select c.data ->> 'name' from public.coll c where c.coll = 'products' and c.id = fl.pid) pn,
                           row_number() over (partition by fl.phone_norm order by fl.q desc, fl.pid) rn from fl) z where rn <= 3 group by phone_norm)
    select jsonb_object_agg(ag.phone_norm, jsonb_build_object(
      'n', ag.n, 'firstAt', ag.first_at, 'lastAt', ag.last_at, 'spent', ag.spent,
      'src', case when fa.phone_norm is not null then 'aff' else 'direct' end,
      'affName', coalesce(nullif(fa.aname, ''), fa.auser), 'affCode', fa.acode,
      'fav', coalesce(top.fav, '[]'::jsonb),
      'coupons', ag.coupons, 'couponDisc', ag.coupon_disc, 'delDisc', ag.del_disc, 'flashN', ag.flash_n, 'flashDisc', ag.flash_disc))
      from ag left join fa on fa.phone_norm = ag.phone_norm left join top on top.phone_norm = ag.phone_norm), '{}'::jsonb);
end $$;
revoke all on function public.admin_customer_stats() from public, anon;
grant execute on function public.admin_customer_stats() to authenticated;
