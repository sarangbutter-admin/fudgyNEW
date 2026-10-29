-- Delidome migration 60: standalone "Join us" page for affiliators.
--  * the application now asks for name, WhatsApp, email, username, password and at least one of Instagram / TikTok / Threads
--  * the password is stored only as a hash and is cleared once the owner answers; approving creates the account with the applicant's own password
--  * the owner's page settings (texts, colors, marquee, steps) live in private_kv "aff_join"; the page reads them with aff_join_page()
-- Safe to run more than once.

alter table public.aff_apps add column if not exists username text not null default '';
alter table public.aff_apps add column if not exists pw_hash  text not null default '';
alter table public.aff_apps add column if not exists ig text not null default '';
alter table public.aff_apps add column if not exists tt text not null default '';
alter table public.aff_apps add column if not exists th text not null default '';

create or replace function public.aff_apply(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare nm text := btrim(coalesce(p ->> 'name', '')); ph text := btrim(coalesce(p ->> 'phone', '')); pn text := public.norm_phone(coalesce(p ->> 'phone', ''));
  em text := lower(btrim(coalesce(p ->> 'email', ''))); un text := lower(btrim(coalesce(p ->> 'username', ''))); pw text := coalesce(p ->> 'password', '');
  ig text := left(regexp_replace(btrim(coalesce(p ->> 'ig', '')), '[^A-Za-z0-9._@/:-]', '', 'g'), 80);
  tt text := left(regexp_replace(btrim(coalesce(p ->> 'tt', '')), '[^A-Za-z0-9._@/:-]', '', 'g'), 80);
  th text := left(regexp_replace(btrim(coalesce(p ->> 'th', '')), '[^A-Za-z0-9._@/:-]', '', 'g'), 80);
  tok text := encode(extensions.gen_random_bytes(10), 'hex'); id0 text := 'ap' || substr(md5(random()::text || clock_timestamp()::text), 1, 10); taken boolean;
begin
  perform public.ts_require('apply');
  if not public.lim_ip('aff-app', 'affAppIp', 5, 3600000) then perform public.bad('Too many tries. Please try again later.'); end if;
  if length(nm) < 2 or length(nm) > 80 then perform public.bad('Please type your name.'); end if;
  if length(pn) < 7 then perform public.bad('Please type a valid WhatsApp number.'); end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(em) > 120 then perform public.bad('Please type a valid email. We use it if you forget your password.'); end if;
  if un !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then perform public.bad('Username: 3 to 30 letters or numbers (dots, dashes and _ are fine), no spaces.'); end if;
  if length(pw) < 8 or length(pw) > 72 then perform public.bad('Password: at least 8 characters.'); end if;
  if ig = '' and tt = '' and th = '' then perform public.bad('Please add your Instagram, TikTok or Threads.'); end if;
  if exists (select 1 from public.aff_apps where status = 'pending' and (phone_norm = pn or email = em or username = un)) then perform public.bad('You already applied. Please wait for our answer.'); end if;
  if exists (select 1 from public.affiliates where (phone_norm <> '' and phone_norm = pn) or lower(contact_email) = em) then perform public.bad('You are already an affiliator. Please sign in.'); end if;
  if exists (select 1 from public.admins where lower(username) = un) or exists (select 1 from public.affiliates where username = un) then perform public.bad('That username is taken. Please choose another.'); end if;
  execute 'select exists (select 1 from auth.users where lower(email) = $1)' into strict taken using un || '@' || public.team_domain();
  if taken then perform public.bad('That username is taken. Please choose another.'); end if;
  insert into public.aff_apps (id, token, name, phone, phone_norm, email, handle, social, why, username, pw_hash, ig, tt, th, created_at)
  values (id0, tok, left(nm, 80), left(ph, 30), pn, em, un, left(concat_ws(' · ', nullif(ig, ''), nullif(tt, ''), nullif(th, '')), 300), left(btrim(coalesce(p ->> 'why', '')), 600),
          un, extensions.crypt(pw, extensions.gen_salt('bf')), ig, tt, th, public.now_ms());
  return jsonb_build_object('ok', true, 'token', tok);
end $$;

create or replace function public.admin_aff_apps() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_owner();
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'phone', a.phone, 'email', a.email, 'handle', a.handle, 'social', a.social, 'why', a.why,
    'username', a.username, 'ig', a.ig, 'tt', a.tt, 'th', a.th, 'ownPw', a.username <> '' and (a.pw_hash <> '' or a.status <> 'pending'),
    'status', a.status, 'reason', a.reason, 'at', a.created_at, 'decidedAt', a.decided_at, 'affId', a.aff_id) order by (a.status = 'pending') desc, a.created_at desc)
    from (select * from public.aff_apps order by created_at desc limit 200) a), '[]'::jsonb);
end $$;

-- owner: approve (creates the affiliator account) or reject with a reason
create or replace function public.admin_aff_app_decide(p_id text, p_action text, p_reason text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.aff_apps; res jsonb; t bigint := public.now_ms(); who text := coalesce(auth.jwt() ->> 'email', ''); un text; note text; aemail text;
begin
  perform public.assert_owner();
  select * into r from public.aff_apps where id = p_id for update;
  if r.id is null then perform public.bad('Application not found.'); end if;
  if r.status <> 'pending' then perform public.bad('This application was already answered.'); end if;
  if p_action = 'reject' then
    if length(btrim(coalesce(p_reason, ''))) < 3 then perform public.bad('Please write the reason (at least 3 characters).'); end if;
    update public.aff_apps set status = 'rejected', reason = left(btrim(p_reason), 300), decided_at = t, decided_by = who, pw_hash = '' where id = p_id;
    perform public.log_act('Rejected affiliator application', r.name);
    return jsonb_build_object('ok', true);
  elsif p_action = 'approve' then
    un := case when r.username <> '' then r.username else coalesce(p ->> 'username', '') end;
    note := left('From application ' || to_char(to_timestamp(r.created_at / 1000.0), 'YYYY-MM-DD')
      || case when r.ig <> '' then ' · IG ' || r.ig else '' end || case when r.tt <> '' then ' · TikTok ' || r.tt else '' end || case when r.th <> '' then ' · Threads ' || r.th else '' end, 300);
    res := public.admin_aff_save(jsonb_build_object('username', un,
      'password', case when r.pw_hash <> '' then encode(extensions.gen_random_bytes(12), 'hex') else coalesce(p ->> 'password', '') end,
      'code', coalesce(p ->> 'code', ''), 'rate', coalesce(p ->> 'rate', '10'), 'name', r.name, 'phone', r.phone, 'coupon', coalesce(p ->> 'coupon', ''), 'status', 'active', 'note', note));
    select email into aemail from public.affiliates where id = res ->> 'id';
    -- the applicant's own password replaces the throwaway one
    if r.pw_hash <> '' then execute 'update auth.users set encrypted_password = $1, updated_at = now() where lower(email) = $2' using r.pw_hash, lower(aemail); end if;
    update public.affiliates set contact_email = r.email where id = res ->> 'id' and r.email <> '';
    update public.aff_apps set status = 'approved', aff_id = res ->> 'id', decided_at = t, decided_by = who, pw_hash = '' where id = p_id;
    perform public.log_act('Approved affiliator application', r.name);
    return jsonb_build_object('ok', true, 'affId', res ->> 'id');
  end if;
  perform public.bad('Unknown action.');
end $$;

-- the page settings: the owner edits, everyone reads (plus the security-check key when the apply form is protected)
create or replace function public.aff_join_page() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d jsonb := coalesce((select data from public.private_kv where key = 'aff_join'), '{}'::jsonb); s jsonb := coalesce((select data -> 'turnstile' from public.docs where key = 'settings'), '{}'::jsonb);
  pg jsonb := coalesce((select data from public.docs where key = 'page'), '{}'::jsonb);
begin
  return jsonb_build_object('cfg', d, 'shop', coalesce(pg ->> 'name', ''), 'brand', coalesce(pg ->> 'brand', ''),
    'ts', jsonb_build_object('on', coalesce((s ->> 'on')::boolean, false) and coalesce(s ->> 'siteKey', '') <> '' and coalesce((s -> 'where' ->> 'apply')::boolean, false), 'key', coalesce(s ->> 'siteKey', '')));
end $$;

create or replace function public.admin_aff_join_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_owner();
  if p is null or jsonb_typeof(p) <> 'object' or length(p::text) > 20000 then perform public.bad('That page is too long.'); end if;
  insert into public.private_kv (key, data, updated_at) values ('aff_join', p, public.now_ms())
    on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
  perform public.log_act('Affiliate join page changed', '');
  return public.aff_join_page();
end $$;

revoke all on function public.aff_join_page(), public.admin_aff_join_save(jsonb) from public;
grant execute on function public.aff_join_page() to anon, authenticated;
grant execute on function public.admin_aff_join_save(jsonb) to authenticated;
revoke all on function public.aff_apply(jsonb) from public;
grant execute on function public.aff_apply(jsonb) to anon, authenticated;
