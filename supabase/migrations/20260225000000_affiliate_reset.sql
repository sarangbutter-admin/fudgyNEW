-- BakeByCulture migration 56: affiliator password reset by email.
--  * each affiliator can have a registered contact email (set from the application, or typed by the owner in the Edit form)
--  * the owner looks the username up, checks that the email they received came from the registered address, and sets a new password
-- Safe to run more than once.
alter table public.affiliates add column if not exists contact_email text not null default '';

create or replace function public.admin_aff_emails() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_owner();
  return coalesce((select jsonb_object_agg(id, contact_email) from public.affiliates), '{}'::jsonb);
end $$;

create or replace function public.admin_aff_email(p_id text, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare em text := lower(btrim(coalesce(p_email, '')));
begin
  perform public.assert_owner();
  if em <> '' and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform public.bad('That email does not look right.'); end if;
  update public.affiliates set contact_email = left(em, 120) where id = p_id;
end $$;

create or replace function public.admin_aff_lookup(p_username text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a public.affiliates; un text := lower(btrim(coalesce(p_username, '')));
begin
  perform public.assert_owner();
  select * into a from public.affiliates where username = un or lower(email) = un limit 1;
  if a.id is null then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'id', a.id, 'name', a.name, 'username', a.username, 'email', a.contact_email, 'status', a.status, 'phone', a.phone);
end $$;

create or replace function public.admin_aff_reset(p_id text, p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates;
begin
  perform public.assert_owner();
  select * into a from public.affiliates where id = p_id;
  if a.id is null then perform public.bad('Affiliator not found.'); end if;
  if length(coalesce(p_password, '')) < 8 then perform public.bad('Password: at least 8 characters.'); end if;
  execute 'update auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt(''bf'')), updated_at = now() where lower(email) = $2' using p_password, a.email;
  perform public.log_act('Reset affiliator password', a.username);
  return jsonb_build_object('ok', true);
end $$;

-- approving an application keeps the applicant's email as the registered email
do $$ declare d text; begin
  select pg_get_functiondef('public.admin_aff_app_decide(text,text,text,jsonb)'::regprocedure) into d;
  if d not like '%contact_email%' then
    d := replace(d, $a$update public.aff_apps set status = 'approved', aff_id = res ->> 'id', decided_at = t, decided_by = who where id = p_id;$a$,
      $a$update public.aff_apps set status = 'approved', aff_id = res ->> 'id', decided_at = t, decided_by = who where id = p_id;
    update public.affiliates set contact_email = r.email where id = res ->> 'id' and r.email <> '';$a$);
    execute d;
  end if;
end $$;

revoke all on function public.admin_aff_emails(), public.admin_aff_email(text, text), public.admin_aff_lookup(text), public.admin_aff_reset(text, text) from public, anon;
grant execute on function public.admin_aff_emails(), public.admin_aff_email(text, text), public.admin_aff_lookup(text), public.admin_aff_reset(text, text) to authenticated;
