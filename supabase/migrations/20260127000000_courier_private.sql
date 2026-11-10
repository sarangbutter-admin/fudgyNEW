-- BakeByCulture migration 27: the courier's live tracking link stays private (only the team can see it).
-- Courier tracking pages can show a map with the pickup point, so customers never receive the link
-- unless the owner switches "Show the live tracking link to customers" on in Delivery & courier.
-- Safe to run more than once. Run after migration 26.
create table if not exists public.courier_private (
  order_id    text primary key references public.orders(id) on delete cascade,
  link        text not null default '',
  tracking_id text not null default '',
  at          bigint
);
alter table public.courier_private enable row level security;      -- no policies: only the server functions touch it

-- links already saved inside orders move here, and are removed from what customers can load
insert into public.courier_private (order_id, link, tracking_id, at)
  select id, coalesce(data #>> '{bship,link}', ''), coalesce(data #>> '{bship,trackingId}', ''), public.now_ms()
  from public.orders where data #>> '{bship,link}' is not null or data #>> '{bship,trackingId}' is not null
  on conflict (order_id) do update set link = excluded.link, tracking_id = excluded.tracking_id;
update public.orders set data = jsonb_set(data, '{bship}', (data -> 'bship') - 'link' - 'trackingId')
  where data #>> '{bship,link}' is not null or data #>> '{bship,trackingId}' is not null;

-- the team reads the link with the order's pictures
create or replace function public.admin_order_files(p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if not (public.has_perm('orders') or public.has_perm('complaints')) then
    raise exception 'You don''t have access to orders. Ask the owner.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'proof', (select data from public.order_files where order_id = p_id and kind = 'proof' and idx = 0),
    'photos', coalesce((select jsonb_agg(data order by idx) from public.order_files where order_id = p_id and kind = 'complaint'), '[]'::jsonb),
    'place', (select data from public.order_files where order_id = p_id and kind = 'place' and idx = 0),
    'refund', (select data from public.order_files where order_id = p_id and kind = 'refund' and idx = 0),
    'courier', (select jsonb_build_object('link', link, 'trackingId', tracking_id) from public.courier_private where order_id = p_id));
end $$;
revoke all on function public.admin_order_files(text) from public;
grant execute on function public.admin_order_files(text) to authenticated;
