-- Delidome migration 32: affiliates.
--  * the owner creates affiliator accounts (username + password, commission %, optional own coupon) and can pause or switch them off
--    (paused: can sign in and see the dashboard, but links and coupon stop earning; off: can't sign in)
--  * a shop link with ?ref=CODE (and &src=ig / tt / wa / ads ...) is counted as a view; an order placed within 30 days of the
--    last link click, or with the affiliator's coupon (the coupon wins), is credited to that affiliator. Their own orders never count.
--  * commission = rate % of the order without the delivery fee. Pending until the order is completed and the complaint window
--    has passed with no complaint and no refund, then approved; the owner marks approved commission as paid.
-- Safe to run more than once. Run after migration 31.

create table if not exists public.affiliates (
  id text primary key, code text not null unique, email text not null unique, username text not null unique,
  name text not null default '', phone text not null default '', phone_norm text not null default '',
  rate numeric not null default 10, coupon text not null default '', status text not null default 'active',
  note text not null default '', created_at bigint not null default public.now_ms());
create table if not exists public.aff_hits (id bigserial primary key, aff text not null, vid text not null, src text not null default 'direct', t bigint not null);
create index if not exists aff_hits_aff_t on public.aff_hits (aff, t);
create table if not exists public.aff_paid (order_id text primary key, aff text not null, amount numeric not null, payout bigint, at bigint not null);
create table if not exists public.aff_payouts (id bigserial primary key, aff text not null, amount numeric not null, n int not null, note text not null default '', at bigint not null, by_email text not null default '');
alter table public.affiliates enable row level security;
alter table public.aff_hits enable row level security;
alter table public.aff_paid enable row level security;
alter table public.aff_payouts enable row level security;
revoke all on public.affiliates, public.aff_hits, public.aff_paid, public.aff_payouts from anon, authenticated;

-- the signed-in affiliator (null when the account isn't one)
create or replace function public.aff_self() returns public.affiliates
language sql stable security definer set search_path = public as $$
  select a.* from public.affiliates a where coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
     and lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1 $$;

create or replace function public.aff_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates := public.aff_self();
begin
  if a.id is null then return jsonb_build_object('aff', false); end if;
  if a.status = 'disabled' then return jsonb_build_object('aff', false, 'disabled', true); end if;
  return jsonb_build_object('aff', true, 'id', a.id, 'code', a.code, 'name', a.name, 'rate', a.rate, 'coupon', a.coupon, 'status', a.status, 'username', a.username);
end $$;

-- a click on an affiliate link (one view per visitor per 30 minutes)
create or replace function public.aff_hit(p_code text, p_vid text, p_src text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.affiliates; nowt bigint := public.now_ms(); s text := lower(coalesce(p_src, ''));
begin
  if p_vid is null or p_vid !~ '^[A-Za-z0-9]{6,40}$' or coalesce(p_code, '') !~* '^[A-Z0-9_-]{2,20}$' then return; end if;
  if not public.lim_ip('aff-m', 'visitIpM', 120, 60000) then return; end if;
  select * into a from public.affiliates where code = upper(p_code) and status = 'active';
  if a.id is null then return; end if;
  if s !~ '^[a-z0-9.-]{1,40}$' then s := 'direct'; end if;
  if exists (select 1 from public.aff_hits h where h.aff = a.id and h.vid = p_vid and h.t > nowt - 1800000) then return; end if;
  insert into public.aff_hits (aff, vid, src, t) values (a.id, p_vid, s, nowt);
end $$;

-- credit a just-placed order to the affiliate link the customer came from (a coupon match set by the trigger below wins)
create or replace function public.aff_claim(p_id text, p_token text, p_code text, p_src text, p_at bigint) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; a public.affiliates; t bigint := public.now_ms(); s text := lower(coalesce(p_src, ''));
begin
  if not public.owns(p_id, p_token) then return; end if;
  select * into o from public.orders where id = p_id;
  if o.id is null or o.data ? 'aff' or o.created_at < t - 900000 then return; end if;
  if coalesce(p_at, 0) < t - 30 * 86400000::bigint or coalesce(p_at, 0) > t + 60000 then return; end if;
  select * into a from public.affiliates where code = upper(coalesce(p_code, '')) and status = 'active';
  if a.id is null or (a.phone_norm <> '' and a.phone_norm = o.phone_norm) then return; end if;
  if s !~ '^[a-z0-9.-]{1,40}$' then s := 'direct'; end if;
  update public.orders set data = data || jsonb_build_object('aff', jsonb_build_object('id', a.id, 'code', a.code, 'src', s, 'via', 'link', 'rate', a.rate, 'at', t))
   where id = p_id;
end $$;

-- an order with an affiliator's coupon is theirs
create or replace function public.orders_aff() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.affiliates; cp text := upper(btrim(coalesce(new.data ->> 'coupon', '')));
begin
  if cp = '' or new.data ? 'aff' then return new; end if;
  select * into a from public.affiliates where upper(coupon) = cp and coupon <> '' and status = 'active' limit 1;
  if a.id is null or (a.phone_norm <> '' and a.phone_norm = coalesce(new.phone_norm, '')) then return new; end if;
  new.data := new.data || jsonb_build_object('aff', jsonb_build_object('id', a.id, 'code', a.code, 'src', 'coupon', 'via', 'coupon', 'rate', a.rate, 'at', public.now_ms()));
  return new;
end $$;
create or replace trigger orders_aff_trg before insert or update of data on public.orders for each row execute function public.orders_aff();

-- commission state of one order: none (not paid yet / cancelled), void (complaint or refund), pending, approved, paid
create or replace function public.aff_state(o public.orders, p_win_h numeric) returns text
language sql stable security definer set search_path = public as $$
  select case
    when o.status in ('cancelled', 'awaiting', 'review') then 'none'
    when o.data ? 'complaint' or coalesce((o.data -> 'refund' ->> 'amount')::numeric, 0) > 0 or o.data ? 'returned' then 'void'
    when exists (select 1 from public.aff_paid p where p.order_id = o.id) then 'paid'
    when o.status = 'completed' and coalesce((o.data ->> 'completedAt')::bigint, 0) > 0
         and (o.data ->> 'completedAt')::bigint + p_win_h * 3600000 < public.now_ms() then 'approved'
    else 'pending' end $$;

create or replace function public.aff_amount(o public.orders) returns numeric
language sql immutable as $$
  select round(greatest(0, coalesce((o.data ->> 'total')::numeric, 0) - coalesce((o.data ->> 'fee')::numeric, 0))
               * coalesce((o.data -> 'aff' ->> 'rate')::numeric, 0) / 100, 2) $$;

-- one affiliator's numbers for a period, grouped by day / week / month (shop time zone)
create or replace function public.aff_report(p_id text, p_from bigint, p_to bigint, p_group text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.affiliates := public.aff_self(); a public.affiliates; tz text := public.shop_tz();
  win numeric := coalesce((select (data ->> 'complaintWindowH')::numeric from public.docs where key = 'settings'), 24);
  g text := case when p_group in ('week', 'month') then p_group else 'day' end;
  f bigint := coalesce(p_from, 0); tt bigint := coalesce(p_to, public.now_ms() + 86400000); r jsonb;
begin
  if not public.is_owner() then
    if me.id is null or me.status = 'disabled' or me.id <> p_id then perform public.bad('Please sign in again.'); end if;
  end if;
  select * into a from public.affiliates where id = p_id;
  if a.id is null then perform public.bad('Affiliator not found.'); end if;
  with o as (select x.*, public.aff_state(x, win) st, public.aff_amount(x) com,
                    greatest(0, coalesce((x.data ->> 'total')::numeric, 0) - coalesce((x.data ->> 'fee')::numeric, 0)) amt
               from public.orders x where x.data -> 'aff' ->> 'id' = a.id and x.created_at >= f and x.created_at < tt),
       h as (select * from public.aff_hits where aff = a.id and t >= f and t < tt),
       k as (select (to_timestamp(t / 1000.0) at time zone tz) ts, 'h' kind, vid, null::numeric amt, null::numeric com, null::text st from h
             union all select (to_timestamp(created_at / 1000.0) at time zone tz), 'o', null, amt, com, st from o where st <> 'none'),
       s as (select case g when 'month' then to_char(ts, 'YYYY-MM') when 'week' then to_char(date_trunc('week', ts), 'YYYY-MM-DD') else to_char(ts, 'YYYY-MM-DD') end b, * from k)
  select jsonb_build_object(
    'aff', jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'rate', a.rate, 'coupon', a.coupon, 'status', a.status, 'username', a.username, 'phone', case when public.is_owner() then a.phone else '' end, 'note', case when public.is_owner() then a.note else '' end),
    'tot', jsonb_build_object(
      'views', (select count(*) from h), 'uniq', (select count(distinct vid) from h),
      'orders', (select count(*) from o where st <> 'none'), 'waiting', (select count(*) from o where st = 'none' and status <> 'cancelled'),
      'coupon', (select count(*) from o where data -> 'aff' ->> 'via' = 'coupon' and status <> 'cancelled'),
      'sales', (select coalesce(sum(amt), 0) from o where st not in ('none', 'void')),
      'pending', (select coalesce(sum(com), 0) from o where st = 'pending'), 'approved', (select coalesce(sum(com), 0) from o where st = 'approved'),
      'paid', (select coalesce(sum(com), 0) from o where st = 'paid'), 'void', (select coalesce(sum(com), 0) from o where st = 'void')),
    'series', coalesce((select jsonb_agg(jsonb_build_object('b', b, 'views', v, 'uniq', u, 'orders', n, 'sales', sa, 'com', c) order by b) from (
        select b, count(*) filter (where kind = 'h') v, count(distinct vid) filter (where kind = 'h') u, count(*) filter (where kind = 'o' and st <> 'void') n,
               coalesce(sum(amt) filter (where kind = 'o' and st <> 'void'), 0) sa, coalesce(sum(com) filter (where kind = 'o' and st <> 'void'), 0) c from s group by b) z), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('src', src, 'views', v, 'orders', n, 'sales', sa) order by v desc, n desc) from (
        select src, sum(v) v, sum(n) n, sum(sa) sa from (
          select src, count(*) v, 0 n, 0::numeric sa from h group by src
          union all select coalesce(data -> 'aff' ->> 'src', 'direct'), 0, count(*), coalesce(sum(amt), 0) from o where st not in ('none', 'void') group by 1) u group by src) z), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'at', created_at, 'status', status, 'amt', amt, 'com', com, 'st', st,
        'src', coalesce(data -> 'aff' ->> 'src', ''), 'via', coalesce(data -> 'aff' ->> 'via', '')) order by created_at desc) from (select * from o order by created_at desc limit 300) z), '[]'::jsonb),
    'payouts', coalesce((select jsonb_agg(jsonb_build_object('at', at, 'amount', amount, 'n', n, 'note', note) order by at desc) from public.aff_payouts where aff = a.id), '[]'::jsonb),
    'win', win) into r;
  return r;
end $$;

-- owner: every affiliator with their totals for the period
create or replace function public.admin_aff_list(p_from bigint, p_to bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare out jsonb := '[]'::jsonb; a record;
begin
  perform public.assert_owner();
  for a in select id from public.affiliates order by created_at loop
    out := out || jsonb_build_array((select r -> 'aff' || jsonb_build_object('tot', r -> 'tot') from (select public.aff_report(a.id, p_from, p_to, 'day') r) z));
  end loop;
  return out;
end $$;

-- owner: add or change an affiliator (a new one gets a sign-in; a password can be changed later)
create or replace function public.admin_aff_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare id0 text := btrim(coalesce(p ->> 'id', '')); un text := lower(btrim(coalesce(p ->> 'username', ''))); pw text := coalesce(p ->> 'password', '');
  cd text := upper(btrim(coalesce(p ->> 'code', ''))); st text := coalesce(p ->> 'status', 'active'); rt numeric; em text; uid uuid := gen_random_uuid(); col text; a public.affiliates;
begin
  perform public.assert_owner();
  if cd !~ '^[A-Z0-9_-]{2,20}$' then perform public.bad('Link code: 2 to 20 letters or numbers, like SARI or DESI10.'); end if;
  if st not in ('active', 'paused', 'disabled') then st := 'active'; end if;
  begin rt := (p ->> 'rate')::numeric; exception when others then rt := null; end;
  if rt is null or rt < 0 or rt > 90 then perform public.bad('Commission must be a number from 0 to 90 (%).'); end if;
  if exists (select 1 from public.affiliates where code = cd and id <> id0) then perform public.bad('That link code is already used.'); end if;
  if id0 = '' then
    if un !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then perform public.bad('Username: 3 to 30 letters or numbers (dots, dashes and _ are fine), no spaces.'); end if;
    if length(pw) < 8 then perform public.bad('Password: at least 8 characters.'); end if;
    em := un || '@' || public.team_domain();
    if exists (select 1 from public.admins where lower(username) = un or lower(email) = em) or exists (select 1 from public.affiliates where username = un) then perform public.bad('That username is taken.'); end if;
    execute 'select exists (select 1 from auth.users where lower(email) = $1)' into strict col using em;
    if col::boolean then perform public.bad('That username is taken.'); end if;
    execute $q$insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
               values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, extensions.crypt($3, extensions.gen_salt('bf')), now(),
                       '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('username', $4), now(), now())$q$ using uid, em, pw, un;
    for col in select column_name from information_schema.columns where table_schema = 'auth' and table_name = 'users' and data_type in ('text','character varying')
               and column_name in ('confirmation_token','recovery_token','email_change_token_new','email_change','email_change_token_current','phone_change','phone_change_token','reauthentication_token') loop
      execute format('update auth.users set %I = coalesce(%I, '''') where id = $1', col, col) using uid;
    end loop;
    if to_regclass('auth.identities') is not null then
      execute $q$insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
                 values (gen_random_uuid(), $1, $1::text, jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true), 'email', now(), now(), now())$q$ using uid, em;
    end if;
    id0 := 'af' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
    insert into public.affiliates (id, code, email, username, name, phone, phone_norm, rate, coupon, status, note)
    values (id0, cd, em, un, left(btrim(coalesce(p ->> 'name', '')), 80), left(btrim(coalesce(p ->> 'phone', '')), 30), public.norm_phone(coalesce(p ->> 'phone', '')),
            rt, upper(left(btrim(coalesce(p ->> 'coupon', '')), 30)), st, left(btrim(coalesce(p ->> 'note', '')), 300));
    perform public.log_act('Added affiliator', un || ' (' || cd || ')');
  else
    select * into a from public.affiliates where id = id0;
    if a.id is null then perform public.bad('Affiliator not found.'); end if;
    update public.affiliates set code = cd, name = left(btrim(coalesce(p ->> 'name', '')), 80), phone = left(btrim(coalesce(p ->> 'phone', '')), 30),
      phone_norm = public.norm_phone(coalesce(p ->> 'phone', '')), rate = rt, coupon = upper(left(btrim(coalesce(p ->> 'coupon', '')), 30)), status = st,
      note = left(btrim(coalesce(p ->> 'note', '')), 300) where id = id0;
    if pw <> '' then
      if length(pw) < 8 then perform public.bad('Password: at least 8 characters.'); end if;
      execute 'update auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt(''bf'')), updated_at = now() where lower(email) = $2' using pw, a.email;
    end if;
    perform public.log_act(case when st <> a.status then 'Affiliator ' || case st when 'active' then 'switched on' when 'paused' then 'paused' else 'switched off' end else 'Changed affiliator' end, a.username || ' (' || cd || ')');
  end if;
  return jsonb_build_object('ok', true, 'id', id0);
end $$;

-- owner: mark everything approved and not paid yet as paid
create or replace function public.admin_aff_pay(p_id text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare win numeric := coalesce((select (data ->> 'complaintWindowH')::numeric from public.docs where key = 'settings'), 24); t bigint := public.now_ms();
  tot numeric; n int; pid bigint; a public.affiliates;
begin
  perform public.assert_owner();
  select * into a from public.affiliates where id = p_id;
  if a.id is null then perform public.bad('Affiliator not found.'); end if;
  select coalesce(sum(public.aff_amount(o)), 0), count(*) into tot, n from public.orders o where o.data -> 'aff' ->> 'id' = p_id and public.aff_state(o, win) = 'approved';
  if n = 0 then perform public.bad('Nothing approved to pay yet.'); end if;
  insert into public.aff_payouts (aff, amount, n, note, at, by_email) values (p_id, tot, n, left(coalesce(p_note, ''), 200), t, lower(coalesce(auth.jwt() ->> 'email', ''))) returning id into pid;
  insert into public.aff_paid (order_id, aff, amount, payout, at)
    select o.id, p_id, public.aff_amount(o), pid, t from public.orders o where o.data -> 'aff' ->> 'id' = p_id and public.aff_state(o, win) = 'approved';
  perform public.log_act('Paid affiliator', a.username || ' · ' || public.money_txt(tot) || ' for ' || n || ' order' || case when n = 1 then '' else 's' end);
  return jsonb_build_object('ok', true, 'amount', tot, 'n', n);
end $$;

revoke all on function public.aff_self(), public.aff_state(public.orders, numeric), public.aff_amount(public.orders), public.orders_aff() from public, anon, authenticated;
revoke all on function public.aff_me(), public.aff_report(text, bigint, bigint, text), public.admin_aff_list(bigint, bigint), public.admin_aff_save(jsonb), public.admin_aff_pay(text, text) from public, anon;
grant execute on function public.aff_me(), public.aff_report(text, bigint, bigint, text), public.admin_aff_list(bigint, bigint), public.admin_aff_save(jsonb), public.admin_aff_pay(text, text) to authenticated;
revoke all on function public.aff_hit(text, text, text), public.aff_claim(text, text, text, text, bigint) from public;
grant execute on function public.aff_hit(text, text, text), public.aff_claim(text, text, text, text, bigint) to anon, authenticated;
