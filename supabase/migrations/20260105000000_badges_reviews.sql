-- BakeByCulture migration 5: badges + best sellers in the shop, reviews only from real buyers.
-- Safe to run more than once.

-- the public shop now also gets the owner's badges and how many of each flavor sold (last 90 days, paid orders only)
create or replace function public.shop_public() returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  perform public.sweep_orders();
  select jsonb_build_object(
    'now', public.now_ms(),
    'docs', coalesce((select jsonb_object_agg(key, data) from public.docs
                      where key in ('settings','page','marquee','announcer','thanks','proofpop','payMethods','badges')), '{}'::jsonb),
    'sizes', public.coll_arr('sizes'),
    'categories', public.coll_arr('categories'),
    'addons', public.coll_arr('addons'),
    'sales', public.coll_arr('sales'),
    'broadcasts', public.coll_arr('broadcasts'),
    'products', coalesce((select jsonb_agg(
        (c.data - 'reviews') || jsonb_build_object('reviews', coalesce(
          (select jsonb_agg(r - 'orderId' || case when r ? 'orderId' then '{"verified":true}'::jsonb else '{}'::jsonb end)
             from jsonb_array_elements(coalesce(c.data -> 'reviews', '[]'::jsonb)) r), '[]'::jsonb))
        order by c.pos, c.id) from public.coll c where c.coll = 'products' and c.data ->> 'status' <> 'hidden'), '[]'::jsonb),
    'sold', coalesce((select jsonb_object_agg(k, n) from (
        select i.key as k, sum((i.value)::int) as n
          from public.orders o, jsonb_each_text(o.data -> 'items') i
         where o.status in ('new','baking','ready','completed') and o.created_at > public.now_ms() - 90 * 86400000::bigint
         group by i.key) s), '{}'::jsonb),
    'coupons', coalesce((select jsonb_agg((c.data - 'maxUses') order by c.pos, c.id) from public.coll c
                         where c.coll = 'coupons' and coalesce((c.data ->> 'show')::boolean, false) and public.cp_live(c.data)), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- open reviews are closed: customers review from their own completed order (submit_rating),
-- once per flavor per order, proven by the order's secret token.
create or replace function public.submit_review(p_pid text, p_user text, p_stars int, p_text text, p_vid text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.bad('Only customers who bought this flavor can review it, from My orders after the order is delivered or picked up.');
end $$;
