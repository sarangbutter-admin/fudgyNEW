-- BakeByCulture migration 21: customers can change the driver note / place photo until a courier is booked (not after).
-- Safe to run more than once. Run after migration 20.
create or replace function public.submit_place(p_id text, p_token text, p_note text, p_img text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; s jsonb := public.cfg(); t bigint := public.now_ms(); d jsonb; nt text := left(btrim(coalesce(p_note, '')), 200); has boolean;
begin
  if not public.owns(p_id, p_token) then perform public.bad('We couldn''t find that order.'); end if;
  if not public.throttle_ok('place:' || p_id, 12, 3600000) then perform public.bad('Too many tries. Please wait a while.'); end if;
  select * into o from public.orders where id = p_id for update;
  if (o.data ->> 'mode') <> 'delivery' then perform public.bad('This order is not a delivery.'); end if;
  if o.status not in ('awaiting','review','new','baking') or coalesce(o.data #>> '{bship,biteshipId}', '') <> '' then
    perform public.bad('The courier is already booked, so the delivery details can''t change now. Please message the shop.'); end if;
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
revoke all on function public.submit_place(text,text,text,text) from public, anon, authenticated;
grant execute on function public.submit_place(text,text,text,text) to anon, authenticated;
