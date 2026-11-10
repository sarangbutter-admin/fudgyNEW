-- BakeByCulture migration 9: no skipping steps for anyone, nothing moves past Check payment until payment is confirmed, staff can only edit/cancel before payment is confirmed. Includes migrations 7 and 8.
-- BakeByCulture migration 8: staff can't reject a payment proof on their own either (owner approves). Includes everything from migration 7.
-- BakeByCulture migration 7: order status rules.
--  * "Confirm payment" needs the customer's payment proof.
--  * Staff can't confirm payment on their own: it waits for an owner to approve.
--  * Status only moves forward: Payment confirmed -> Baking -> Ready / Out for delivery -> Delivered / Picked up.
--  * Out for delivery needs a courier and an airway bill; typing both on a baking delivery order moves it there automatically.
--  * Once an order is ready (or done), only an owner can move it back, edit it or cancel it. Staff can only cancel unpaid orders.
-- Safe to run more than once. Run after migration 6.

create or replace function public.admin_patch_order(p_id text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; d jsonb; pt jsonb := coalesce(p_patch, '{}'::jsonb); me public.admins := public.team_me();
        owner boolean; cur text; st text; deliv boolean; only_cp boolean; courier text; awb text; k text;
        parts text[] := '{}'; ask boolean := false; approved boolean := false; askrej boolean := false; rrsn text; sl text[][] := array[
  ['awaiting','Awaiting payment'],['review','Check payment'],['new','Payment confirmed'],['baking','Baking'],['ready','Ready / out for delivery'],['completed','Delivered / picked up'],['cancelled','Cancelled']];
  nm_old text; nm_new text; i int;
begin
  perform public.assert_admin();
  owner := me.role = 'owner';
  only_cp := not exists (select 1 from jsonb_object_keys(pt) x where x not in ('complaint','msgsAdd'));
  if not (public.has_perm('orders') or (only_cp and public.has_perm('complaints'))) then
    raise exception 'You don''t have access to change orders. Ask the owner.' using errcode = '42501'; end if;
  select * into o from public.orders where id = p_id for update;
  if not found then perform public.bad('Order not found'); end if;
  cur := o.status; deliv := (o.data ->> 'mode') = 'delivery';
  st := nullif(pt ->> 'status', ''); if st = cur then st := null; pt := pt - 'status'; end if;

  -- owner turns down a staff member's proof rejection (the order stays at Check payment)
  if pt ? 'rejReqReject' then
    if not owner then perform public.bad('Only an owner can approve or turn down a payment.'); end if;
    pt := pt - 'rejReqReject';
    if o.data ? 'rejReq' then
      perform set_config('dd.op', 'order', true);
      update public.orders set data = data - 'rejReq' where id = p_id;
      perform public.log_act('Order ' || coalesce(o.data ->> 'code', p_id), 'proof rejection turned down');
      select * into o from public.orders where id = p_id;
    end if;
    if pt = '{}'::jsonb then return o.data; end if;
  end if;

  -- owner turns down a staff member's payment confirmation
  if pt ? 'payReqReject' then
    if not owner then perform public.bad('Only an owner can approve or turn down a payment.'); end if;
    pt := pt - 'payReqReject';
    if o.data ? 'payReq' then
      perform set_config('dd.op', 'order', true);
      update public.orders set data = data - 'payReq' where id = p_id;
      perform public.log_act('Order ' || coalesce(o.data ->> 'code', p_id), 'payment approval turned down');
      select * into o from public.orders where id = p_id;
    end if;
    if pt = '{}'::jsonb then return o.data; end if;
  end if;

  -- typing courier + airway bill on a baking delivery order sends it out
  courier := btrim(coalesce(case when pt ? 'courier' then pt ->> 'courier' else o.data ->> 'courier' end, ''));
  awb     := btrim(coalesce(case when pt ? 'awb' then pt ->> 'awb' else o.data ->> 'awb' end, ''));
  if st is null and deliv and cur = 'baking' and (pt ? 'courier' or pt ? 'awb') and courier <> '' and awb <> '' then
    st := 'ready'; pt := jsonb_set(pt, '{status}', to_jsonb(st));
  end if;

  if st is not null then
    if st = 'new' and not (o.data ? 'proof') then
      perform public.bad('Confirm payment needs the customer''s payment proof first.'); end if;
    if st = 'ready' and deliv and (courier = '' or awb = '') then
      perform public.bad('Type the courier and the airway bill number first. The order moves to Out for delivery by itself.'); end if;
    -- order of steps: nobody can skip one, and nothing moves on before the payment is confirmed
    declare ci int := array_position(array['awaiting','review','new','baking','ready','completed'], cur);
            si int := array_position(array['awaiting','review','new','baking','ready','completed'], st);
    begin
      if st = 'new' and ci is not null and ci < 3 and cur <> 'review' then
        perform public.bad('Confirm payment needs the customer''s payment proof first (the order must be at Check payment).'); end if;
      if si is not null and ci is not null and si > 3 and ci < 3 then
        perform public.bad('Confirm the payment first. Orders can''t skip steps.'); end if;
      if si is not null and ci is not null and ci >= 3 and si > ci + 1 then
        perform public.bad('Orders move one step at a time. They can''t skip a step.'); end if;
    end;
    if not owner then
      if cur = 'review' and st = 'new' then
        if o.data ? 'rejReq' then perform public.bad('A proof rejection is already waiting for the owner.'); end if;
        ask := true;
      elsif cur = 'review' and st = 'awaiting' then
        if o.data ? 'payReq' then perform public.bad('A payment confirmation is already waiting for the owner.'); end if;
        askrej := true;
      elsif not ((cur in ('awaiting','review') and st = 'cancelled')
              or (cur = 'new' and st = 'baking')
              or (cur = 'baking' and st = 'ready')
              or (cur = 'ready' and st = 'completed')) then
        perform public.bad('Orders only move forward one step at a time. Going back or cancelling a paid order needs an owner.');
      end if;
    end if;
  end if;

  -- staff can't edit an order that is ready or done (adding a missing airway bill is fine)
  if not owner and cur in ('new','baking','ready','completed','cancelled') then
    for k in select jsonb_object_keys(pt) loop
      if k in ('items','total','surcharge','notify','expiresAt','cancelReason','paidAt','rejected')
         or (k in ('courier','awb') and btrim(coalesce(o.data ->> k, '')) <> '' and (pt ->> k) is distinct from (o.data ->> k)) then
        perform public.bad('This order is ' || case cur when 'new' then 'paid' when 'baking' then 'paid' when 'ready' then 'ready' when 'completed' then 'done' else 'cancelled' end || '. Only an owner can change it now.');
      end if;
    end loop;
  end if;
  if not owner and cur in ('new','baking') and st = 'cancelled' then
    perform public.bad('Only an owner can cancel a paid order.'); end if;

  if askrej then rrsn := left(btrim(coalesce(pt #>> '{rejected,reason}', '')), 80); pt := pt - 'status' - 'rejected' - 'expiresAt'; end if;
  if ask then pt := pt - 'status' - 'paidAt'; end if;
  perform set_config('dd.op', 'order', true);
  if pt <> '{}'::jsonb then d := public.admin_patch_order_core(p_id, pt); else d := o.data; end if;

  if ask then
    d := d || jsonb_build_object('payReq', jsonb_build_object('by', coalesce(nullif(me.name, ''), me.username, me.email), 'role', coalesce(nullif(me.title, ''), 'Staff'), 'at', public.now_ms()));
    update public.orders set data = d where id = p_id;
    perform public.log_act('Order ' || coalesce(d ->> 'code', p_id), 'payment checked, waiting for owner approval');
  elsif askrej then
    d := d || jsonb_build_object('rejReq', jsonb_build_object('by', coalesce(nullif(me.name, ''), me.username, me.email), 'role', coalesce(nullif(me.title, ''), 'Staff'), 'at', public.now_ms(), 'reason', rrsn));
    update public.orders set data = d where id = p_id;
    perform public.log_act('Order ' || coalesce(d ->> 'code', p_id), 'proof rejected, waiting for owner approval' || case when rrsn <> '' then ' (' || rrsn || ')' else '' end);
  elsif (d ->> 'status') = 'new' and d ? 'payReq' then
    approved := true; d := d - 'payReq';
    update public.orders set data = d where id = p_id;
  elsif (d ->> 'status') <> 'review' and d ? 'payReq' then
    d := d - 'payReq'; update public.orders set data = d where id = p_id;
  end if;

  if (d ->> 'status') <> 'review' and d ? 'rejReq' then d := d - 'rejReq'; update public.orders set data = d where id = p_id; end if;

  if (o.data ->> 'status') is distinct from (d ->> 'status') then
    for i in 1 .. array_length(sl, 1) loop
      if sl[i][1] = o.data ->> 'status' then nm_old := sl[i][2]; end if;
      if sl[i][1] = d ->> 'status' then nm_new := sl[i][2]; end if;
    end loop;
    parts := parts || ('status ' || coalesce(nm_old, o.data ->> 'status') || ' → ' || coalesce(nm_new, d ->> 'status'));
  end if;
  if approved then parts := parts || 'payment approved'::text; end if;
  if (o.data -> 'items') is distinct from (d -> 'items') then parts := parts || 'cookies changed'::text; end if;
  if (o.data ->> 'courier') is distinct from (d ->> 'courier') or (o.data ->> 'awb') is distinct from (d ->> 'awb') then
    parts := parts || ('courier ' || coalesce(d ->> 'courier', '') || ' ' || coalesce(d ->> 'awb', '')); end if;
  if (o.data #>> '{complaint,status}') is distinct from (d #>> '{complaint,status}') then parts := parts || ('complaint ' || coalesce(d #>> '{complaint,status}', '')); end if;
  if (o.data #>> '{complaint,reply}') is distinct from (d #>> '{complaint,reply}') then parts := parts || 'complaint reply'::text; end if;
  if (o.data -> 'rejected') is distinct from (d -> 'rejected') and d ? 'rejected' then parts := parts || 'payment proof rejected'::text; end if;
  if array_length(parts, 1) > 0 then perform public.log_act('Order ' || coalesce(d ->> 'code', p_id), array_to_string(parts, ', ')); end if;
  return d;
end $$;

revoke all on function public.admin_patch_order(text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_patch_order(text, jsonb) to authenticated;
