-- BakeByCulture migration 52: DOKU online payment (auto confirmation). Manual confirmation by the store stays as it is.
--  * the owner saves the DOKU Client ID + Secret Key in Shop settings (kept in private_kv "doku_key", never sent to the website)
--  * settings.doku (public part of the settings doc): { on, methods: [{ k, name, on, payer: 'owner'|'customer', pct, fixed }] }
--  * the customer picks a method group; the fee is added to the DOKU amount only when the customer pays that fee
--  * the edge functions doku (create / status) and doku-webhook call doku_prepare() and doku_paid() with the service role
-- Safe to run more than once.
create table if not exists public.doku_pay (
  invoice text primary key, order_id text not null, method text not null, amount numeric not null, fee numeric not null default 0,
  url text, status text not null default 'pending', ref text, created_at bigint not null, paid_at bigint
);
create index if not exists doku_pay_order_idx on public.doku_pay (order_id);
alter table public.doku_pay enable row level security;

-- owner: status of the DOKU connection (never returns the secret)
create or replace function public.admin_doku_get() returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  perform public.assert_owner();
  select data into d from public.private_kv where key = 'doku_key';
  return jsonb_build_object('hasKey', coalesce(d ->> 'secret', '') <> '' and coalesce(d ->> 'clientId', '') <> '',
    'env', coalesce(nullif(d ->> 'env', ''), 'sandbox'), 'clientId', coalesce(d ->> 'clientId', ''));
end $$;

-- owner: save Client ID, Secret Key (empty = keep the old one) and environment
create or replace function public.admin_doku_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb; cid text; sec text; env text;
begin
  perform public.assert_owner();
  select coalesce(data, '{}'::jsonb) into d from public.private_kv where key = 'doku_key';
  d := coalesce(d, '{}'::jsonb);
  cid := btrim(coalesce(p ->> 'clientId', d ->> 'clientId', ''));
  sec := btrim(coalesce(nullif(p ->> 'secret', ''), d ->> 'secret', ''));
  env := case when p ->> 'env' = 'production' then 'production' when p ->> 'env' = 'sandbox' then 'sandbox' else coalesce(nullif(d ->> 'env', ''), 'sandbox') end;
  if length(cid) > 80 or length(sec) > 200 then perform public.bad('That does not look right.'); end if;
  insert into public.private_kv (key, data, updated_at) values ('doku_key', jsonb_build_object('clientId', cid, 'secret', sec, 'env', env), public.now_ms())
    on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
  return public.admin_doku_get();
end $$;

-- edge function "doku": check the order and the chosen method group, work out the fee, and open a pending payment row
create or replace function public.doku_prepare(p_id text, p_token text, p_group text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; c jsonb := coalesce(public.cfg() -> 'doku', '{}'::jsonb); m jsonb; total numeric; fee numeric := 0; inv text; t bigint := public.now_ms();
begin
  if not coalesce((c ->> 'on')::boolean, false) then perform public.bad('Online payment is not available right now.'); end if;
  if not public.owns(p_id, p_token) then perform public.bad('Please try again.'); end if;
  select * into o from public.orders where id = p_id;
  if o.id is null or o.status <> 'awaiting' then perform public.bad('This order can''t be paid online any more.'); end if;
  if o.expires_at is not null and o.expires_at < t then perform public.bad('This order has expired.'); end if;
  select e into m from jsonb_array_elements(coalesce(c -> 'methods', '[]'::jsonb)) e where e ->> 'k' = p_group and coalesce((e ->> 'on')::boolean, true) limit 1;
  if m is null then perform public.bad('That payment method is not available.'); end if;
  total := coalesce((o.data ->> 'total')::numeric, 0);
  if total <= 0 then perform public.bad('Nothing to pay.'); end if;
  if coalesce(m ->> 'payer', 'customer') = 'customer' then
    fee := round(total * coalesce(nullif(m ->> 'pct', '')::numeric, 0) / 100 + coalesce(nullif(m ->> 'fixed', '')::numeric, 0));
  end if;
  inv := o.code || '-' || substr(md5(random()::text || t::text), 1, 6);
  insert into public.doku_pay (invoice, order_id, method, amount, fee, created_at) values (inv, o.id, p_group, total + fee, fee, t);
  return jsonb_build_object('invoice', inv, 'amount', total + fee, 'fee', fee, 'code', o.code, 'expires', o.expires_at,
    'name', coalesce(o.data #>> '{customer,name}', ''), 'phone', coalesce(o.data #>> '{customer,phone}', ''), 'email', coalesce(o.data #>> '{customer,email}', ''));
end $$;

create or replace function public.doku_set_url(p_invoice text, p_url text) returns void
language sql security definer set search_path = public as $$
  update public.doku_pay set url = left(p_url, 600) where invoice = p_invoice $$;

-- DOKU says "paid" (notification or status check): mark the order paid once
create or replace function public.doku_paid(p_invoice text, p_amount numeric, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.doku_pay; o public.orders; t bigint := public.now_ms();
begin
  select * into r from public.doku_pay where invoice = p_invoice for update;
  if r.invoice is null then return jsonb_build_object('ok', false, 'err', 'unknown invoice'); end if;
  if r.status = 'paid' then return jsonb_build_object('ok', true, 'dup', true); end if;
  select * into o from public.orders where id = r.order_id for update;
  if o.id is null then return jsonb_build_object('ok', false, 'err', 'no order'); end if;
  if coalesce(p_amount, 0) < r.amount then
    update public.doku_pay set status = 'short', ref = left(p_ref, 80) where invoice = p_invoice;
    return jsonb_build_object('ok', false, 'err', 'amount');
  end if;
  if o.status not in ('awaiting', 'review') then
    update public.doku_pay set status = 'late', ref = left(p_ref, 80), paid_at = t where invoice = p_invoice;
    return jsonb_build_object('ok', false, 'err', 'order is ' || o.status);
  end if;
  update public.orders set status = 'new', updated_at = t,
    data = (o.data - 'rejected') || jsonb_build_object('status', 'new', 'paidAt', t, 'payVia', 'doku', 'payRef', left(p_ref, 80), 'payFee', r.fee, 'payGroup', r.method,
      'msgs', coalesce(o.data -> 'msgs', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', t, 'channel', case when o.data ->> 'notify' = 'email' then 'email' else 'whatsapp' end,
        'status', 'new', 'by', 'system', 'text', 'Payment received via DOKU. Thank you! We are preparing your order.')))
    where id = o.id;
  update public.doku_pay set status = 'paid', ref = left(p_ref, 80), paid_at = t where invoice = p_invoice;
  return jsonb_build_object('ok', true, 'code', o.code);
end $$;

-- does the order's latest DOKU attempt exist (for the status check after the customer comes back)
create or replace function public.doku_last(p_id text, p_token text) returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not public.owns(p_id, p_token) then return null; end if;
  select invoice into v from public.doku_pay where order_id = p_id and status = 'pending' order by created_at desc limit 1;
  return v;
end $$;

revoke all on function public.doku_prepare(text, text, text), public.doku_set_url(text, text), public.doku_paid(text, numeric, text), public.doku_last(text, text) from public, anon, authenticated;
grant execute on function public.doku_prepare(text, text, text), public.doku_set_url(text, text), public.doku_paid(text, numeric, text), public.doku_last(text, text) to service_role;
revoke all on function public.admin_doku_get(), public.admin_doku_save(jsonb) from public, anon;
grant execute on function public.admin_doku_get(), public.admin_doku_save(jsonb) to authenticated;
