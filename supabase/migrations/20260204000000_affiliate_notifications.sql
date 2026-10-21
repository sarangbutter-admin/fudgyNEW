-- Delidome migration 35: notifications for affiliators (the bell on their page) and announcements from the owner.
--  Automatic notifications: a new order from their link or coupon, payment confirmed, delivered, cancelled, complaint, refund, failed delivery,
--  commission approved / voided, payout sent, payment account verified or rejected, account paused or active again, commission rate changed.
--  Announcements: the owner writes to all affiliators or to one (flash sale, coupon, new feature...).
-- Safe to run more than once. Run after migration 34.

create table if not exists public.aff_notes (
  id bigserial primary key, aff text, kind text not null default 'info', title text not null default '', body text not null default '',
  at bigint not null default public.now_ms(), by_email text not null default '', hidden boolean not null default false);
create index if not exists aff_notes_aff_at on public.aff_notes (aff, at desc);
alter table public.aff_notes enable row level security;
revoke all on public.aff_notes from anon, authenticated;
alter table public.affiliates add column if not exists notes_seen bigint not null default 0;

create or replace function public.aff_note(p_aff text, p_kind text, p_title text, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into public.aff_notes (aff, kind, title, body, at) values (p_aff, p_kind, left(p_title, 120), left(p_body, 600), public.now_ms()) $$;

-- order events
create or replace function public.orders_aff_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare a text := new.data -> 'aff' ->> 'id'; o jsonb := case when tg_op = 'UPDATE' then old.data else '{}'::jsonb end; n jsonb := new.data;
  c text := coalesce(new.code, new.id); prod numeric := greatest(0, coalesce((n ->> 'total')::numeric, 0) - coalesce((n ->> 'fee')::numeric, 0));
  rate numeric := coalesce((n -> 'aff' ->> 'rate')::numeric, 0); ref numeric := coalesce((n -> 'refund' ->> 'amount')::numeric, 0);
  win numeric := coalesce((select (data ->> 'complaintWindowH')::numeric from public.docs where key = 'settings'), 24);
begin
  if a is null then return new; end if;
  if not (o ? 'aff') then
    perform public.aff_note(a, 'order', 'New order ' || c, 'An order came from your ' || case when n -> 'aff' ->> 'via' = 'coupon' then 'coupon' else 'link' end
      || ' (' || coalesce(n -> 'aff' ->> 'src', 'direct') || '). Your commission starts once the payment is confirmed.');
  end if;
  if tg_op = 'UPDATE' and o ? 'aff' then
    if coalesce(old.status, '') in ('awaiting', 'review') and new.status not in ('awaiting', 'review', 'cancelled') then
      perform public.aff_note(a, 'order', 'Payment confirmed: ' || c, 'Order ' || c || ' is paid. Your commission of ' || public.money_txt(round(prod * rate / 100, 2)) || ' is pending.'); end if;
    if coalesce(old.status, '') <> 'completed' and new.status = 'completed' then
      perform public.aff_note(a, 'order', 'Delivered: ' || c, 'Order ' || c || ' was delivered. The commission stays on hold for ' || win::text || ' hours (or until a complaint is resolved), then the shop reviews it.'); end if;
    if coalesce(old.status, '') <> 'cancelled' and new.status = 'cancelled' then
      perform public.aff_note(a, 'void', 'Order cancelled: ' || c, 'Order ' || c || ' was cancelled, so there is no commission for it.'); end if;
    if not (o ? 'complaint') and n ? 'complaint' then
      perform public.aff_note(a, 'hold', 'Complaint on ' || c, 'The customer raised a complaint on order ' || c || '. The commission is on hold until it is resolved.'); end if;
    if coalesce(o -> 'complaint' ->> 'status', '') <> 'resolved' and n -> 'complaint' ->> 'status' = 'resolved' then
      perform public.aff_note(a, 'hold', 'Complaint resolved: ' || c, 'The complaint on order ' || c || ' was resolved. The shop will review the commission.'); end if;
    if not (o ? 'refund') and n ? 'refund' then
      if prod > 0 and ref >= prod then
        perform public.aff_note(a, 'void', 'Refunded in full: ' || c, 'Order ' || c || ' was refunded in full, so its commission is voided.');
      else
        perform public.aff_note(a, 'hold', 'Partly refunded: ' || c, 'Order ' || c || ' was partly refunded. Your commission is recalculated on the rest and the shop will review it.');
      end if; end if;
    if coalesce(o -> 'bship' ->> 'status', '') <> coalesce(n -> 'bship' ->> 'status', '') and n -> 'bship' ->> 'status' in ('returned', 'disposed', 'lost') then
      perform public.aff_note(a, 'void', 'Delivery failed: ' || c, 'The courier could not deliver order ' || c || ' (' || (n -> 'bship' ->> 'status') || '), so its commission is voided.'); end if;
  end if;
  return new;
end $$;
create or replace trigger orders_aff_events_trg after insert or update on public.orders
  for each row when (new.data ? 'aff') execute function public.orders_aff_events();

-- account events
create or replace function public.affiliates_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'paused' then perform public.aff_note(new.id, 'account', 'Account paused', 'Your account is paused. Your links and coupon do not earn commission for now. Please contact the shop.');
    elsif new.status = 'active' then perform public.aff_note(new.id, 'account', 'Account active', 'Your account is active again.'); end if;
  end if;
  if new.rate is distinct from old.rate then
    perform public.aff_note(new.id, 'account', 'Commission rate changed', 'Your commission is now ' || new.rate::text || '% on new orders.'); end if;
  if new.pay_status is distinct from old.pay_status and new.pay_status in ('verified', 'rejected') then
    if new.pay_status = 'verified' then
      perform public.aff_note(new.id, 'money', 'Payment account verified', 'You can now be paid to ' || new.pay_method || ' ••••' || right(new.pay_no, 4) || '.');
    else
      perform public.aff_note(new.id, 'account', 'Payment account rejected', 'The shop could not accept it' || case when new.pay_reason <> '' then ': ' || new.pay_reason else '' end || '. Please fix it in Payment account.');
    end if; end if;
  return new;
end $$;
create or replace trigger affiliates_events_trg after update on public.affiliates for each row execute function public.affiliates_events();

-- commission decisions (grouped per affiliator, so approving 12 orders gives one notification)
create or replace function public.aff_orders_ev_ins() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.aff_notes (aff, kind, title, body, at)
  select g.aff, case g.status when 'paid' then 'money' when 'voided' then 'void' else 'money' end,
         case g.status when 'approved' then g.c || ' order' || case when g.c = 1 then '' else 's' end || ' approved' when 'voided' then case when g.c = 1 then 'Order voided' else g.c || ' orders voided' end else 'Payout sent' end,
         left(case g.status when 'approved' then 'Commission ' || public.money_txt(g.amt) || ' is now waiting for payout (' || g.codes || ').'
                            when 'voided' then 'Voided: ' || g.codes
                            else public.money_txt(g.amt) || ' was paid out for ' || g.c || ' order' || case when g.c = 1 then '' else 's' end || '. Open Payouts to see the transfer proof.' end, 600),
         public.now_ms()
    from (select n.aff, n.status, count(*) c, sum(n.amount) amt,
                 string_agg(coalesce(o.code, n.order_id) || case when n.status = 'voided' then ' (' || n.reason || ')' else '' end, ', ') codes
            from nt n left join public.orders o on o.id = n.order_id where n.status in ('approved', 'voided', 'paid') group by n.aff, n.status) g;
  return null;
end $$;
create or replace function public.aff_orders_ev_upd() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.aff_notes (aff, kind, title, body, at)
  select g.aff, case g.status when 'voided' then 'void' else 'money' end,
         case g.status when 'approved' then g.c || ' order' || case when g.c = 1 then '' else 's' end || ' approved' when 'voided' then case when g.c = 1 then 'Order voided' else g.c || ' orders voided' end else 'Payout sent' end,
         left(case g.status when 'approved' then 'Commission ' || public.money_txt(g.amt) || ' is now waiting for payout (' || g.codes || ').'
                            when 'voided' then 'Voided: ' || g.codes
                            else public.money_txt(g.amt) || ' was paid out for ' || g.c || ' order' || case when g.c = 1 then '' else 's' end || '. Open Payouts to see the transfer proof.' end, 600),
         public.now_ms()
    from (select n.aff, n.status, count(*) c, sum(n.amount) amt,
                 string_agg(coalesce(o.code, n.order_id) || case when n.status = 'voided' then ' (' || n.reason || ')' else '' end, ', ') codes
            from nt n join ot p on p.order_id = n.order_id and p.status is distinct from n.status
            left join public.orders o on o.id = n.order_id where n.status in ('approved', 'voided', 'paid') group by n.aff, n.status) g;
  return null;
end $$;
create or replace trigger aff_orders_ev_ins_trg after insert on public.aff_orders referencing new table as nt for each statement execute function public.aff_orders_ev_ins();
create or replace trigger aff_orders_ev_upd_trg after update on public.aff_orders referencing old table as ot new table as nt for each statement execute function public.aff_orders_ev_upd();

-- the affiliator's bell
create or replace function public.aff_notes_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me public.affiliates := public.aff_self();
begin
  if me.id is null or me.status = 'disabled' then perform public.bad('Please sign in again.'); end if;
  return jsonb_build_object(
    'unseen', (select count(*) from public.aff_notes n where not n.hidden and (n.aff = me.id or (n.aff is null and n.at >= me.created_at)) and n.at > me.notes_seen),
    'seen', me.notes_seen,
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'kind', z.kind, 'title', z.title, 'body', z.body, 'at', z.at, 'all', z.aff is null) order by z.at desc)
                         from (select * from public.aff_notes n where not n.hidden and (n.aff = me.id or (n.aff is null and n.at >= me.created_at)) order by n.at desc limit 60) z), '[]'::jsonb));
end $$;
create or replace function public.aff_notes_seen() returns void
language plpgsql security definer set search_path = public as $$
declare me public.affiliates := public.aff_self();
begin
  if me.id is null then return; end if;
  update public.affiliates set notes_seen = public.now_ms() where id = me.id;
end $$;

-- owner: announcements
create or replace function public.admin_aff_announce(p_to text, p_title text, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text := left(btrim(coalesce(p_title, '')), 80); b text := left(btrim(coalesce(p_body, '')), 500); tgt text := nullif(btrim(coalesce(p_to, '')), '');
begin
  perform public.assert_owner();
  if length(t) < 3 then perform public.bad('Type a title (at least 3 letters).'); end if;
  if length(b) < 3 then perform public.bad('Type the message (at least 3 letters).'); end if;
  if tgt = 'all' then tgt := null; end if;
  if tgt is not null and not exists (select 1 from public.affiliates where id = tgt) then perform public.bad('Affiliator not found.'); end if;
  if not public.throttle_ok('affann', 30, 3600000) then perform public.bad('Too many announcements. Please wait a little.'); end if;
  insert into public.aff_notes (aff, kind, title, body, at, by_email) values (tgt, 'info', t, b, public.now_ms(), lower(coalesce(auth.jwt() ->> 'email', '')));
  perform public.log_act('Affiliate announcement', t || case when tgt is null then ' (to all)' else '' end);
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.admin_aff_announcements() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_owner();
  return coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'aff', z.aff, 'aname', coalesce(nullif(a.name, ''), a.username), 'title', z.title, 'body', z.body, 'at', z.at, 'hidden', z.hidden) order by z.at desc)
                     from (select * from public.aff_notes where kind = 'info' order by at desc limit 40) z left join public.affiliates a on a.id = z.aff), '[]'::jsonb);
end $$;
create or replace function public.admin_aff_announce_hide(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_owner();
  update public.aff_notes set hidden = true where id = p_id and kind = 'info';
end $$;

revoke all on function public.aff_note(text, text, text, text), public.orders_aff_events(), public.affiliates_events(), public.aff_orders_ev_ins(), public.aff_orders_ev_upd() from public, anon, authenticated;
revoke all on function public.aff_notes_list(), public.aff_notes_seen(), public.admin_aff_announce(text, text, text), public.admin_aff_announcements(), public.admin_aff_announce_hide(bigint) from public, anon;
grant execute on function public.aff_notes_list(), public.aff_notes_seen(), public.admin_aff_announce(text, text, text), public.admin_aff_announcements(), public.admin_aff_announce_hide(bigint) to authenticated;
