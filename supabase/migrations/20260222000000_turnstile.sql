-- BakeByCulture migration 53: Cloudflare Turnstile security checks.
--  * the owner saves the Turnstile secret key in Shop settings (private_kv "turnstile_key"); the site key and the switches live in settings.turnstile
--  * the edge function "turnstile" verifies the widget token with Cloudflare and returns a short pass "<action>|<expiry ms>.<hmac>"
--  * the checks that run in the database (WhatsApp / place order, coupon input, payment proof) read the pass from the request header x-ts-pass
--  * the courier check and DOKU checkout are Edge Functions: they verify the pass in their own body
-- When the switch is off (default) nothing changes. Safe to run more than once.
create or replace function public.admin_ts_get() returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  perform public.assert_owner();
  select data into d from public.private_kv where key = 'turnstile_key';
  return jsonb_build_object('hasKey', coalesce(d ->> 'secret', '') <> '');
end $$;

create or replace function public.admin_ts_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_owner();
  if length(btrim(coalesce(p ->> 'secret', ''))) > 200 then perform public.bad('That does not look right.'); end if;
  insert into public.private_kv (key, data, updated_at) values ('turnstile_key', jsonb_build_object('secret', btrim(coalesce(p ->> 'secret', ''))), public.now_ms())
    on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
  return public.admin_ts_get();
end $$;

create or replace function public.ts_sig(p_msg text) returns text
language sql stable security definer set search_path = public, extensions as $$
  select encode(extensions.hmac(convert_to(p_msg, 'utf8'), convert_to(coalesce((select data ->> 'v' from public.private_kv where key = 'quote_secret'), ''), 'utf8'), 'sha256'), 'hex') $$;

create or replace function public.ts_valid(p_pass text, p_act text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare msg text; sig text; exp bigint;
begin
  if p_pass is null or position('.' in p_pass) = 0 then return false; end if;
  msg := split_part(p_pass, '.', 1); sig := split_part(p_pass, '.', 2);
  if split_part(msg, '|', 1) <> p_act then return false; end if;
  exp := nullif(split_part(msg, '|', 2), '')::bigint;
  return exp is not null and exp > public.now_ms() and sig = public.ts_sig(msg);
exception when others then return false;
end $$;

-- called at the top of the protected functions: does nothing unless Turnstile is on for that action
create or replace function public.ts_require(p_act text) returns void
language plpgsql stable security definer set search_path = public as $$
declare c jsonb := coalesce(public.cfg() -> 'turnstile', '{}'::jsonb); h text;
begin
  if not coalesce((c ->> 'on')::boolean, false) or coalesce(c ->> 'siteKey', '') = '' then return; end if;
  if not coalesce((c -> 'where' ->> p_act)::boolean, false) then return; end if;
  if not exists (select 1 from public.private_kv where key = 'turnstile_key' and coalesce(data ->> 'secret', '') <> '') then return; end if;
  begin h := (current_setting('request.headers', true)::jsonb) ->> 'x-ts-pass'; exception when others then h := null; end;
  if not public.ts_valid(h, p_act) then perform public.bad('Please complete the security check and try again.'); end if;
end $$;

revoke all on function public.ts_sig(text), public.ts_valid(text, text), public.ts_require(text) from public, anon, authenticated;
grant execute on function public.ts_sig(text), public.ts_valid(text, text), public.ts_require(text) to service_role;
revoke all on function public.admin_ts_get(), public.admin_ts_save(jsonb) from public, anon;
grant execute on function public.admin_ts_get(), public.admin_ts_save(jsonb) to authenticated;

-- gate the protected functions (first statement after BEGIN)
do $$ declare f text; a text; d text; begin
  foreach f in array array['check_coupon(text,integer,text,text)', 'submit_proof(text,text,text,text)', 'place_order(jsonb)'] loop
    a := case when f like 'check_coupon%' then 'coupon' when f like 'submit_proof%' then 'proof' else 'whatsapp' end;
    select pg_get_functiondef(('public.' || f)::regprocedure) into d;
    if d not like '%ts_require%' then
      d := regexp_replace(d, E'\\nbegin\\n', E'\nbegin\n  perform public.ts_require(''' || a || E''');\n', 'n');
      execute d;
    end if;
  end loop;
end $$;
