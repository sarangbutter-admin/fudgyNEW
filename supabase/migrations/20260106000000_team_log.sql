-- BakeByCulture migration 6: staff logins (username + password), permission checkboxes,
-- activity log (owner only, kept 3 months), owner password for deletes and price changes.
-- Safe to run more than once. Run after migrations 1-5.

create extension if not exists pgcrypto with schema extensions;

-- ---------- team members ----------------------------------------------------
alter table public.admins add column if not exists username text;
alter table public.admins add column if not exists title    text    not null default '';
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'admins' and column_name = 'perms') then
    alter table public.admins add column perms jsonb not null default '[]'::jsonb;
    -- staff added before this update keep what they could do before
    update public.admins set perms = '["orders","complaints","labels","customers"]'::jsonb where role = 'staff';
  end if;
end $$;
alter table public.admins add column if not exists managed  boolean not null default false;   -- login was created from the Team tab
create unique index if not exists admins_username_uq on public.admins (lower(username)) where username is not null;

-- what a staff member can be allowed to do (owners can do everything)
create or replace function public.perm_list() returns text[]
language sql immutable as $$
  select array['dashboard','orders','complaints','customers','labels','products','badges','boxes','sales','coupons','notify','design','settings']
$$;

create or replace function public.team_me() returns public.admins
language sql stable security definer set search_path = public as $$
  select a.* from public.admins a
   where coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
     and lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1
$$;

create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select a.role = 'owner' or a.perms ? p from public.team_me() a where a.email is not null), false)
$$;

create or replace function public.can_upload() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_perm('products') or public.has_perm('design') or public.has_perm('settings') or public.has_perm('badges')
$$;

-- ---------- activity log ------------------------------------------------------
create table if not exists public.activity_log (
  id     bigserial primary key,
  at     bigint not null,
  actor  text   not null,
  email  text   not null,
  role   text   not null,
  action text   not null,
  detail text   not null default '',
  note   text   not null default ''
);
create index if not exists activity_log_at_idx on public.activity_log (at desc);
alter table public.activity_log enable row level security;
revoke all on public.activity_log from public, anon, authenticated;

create or replace function public.log_act(p_action text, p_detail text default '') returns void
language plpgsql security definer set search_path = public as $$
declare me public.admins := public.team_me();
begin
  if me.email is null then return; end if;
  insert into public.activity_log (at, actor, email, role, action, detail)
  values (public.now_ms(), coalesce(nullif(me.name, ''), me.username, me.email), me.email,
          case when me.role = 'owner' then 'Owner' else coalesce(nullif(me.title, ''), 'Staff') end,
          left(coalesce(p_action, ''), 120), left(coalesce(p_detail, ''), 600));
  if random() < 0.02 then delete from public.activity_log where at < public.now_ms() - 92 * 86400000::bigint; end if;
end $$;

-- ---------- owner password (valid 10 minutes for the person who typed it) -----
create table if not exists public.team_sudo (email text primary key, until bigint not null);
alter table public.team_sudo enable row level security;
revoke all on public.team_sudo from public, anon, authenticated;

create or replace function public.owner_pw_ok(p text, p_only_email text default null) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare ok boolean := false;
begin
  if coalesce(p, '') = '' or to_regclass('auth.users') is null then return false; end if;
  execute $q$select exists (select 1 from auth.users u join public.admins a on lower(a.email) = lower(u.email)
                     where a.role = 'owner' and ($2 is null or lower(a.email) = lower($2))
                       and u.encrypted_password is not null and u.encrypted_password = extensions.crypt($1, u.encrypted_password))$q$
    into ok using p, p_only_email;
  return ok;
end $$;

create or replace function public.sudo_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_sudo s where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', '')) and s.until > public.now_ms())
$$;

create or replace function public.admin_sudo(p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare em text := lower(coalesce(auth.jwt() ->> 'email', '')); u bigint := public.now_ms() + 600000;
begin
  perform public.assert_admin();
  if not public.throttle_ok('sudo:' || em, 8, 600000) then
    return jsonb_build_object('ok', false, 'err', 'Too many tries. Please wait 10 minutes.'); end if;
  if not public.owner_pw_ok(p_password) then
    perform public.log_act('Owner password wrong', 'Someone typed a wrong owner password');
    return jsonb_build_object('ok', false, 'err', 'That owner password isn''t right.'); end if;
  insert into public.team_sudo (email, until) values (em, u) on conflict (email) do update set until = excluded.until;
  perform public.log_act('Owner password confirmed', '');
  return jsonb_build_object('ok', true, 'until', u);
end $$;

-- ---------- guards + log on shop content (only for changes made from the team site) ---
-- The team write functions set dd.op = 'team'. Customer orders and automatic stock changes don't, so they pass untouched.
create or replace function public.chg_list(o jsonb, n jsonb, money_keys text[]) returns text
language plpgsql immutable as $$
declare k text; parts text[] := '{}'; nice text;
begin
  for k in select key from (select jsonb_object_keys(coalesce(o, '{}'::jsonb)) as key union select jsonb_object_keys(coalesce(n, '{}'::jsonb))) x order by 1 loop
    if (o -> k) is distinct from (n -> k) and not (k in ('reviews','badges','tints') and coalesce(o -> k, '[]'::jsonb) = coalesce(n -> k, '[]'::jsonb)) then
      nice := case k when 'desc' then 'description' when 'img' then 'photo' when 'bg' then 'background' when 'cat' then 'category'
                     when 'track' then 'stock tracking' when 'art' then 'look' when 'active' then 'on/off' when 'surcharge' then 'extra price'
                     when 'reviews' then 'reviews' when 'cutout' then null when 'tints' then null else k end;
      if nice is null then continue; end if;
      if k = any (money_keys) or k in ('stock','status','name','code','value','type') then
        if jsonb_typeof(o -> k) in ('string','number','boolean') or jsonb_typeof(n -> k) in ('string','number','boolean') then
          parts := parts || (nice || ' ' || coalesce(left(o ->> k, 40), '–') || ' → ' || coalesce(left(n ->> k, 40), '–'));
          continue;
        end if;
      end if;
      parts := parts || nice;
    end if;
  end loop;
  return array_to_string(parts, ', ');
end $$;

create or replace function public.coll_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare c text := coalesce(new.coll, old.coll); o jsonb; n jsonb; perm text; lbl text; nm text; ch text;
begin
  if coalesce(current_setting('dd.op', true), '') <> 'team' then return coalesce(new, old); end if;
  -- "insert ... on conflict do update" fires this for the insert too: let the update pass do the work
  if tg_op = 'INSERT' and exists (select 1 from public.coll x where x.coll = new.coll and x.id = new.id) then return new; end if;
  if tg_op <> 'INSERT' then o := old.data; end if;
  if tg_op <> 'DELETE' then n := new.data; end if;
  perm := case c when 'products' then 'products' when 'categories' then 'products' when 'sizes' then 'boxes' when 'addons' then 'boxes'
                 when 'sales' then 'sales' when 'coupons' then 'coupons' when 'broadcasts' then 'notify' else 'settings' end;
  if not public.has_perm(perm) then raise exception 'You don''t have access to change this. Ask the owner.' using errcode = '42501'; end if;
  if tg_op = 'DELETE' and c in ('products','categories','sizes','addons') and not public.sudo_ok() then
    raise exception 'Owner password needed to delete this.' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' and not public.sudo_ok() and (
       (c in ('sizes','addons') and (o -> 'price') is distinct from (n -> 'price')) or
       (c = 'products' and (o -> 'surcharge') is distinct from (n -> 'surcharge'))) then
    raise exception 'Owner password needed to change a price.' using errcode = 'P0001'; end if;
  lbl := case c when 'products' then 'flavor' when 'categories' then 'category' when 'sizes' then 'box size' when 'addons' then 'extra'
                when 'sales' then 'flash sale' when 'coupons' then 'coupon' when 'broadcasts' then 'notification' else c end;
  nm := case c when 'sizes' then 'Box of ' || (coalesce(n, o) ->> 'n') when 'coupons' then coalesce(n, o) ->> 'code'
               when 'broadcasts' then coalesce(n, o) ->> 'title' else coalesce(n, o) ->> 'name' end;
  if tg_op = 'INSERT' then perform public.log_act('Added ' || lbl, coalesce(nm, ''));
  elsif tg_op = 'DELETE' then perform public.log_act('Deleted ' || lbl, coalesce(nm, ''));
  else
    ch := public.chg_list(o, n, array['price','surcharge']);
    if ch <> '' then perform public.log_act('Edited ' || lbl, coalesce(nm, '') || ': ' || ch); end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists coll_guard_trg on public.coll;
create trigger coll_guard_trg before insert or update or delete on public.coll for each row execute function public.coll_guard();

create or replace function public.docs_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text := coalesce(new.key, old.key); perm text; o jsonb; n jsonb; ch text; lbl text;
begin
  if coalesce(current_setting('dd.op', true), '') <> 'team' then return coalesce(new, old); end if;
  if tg_op = 'INSERT' and exists (select 1 from public.docs x where x.key = new.key) then return new; end if;
  if tg_op <> 'INSERT' then o := old.data; end if;
  if tg_op <> 'DELETE' then n := new.data; end if;
  perm := case when k in ('settings','payMethods','thanks','proofpop') then 'settings' when k in ('page','marquee','announcer') then 'design'
               when k = 'badges' then 'badges' when k = 'label' then 'labels' when k = 'alerts' then null else 'settings' end;
  if perm is not null and not public.has_perm(perm) then raise exception 'You don''t have access to change this. Ask the owner.' using errcode = '42501'; end if;
  if k = 'settings' and tg_op = 'UPDATE' and not public.sudo_ok() and
     ((o -> 'deliveryFee') is distinct from (n -> 'deliveryFee') or (o -> 'customPer') is distinct from (n -> 'customPer')) then
    raise exception 'Owner password needed to change a price.' using errcode = 'P0001'; end if;
  if k = 'alerts' then return coalesce(new, old); end if;
  lbl := case k when 'settings' then 'shop settings' when 'payMethods' then 'payment methods' when 'thanks' then 'order placed page'
                when 'proofpop' then 'payment popup' when 'page' then 'landing page / top banner' when 'marquee' then 'marquee banner'
                when 'announcer' then 'announcer' when 'badges' then 'badges' when 'label' then 'shipping label' else k end;
  if k = 'settings' then ch := public.chg_list(o, n, array['deliveryFee','customPer','currency','payWindowH','cutoffHour','lowStockAt','menuSort']);
  else ch := ''; end if;
  if (o is distinct from n) then perform public.log_act('Edited ' || lbl, ch); end if;
  return coalesce(new, old);
end $$;
drop trigger if exists docs_guard_trg on public.docs;
create trigger docs_guard_trg before insert or update or delete on public.docs for each row execute function public.docs_guard();

-- ---------- team write functions (permissions are checked by the guards above) ---
create or replace function public.admin_put_doc(p_key text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  perform set_config('dd.op', 'team', true);
  if p_key !~ '^[a-zA-Z]{2,30}$' then perform public.bad('Bad key'); end if;
  insert into public.docs (key, data, updated_at) values (p_key, p_data, public.now_ms())
    on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at
    where public.docs.data is distinct from excluded.data;
end $$;

create or replace function public.admin_put_rows(p_coll text, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.assert_admin();
  perform set_config('dd.op', 'team', true);
  if p_coll not in ('sizes','categories','addons','sales','coupons','broadcasts') then perform public.bad('Bad collection'); end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    insert into public.coll (coll, id, pos, data, updated_at) values (p_coll, r ->> 'id', coalesce((r ->> 'pos')::int, 0), r -> 'data', public.now_ms())
      on conflict (coll, id) do update set pos = excluded.pos, data = excluded.data, updated_at = excluded.updated_at;
  end loop;
end $$;

create or replace function public.admin_del_rows(p_coll text, p_ids jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  perform set_config('dd.op', 'team', true);
  delete from public.coll where coll = p_coll and id in (select value from jsonb_array_elements_text(p_ids));
end $$;

create or replace function public.admin_put_products(p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb; cur jsonb; t bigint := public.now_ms(); revs jsonb; rv jsonb;
begin
  perform public.assert_admin();
  perform set_config('dd.op', 'team', true);
  for r in select value from jsonb_array_elements(p_rows) loop
    select data into cur from public.coll where coll = 'products' and id = r ->> 'id' for update;
    if cur is null then
      insert into public.coll (coll, id, pos, data, updated_at) values ('products', r ->> 'id', coalesce((r ->> 'pos')::int, 0), coalesce(r -> 'create', r -> 'set'), t);
    else
      if coalesce((r ->> 'replace')::boolean, false) then
        cur := coalesce(r -> 'set', '{}'::jsonb) || jsonb_build_object('stock', coalesce(cur -> 'stock', '0'::jsonb), 'reviews', coalesce(cur -> 'reviews', '[]'::jsonb));
      else
        cur := cur || coalesce(r -> 'set', '{}'::jsonb);   -- only the fields this person changed, so two people editing don't undo each other
        if jsonb_typeof(r -> 'unset') = 'array' then cur := cur - array(select jsonb_array_elements_text(r -> 'unset')); end if;
      end if;
      if r ? 'stockAdd' then cur := jsonb_set(cur, '{stock}', to_jsonb(greatest(0, coalesce((cur ->> 'stock')::int, 0) + (r ->> 'stockAdd')::int))); end if;
      revs := coalesce(cur -> 'reviews', '[]'::jsonb);
      if r ? 'revDel' then
        revs := coalesce((select jsonb_agg(x) from jsonb_array_elements(revs) x where not (x ->> 'id' in (select value from jsonb_array_elements_text(r -> 'revDel')))), '[]'::jsonb);
      end if;
      if r ? 'revAdd' then
        for rv in select value from jsonb_array_elements(r -> 'revAdd') loop revs := revs || jsonb_build_array(rv); end loop;
      end if;
      cur := jsonb_set(cur, '{reviews}', revs);
      update public.coll set data = cur, pos = coalesce((r ->> 'pos')::int, pos), updated_at = t where coll = 'products' and id = r ->> 'id';
    end if;
  end loop;
end $$;

-- orders: keep the tested core, put a permission check + log in front of it
do $$
begin
  if to_regprocedure('public.admin_patch_order_core(text,jsonb)') is null then
    alter function public.admin_patch_order(text, jsonb) rename to admin_patch_order_core;
  end if;
end $$;
revoke all on function public.admin_patch_order_core(text, jsonb) from public, anon, authenticated;

create or replace function public.admin_patch_order(p_id text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; d jsonb; only_cp boolean; parts text[] := '{}'; sl text[][] := array[
  ['awaiting','Awaiting payment'],['review','Check payment'],['new','Payment confirmed'],['baking','Baking'],['ready','Ready / out for delivery'],['completed','Completed'],['cancelled','Cancelled']];
  nm_old text; nm_new text; i int;
begin
  perform public.assert_admin();
  only_cp := not exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('complaint','msgsAdd'));
  if not (public.has_perm('orders') or (only_cp and public.has_perm('complaints'))) then
    raise exception 'You don''t have access to change orders. Ask the owner.' using errcode = '42501'; end if;
  perform set_config('dd.op', 'order', true);
  select * into o from public.orders where id = p_id;
  d := public.admin_patch_order_core(p_id, p_patch);
  if (o.data ->> 'status') is distinct from (d ->> 'status') then
    for i in 1 .. array_length(sl, 1) loop
      if sl[i][1] = o.data ->> 'status' then nm_old := sl[i][2]; end if;
      if sl[i][1] = d ->> 'status' then nm_new := sl[i][2]; end if;
    end loop;
    parts := parts || ('status ' || coalesce(nm_old, o.data ->> 'status') || ' → ' || coalesce(nm_new, d ->> 'status'));
  end if;
  if (o.data -> 'items') is distinct from (d -> 'items') then parts := parts || 'cookies changed'::text; end if;
  if (o.data ->> 'courier') is distinct from (d ->> 'courier') or (o.data ->> 'awb') is distinct from (d ->> 'awb') then
    parts := parts || ('courier ' || coalesce(d ->> 'courier', '') || ' ' || coalesce(d ->> 'awb', '')); end if;
  if (o.data #>> '{complaint,status}') is distinct from (d #>> '{complaint,status}') then parts := parts || ('complaint ' || coalesce(d #>> '{complaint,status}', '')); end if;
  if (o.data #>> '{complaint,reply}') is distinct from (d #>> '{complaint,reply}') then parts := parts || 'complaint reply'::text; end if;
  if (o.data -> 'rejected') is distinct from (d -> 'rejected') and d ? 'rejected' then parts := parts || 'payment proof rejected'::text; end if;
  if array_length(parts, 1) > 0 then perform public.log_act('Order ' || coalesce(d ->> 'code', p_id), array_to_string(parts, ', ')); end if;
  return d;
end $$;

create or replace function public.admin_order_files(p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if not (public.has_perm('orders') or public.has_perm('complaints')) then
    raise exception 'You don''t have access to orders. Ask the owner.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'proof', (select data from public.order_files where order_id = p_id and kind = 'proof' and idx = 0),
    'photos', coalesce((select jsonb_agg(data order by idx) from public.order_files where order_id = p_id and kind = 'complaint'), '[]'::jsonb));
end $$;

create or replace function public.admin_delete_order(p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; k text; n int; t bigint := public.now_ms();
begin
  perform public.assert_owner();
  select * into o from public.orders where id = p_id for update;
  if not found then return; end if;
  if coalesce((o.data ->> 'holds')::boolean, false) then
    for k, n in select key, value::int from jsonb_each_text(o.data -> 'items') loop
      update public.coll set data = jsonb_set(data, '{stock}', to_jsonb(coalesce((data ->> 'stock')::int, 0) + n)), updated_at = t
      where coll = 'products' and id = k and coalesce((data ->> 'track')::boolean, false);
    end loop;
  end if;
  delete from public.orders where id = p_id;
  perform public.log_act('Deleted order', coalesce(o.data ->> 'code', p_id));
end $$;

-- customers: staff need the "customers" permission
create or replace function public.admin_customers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if not public.has_perm('customers') then raise exception 'You don''t have access to customers. Ask the owner.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by (x ->> 'createdAt')::bigint desc) from (
    select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'note', c.note, 'source', c.source, 'createdAt', c.created_at,
             'orders', coalesce(s.n, 0), 'spent', coalesce(s.spent, 0), 'lastOrder', s.last) as x
      from public.customers c
      left join (select phone_norm, count(*) as n,
                        coalesce(sum((data ->> 'total')::numeric) filter (where status in ('new','baking','ready','completed')), 0) as spent,
                        max(created_at) as last
                   from public.orders group by phone_norm) s on s.phone_norm = c.phone_norm) q), '[]'::jsonb);
end $$;

create or replace function public.admin_customer_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text := nullif(btrim(coalesce(p ->> 'id', '')), ''); v_name text := btrim(coalesce(p ->> 'name', '')); v_phone text := btrim(coalesce(p ->> 'phone', ''));
        v_email text := btrim(coalesce(p ->> 'email', '')); v_note text := btrim(coalesce(p ->> 'note', '')); pn text; dup public.customers; t bigint := public.now_ms();
begin
  perform public.assert_admin();
  if not public.has_perm('customers') then raise exception 'You don''t have access to customers. Ask the owner.' using errcode = '42501'; end if;
  pn := public.norm_phone(v_phone);
  if length(v_name) < 2 or length(v_name) > 80 then perform public.bad('Please enter the customer''s full name.'); end if;
  if v_phone !~ '^[0-9+()\s.-]{6,24}$' or length(pn) < 7 or length(pn) > 14 then perform public.bad('Please enter a valid WhatsApp number.'); end if;
  if v_email <> '' and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 120) then perform public.bad('That email address doesn''t look right.'); end if;
  select * into dup from public.customers where phone_norm = pn and id is distinct from v_id;
  if found then perform public.bad('This WhatsApp number is already saved for ' || dup.name || '.'); end if;
  if v_id is null then
    insert into public.customers (phone_norm, name, phone, email, note, source, created_at, updated_at)
    values (pn, v_name, v_phone, left(v_email, 120), left(v_note, 500), 'manual', t, t);
    perform public.log_act('Added customer', v_name || ' ' || v_phone);
  else
    update public.customers set phone_norm = pn, name = v_name, phone = v_phone, email = left(v_email, 120), note = left(v_note, 500), updated_at = t where id = v_id;
    if not found then perform public.bad('Customer not found.'); end if;
    perform public.log_act('Edited customer', v_name || ' ' || v_phone);
  end if;
  return public.admin_customers();
end $$;

create or replace function public.admin_customer_delete(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.customers;
begin
  perform public.assert_owner();
  delete from public.customers where id = p_id returning * into c;
  if c.id is not null then perform public.log_act('Deleted customer', c.name || ' ' || c.phone); end if;
  return public.admin_customers();
end $$;

-- who am I (also logs the sign-in)
drop function if exists public.admin_me();
create or replace function public.admin_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.admins := public.team_me();
begin
  if me.email is null then return jsonb_build_object('admin', false, 'email', auth.jwt() ->> 'email'); end if;
  perform public.log_act('Opened the team site', '');
  return jsonb_build_object('admin', true, 'role', me.role, 'email', me.email, 'username', me.username, 'name', me.name,
                            'title', me.title, 'perms', case when me.role = 'owner' then to_jsonb(public.perm_list()) else me.perms end);
end $$;

-- ---------- team management (owner only) ---------------------------------------
create or replace function public.team_domain() returns text language sql immutable as $$ select 'team.bakebyculture.local' $$;

drop function if exists public.admin_team_list();
create or replace function public.admin_team_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; has_auth boolean := to_regclass('auth.users') is not null;
begin
  perform public.assert_owner();
  if has_auth then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('email', a.email, 'role', a.role, 'name', a.name, 'username', a.username, 'title', a.title,
                 'perms', a.perms, 'managed', a.managed,
                 'login', exists (select 1 from auth.users u where lower(u.email) = lower(a.email))) order by (a.role = 'owner') desc, coalesce(a.username, a.email)), '[]'::jsonb)
               from public.admins a$q$ into r;
  else
    select coalesce(jsonb_agg(jsonb_build_object('email', a.email, 'role', a.role, 'name', a.name, 'username', a.username, 'title', a.title,
             'perms', a.perms, 'managed', a.managed, 'login', true) order by (a.role = 'owner') desc, coalesce(a.username, a.email)), '[]'::jsonb)
      into r from public.admins a;
  end if;
  return r;
end $$;

create or replace function public.clean_perms(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce((select jsonb_agg(distinct x) from jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x
                   where x = any (public.perm_list())), '[]'::jsonb)
$$;

-- add a staff member with a username + password: {username, name, password, title, role, perms}
create or replace function public.admin_team_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare un text := lower(btrim(coalesce(p ->> 'username', ''))); pw text := coalesce(p ->> 'password', '');
        rl text := coalesce(p ->> 'role', 'staff'); em text; uid uuid := gen_random_uuid(); col text;
begin
  perform public.assert_owner();
  if un !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then perform public.bad('Username: 3 to 30 letters or numbers (dots, dashes and _ are fine), no spaces.'); end if;
  if length(pw) < 8 then perform public.bad('Password: at least 8 characters.'); end if;
  if rl not in ('owner','staff') then perform public.bad('Role must be owner or staff.'); end if;
  if to_regclass('auth.users') is null then perform public.bad('Supabase Auth is not available.'); end if;
  em := un || '@' || public.team_domain();
  if exists (select 1 from public.admins where lower(username) = un or lower(email) = em) then perform public.bad('That username is taken.'); end if;
  execute 'select exists (select 1 from auth.users where lower(email) = $1)' into strict col using em;
  if col::boolean then perform public.bad('That username is taken.'); end if;
  execute $q$insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
             values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, extensions.crypt($3, extensions.gen_salt('bf')), now(),
                     '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('username', $4), now(), now())$q$
    using uid, em, pw, un;
  -- Supabase Auth expects these to be empty text, not null
  for col in select column_name from information_schema.columns where table_schema = 'auth' and table_name = 'users' and data_type in ('text','character varying')
             and column_name in ('confirmation_token','recovery_token','email_change_token_new','email_change','email_change_token_current','phone_change','phone_change_token','reauthentication_token') loop
    execute format('update auth.users set %I = coalesce(%I, '''') where id = $1', col, col) using uid;
  end loop;
  if to_regclass('auth.identities') is not null then
    execute $q$insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
               values (gen_random_uuid(), $1, $1::text, jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true), 'email', now(), now(), now())$q$
      using uid, em;
  end if;
  insert into public.admins (email, role, name, username, title, perms, managed)
  values (em, rl, left(btrim(coalesce(p ->> 'name', '')), 80), un, left(btrim(coalesce(p ->> 'title', '')), 40), public.clean_perms(p -> 'perms'), true);
  perform public.log_act('Added team member', un || ' (' || case when rl = 'owner' then 'Owner' else coalesce(nullif(btrim(p ->> 'title'), ''), 'Staff') end || ')');
  return public.admin_team_list();
end $$;

-- edit a member: {email, name, title, role, perms}. Also adds an existing Supabase login by email.
drop function if exists public.admin_team_set(text, text, text);
create or replace function public.admin_team_set(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare em text := lower(btrim(coalesce(p ->> 'email', ''))); me text := lower(coalesce(auth.jwt() ->> 'email', '')); rl text := coalesce(p ->> 'role', 'staff');
begin
  perform public.assert_owner();
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(em) > 120 then perform public.bad('Enter a valid email address.'); end if;
  if rl not in ('owner','staff') then perform public.bad('Role must be owner or staff.'); end if;
  if em = me and rl <> 'owner' then perform public.bad('You can''t make yourself staff.'); end if;
  insert into public.admins (email, role, name, title, perms) values (em, rl, left(btrim(coalesce(p ->> 'name', '')), 80), left(btrim(coalesce(p ->> 'title', '')), 40), public.clean_perms(p -> 'perms'))
    on conflict (email) do update set role = excluded.role, name = excluded.name, title = excluded.title, perms = excluded.perms;
  perform public.log_act('Changed team member', coalesce((select coalesce(username, email) from public.admins where email = em), em) || ': ' ||
                         case when rl = 'owner' then 'Owner' else coalesce(nullif(btrim(p ->> 'title'), ''), 'Staff') || ' · ' ||
                           coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(public.clean_perms(p -> 'perms')) x), 'no access') end);
  return public.admin_team_list();
end $$;

create or replace function public.admin_team_password(p_email text, p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare em text := lower(btrim(coalesce(p_email, ''))); n int;
begin
  perform public.assert_owner();
  if length(coalesce(p_password, '')) < 8 then perform public.bad('Password: at least 8 characters.'); end if;
  if not exists (select 1 from public.admins where lower(email) = em) then perform public.bad('Not a team member.'); end if;
  execute 'update auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt(''bf'')), updated_at = now() where lower(email) = $2' using p_password, em;
  get diagnostics n = row_count;
  if n = 0 then perform public.bad('This person has no login yet.'); end if;
  perform public.log_act('Changed a password', coalesce((select coalesce(username, email) from public.admins where lower(email) = em), em));
  return public.admin_team_list();
end $$;

create or replace function public.admin_team_remove(p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare em text := lower(btrim(coalesce(p_email, ''))); a public.admins;
begin
  perform public.assert_owner();
  if em = lower(coalesce(auth.jwt() ->> 'email', '')) then perform public.bad('You can''t remove yourself.'); end if;
  delete from public.admins where lower(email) = em returning * into a;
  if not exists (select 1 from public.admins where role = 'owner') then perform public.bad('There must be at least one owner.'); end if;
  if a.managed and to_regclass('auth.users') is not null then execute 'delete from auth.users where lower(email) = $1' using em; end if;
  if a.email is not null then perform public.log_act('Removed team member', coalesce(a.username, a.email)); end if;
  return public.admin_team_list();
end $$;

-- ---------- activity log (owner only) ------------------------------------------
create or replace function public.admin_log_list(p_before bigint default null, p_q text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare q text := '%' || lower(btrim(coalesce(p_q, ''))) || '%';
begin
  perform public.assert_owner();
  delete from public.activity_log where at < public.now_ms() - 92 * 86400000::bigint;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'at', at, 'actor', actor, 'email', email, 'role', role, 'action', action, 'detail', detail, 'note', note) order by at desc, id desc)
     from (select * from public.activity_log
            where (p_before is null or at < p_before)
              and (q = '%%' or lower(actor || ' ' || role || ' ' || action || ' ' || detail || ' ' || note) like q)
            order by at desc, id desc limit 200) x), '[]'::jsonb);
end $$;

create or replace function public.admin_log_note(p_id bigint, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_owner();
  update public.activity_log set note = left(btrim(coalesce(p_note, '')), 300) where id = p_id;
end $$;

create or replace function public.admin_log_delete(p_ids jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_owner();
  delete from public.activity_log where id in (select (value)::bigint from jsonb_array_elements_text(p_ids));
end $$;

-- delete everything: needs this owner's own password
create or replace function public.admin_log_clear(p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare em text := lower(coalesce(auth.jwt() ->> 'email', '')); n int;
begin
  perform public.assert_owner();
  if not public.throttle_ok('logclr:' || em, 6, 600000) then return jsonb_build_object('ok', false, 'err', 'Too many tries. Please wait 10 minutes.'); end if;
  if not public.owner_pw_ok(p_password, em) then return jsonb_build_object('ok', false, 'err', 'That password isn''t right.'); end if;
  delete from public.activity_log; get diagnostics n = row_count;
  perform public.log_act('Deleted the whole activity log', n || ' entries');
  return jsonb_build_object('ok', true, 'deleted', n);
end $$;

-- ---------- pictures: anyone allowed to edit flavors, design or settings ----------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    drop policy if exists "shop-media owner insert" on storage.objects;
    drop policy if exists "shop-media owner update" on storage.objects;
    drop policy if exists "shop-media owner delete" on storage.objects;
    drop policy if exists "shop-media owner select" on storage.objects;
    create policy "shop-media owner insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'shop-media' and public.can_upload());
    create policy "shop-media owner update" on storage.objects for update to authenticated
      using (bucket_id = 'shop-media' and public.can_upload()) with check (bucket_id = 'shop-media' and public.can_upload());
    create policy "shop-media owner delete" on storage.objects for delete to authenticated
      using (bucket_id = 'shop-media' and public.is_owner());
    create policy "shop-media owner select" on storage.objects for select to authenticated
      using (bucket_id = 'shop-media' and public.can_upload());
  end if;
end $$;

-- ---------- who may call what ------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'perm_list','team_me','has_perm','can_upload','log_act','owner_pw_ok','sudo_ok','chg_list','coll_guard','docs_guard','team_domain','clean_perms',
             'admin_sudo','admin_put_doc','admin_put_rows','admin_del_rows','admin_put_products','admin_patch_order','admin_patch_order_core','admin_order_files',
             'admin_delete_order','admin_customers','admin_customer_save','admin_customer_delete','admin_me','admin_team_list','admin_team_create','admin_team_set',
             'admin_team_password','admin_team_remove','admin_log_list','admin_log_note','admin_log_delete','admin_log_clear')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on function public.can_upload(), public.is_owner() to authenticated;   -- used by the picture-storage rules (true/false only)
grant execute on function
  public.admin_sudo(text), public.admin_put_doc(text,jsonb), public.admin_put_rows(text,jsonb), public.admin_del_rows(text,jsonb),
  public.admin_put_products(jsonb), public.admin_patch_order(text,jsonb), public.admin_order_files(text), public.admin_delete_order(text),
  public.admin_customers(), public.admin_customer_save(jsonb), public.admin_customer_delete(text), public.admin_me(),
  public.admin_team_list(), public.admin_team_create(jsonb), public.admin_team_set(jsonb), public.admin_team_password(text,text), public.admin_team_remove(text),
  public.admin_log_list(bigint,text), public.admin_log_note(bigint,text), public.admin_log_delete(jsonb), public.admin_log_clear(text)
  to authenticated;
