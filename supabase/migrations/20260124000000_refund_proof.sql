-- BakeByCulture migration 24: a refund needs a picture proof (the transfer receipt / screenshot).
--  * the picture is kept out of the order (like payment proofs) in order_files, kind 'refund'; the order only keeps refund.proof = true
--  * admin_refund_order now takes the picture and refuses to save a refund without it (the old 4-argument version is removed)
--  * admin_order_files also returns the refund picture
--  * also allows kind 'place' in order_files (the driver place photo of migrations 20 and 21 uses it)
-- Safe to run more than once. Run after migration 23.

do $$ begin
  alter table public.order_files drop constraint if exists order_files_kind_check;
  alter table public.order_files add constraint order_files_kind_check check (kind in ('proof','complaint','place','refund'));
end $$;

drop function if exists public.admin_refund_order(text, numeric, text, jsonb);
create or replace function public.admin_refund_order(p_id text, p_amount numeric, p_note text, p_msgs jsonb, p_img text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; me public.admins := public.team_me(); amt numeric; tot numeric; d jsonb; m jsonb; t bigint := public.now_ms(); ms jsonb;
begin
  perform public.assert_admin();
  if me.role is distinct from 'owner' then perform public.bad('Only an owner can refund an order.'); end if;
  if not public.owner_unlocked(p_id) then perform public.bad('Turn on Owner mode for this order to refund it.'); end if;
  if not public.valid_img(p_img) then perform public.bad('Upload the refund proof picture first (JPG, PNG or WebP, under 1 MB).'); end if;
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
  insert into public.order_files (order_id, kind, idx, data, at) values (p_id, 'refund', 0, p_img, t)
    on conflict (order_id, kind, idx) do update set data = excluded.data, at = excluded.at;
  d := o.data || jsonb_build_object('msgs', ms, 'refund', jsonb_build_object(
         'amount', amt, 'full', amt >= tot, 'at', t, 'note', left(btrim(coalesce(p_note, '')), 200), 'proof', true,
         'by', coalesce(nullif(me.name, ''), me.username, me.email)));
  perform set_config('dd.op', 'order', true);
  update public.orders set data = d, updated_at = t where id = p_id;
  perform public.log_act('Order ' || coalesce(d ->> 'code', p_id), 'refunded ' || amt::text || case when amt >= tot then ' (full)' else ' (part)' end || ' with proof picture');
  return d;
end $$;
revoke all on function public.admin_refund_order(text, numeric, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_refund_order(text, numeric, text, jsonb, text) to authenticated;

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
    'refund', (select data from public.order_files where order_id = p_id and kind = 'refund' and idx = 0));
end $$;
revoke all on function public.admin_order_files(text) from public;
grant execute on function public.admin_order_files(text) to authenticated;
