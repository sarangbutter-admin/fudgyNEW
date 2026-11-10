-- BakeByCulture migration 43: the owner can approve a commission that is still "On hold" once its complaint is resolved (no need to wait for the window to end).
-- A new complaint during the window puts it on hold again. Safe to run more than once.

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
      -- an order still "On hold" (waiting out the complaint window) can be approved early once it has no open complaint
      if r.st = 'hold' and coalesce((select data -> 'complaint' ->> 'status' from public.orders where id = r.id), '') in ('open', 'review') then
        if cnt = 1 then perform public.bad('This order has an open complaint. Resolve the complaint first.'); end if;
        skipped := skipped + 1; continue;
      end if;
      if r.st not in ('review', 'hold') or (r.partial and cnt > 1) then skipped := skipped + 1; continue; end if;
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
revoke all on function public.admin_aff_decide(jsonb, text, text) from public, anon;
grant execute on function public.admin_aff_decide(jsonb, text, text) to authenticated;
