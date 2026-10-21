-- Delidome migration 33: affiliate commission review and payout flow.
--  Statuses per order (worked out live, plus the owner's own decisions):
--    waiting (not paid yet) · cancelled · progress (paid, being prepared / delivered) · hold (24 h window running, or a complaint not resolved)
--    review (owner must approve or void) · approved (waiting payout) · paid (proof uploaded) · voided (reason)
--  * commission = rate % of the product value (the delivery fee is never part of it) minus any refund; the delivery fee can't be refunded
--  * nothing is approved by itself: after the hold every order waits for the owner's click
--  * a full refund, a cancelled order or a final courier failure (returned / disposed / lost) voids the commission by itself, with the reason shown
--  * a partial refund recalculates the commission and the owner approves or voids it by hand
--  * paying needs a proof picture; the affiliator sees the proof and the reasons
-- Safe to run more than once. Run after migration 32.

create table if not exists public.aff_orders (
  order_id text primary key, aff text not null,
  status text not null check (status in ('review', 'approved', 'voided', 'paid')),
  amount numeric not null default 0, refund numeric not null default 0, reason text not null default '',
  at bigint not null, by_email text not null default '', payout bigint);
alter table public.aff_orders enable row level security;
revoke all on public.aff_orders from anon, authenticated;
alter table public.aff_payouts add column if not exists proof text not null default '';

create or replace function public.aff_rows(p_aff text, p_from bigint, p_to bigint, p_ids jsonb default null)
returns table (id text, code text, aff text, aname text, acode text, at bigint, ostatus text, sales numeric, refund numeric, com numeric,
               src text, via text, st text, reason text, partial boolean, late boolean, proof text, payout bigint, paid_at bigint)
language sql stable security definer set search_path = public as $$
  with w as (select coalesce((select (data ->> 'complaintWindowH')::numeric from public.docs where key = 'settings'), 24) h, public.now_ms() n),
  b as (
    select o.id, o.code, a.id aff, coalesce(nullif(a.name, ''), a.username) aname, a.code acode, o.created_at at, o.status ostatus, o.data,
           greatest(0, coalesce((o.data ->> 'total')::numeric, 0) - coalesce((o.data ->> 'fee')::numeric, 0)) prod,
           coalesce((o.data -> 'refund' ->> 'amount')::numeric, 0) ref,
           coalesce((o.data -> 'aff' ->> 'rate')::numeric, 0) rate,
           coalesce((o.data ->> 'completedAt')::bigint, o.updated_at) done_at,
           coalesce(o.data -> 'complaint' ->> 'status', '') cst,
           coalesce(o.data -> 'bship' ->> 'status', '') bst,
           d.status dst, d.amount damt, d.refund dref, d.reason dreason, d.payout dpay, d.at dat, p.proof pproof
      from public.orders o
      join public.affiliates a on a.id = o.data -> 'aff' ->> 'id'
      left join public.aff_orders d on d.order_id = o.id
      left join public.aff_payouts p on p.id = d.payout
     where (p_aff is null or a.id = p_aff)
       and o.created_at >= coalesce(p_from, 0) and o.created_at < coalesce(p_to, 9000000000000000::bigint)
       and (p_ids is null or o.id in (select jsonb_array_elements_text(p_ids)))
  ),
  c as (select b.*, least(b.ref, b.prod) rf, w.h, w.n, (b.prod > 0 and b.ref >= b.prod) fullref from b, w),
  s as (
    select c.*, round(greatest(0, prod - rf) * rate / 100, 2) calc,
      case
        when dst = 'paid' then 'paid'
        when dst = 'voided' then 'voided'
        when ostatus = 'cancelled' then case when dst = 'approved' then 'voided' else 'cancelled' end
        when fullref then 'voided'
        when dst is null and bst in ('returned', 'disposed', 'lost') then 'voided'
        when ostatus in ('awaiting', 'review') then 'waiting'
        when cst in ('open', 'review') then 'hold'
        when dst = 'review' then 'review'
        when dst = 'approved' then case when ref > coalesce(dref, 0) + 0.004 then 'review' else 'approved' end
        when ostatus = 'completed' and done_at + h * 3600000 > n then 'hold'
        when ostatus = 'completed' then 'review'
        else 'progress' end st
    from c)
  select s.id, s.code, s.aff, s.aname, s.acode, s.at, s.ostatus, greatest(0, s.prod - s.rf) sales, s.ref,
         case when s.st in ('approved', 'paid') then coalesce(s.damt, s.calc) else s.calc end com,
         coalesce(s.data -> 'aff' ->> 'src', 'direct'), coalesce(s.data -> 'aff' ->> 'via', ''), s.st,
         case when s.st <> 'voided' then ''
              when s.dst = 'voided' then coalesce(s.dreason, '')
              when s.ostatus = 'cancelled' then 'Order cancelled'
              when s.fullref then 'Full refund'
              else 'Delivery failed (courier: ' || s.bst || ')' end,
         (s.ref > 0 and s.ref < s.prod), (s.dst in ('approved', 'paid') and s.ref > coalesce(s.dref, 0) + 0.004),
         coalesce(s.pproof, ''), s.dpay, s.dat
    from s $$;

-- one affiliator: who they are, the totals and the sources for a period
create or replace function public.aff_summary(p_id text, p_from bigint, p_to bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a public.affiliates; f bigint := coalesce(p_from, 0); tt bigint := coalesce(p_to, public.now_ms() + 86400000); r jsonb;
begin
  select * into a from public.affiliates where id = p_id;
  if a.id is null then perform public.bad('Affiliator not found.'); end if;
  with o as (select * from public.aff_rows(a.id, f, tt)),
       h as (select * from public.aff_hits where aff = a.id and t >= f and t < tt)
  select jsonb_build_object(
    'aff', jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'rate', a.rate, 'coupon', a.coupon, 'status', a.status, 'username', a.username,
            'phone', case when public.is_owner() then a.phone else '' end, 'note', case when public.is_owner() then a.note else '' end),
    'tot', jsonb_build_object(
      'views', (select count(*) from h), 'uniq', (select count(distinct vid) from h),
      'orders', (select count(*) from o where st in ('progress', 'hold', 'review', 'approved', 'paid')),
      'waiting', (select count(*) from o where st = 'waiting'),
      'coupon', (select count(*) from o where via = 'coupon' and st <> 'cancelled'),
      'sales', (select coalesce(sum(sales), 0) from o where st in ('progress', 'hold', 'review', 'approved', 'paid')),
      'pending', (select coalesce(sum(com), 0) from o where st in ('progress', 'hold')), 'hold_n', (select count(*) from o where st = 'hold'),
      'review', (select coalesce(sum(com), 0) from o where st = 'review'), 'review_n', (select count(*) from o where st = 'review'),
      'approved', (select coalesce(sum(com), 0) from o where st = 'approved'), 'approved_n', (select count(*) from o where st = 'approved'),
      'paid', (select coalesce(sum(com), 0) from o where st = 'paid'),
      'void', (select coalesce(sum(com), 0) from o where st = 'voided'), 'void_n', (select count(*) from o where st = 'voided'),
      'cancelled_n', (select count(*) from o where st = 'cancelled')),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('src', src, 'views', v, 'orders', n, 'sales', sa) order by v desc, n desc) from (
        select src, sum(v) v, sum(n) n, sum(sa) sa from (
          select src, count(*) v, 0 n, 0::numeric sa from h group by src
          union all select o.src, 0, count(*), coalesce(sum(o.sales), 0) from o where o.st in ('progress', 'hold', 'review', 'approved', 'paid') group by o.src) u group by src) z), '[]'::jsonb)
  ) into r;
  return r;
end $$;

create or replace function public.aff_report(p_id text, p_from bigint, p_to bigint, p_group text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me public.affiliates := public.aff_self(); tz text := public.shop_tz(); own boolean := public.is_owner();
  win numeric := coalesce((select (data ->> 'complaintWindowH')::numeric from public.docs where key = 'settings'), 24);
  g text := case when p_group in ('week', 'month') then p_group else 'day' end;
  f bigint := coalesce(p_from, 0); tt bigint := coalesce(p_to, public.now_ms() + 86400000); r jsonb; x jsonb;
begin
  if not own then
    if me.id is null or me.status = 'disabled' or me.id <> p_id then perform public.bad('Please sign in again.'); end if;
  end if;
  r := public.aff_summary(p_id, f, tt);
  with o as (select * from public.aff_rows(p_id, f, tt)),
       h as (select * from public.aff_hits where aff = p_id and t >= f and t < tt),
       k as (select (to_timestamp(t / 1000.0) at time zone tz) ts, 'h' kind, vid, null::numeric amt, null::numeric cm from h
             union all select (to_timestamp(o.at / 1000.0) at time zone tz), 'o', null, o.sales, o.com from o where o.st in ('progress', 'hold', 'review', 'approved', 'paid')),
       s as (select case g when 'month' then to_char(ts, 'YYYY-MM') when 'week' then to_char(date_trunc('week', ts), 'YYYY-MM-DD') else to_char(ts, 'YYYY-MM-DD') end b, * from k)
  select jsonb_build_object(
    'series', coalesce((select jsonb_agg(jsonb_build_object('b', b, 'views', v, 'uniq', u, 'orders', n, 'sales', sa, 'com', c) order by b) from (
        select b, count(*) filter (where kind = 'h') v, count(distinct vid) filter (where kind = 'h') u, count(*) filter (where kind = 'o') n,
               coalesce(sum(amt) filter (where kind = 'o'), 0) sa, coalesce(sum(cm) filter (where kind = 'o'), 0) c from s group by b) z), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(case when own then to_jsonb(z) else to_jsonb(z) - 'id' - 'aff' end order by z.at desc) from (select * from o order by o.at desc limit 400) z), '[]'::jsonb),
    'payouts', coalesce((select jsonb_agg(jsonb_build_object('at', at, 'amount', amount, 'n', n, 'note', note, 'proof', proof) order by at desc) from public.aff_payouts where aff = p_id), '[]'::jsonb),
    'win', win) into x;
  return r || x;
end $$;

create or replace function public.admin_aff_list(p_from bigint, p_to bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb := '[]'::jsonb; a record;
begin
  perform public.assert_owner();
  for a in select id from public.affiliates order by created_at loop
    out := out || jsonb_build_array((select (r -> 'aff') || jsonb_build_object('tot', r -> 'tot', 'sources', r -> 'sources') from (select public.aff_summary(a.id, p_from, p_to) r) z));
  end loop;
  return out;
end $$;

-- owner: every affiliator's orders for a period
create or replace function public.admin_aff_orders(p_from bigint, p_to bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_owner();
  return coalesce((select jsonb_agg(to_jsonb(z) order by z.at desc) from (select * from public.aff_rows(null, coalesce(p_from, 0), coalesce(p_to, public.now_ms() + 86400000)) order by at desc limit 600) z), '[]'::jsonb);
end $$;

-- owner: approve, void (with a reason) or restore orders
create or replace function public.admin_aff_decide(p_ids jsonb, p_action text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; skipped int := 0; tot numeric := 0; t bigint := public.now_ms(); cnt int;
  rs text := left(btrim(coalesce(p_reason, '')), 200); em text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  perform public.assert_owner();
  if p_action not in ('approve', 'void', 'restore') then perform public.bad('Unknown action.'); end if;
  if jsonb_typeof(p_ids) is distinct from 'array' or jsonb_array_length(p_ids) = 0 or jsonb_array_length(p_ids) > 300 then perform public.bad('Pick 1 to 300 orders.'); end if;
  if p_action = 'void' and length(rs) < 3 then perform public.bad('Type the reason for voiding (at least 3 letters).'); end if;
  cnt := jsonb_array_length(p_ids);
  for r in select * from public.aff_rows(null, 0, null, p_ids) loop
    if p_action = 'approve' then
      if r.st <> 'review' or (r.partial and cnt > 1) then skipped := skipped + 1; continue; end if;
      insert into public.aff_orders (order_id, aff, status, amount, refund, reason, at, by_email) values (r.id, r.aff, 'approved', r.com, r.refund, '', t, em)
        on conflict (order_id) do update set status = 'approved', amount = excluded.amount, refund = excluded.refund, reason = '', at = excluded.at, by_email = excluded.by_email;
    elsif p_action = 'void' then
      if r.st not in ('progress', 'hold', 'review', 'approved') then skipped := skipped + 1; continue; end if;
      insert into public.aff_orders (order_id, aff, status, amount, refund, reason, at, by_email) values (r.id, r.aff, 'voided', r.com, r.refund, rs, t, em)
        on conflict (order_id) do update set status = 'voided', amount = excluded.amount, refund = excluded.refund, reason = excluded.reason, at = excluded.at, by_email = excluded.by_email;
    else
      if r.st <> 'voided' or r.reason in ('Full refund', 'Order cancelled') then skipped := skipped + 1; continue; end if;
      insert into public.aff_orders (order_id, aff, status, amount, refund, reason, at, by_email) values (r.id, r.aff, 'review', r.com, r.refund, '', t, em)
        on conflict (order_id) do update set status = 'review', amount = excluded.amount, refund = excluded.refund, reason = '', at = excluded.at, by_email = excluded.by_email;
    end if;
    n := n + 1; tot := tot + r.com;
  end loop;
  if n > 0 then
    perform public.log_act(case p_action when 'approve' then 'Approved affiliate commission' when 'void' then 'Voided affiliate commission' else 'Restored affiliate commission' end,
                           n || ' order' || case when n = 1 then '' else 's' end || ' · ' || public.money_txt(tot) || case when p_action = 'void' then ' · ' || rs else '' end);
  end if;
  return jsonb_build_object('ok', true, 'n', n, 'skipped', skipped, 'amount', tot);
end $$;

-- owner: pay orders that are waiting for payout (one affiliator, one proof picture)
create or replace function public.admin_aff_pay(p_ids jsonb, p_note text, p_proof text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; tot numeric := 0; t bigint := public.now_ms(); pid bigint; who text; whon int; bad_n int;
  em text := lower(coalesce(auth.jwt() ->> 'email', '')); a public.affiliates;
begin
  perform public.assert_owner();
  if jsonb_typeof(p_ids) is distinct from 'array' or jsonb_array_length(p_ids) = 0 or jsonb_array_length(p_ids) > 300 then perform public.bad('Pick 1 to 300 orders.'); end if;
  if coalesce(p_proof, '') !~ '^https://[^ ]{10,250}$' then perform public.bad('Upload the payout proof picture first.'); end if;
  select count(*), count(*) filter (where st <> 'approved'), min(aff), count(distinct aff), coalesce(sum(com), 0)
    into n, bad_n, who, whon, tot from public.aff_rows(null, 0, null, p_ids);
  if n = 0 then perform public.bad('Nothing to pay.'); end if;
  if bad_n > 0 then perform public.bad('Only orders in "Waiting payout" can be paid.'); end if;
  if whon <> 1 then perform public.bad('Pay one affiliator at a time.'); end if;
  select * into a from public.affiliates where id = who;
  insert into public.aff_payouts (aff, amount, n, note, at, by_email, proof) values (who, tot, n, left(coalesce(p_note, ''), 200), t, em, p_proof) returning id into pid;
  update public.aff_orders set status = 'paid', payout = pid, at = t, by_email = em
   where order_id in (select jsonb_array_elements_text(p_ids)) and status = 'approved';
  perform public.log_act('Paid affiliator', coalesce(a.username, who) || ' · ' || public.money_txt(tot) || ' for ' || n || ' order' || case when n = 1 then '' else 's' end || ' (proof uploaded)');
  return jsonb_build_object('ok', true, 'amount', tot, 'n', n);
end $$;

-- the first version of paying is replaced by the one above
create or replace function public.admin_aff_pay(p_id text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin perform public.bad('Please reload the page: paying now needs the payout proof picture.'); return null; end $$;

revoke all on function public.aff_rows(text, bigint, bigint, jsonb), public.aff_summary(text, bigint, bigint) from public, anon, authenticated;
revoke all on function public.aff_report(text, bigint, bigint, text), public.admin_aff_list(bigint, bigint), public.admin_aff_orders(bigint, bigint),
  public.admin_aff_decide(jsonb, text, text), public.admin_aff_pay(jsonb, text, text), public.admin_aff_pay(text, text) from public, anon;
grant execute on function public.aff_report(text, bigint, bigint, text), public.admin_aff_list(bigint, bigint), public.admin_aff_orders(bigint, bigint),
  public.admin_aff_decide(jsonb, text, text), public.admin_aff_pay(jsonb, text, text), public.admin_aff_pay(text, text) to authenticated;

-- refunds: the delivery fee can't be refunded, so a refund is at most the product value
do $do$
declare d text; n text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_refund_order' limit 1;
  if d is null or position('greatest(0, coalesce((o.data ->> ''total'')' in d) > 0 then return; end if;
  n := replace(d, $a$tot := coalesce((o.data ->> 'total')::numeric, 0);$a$, $b$tot := greatest(0, coalesce((o.data ->> 'total')::numeric, 0) - coalesce((o.data ->> 'fee')::numeric, 0));$b$);
  n := replace(n, $a$no more than the order total.$a$, $b$no more than the order value. The delivery fee can''t be refunded.$b$);
  if n <> d then execute n; end if;
end $do$;
