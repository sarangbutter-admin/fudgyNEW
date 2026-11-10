-- BakeByCulture migration 37: ban / unban customers (by WhatsApp number and email), with an optional expiry.
--  * a banned customer can't place a new order (checked in the database, so it can't be skipped in the browser)
--  * unbanning keeps the record. Everything is written to the activity log.
-- Safe to run more than once. Run after migration 36.

create table if not exists public.cust_bans (
  id bigserial primary key, phone_norm text not null default '', email text not null default '', name text not null default '',
  reason text not null default '', at bigint not null, until bigint, by_email text not null default '',
  lifted boolean not null default false, lifted_at bigint, lifted_by text not null default '');
create index if not exists cust_bans_phone on public.cust_bans (phone_norm) where not lifted;
create index if not exists cust_bans_email on public.cust_bans (email) where not lifted;
alter table public.cust_bans enable row level security;
revoke all on public.cust_bans from anon, authenticated;

create or replace function public.cust_ban_of(p_phone text, p_email text) returns public.cust_bans
language sql stable security definer set search_path = public as $$
  select b.* from public.cust_bans b
   where not b.lifted and (b.until is null or b.until > public.now_ms())
     and ((b.phone_norm <> '' and b.phone_norm = coalesce(p_phone, '')) or (b.email <> '' and b.email = lower(btrim(coalesce(p_email, '')))))
   order by b.at desc limit 1 $$;

create or replace function public.orders_ban_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (public.cust_ban_of(new.phone_norm, new.data #>> '{customer,email}')).id is not null then
    perform public.bad('We can''t take this order right now. Please contact the shop on WhatsApp.');
  end if;
  return new;
end $$;
create or replace trigger orders_aa_ban_check before insert on public.orders for each row execute function public.orders_ban_check();

create or replace function public.admin_customers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return coalesce((select jsonb_agg(x order by (x ->> 'createdAt')::bigint desc) from (
    select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'note', c.note, 'source', c.source, 'createdAt', c.created_at,
             'orders', coalesce(s.n, 0), 'spent', coalesce(s.spent, 0), 'lastOrder', s.last,
             'ban', (select jsonb_build_object('id', b.id, 'reason', b.reason, 'at', b.at, 'until', b.until, 'by', b.by_email) from (select (public.cust_ban_of(c.phone_norm, c.email)).*) b where b.id is not null)) as x
      from public.customers c
      left join (select phone_norm, count(*) as n,
                        coalesce(sum((data ->> 'total')::numeric) filter (where status in ('new','baking','ready','completed')), 0) as spent,
                        max(created_at) as last
                   from public.orders group by phone_norm) s on s.phone_norm = c.phone_norm) q), '[]'::jsonb);
end $$;

-- p_days: 1, 7, 30 ... or null for no end date
create or replace function public.admin_cust_ban(p_id text, p_reason text, p_days int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.customers; rs text := left(btrim(coalesce(p_reason, '')), 200); t bigint := public.now_ms(); em text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  perform public.assert_admin();
  select * into c from public.customers where id = p_id;
  if c.id is null then perform public.bad('Customer not found.'); end if;
  if length(rs) < 3 then perform public.bad('Type the reason (at least 3 letters).'); end if;
  if p_days is not null and (p_days < 1 or p_days > 3650) then perform public.bad('Pick how long the ban lasts.'); end if;
  update public.cust_bans set lifted = true, lifted_at = t, lifted_by = em
   where not lifted and ((phone_norm <> '' and phone_norm = c.phone_norm) or (email <> '' and email = lower(c.email)));
  insert into public.cust_bans (phone_norm, email, name, reason, at, until, by_email)
    values (c.phone_norm, lower(btrim(c.email)), c.name, rs, t, case when p_days is null then null else t + p_days * 86400000::bigint end, em);
  perform public.log_act('Banned customer', c.name || ' · ' || c.phone || ' · ' || case when p_days is null then 'no end date' else p_days || ' day' || case when p_days = 1 then '' else 's' end end || ' · ' || rs);
  return public.admin_customers();
end $$;

create or replace function public.admin_cust_unban(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.customers; t bigint := public.now_ms(); em text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  perform public.assert_admin();
  select * into c from public.customers where id = p_id;
  if c.id is null then perform public.bad('Customer not found.'); end if;
  update public.cust_bans set lifted = true, lifted_at = t, lifted_by = em
   where not lifted and ((phone_norm <> '' and phone_norm = c.phone_norm) or (email <> '' and email = lower(c.email)));
  perform public.log_act('Unbanned customer', c.name || ' · ' || c.phone);
  return public.admin_customers();
end $$;

revoke all on function public.cust_ban_of(text, text), public.orders_ban_check() from public, anon, authenticated;
revoke all on function public.admin_customers(), public.admin_cust_ban(text, text, int), public.admin_cust_unban(text) from public, anon;
grant execute on function public.admin_customers(), public.admin_cust_ban(text, text, int), public.admin_cust_unban(text) to authenticated;
