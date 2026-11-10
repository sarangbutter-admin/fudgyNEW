-- BakeByCulture migration 55: "Become an affiliator" applications.
--  * a customer opens the apply link the owner shares, fills a short form and gets a private status link
--  * the owner sees the applications in the Affiliates menu and approves (creates the account) or rejects with a reason
--  * the applicant checks the result with their status link
-- Safe to run more than once.
create table if not exists public.aff_apps (
  id text primary key, token text not null unique, name text not null, phone text not null, phone_norm text not null default '', email text not null default '',
  handle text not null default '', social text not null default '', why text not null default '', status text not null default 'pending',
  reason text not null default '', aff_id text, created_at bigint not null, decided_at bigint, decided_by text not null default '');
create index if not exists aff_apps_status_idx on public.aff_apps (status, created_at);
alter table public.aff_apps enable row level security;
revoke all on public.aff_apps from anon, authenticated;

create or replace function public.aff_apply(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare nm text := btrim(coalesce(p ->> 'name', '')); ph text := btrim(coalesce(p ->> 'phone', '')); pn text := public.norm_phone(coalesce(p ->> 'phone', '')); em text := lower(btrim(coalesce(p ->> 'email', '')));
  tok text := encode(extensions.gen_random_bytes(10), 'hex'); id0 text := 'ap' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
begin
  perform public.ts_require('apply');
  if not public.lim_ip('aff-app', 'affAppIp', 5, 3600000) then perform public.bad('Too many tries. Please try again later.'); end if;
  if length(nm) < 2 or length(nm) > 80 then perform public.bad('Please type your name.'); end if;
  if length(pn) < 7 then perform public.bad('Please type a valid WhatsApp number.'); end if;
  if em <> '' and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform public.bad('That email does not look right.'); end if;
  if exists (select 1 from public.aff_apps where status = 'pending' and (phone_norm = pn or (em <> '' and email = em))) then perform public.bad('You already applied. Please wait for our answer.'); end if;
  if exists (select 1 from public.affiliates where (phone_norm <> '' and phone_norm = pn)) then perform public.bad('You are already an affiliator. Please sign in.'); end if;
  insert into public.aff_apps (id, token, name, phone, phone_norm, email, handle, social, why, created_at)
  values (id0, tok, left(nm, 80), left(ph, 30), pn, left(em, 120), left(regexp_replace(lower(btrim(coalesce(p ->> 'handle', ''))), '[^a-z0-9._-]', '', 'g'), 30),
          left(btrim(coalesce(p ->> 'social', '')), 300), left(btrim(coalesce(p ->> 'why', '')), 600), public.now_ms());
  return jsonb_build_object('ok', true, 'token', tok);
end $$;

create or replace function public.aff_app_status(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.aff_apps; u text;
begin
  select * into r from public.aff_apps where token = left(coalesce(p_token, ''), 40);
  if r.id is null then return jsonb_build_object('ok', false); end if;
  if r.status = 'approved' then select username into u from public.affiliates where id = r.aff_id; end if;
  return jsonb_build_object('ok', true, 'status', r.status, 'name', r.name, 'reason', case when r.status = 'rejected' then r.reason else '' end, 'username', coalesce(u, ''), 'at', r.created_at);
end $$;

create or replace function public.admin_aff_apps() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_owner();
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'phone', a.phone, 'email', a.email, 'handle', a.handle, 'social', a.social, 'why', a.why,
    'status', a.status, 'reason', a.reason, 'at', a.created_at, 'decidedAt', a.decided_at, 'affId', a.aff_id) order by (a.status = 'pending') desc, a.created_at desc)
    from (select * from public.aff_apps order by created_at desc limit 200) a), '[]'::jsonb);
end $$;

-- owner: approve (creates the affiliator account) or reject with a reason
create or replace function public.admin_aff_app_decide(p_id text, p_action text, p_reason text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.aff_apps; res jsonb; t bigint := public.now_ms(); who text := coalesce(auth.jwt() ->> 'email', '');
begin
  perform public.assert_owner();
  select * into r from public.aff_apps where id = p_id for update;
  if r.id is null then perform public.bad('Application not found.'); end if;
  if r.status <> 'pending' then perform public.bad('This application was already answered.'); end if;
  if p_action = 'reject' then
    if length(btrim(coalesce(p_reason, ''))) < 3 then perform public.bad('Please write the reason (at least 3 characters).'); end if;
    update public.aff_apps set status = 'rejected', reason = left(btrim(p_reason), 300), decided_at = t, decided_by = who where id = p_id;
    perform public.log_act('Rejected affiliator application', r.name);
    return jsonb_build_object('ok', true);
  elsif p_action = 'approve' then
    res := public.admin_aff_save(jsonb_build_object('username', coalesce(p ->> 'username', ''), 'password', coalesce(p ->> 'password', ''), 'code', coalesce(p ->> 'code', ''),
      'rate', coalesce(p ->> 'rate', '10'), 'name', r.name, 'phone', r.phone, 'coupon', coalesce(p ->> 'coupon', ''), 'status', 'active', 'note', 'From application ' || to_char(to_timestamp(r.created_at / 1000.0), 'YYYY-MM-DD')));
    update public.aff_apps set status = 'approved', aff_id = res ->> 'id', decided_at = t, decided_by = who where id = p_id;
    perform public.log_act('Approved affiliator application', r.name);
    return jsonb_build_object('ok', true, 'affId', res ->> 'id');
  end if;
  perform public.bad('Unknown action.');
end $$;

revoke all on function public.aff_apply(jsonb), public.aff_app_status(text) from public;
grant execute on function public.aff_apply(jsonb), public.aff_app_status(text) to anon, authenticated;
revoke all on function public.admin_aff_apps(), public.admin_aff_app_decide(text, text, text, jsonb) from public, anon;
grant execute on function public.admin_aff_apps(), public.admin_aff_app_decide(text, text, text, jsonb) to authenticated;
