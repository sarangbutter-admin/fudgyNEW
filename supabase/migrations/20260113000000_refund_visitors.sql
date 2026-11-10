-- BakeByCulture migration 13:
--  * Visitor numbers are only sent to owners. Staff accounts get an empty list (hidden on the screen too).
--  * Refunds: an owner can mark a paid order as refunded (full or part). The customer sees it in the bell and in their order history.
-- Safe to run more than once. Run after migration 12.

create or replace function public.admin_load() returns jsonb
language plpgsql security definer set search_path = public as $$
declare nowt bigint := public.now_ms();
begin
  perform public.assert_admin();
  perform public.sweep_orders();
  return jsonb_build_object(
    'now', nowt,
    'docs', coalesce((select jsonb_object_agg(key, data) from public.docs), '{}'::jsonb),
    'colls', coalesce((select jsonb_object_agg(c, a) from (
        select coll as c, jsonb_agg(jsonb_build_object('id', id, 'pos', pos, 'data', data) order by pos, id) as a from public.coll group by coll) q), '{}'::jsonb),
    'orders', coalesce((select jsonb_agg(data order by created_at desc) from public.orders
                        where created_at > nowt - 180 * 86400000::bigint or status in ('awaiting','review','new','baking','ready')), '[]'::jsonb),
    'visits', case when not public.is_owner() then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('t', t2, 'v', vid)) from
        (select visits.t as t2, vid from public.visits where visits.t > nowt - 40 * 86400000::bigint order by t desc limit 4000) v), '[]'::jsonb) end);
end $$;

create or replace function public.admin_poll(p_since bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t bigint := public.now_ms();
begin
  perform public.assert_admin();
  perform public.sweep_orders();
  return jsonb_build_object(
    'now', t,
    'orders', coalesce((select jsonb_agg(data order by created_at desc) from public.orders where updated_at > coalesce(p_since, 0)), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'stock', data -> 'stock', 'reviews', coalesce(data -> 'reviews', '[]'::jsonb)))
                          from public.coll where coll = 'products' and updated_at > coalesce(p_since, 0)), '[]'::jsonb),
    'visits', case when not public.is_owner() then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('t', v.t, 'v', v.vid)) from public.visits v where v.t > coalesce(p_since, 0)), '[]'::jsonb) end);
end $$;

create or replace function public.admin_refund_order(p_id text, p_amount numeric, p_note text, p_msgs jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; me public.admins := public.team_me(); amt numeric; tot numeric; d jsonb; m jsonb; t bigint := public.now_ms(); ms jsonb;
begin
  perform public.assert_admin();
  if me.role is distinct from 'owner' then perform public.bad('Only an owner can refund an order.'); end if;
  select * into o from public.orders where id = p_id for update;
  if not found then perform public.bad('Order not found'); end if;
  if not (o.data ? 'paidAt') then perform public.bad('Only an order that was paid can be refunded.'); end if;
  if o.data ? 'refund' then perform public.bad('This order is already marked as refunded.'); end if;
  tot := coalesce((o.data ->> 'total')::numeric, 0);
  amt := round(coalesce(p_amount, tot), 2);
  if amt <= 0 or amt > tot then perform public.bad('The refund must be more than 0 and no more than the order total.'); end if;
  ms := coalesce(o.data -> 'msgs', '[]'::jsonb);
  if jsonb_typeof(p_msgs) = 'array' then
    for m in select * from jsonb_array_elements(p_msgs) loop
      if m ->> 'channel' in ('whatsapp', 'email') and btrim(coalesce(m ->> 'text', '')) <> '' then
        ms := ms || jsonb_build_array(jsonb_build_object('at', t, 'channel', m ->> 'channel', 'status', 'refunded', 'text', left(m ->> 'text', 800), 'by', 'staff'));
      end if;
    end loop;
  end if;
  d := o.data || jsonb_build_object('msgs', ms, 'refund', jsonb_build_object(
         'amount', amt, 'full', amt >= tot, 'at', t, 'note', left(btrim(coalesce(p_note, '')), 200),
         'by', coalesce(nullif(me.name, ''), me.username, me.email)));
  perform set_config('dd.op', 'order', true);
  update public.orders set data = d, updated_at = t where id = p_id;
  perform public.log_act('Order ' || coalesce(d ->> 'code', p_id), 'refunded ' || amt::text || case when amt >= tot then ' (full)' else ' (part)' end);
  return d;
end $$;
revoke all on function public.admin_refund_order(text, numeric, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_refund_order(text, numeric, text, jsonb) to authenticated;
