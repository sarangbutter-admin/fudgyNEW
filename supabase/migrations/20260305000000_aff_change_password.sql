-- Delidome migration 64: affiliator "Change my password" without signing in again.
-- It used to sign in again with the old password, which cannot work once Supabase's sign-in CAPTCHA protection
-- (Cloudflare Turnstile) is switched on: that sign-in carries no security token. Now the old password is checked here.
-- Safe to run more than once.
create or replace function public.aff_change_pw(p_old text, p_new text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); a public.affiliates := public.aff_self(); ok boolean;
begin
  if uid is null or a.id is null or a.status = 'disabled' then perform public.bad('Please sign in again.'); end if;
  if not public.throttle_ok('affpw:' || uid::text, 8, 3600000) then perform public.bad('Too many tries. Please try again later.'); end if;
  if length(coalesce(p_new, '')) < 8 or length(p_new) > 72 then perform public.bad('New password: at least 8 characters.'); end if;
  execute 'select encrypted_password = extensions.crypt($1, encrypted_password) from auth.users where id = $2' into ok using coalesce(p_old, ''), uid;
  if not coalesce(ok, false) then perform public.bad('Your current password isn''t right.'); end if;
  if p_old = p_new then perform public.bad('Please choose a different password.'); end if;
  execute 'update auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt(''bf'')), updated_at = now() where id = $2' using p_new, uid;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.aff_change_pw(text, text) from public, anon;
grant execute on function public.aff_change_pw(text, text) to authenticated;
