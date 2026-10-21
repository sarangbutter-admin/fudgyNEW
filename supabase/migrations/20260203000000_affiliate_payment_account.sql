-- Delidome migration 34: affiliator payment account, payout rules.
--  * the affiliator adds a bank / e-wallet account (changing it needs their password and sets it back to "pending");
--    the owner verifies it by hand (verify, or reject with a reason)
--  * paying needs a verified account and at least the minimum payout (default 20000, the owner can change it); the day is only a note (default Thursday)
-- Safe to run more than once. Run after migration 33.

alter table public.affiliates
  add column if not exists pay_method text not null default '',
  add column if not exists pay_no text not null default '',
  add column if not exists pay_name text not null default '',
  add column if not exists pay_status text not null default 'none',
  add column if not exists pay_reason text not null default '',
  add column if not exists pay_at bigint not null default 0;
alter table public.aff_payouts add column if not exists acct text not null default '';

create or replace function public.aff_cfg_vals() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('min', coalesce((select (data ->> 'min')::numeric from public.private_kv where key = 'aff_cfg'), 20000),
                            'day', coalesce((select (data ->> 'day')::int from public.private_kv where key = 'aff_cfg'), 4)) $$;

create or replace function public.admin_aff_cfg(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare mn numeric; dy int;
begin
  perform public.assert_owner();
  if p is null or p = '{}'::jsonb then return public.aff_cfg_vals(); end if;
  begin mn := (p ->> 'min')::numeric; dy := (p ->> 'day')::int; exception when others then mn := null; end;
  if mn is null or mn < 0 or mn > 100000000 then perform public.bad('Minimum payout: a number from 0 to 100,000,000.'); end if;
  if dy is null or dy < 0 or dy > 6 then perform public.bad('Pick a payout day.'); end if;
  insert into public.private_kv (key, data, updated_at) values ('aff_cfg', jsonb_build_object('min', mn, 'day', dy), public.now_ms())
    on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
  perform public.log_act('Affiliate payout rules changed', 'minimum ' || public.money_txt(mn));
  return public.aff_cfg_vals();
end $$;

-- the payment account as the viewer may see it (the affiliator sees the number hidden except the last 4 digits)
create or replace function public.aff_pay_json(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('method', a.pay_method, 'name', a.pay_name, 'status', a.pay_status, 'reason', a.pay_reason, 'at', a.pay_at,
    'no', case when public.is_owner() then a.pay_no when a.pay_no = '' then '' else repeat('•', greatest(0, length(a.pay_no) - 4)) || right(a.pay_no, 4) end)
  from public.affiliates a where a.id = p_id $$;

create or replace function public.aff_pay_info(p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me public.affiliates := public.aff_self();
begin
  if not public.is_owner() then
    if me.id is null or me.status = 'disabled' or me.id <> p_id then perform public.bad('Please sign in again.'); end if;
  end if;
  return jsonb_build_object('pay', public.aff_pay_json(p_id), 'cfg', public.aff_cfg_vals());
end $$;

create or replace function public.aff_pay_save(p_method text, p_no text, p_name text, p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.affiliates := public.aff_self(); m text := left(btrim(coalesce(p_method, '')), 40);
  num text := regexp_replace(coalesce(p_no, ''), '[^0-9]', '', 'g'); nm text := left(btrim(coalesce(p_name, '')), 80); ok boolean := false;
begin
  if me.id is null or me.status = 'disabled' then perform public.bad('Please sign in again.'); end if;
  if not public.throttle_ok('affpay:' || me.id, 8, 600000) then perform public.bad('Too many tries. Please wait 10 minutes.'); end if;
  if m = '' then perform public.bad('Choose your bank or e-wallet.'); end if;
  if length(num) < 5 or length(num) > 25 then perform public.bad('Account number: digits only, 5 to 25 numbers.'); end if;
  if length(nm) < 2 then perform public.bad('Type the account holder name.'); end if;
  if coalesce(p_password, '') = '' then perform public.bad('Type your password to confirm.'); end if;
  execute $q$select exists (select 1 from auth.users u where lower(u.email) = lower($1) and u.encrypted_password is not null and u.encrypted_password = extensions.crypt($2, u.encrypted_password))$q$
    into ok using me.email, p_password;
  if not ok then perform public.bad('That password isn''t right.'); end if;
  update public.affiliates set pay_method = m, pay_no = num, pay_name = nm, pay_status = 'pending', pay_reason = '', pay_at = public.now_ms() where id = me.id;
  insert into public.activity_log (at, actor, email, role, action, detail)
    values (public.now_ms(), coalesce(nullif(me.name, ''), me.username), me.email, 'Affiliate', 'Affiliate payment account changed', left(me.username || ' · ' || m || ' ••••' || right(num, 4), 600));
  return public.aff_pay_json(me.id);
end $$;

create or replace function public.admin_aff_pay_verify(p_id text, p_action text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates; rs text := left(btrim(coalesce(p_reason, '')), 200);
begin
  perform public.assert_owner();
  if p_action not in ('verify', 'reject') then perform public.bad('Unknown action.'); end if;
  select * into a from public.affiliates where id = p_id;
  if a.id is null then perform public.bad('Affiliator not found.'); end if;
  if a.pay_status = 'none' then perform public.bad('There is no payment account to check yet.'); end if;
  if p_action = 'reject' and length(rs) < 3 then perform public.bad('Type the reason (at least 3 letters).'); end if;
  update public.affiliates set pay_status = case when p_action = 'verify' then 'verified' else 'rejected' end, pay_reason = case when p_action = 'reject' then rs else '' end where id = p_id;
  perform public.log_act(case when p_action = 'verify' then 'Verified affiliator payment account' else 'Rejected affiliator payment account' end, a.username || ' · ' || a.pay_method || ' ••••' || right(a.pay_no, 4));
  return public.aff_pay_json(p_id);
end $$;

create or replace function public.admin_aff_list(p_from bigint, p_to bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb := '[]'::jsonb; a record;
begin
  perform public.assert_owner();
  for a in select id from public.affiliates order by created_at loop
    out := out || jsonb_build_array((select (r -> 'aff') || jsonb_build_object('tot', r -> 'tot', 'sources', r -> 'sources', 'pay', public.aff_pay_json(a.id)) from (select public.aff_summary(a.id, p_from, p_to) r) z));
  end loop;
  return out;
end $$;

create or replace function public.admin_aff_pay(p_ids jsonb, p_note text, p_proof text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int := 0; tot numeric := 0; t bigint := public.now_ms(); pid bigint; who text; whon int; bad_n int;
  em text := lower(coalesce(auth.jwt() ->> 'email', '')); a public.affiliates; mn numeric := (public.aff_cfg_vals() ->> 'min')::numeric;
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
  if a.pay_status <> 'verified' then perform public.bad('This affiliator''s payment account is not verified yet.'); end if;
  if tot < mn then perform public.bad('Below the minimum payout of ' || public.money_txt(mn) || '.'); end if;
  insert into public.aff_payouts (aff, amount, n, note, at, by_email, proof, acct)
    values (who, tot, n, left(coalesce(p_note, ''), 200), t, em, p_proof, left(a.pay_method || ' · ' || a.pay_no || ' · ' || a.pay_name, 200)) returning id into pid;
  update public.aff_orders set status = 'paid', payout = pid, at = t, by_email = em
   where order_id in (select jsonb_array_elements_text(p_ids)) and status = 'approved';
  perform public.log_act('Paid affiliator', coalesce(a.username, who) || ' · ' || public.money_txt(tot) || ' for ' || n || ' order' || case when n = 1 then '' else 's' end || ' (proof uploaded)');
  return jsonb_build_object('ok', true, 'amount', tot, 'n', n);
end $$;

revoke all on function public.aff_cfg_vals(), public.aff_pay_json(text) from public, anon, authenticated;
revoke all on function public.admin_aff_cfg(jsonb), public.aff_pay_info(text), public.aff_pay_save(text, text, text, text), public.admin_aff_pay_verify(text, text, text),
  public.admin_aff_list(bigint, bigint), public.admin_aff_pay(jsonb, text, text) from public, anon;
grant execute on function public.admin_aff_cfg(jsonb), public.aff_pay_info(text), public.aff_pay_save(text, text, text, text), public.admin_aff_pay_verify(text, text, text),
  public.admin_aff_list(bigint, bigint), public.admin_aff_pay(jsonb, text, text) to authenticated;
