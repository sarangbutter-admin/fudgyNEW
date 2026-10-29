-- Delidome migration 62: "Forgot password" requests for affiliators, sent from the sign-in page (no mail app needed).
--  * the affiliator types their username and registered email; the request is saved with a flag "email matches"
--  * the owner sees the requests in Affiliates -> Forgot password, checks the flag and sets a new password (existing step)
--  * the answer to the affiliator is always the same, so nobody can find out which usernames exist
-- Safe to run more than once.
create table if not exists public.aff_resets (
  id bigserial primary key, aff_id text not null, username text not null, name text not null default '', email text not null default '',
  match boolean not null default false, status text not null default 'open', at bigint not null, done_at bigint);
create index if not exists aff_resets_idx on public.aff_resets (status, at desc);
alter table public.aff_resets enable row level security;
revoke all on public.aff_resets from anon, authenticated;

create or replace function public.aff_forgot(p_username text, p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare un text := lower(btrim(coalesce(p_username, ''))); em text := lower(btrim(coalesce(p_email, ''))); a public.affiliates; ok boolean;
begin
  if not public.lim_ip('aff-forgot', 'affForgotIp', 5, 3600000) then perform public.bad('Too many tries. Please try again later.'); end if;
  if length(un) < 3 or length(un) > 40 then perform public.bad('Please type your username.'); end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(em) > 120 then perform public.bad('Please type the email you registered with.'); end if;
  select * into a from public.affiliates where username = un limit 1;
  if a.id is not null and a.status <> 'disabled' and not exists (select 1 from public.aff_resets where aff_id = a.id and status = 'open' and at > public.now_ms() - 600000) then
    ok := coalesce(a.contact_email, '') <> '' and lower(a.contact_email) = em;
    insert into public.aff_resets (aff_id, username, name, email, match, at) values (a.id, a.username, a.name, left(em, 120), ok, public.now_ms());
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_aff_resets() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_owner();
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'affId', r.aff_id, 'username', r.username, 'name', r.name, 'email', r.email, 'match', r.match, 'status', r.status, 'at', r.at, 'doneAt', r.done_at)
    order by (r.status = 'open') desc, r.at desc) from (select * from public.aff_resets order by (status = 'open') desc, at desc limit 30) r), '[]'::jsonb);
end $$;

create or replace function public.admin_aff_reset_dismiss(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_owner();
  update public.aff_resets set status = 'dismissed', done_at = public.now_ms() where id = p_id and status = 'open';
end $$;

-- setting a new password also closes the open requests of that affiliator
create or replace function public.admin_aff_reset(p_id text, p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates;
begin
  perform public.assert_owner();
  select * into a from public.affiliates where id = p_id;
  if a.id is null then perform public.bad('Affiliator not found.'); end if;
  if length(coalesce(p_password, '')) < 8 then perform public.bad('Password: at least 8 characters.'); end if;
  execute 'update auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt(''bf'')), updated_at = now() where lower(email) = $2' using p_password, a.email;
  update public.aff_resets set status = 'done', done_at = public.now_ms() where aff_id = p_id and status = 'open';
  perform public.log_act('Reset affiliator password', a.username);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.aff_forgot(text, text) from public;
grant execute on function public.aff_forgot(text, text) to anon, authenticated;
revoke all on function public.admin_aff_resets(), public.admin_aff_reset_dismiss(bigint), public.admin_aff_reset(text, text) from public, anon;
grant execute on function public.admin_aff_resets(), public.admin_aff_reset_dismiss(bigint), public.admin_aff_reset(text, text) to authenticated;
