-- Delidome migration 38: the ban message the owner can customise, the courier price gate for banned customers, and "Needs a look" flags.
--  * a banned customer's order is refused with the word BANNED, and the shop then shows the owner's own message (icon, picture, gifts, text)
--  * cust_ban_gate() is called by the courier function: no courier prices for a banned number or email
--  * admin_customers() also returns flags for suspicious patterns; the owner can mark a customer as checked
-- Safe to run more than once. Run after migration 37.

alter table public.customers add column if not exists reviewed_at bigint not null default 0;

create or replace function public.orders_ban_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (public.cust_ban_of(new.phone_norm, new.data #>> '{customer,email}')).id is not null then
    perform public.bad('BANNED');
  end if;
  return new;
end $$;

-- 'banned' | 'ok' (only the courier function calls this). A request without a number or email (an older shop version) is let through.
create or replace function public.cust_ban_gate(p_phone text, p_email text) returns text
language plpgsql stable security definer set search_path = public as $$
declare pn text := public.norm_phone(coalesce(p_phone, ''));
begin
  if length(pn) < 7 and btrim(coalesce(p_email, '')) = '' then return 'ok'; end if;
  if (public.cust_ban_of(pn, p_email)).id is not null then return 'banned'; end if;
  return 'ok';
end $$;

-- the ban message
create or replace function public.ban_msg_vals() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('icon', '🚫', 'title', 'We can''t take this order', 'text', 'Sorry, we are not able to take orders from this number or email right now. Please contact us and we will be happy to help.',
    'img', '', 'fx', true, 'items', '[]'::jsonb, 'amount', 24, 'btn', 'Chat with us', 'btnOn', true) || coalesce((select data from public.private_kv where key = 'ban_msg'), '{}'::jsonb) $$;

create or replace function public.ban_msg() returns jsonb
language sql stable security definer set search_path = public as $$ select public.ban_msg_vals() $$;

create or replace function public.admin_ban_msg_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare im text := btrim(coalesce(p ->> 'img', '')); v jsonb; its jsonb := '[]'::jsonb; u text; am int;
begin
  perform public.assert_admin();
  if im <> '' and im !~ '^https://[^ ]{10,250}$' then perform public.bad('Upload the picture again.'); end if;
  if jsonb_typeof(p -> 'items') = 'array' then
    for u in select jsonb_array_elements_text(p -> 'items') limit 6 loop
      if u !~ '^https://[^ ]{10,250}$' then perform public.bad('Upload the gift pictures again.'); end if;
      its := its || to_jsonb(u);
    end loop;
  end if;
  begin am := greatest(4, least(60, (p ->> 'amount')::int)); exception when others then am := 24; end;
  v := jsonb_build_object('icon', left(btrim(coalesce(p ->> 'icon', '')), 12), 'title', left(btrim(coalesce(p ->> 'title', '')), 80), 'text', left(btrim(coalesce(p ->> 'text', '')), 400),
    'img', im, 'fx', coalesce((p ->> 'fx')::boolean, true), 'items', its, 'amount', am, 'btn', left(btrim(coalesce(p ->> 'btn', '')), 40), 'btnOn', coalesce((p ->> 'btnOn')::boolean, true));
  insert into public.private_kv (key, data, updated_at) values ('ban_msg', v, public.now_ms())
    on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
  perform public.log_act('Ban message changed', left(coalesce(v ->> 'title', ''), 80));
  return public.ban_msg_vals();
end $$;

-- "Needs a look": suspicious patterns since the owner last marked the customer as checked
create or replace function public.admin_cust_reviewed(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  update public.customers set reviewed_at = public.now_ms() where id = p_id;
  perform public.log_act('Customer marked as checked', (select name || ' · ' || phone from public.customers where id = p_id));
  return public.admin_customers();
end $$;

create or replace function public.admin_customers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return coalesce((select jsonb_agg(x order by (x ->> 'createdAt')::bigint desc) from (
    with t as (select public.now_ms() n),
    o as (select o.phone_norm, o.status, o.created_at, o.data from public.orders o join public.customers c on c.phone_norm = o.phone_norm
           where o.phone_norm <> '' and o.created_at > c.reviewed_at),
    fl as (
      select phone_norm, 'Cancelled for no payment ' || count(*) || ' times in 30 days' as f from o, t
       where status = 'cancelled' and data ->> 'cancelReason' ilike 'Not paid within%' and created_at > t.n - 30 * 86400000::bigint group by phone_norm having count(*) >= 3
      union all select phone_norm, count(*) || ' orders in the last 24 hours' from o, t where created_at > t.n - 86400000 group by phone_norm having count(*) >= 5
      union all select phone_norm, 'Used ' || count(distinct lower(btrim(data #>> '{customer,name}'))) || ' different names in 30 days' from o, t
       where created_at > t.n - 30 * 86400000::bigint group by phone_norm having count(distinct lower(btrim(data #>> '{customer,name}'))) >= 3
      union all select phone_norm, count(*) || ' orders with a rejected payment proof' from o where data ? 'rejected' group by phone_norm having count(*) >= 2
      union all select phone_norm, count(*) || ' complaints' from o where data ? 'complaint' group by phone_norm having count(*) >= 3
      union all select p.phone_norm, 'Same address used by ' || a.n || ' different numbers' from (
          select lower(btrim(data #>> '{customer,address}')) ad, count(distinct phone_norm) n from o, t
           where created_at > t.n - 60 * 86400000::bigint and length(btrim(coalesce(data #>> '{customer,address}', ''))) >= 12 group by 1 having count(distinct phone_norm) >= 3) a
        join (select distinct phone_norm, lower(btrim(data #>> '{customer,address}')) ad from o) p on p.ad = a.ad),
    fj as (select phone_norm, jsonb_agg(distinct f) flags from fl group by phone_norm)
    select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'note', c.note, 'source', c.source, 'createdAt', c.created_at,
             'orders', coalesce(s.n, 0), 'spent', coalesce(s.spent, 0), 'lastOrder', s.last, 'flags', coalesce(fj.flags, '[]'::jsonb),
             'ban', (select jsonb_build_object('id', b.id, 'reason', b.reason, 'at', b.at, 'until', b.until, 'by', b.by_email) from (select (public.cust_ban_of(c.phone_norm, c.email)).*) b where b.id is not null)) as x
      from public.customers c
      left join fj on fj.phone_norm = c.phone_norm
      left join (select phone_norm, count(*) as n,
                        coalesce(sum((data ->> 'total')::numeric) filter (where status in ('new','baking','ready','completed')), 0) as spent,
                        max(created_at) as last
                   from public.orders group by phone_norm) s on s.phone_norm = c.phone_norm) q), '[]'::jsonb);
end $$;

revoke all on function public.cust_ban_gate(text, text), public.ban_msg_vals() from public, anon, authenticated;
revoke all on function public.ban_msg(), public.admin_ban_msg_save(jsonb), public.admin_cust_reviewed(text), public.admin_customers() from public;
grant execute on function public.ban_msg() to anon, authenticated;
grant execute on function public.admin_ban_msg_save(jsonb), public.admin_cust_reviewed(text), public.admin_customers() to authenticated;
revoke execute on function public.admin_ban_msg_save(jsonb), public.admin_cust_reviewed(text), public.admin_customers() from anon;
