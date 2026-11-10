-- BakeByCulture migration 20: optional "Note for the driver" and "Photo of your place" for delivery orders.
-- Safe to run more than once. Run after migration 19. Switched on/off in the Delivery & courier tab.
-- The photo is kept out of the order (like payment proofs), only the shop and that customer can see it,
-- and it is deleted 3 days after the order is delivered or cancelled.

create or replace function public.place_cleanup() returns void
language sql security definer set search_path = public as $$
  delete from public.order_files f using public.orders o
  where f.kind = 'place' and o.id = f.order_id and o.status in ('completed','cancelled')
    and coalesce(nullif(o.data ->> 'completedAt', '')::bigint, o.updated_at) < public.now_ms() - 3 * 86400000::bigint;
$$;

-- customer: save the driver note and/or the place photo for their own order (p_img: data URL, '' keeps, 'remove' deletes)
create or replace function public.submit_place(p_id text, p_token text, p_note text, p_img text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; s jsonb := public.cfg(); t bigint := public.now_ms(); d jsonb; nt text := left(btrim(coalesce(p_note, '')), 200); has boolean;
begin
  if not public.owns(p_id, p_token) then perform public.bad('We couldn''t find that order.'); end if;
  if not public.throttle_ok('place:' || p_id, 12, 3600000) then perform public.bad('Too many tries. Please wait a while.'); end if;
  select * into o from public.orders where id = p_id for update;
  if (o.data ->> 'mode') <> 'delivery' then perform public.bad('This order is not a delivery.'); end if;
  if o.status not in ('awaiting','review','new','baking') then perform public.bad('The courier is already on the way. Please contact the shop.'); end if;
  if not coalesce((s ->> 'dnoteOn')::boolean, true) then nt := coalesce(o.data #>> '{place,note}', ''); end if;
  if coalesce(p_img, '') = 'remove' then
    delete from public.order_files where order_id = p_id and kind = 'place';
  elsif coalesce(p_img, '') <> '' then
    if not coalesce((s ->> 'dphotoOn')::boolean, true) then perform public.bad('Photos are switched off.'); end if;
    if not public.valid_img(p_img) then perform public.bad('Please attach a photo (JPG, PNG or WebP, under 1 MB).'); end if;
    insert into public.order_files (order_id, kind, idx, data, at) values (p_id, 'place', 0, p_img, t)
      on conflict (order_id, kind, idx) do update set data = excluded.data, at = excluded.at;
  end if;
  has := exists (select 1 from public.order_files where order_id = p_id and kind = 'place');
  d := o.data || jsonb_build_object('place', jsonb_build_object('note', nt, 'photo', has, 'at', t));
  update public.orders set data = d where id = p_id;
  perform public.place_cleanup();
  return d;
end $$;

create or replace function public.order_files(p_id text, p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.owns(p_id, p_token) then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'proof', (select data from public.order_files where order_id = p_id and kind = 'proof' and idx = 0),
    'photos', coalesce((select jsonb_agg(data order by idx) from public.order_files where order_id = p_id and kind = 'complaint'), '[]'::jsonb),
    'place', (select data from public.order_files where order_id = p_id and kind = 'place' and idx = 0));
end $$;

create or replace function public.admin_order_files(p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if not (public.has_perm('orders') or public.has_perm('complaints')) then
    raise exception 'You don''t have access to orders. Ask the owner.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'proof', (select data from public.order_files where order_id = p_id and kind = 'proof' and idx = 0),
    'photos', coalesce((select jsonb_agg(data order by idx) from public.order_files where order_id = p_id and kind = 'complaint'), '[]'::jsonb),
    'place', (select data from public.order_files where order_id = p_id and kind = 'place' and idx = 0));
end $$;

revoke all on function public.place_cleanup(), public.submit_place(text,text,text,text) from public, anon, authenticated;
grant execute on function public.submit_place(text,text,text,text) to anon, authenticated;
grant execute on function public.place_cleanup() to service_role;
revoke all on function public.order_files(text,text), public.admin_order_files(text) from public;
grant execute on function public.order_files(text,text) to anon, authenticated;
grant execute on function public.admin_order_files(text) to authenticated;
