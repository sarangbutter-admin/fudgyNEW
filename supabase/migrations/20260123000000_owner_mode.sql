-- BakeByCulture migration 23: Owner mode per order.
-- Owner overrides (going back a step, cancelling a paid order, reopening a cancelled one, editing a paid order,
-- changing a set courier / airway bill, refunds) only work after the owner turns on Owner mode for that order
-- with the owner password. It switches itself off after 5 minutes. Everyday work (confirming payments,
-- approving staff requests, moving forward) works as before. Safe to run more than once. Run after migration 22.

create table if not exists public.order_unlock (
  order_id text not null, email text not null, until bigint not null,
  primary key (order_id, email)
);
alter table public.order_unlock enable row level security;
revoke all on public.order_unlock from public, anon, authenticated;

create or replace function public.owner_unlocked(p_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.order_unlock u
                 where u.order_id = p_id and u.email = lower(coalesce(auth.jwt() ->> 'email', '')) and u.until > public.now_ms())
$$;

-- owner: turn Owner mode on for one order (5 minutes); p_password empty = turn it off
create or replace function public.admin_owner_mode(p_id text, p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.admins := public.team_me(); em text := lower(coalesce(auth.jwt() ->> 'email', '')); u bigint := public.now_ms() + 300000; c text;
begin
  perform public.assert_admin();
  if me.role is distinct from 'owner' then perform public.bad('Only an owner can use Owner mode.'); end if;
  select data ->> 'code' into c from public.orders where id = p_id;
  if c is null then perform public.bad('Order not found'); end if;
  if coalesce(p_password, '') = '' then
    delete from public.order_unlock where order_id = p_id and email = em;
    return jsonb_build_object('ok', true, 'until', 0);
  end if;
  if not public.throttle_ok('sudo:' || em, 8, 600000) then
    return jsonb_build_object('ok', false, 'err', 'Too many tries. Please wait 10 minutes.'); end if;
  if not public.owner_pw_ok(p_password) then
    perform public.log_act('Owner password wrong', 'Owner mode on order ' || c);
    return jsonb_build_object('ok', false, 'err', 'That owner password isn''t right.'); end if;
  delete from public.order_unlock where until < public.now_ms();
  insert into public.order_unlock (order_id, email, until) values (p_id, em, u)
    on conflict (order_id, email) do update set until = excluded.until;
  perform public.log_act('Owner mode on: order ' || c, 'for 5 minutes');
  return jsonb_build_object('ok', true, 'until', u);
end $$;

revoke all on function public.owner_unlocked(text), public.admin_owner_mode(text, text) from public, anon, authenticated;
grant execute on function public.admin_owner_mode(text, text) to authenticated;

create or replace function public.admin_patch_order(p_id text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; d jsonb; pt jsonb := coalesce(p_patch, '{}'::jsonb); me public.admins := public.team_me();
        owner boolean; cur text; st text; deliv boolean; only_cp boolean; courier text; awb text; k text;
        parts text[] := '{}'; ask boolean := false; approved boolean := false; askrej boolean := false; rrsn text; sl text[][] := array[
  ['awaiting','Awaiting payment'],['review','Check payment'],['new','Payment confirmed'],['baking','Baking'],['ready','Ready / out for delivery'],['completed','Delivered / picked up'],['cancelled','Cancelled']];
  nm_old text; nm_new text; i int; ovr boolean;
begin
  perform public.assert_admin();
  owner := me.role = 'owner';
  ovr := owner and public.owner_unlocked(p_id);   -- Owner mode switched on for this order (password, 5 minutes)
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
    -- payment comes first: a cancelled order is only reopened at the payment steps, and a paid order never goes back to them
    if cur = 'cancelled' and st not in ('awaiting','review') then
      perform public.bad('A cancelled order can only be reopened as Awaiting payment (or Check payment if it has a proof). Then confirm the payment again.'); end if;
    if st = 'review' and not (o.data ? 'proof') then
      perform public.bad('Check payment needs the customer''s payment proof first.'); end if;
    if cur in ('baking','ready','completed') and st in ('awaiting','review') then
      perform public.bad('This order is already paid. Use Cancel order or Refund instead of moving it back to payment.'); end if;
    if cur = 'new' and st = 'awaiting' then
      perform public.bad('To undo a payment confirmation, move it back to Check payment.'); end if;
    if st in ('awaiting','review') then pt := pt || jsonb_build_object('paidAt', null); end if;   -- no longer counted as paid
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
    -- everyday rules for everybody; going back, cancelling a paid order or reopening a cancelled one needs Owner mode on this order
    if not ovr then
      if cur = 'review' and st = 'new' then
        if not owner then
          if o.data ? 'rejReq' then perform public.bad('A proof rejection is already waiting for the owner.'); end if;
          ask := true;
        end if;
      elsif cur = 'review' and st = 'awaiting' then
        if not owner then
          if o.data ? 'payReq' then perform public.bad('A payment confirmation is already waiting for the owner.'); end if;
          askrej := true;
        end if;
      elsif not ((cur in ('awaiting','review') and st = 'cancelled')
              or (cur = 'new' and st = 'baking')
              or (cur = 'baking' and st = 'ready')
              or (cur = 'ready' and st = 'completed')) then
        perform public.bad(case when owner then 'Turn on Owner mode for this order first (going back a step, cancelling a paid order or reopening a cancelled one).'
                                else 'Orders only move forward one step at a time. Going back or cancelling a paid order needs an owner.' end);
      end if;
    end if;
  end if;

  -- staff can't edit an order that is ready or done (adding a missing airway bill is fine)
  -- after payment the order itself is locked (a missing airway bill can still be added); the owner unlocks it with Owner mode
  if not ovr and cur in ('new','baking','ready','completed','cancelled') then
    for k in select jsonb_object_keys(pt) loop
      if (k in ('items','total','surcharge','notify','expiresAt','cancelReason','rejected') or (k = 'paidAt' and not (st in ('awaiting','review'))))
         or (k in ('courier','awb') and btrim(coalesce(o.data ->> k, '')) <> '' and (pt ->> k) is distinct from (o.data ->> k)) then
        perform public.bad(case when owner then 'This order is locked after payment. Turn on Owner mode for this order to change it.'
          else 'This order is ' || case cur when 'new' then 'paid' when 'baking' then 'paid' when 'ready' then 'ready' when 'completed' then 'done' else 'cancelled' end || '. Only an owner can change it now.' end);
      end if;
    end loop;
  end if;
  if not ovr and cur in ('new','baking','ready','completed') and st = 'cancelled' then
    perform public.bad(case when owner then 'Turn on Owner mode for this order to cancel a paid order.' else 'Only an owner can cancel a paid order.' end); end if;
  if ovr and (st is not null or pt ?| array['items','total','surcharge','notify','expiresAt','cancelReason','courier','awb']) then
    perform public.log_act('Owner mode: order ' || coalesce(o.data ->> 'code', p_id), 'override used'); end if;

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

create or replace function public.admin_refund_order(p_id text, p_amount numeric, p_note text, p_msgs jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; me public.admins := public.team_me(); amt numeric; tot numeric; d jsonb; m jsonb; t bigint := public.now_ms(); ms jsonb;
begin
  perform public.assert_admin();
  if me.role is distinct from 'owner' then perform public.bad('Only an owner can refund an order.'); end if;
  if not public.owner_unlocked(p_id) then perform public.bad('Turn on Owner mode for this order to refund it.'); end if;
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
