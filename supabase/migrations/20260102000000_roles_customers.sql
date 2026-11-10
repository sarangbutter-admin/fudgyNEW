-- BakeByCulture migration 2: staff roles, team management, customer list.
-- Safe to run more than once. Run it AFTER 20260101000000_bakebyculture_schema.sql.

-- ---------- roles ------------------------------------------------------
alter table public.admins add column if not exists role text not null default 'owner';
alter table public.admins add column if not exists name text not null default '';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'admins_role_chk') then
    alter table public.admins add constraint admins_role_chk check (role in ('owner','staff'));
  end if;
end $$;
update public.admins set email = lower(btrim(email)) where email <> lower(btrim(email));

create or replace function public.admin_role() returns text
language sql stable security definer set search_path = public as $$
  select case when coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
              then (select a.role from public.admins a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1)
         end
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.admin_role() = 'owner', false) $$;

create or replace function public.assert_owner() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Please sign in to the team area.' using errcode = '42501'; end if;
  if not public.is_owner() then raise exception 'Only the owner can do this.' using errcode = '42501'; end if;
end $$;

create or replace function public.admin_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('admin', public.is_admin(), 'role', coalesce(public.admin_role(), ''), 'email', auth.jwt() ->> 'email')
$$;

-- ---------- owner-only versions of the content functions -----------------

create or replace function public.admin_put_rows(p_coll text, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.assert_owner();
  if p_coll not in ('sizes','categories','addons','sales','coupons','broadcasts') then perform public.bad('Bad collection'); end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    insert into public.coll (coll, id, pos, data, updated_at) values (p_coll, r ->> 'id', coalesce((r ->> 'pos')::int, 0), r -> 'data', public.now_ms())
      on conflict (coll, id) do update set pos = excluded.pos, data = excluded.data, updated_at = excluded.updated_at;
  end loop;
end $$;

create or replace function public.admin_del_rows(p_coll text, p_ids jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_owner();
  delete from public.coll where coll = p_coll and id in (select value from jsonb_array_elements_text(p_ids));
end $$;

create or replace function public.admin_put_products(p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb; cur jsonb; t bigint := public.now_ms(); revs jsonb; rv jsonb;
begin
  perform public.assert_owner();
  for r in select value from jsonb_array_elements(p_rows) loop
    select data into cur from public.coll where coll = 'products' and id = r ->> 'id' for update;
    if cur is null then
      insert into public.coll (coll, id, pos, data, updated_at) values ('products', r ->> 'id', coalesce((r ->> 'pos')::int, 0), coalesce(r -> 'create', r -> 'set'), t);
    else
      if coalesce((r ->> 'replace')::boolean, false) then
        cur := coalesce(r -> 'set', '{}'::jsonb) || jsonb_build_object('stock', coalesce(cur -> 'stock', '0'::jsonb), 'reviews', coalesce(cur -> 'reviews', '[]'::jsonb));
      else
        cur := cur || coalesce(r -> 'set', '{}'::jsonb);
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
end $$;

create or replace function public.admin_put_doc(p_key text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if not public.is_owner() and p_key not in ('label','alerts') then perform public.bad('Only the owner can change this.'); end if;
  if p_key !~ '^[a-zA-Z]{2,30}$' then perform public.bad('Bad key'); end if;
  insert into public.docs (key, data, updated_at) values (p_key, p_data, public.now_ms())
    on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
end $$;


-- pictures: owner only
do $$
begin
  if to_regclass('storage.buckets') is not null then
    drop policy if exists "shop-media owner insert" on storage.objects;
    drop policy if exists "shop-media owner update" on storage.objects;
    drop policy if exists "shop-media owner delete" on storage.objects;
    drop policy if exists "shop-media owner select" on storage.objects;
    create policy "shop-media owner select" on storage.objects for select to authenticated
      using (bucket_id = 'shop-media' and public.is_owner());
    create policy "shop-media owner insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'shop-media' and public.is_owner());
    create policy "shop-media owner update" on storage.objects for update to authenticated
      using (bucket_id = 'shop-media' and public.is_owner()) with check (bucket_id = 'shop-media' and public.is_owner());
    create policy "shop-media owner delete" on storage.objects for delete to authenticated
      using (bucket_id = 'shop-media' and public.is_owner());
  end if;
end $$;

-- ---------- team (owner only) ------------------------------------------
create or replace function public.admin_team_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; has_auth boolean := to_regclass('auth.users') is not null;
begin
  perform public.assert_owner();
  if has_auth then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('email', a.email, 'role', a.role, 'name', a.name,
                 'login', exists (select 1 from auth.users u where lower(u.email) = lower(a.email))) order by (a.role = 'owner') desc, a.email), '[]'::jsonb)
               from public.admins a$q$ into r;
  else
    select coalesce(jsonb_agg(jsonb_build_object('email', a.email, 'role', a.role, 'name', a.name, 'login', true) order by (a.role = 'owner') desc, a.email), '[]'::jsonb)
      into r from public.admins a;
  end if;
  return r;
end $$;

create or replace function public.admin_team_set(p_email text, p_role text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare em text := lower(btrim(coalesce(p_email, ''))); me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  perform public.assert_owner();
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(em) > 120 then perform public.bad('Enter a valid email address.'); end if;
  if p_role not in ('owner','staff') then perform public.bad('Role must be owner or staff.'); end if;
  if em = me and p_role <> 'owner' then perform public.bad('You can''t make yourself staff.'); end if;
  insert into public.admins (email, role, name) values (em, p_role, left(btrim(coalesce(p_name, '')), 80))
    on conflict (email) do update set role = excluded.role, name = excluded.name;
  return public.admin_team_list();
end $$;

create or replace function public.admin_team_remove(p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare em text := lower(btrim(coalesce(p_email, '')));
begin
  perform public.assert_owner();
  if em = lower(coalesce(auth.jwt() ->> 'email', '')) then perform public.bad('You can''t remove yourself.'); end if;
  delete from public.admins where lower(email) = em;
  if not exists (select 1 from public.admins where role = 'owner') then perform public.bad('There must be at least one owner.'); end if;
  return public.admin_team_list();
end $$;

-- ---------- customers ----------------------------------------------------
create table if not exists public.customers (
  id         text primary key default replace(gen_random_uuid()::text, '-', ''),
  phone_norm text not null unique,
  name       text not null,
  phone      text not null,
  email      text not null default '',
  note       text not null default '',
  source     text not null default 'order',      -- 'order' (came from an order) or 'manual' (added by the team)
  created_at bigint not null default 0,
  updated_at bigint not null default 0
);
alter table public.customers enable row level security;
revoke all on public.customers from public, anon, authenticated;

-- every order's name + WhatsApp number is saved once (one row per number)
create or replace function public.customers_from_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare c jsonb := new.data -> 'customer'; pn text := public.norm_phone(new.data #>> '{customer,phone}'); t bigint := public.now_ms();
begin
  if pn = '' or btrim(coalesce(c ->> 'name', '')) = '' then return new; end if;
  if tg_op = 'UPDATE' and (old.data -> 'customer') is not distinct from c then return new; end if;
  insert into public.customers (phone_norm, name, phone, email, source, created_at, updated_at)
  values (pn, left(btrim(c ->> 'name'), 80), left(btrim(c ->> 'phone'), 24), left(btrim(coalesce(c ->> 'email', '')), 120), 'order', t, t)
  on conflict (phone_norm) do update
    set email = case when public.customers.email = '' then excluded.email else public.customers.email end,
        updated_at = excluded.updated_at;
  return new;
end $$;
drop trigger if exists orders_customers_trg on public.orders;
create trigger orders_customers_trg after insert or update of data on public.orders
  for each row execute function public.customers_from_order();

-- add the customers who already ordered before this migration
insert into public.customers (phone_norm, name, phone, email, source, created_at, updated_at)
select distinct on (o.phone_norm) o.phone_norm, left(btrim(o.data #>> '{customer,name}'), 80), left(btrim(o.data #>> '{customer,phone}'), 24),
       left(btrim(coalesce(o.data #>> '{customer,email}', '')), 120), 'order', o.created_at, o.created_at
  from public.orders o
 where o.phone_norm <> '' and btrim(coalesce(o.data #>> '{customer,name}', '')) <> ''
 order by o.phone_norm, o.created_at
on conflict (phone_norm) do nothing;

create or replace function public.admin_customers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return coalesce((select jsonb_agg(x order by (x ->> 'createdAt')::bigint desc) from (
    select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'note', c.note, 'source', c.source, 'createdAt', c.created_at,
             'orders', coalesce(s.n, 0), 'spent', coalesce(s.spent, 0), 'lastOrder', s.last) as x
      from public.customers c
      left join (select phone_norm, count(*) as n,
                        coalesce(sum((data ->> 'total')::numeric) filter (where status in ('new','baking','ready','completed')), 0) as spent,
                        max(created_at) as last
                   from public.orders group by phone_norm) s on s.phone_norm = c.phone_norm) q), '[]'::jsonb);
end $$;

-- add or edit a customer: {id?, name, phone, email?, note?}
create or replace function public.admin_customer_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text := nullif(btrim(coalesce(p ->> 'id', '')), ''); v_name text := btrim(coalesce(p ->> 'name', '')); v_phone text := btrim(coalesce(p ->> 'phone', ''));
        v_email text := btrim(coalesce(p ->> 'email', '')); v_note text := btrim(coalesce(p ->> 'note', '')); pn text; dup public.customers; t bigint := public.now_ms();
begin
  perform public.assert_admin();
  pn := public.norm_phone(v_phone);
  if length(v_name) < 2 or length(v_name) > 80 then perform public.bad('Please enter the customer''s full name.'); end if;
  if v_phone !~ '^[0-9+()\s.-]{6,24}$' or length(pn) < 7 or length(pn) > 14 then perform public.bad('Please enter a valid WhatsApp number.'); end if;
  if v_email <> '' and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 120) then perform public.bad('That email address doesn''t look right.'); end if;
  select * into dup from public.customers where phone_norm = pn and id is distinct from v_id;
  if found then perform public.bad('This WhatsApp number is already saved for ' || dup.name || '.'); end if;
  if v_id is null then
    insert into public.customers (phone_norm, name, phone, email, note, source, created_at, updated_at)
    values (pn, v_name, v_phone, left(v_email, 120), left(v_note, 500), 'manual', t, t);
  else
    update public.customers set phone_norm = pn, name = v_name, phone = v_phone, email = left(v_email, 120), note = left(v_note, 500), updated_at = t where id = v_id;
    if not found then perform public.bad('Customer not found.'); end if;
  end if;
  return public.admin_customers();
end $$;

create or replace function public.admin_customer_delete(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_owner();
  delete from public.customers where id = p_id;
  return public.admin_customers();
end $$;

-- ---------- who may call what --------------------------------------------
revoke all on function
  public.admin_role(), public.is_owner(), public.assert_owner(), public.customers_from_order(),
  public.admin_team_list(), public.admin_team_set(text,text,text), public.admin_team_remove(text),
  public.admin_customers(), public.admin_customer_save(jsonb), public.admin_customer_delete(text),
  public.admin_me(), public.admin_put_doc(text,jsonb), public.admin_put_rows(text,jsonb), public.admin_del_rows(text,jsonb),
  public.admin_put_products(jsonb), public.admin_delete_order(text)
  from public, anon, authenticated;
grant execute on function public.is_owner() to authenticated;      -- used by the storage policies (true/false only)
grant execute on function
  public.admin_me(), public.admin_put_doc(text,jsonb), public.admin_put_rows(text,jsonb), public.admin_del_rows(text,jsonb),
  public.admin_put_products(jsonb), public.admin_delete_order(text),
  public.admin_team_list(), public.admin_team_set(text,text,text), public.admin_team_remove(text),
  public.admin_customers(), public.admin_customer_save(jsonb), public.admin_customer_delete(text)
  to authenticated;
