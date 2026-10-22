-- Delidome migration 39: pre-launch page.
--  * docs 'prelaunch' (public): the owner's page settings; shop_public also returns it
--  * prelaunch_regs: who registered for a free Gift Set (one per WhatsApp number, first X only), each with a personal gift code
--  * while pre-launch is on (and the opening time has not passed with auto-open), the shop takes no orders (except from the team)
-- Safe to run more than once. Run after migration 38.

create table if not exists public.prelaunch_regs (
  id bigserial primary key, rank int not null, phone_norm text not null unique, phone text not null default '', name text not null default '',
  email text not null default '', code text not null unique, at bigint not null, exp bigint, used_order text, used_at bigint);
alter table public.prelaunch_regs enable row level security;
revoke all on public.prelaunch_regs from anon, authenticated;

create or replace function public.pre_cfg() returns jsonb
language sql stable security definer set search_path = public as $$ select coalesce((select data from public.docs where key = 'prelaunch'), '{}'::jsonb) $$;

-- true while the page replaces the shop
create or replace function public.pre_live() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((c ->> 'on')::boolean, false)
     and not (coalesce((c ->> 'autoOpen')::boolean, true) and coalesce((c ->> 'openAt')::bigint, 0) > 0 and public.now_ms() >= (c ->> 'openAt')::bigint)
    from (select public.pre_cfg() c) z $$;

create or replace function public.pre_max() returns int
language sql stable security definer set search_path = public as $$ select greatest(0, least(100000, coalesce((public.pre_cfg() ->> 'max')::int, 100))) $$;

create or replace function public.prelaunch_public() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('live', public.pre_live(), 'count', (select count(*) from public.prelaunch_regs), 'max', public.pre_max(), 'now', public.now_ms(),
    'full', (select count(*) from public.prelaunch_regs) >= public.pre_max()) $$;

create or replace function public.prelaunch_register(p_name text, p_phone text, p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb := public.pre_cfg(); nm text := left(btrim(coalesce(p_name, '')), 80); ph text := left(btrim(coalesce(p_phone, '')), 24);
  pn text := public.norm_phone(coalesce(p_phone, '')); em text := left(lower(btrim(coalesce(p_email, ''))), 120); r public.prelaunch_regs; n int; mx int := public.pre_max();
  pre text := upper(regexp_replace(coalesce(c ->> 'codePrefix', 'GIFT-'), '[^A-Za-z0-9-]', '', 'g')); cd text; ab text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; t bigint := public.now_ms(); ex bigint; i int;
begin
  if not public.pre_live() then perform public.bad('Registration is closed.'); end if;
  if length(nm) < 2 then perform public.bad('Please enter your name.'); end if;
  if ph !~ '^[0-9+()\s.-]{6,24}$' or length(pn) < 7 or length(pn) > 14 then perform public.bad('Please enter a valid WhatsApp number.'); end if;
  if em <> '' and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform public.bad('Please enter a valid email address.'); end if;
  if not public.throttle_ok('prereg:' || pn, 6, 600000) or not public.throttle_ok('prereg-all', 120, 60000) then perform public.bad('Too many tries. Please wait a minute.'); end if;
  perform pg_advisory_xact_lock(hashtext('delidome-prelaunch'));
  select * into r from public.prelaunch_regs where phone_norm = pn;
  if r.id is not null then
    return jsonb_build_object('ok', true, 'again', true, 'code', r.code, 'rank', r.rank, 'name', r.name, 'exp', r.exp, 'max', mx);
  end if;
  select count(*) into n from public.prelaunch_regs;
  if n >= mx then return jsonb_build_object('ok', false, 'full', true, 'max', mx); end if;
  if pre = '' then pre := 'GIFT-'; end if;
  loop
    cd := left(pre, 12);
    for i in 1..4 loop cd := cd || substr(ab, 1 + floor(random() * length(ab))::int, 1); end loop;
    exit when not exists (select 1 from public.prelaunch_regs where code = cd) and not exists (select 1 from public.coll where coll = 'coupons' and upper(data ->> 'code') = cd);
  end loop;
  if c ->> 'expMode' = 'date' and coalesce((c ->> 'expAt')::bigint, 0) > 0 then ex := (c ->> 'expAt')::bigint;
  elsif coalesce((c ->> 'openAt')::bigint, 0) > 0 then ex := (c ->> 'openAt')::bigint + greatest(1, least(365, coalesce((c ->> 'expDays')::int, 7))) * 86400000::bigint;
  end if;
  insert into public.prelaunch_regs (rank, phone_norm, phone, name, email, code, at, exp) values (n + 1, pn, ph, nm, em, cd, t, ex) returning * into r;
  return jsonb_build_object('ok', true, 'code', r.code, 'rank', r.rank, 'name', r.name, 'exp', r.exp, 'max', mx);
end $$;

create or replace function public.admin_prelaunch_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_owner();
  return jsonb_build_object('count', (select count(*) from public.prelaunch_regs), 'max', public.pre_max(), 'list', coalesce((select jsonb_agg(jsonb_build_object(
    'rank', r.rank, 'name', r.name, 'phone', r.phone, 'email', r.email, 'code', r.code, 'at', r.at, 'exp', r.exp, 'order', r.used_order, 'usedAt', r.used_at,
    'status', case when r.used_order is not null then 'claimed' when r.exp is not null and r.exp < public.now_ms() then 'expired' else 'open' end) order by r.rank desc)
    from public.prelaunch_regs r), '[]'::jsonb));
end $$;

-- no orders while the pre-launch page is up (the team can still place test orders)
create or replace function public.orders_pre_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.pre_live() and not public.is_admin() then perform public.bad('We open soon! The shop is not taking orders yet.'); end if;
  return new;
end $$;
create or replace trigger orders_ab_pre_check before insert on public.orders for each row execute function public.orders_pre_check();

create or replace function public.shop_public()
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare res jsonb;
begin
  perform public.sweep_orders();
  select jsonb_build_object(
    'now', public.now_ms(),
    'docs', coalesce((select jsonb_object_agg(key, data) from public.docs
                      where key in ('settings','page','marquee','announcer','thanks','proofpop','payMethods','badges','prelaunch')), '{}'::jsonb),
    'sizes', public.coll_arr('sizes'),
    'categories', public.coll_arr('categories'),
    'addons', public.coll_arr('addons'),
    'sales', public.coll_arr('sales'),
    'broadcasts', public.coll_arr('broadcasts'),
    'products', coalesce((select jsonb_agg(
        (c.data - 'reviews') || jsonb_build_object('reviews', coalesce(
          (select jsonb_agg(r - 'orderId' || case when r ? 'orderId' then '{"verified":true}'::jsonb else '{}'::jsonb end)
             from jsonb_array_elements(coalesce(c.data -> 'reviews', '[]'::jsonb)) r), '[]'::jsonb))
        order by c.pos, c.id) from public.coll c where c.coll = 'products' and c.data ->> 'status' <> 'hidden'), '[]'::jsonb),
    'slotUse', coalesce((select jsonb_object_agg(d, u) from (
        select day_t as d, jsonb_object_agg(time_t, n) as u from (
          select o.data ->> 'day' as day_t, o.data ->> 'time' as time_t, count(*) as n from public.orders o
           where o.data ? 'paidAt' and o.status <> 'cancelled' and o.data ->> 'day' >= to_char((now() at time zone public.shop_tz())::date - 1, 'YYYY-MM-DD')
           group by 1, 2) q group by day_t) q2), '{}'::jsonb),
    'sold', coalesce((select jsonb_object_agg(k, n) from (
        select i.key as k, sum((i.value)::int) as n
          from public.orders o, jsonb_each_text(o.data -> 'items') i
         where o.status in ('new','baking','ready','completed') and o.created_at > public.now_ms() - 90 * 86400000::bigint
         group by i.key) s), '{}'::jsonb),
    'coupons', coalesce((select jsonb_agg((c.data - 'maxUses') order by c.pos, c.id) from public.coll c
                         where c.coll = 'coupons' and coalesce((c.data ->> 'show')::boolean, false) and public.cp_live(c.data)), '[]'::jsonb)
  ) into res;
  return res;
end $function$;

revoke all on function public.pre_cfg(), public.pre_live(), public.pre_max(), public.orders_pre_check() from public, anon, authenticated;
revoke all on function public.prelaunch_public(), public.prelaunch_register(text, text, text), public.admin_prelaunch_list() from public;
grant execute on function public.prelaunch_public(), public.prelaunch_register(text, text, text) to anon, authenticated;
grant execute on function public.admin_prelaunch_list() to authenticated;
