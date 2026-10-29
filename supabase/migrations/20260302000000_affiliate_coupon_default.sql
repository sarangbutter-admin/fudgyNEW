-- Delidome migration 61: one default discount for every affiliator coupon.
--  * the owner sets the default once (private_kv "aff_cdef": type, value, minimum order, uses, one per customer, flash sale, end date)
--  * every affiliator coupon uses it, so an affiliator can create their coupon straight away and sees the discount before choosing a name
--  * a per-affiliator discount set in "Affiliate coupons" still wins, but only where the owner typed one
--  * saving the default re-syncs every existing affiliator coupon; "all" also clears the per-affiliator discounts
-- Safe to run more than once.

create or replace function public.aff_cdef_vals() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select data from public.private_kv where key = 'aff_cdef'),
    jsonb_build_object('type', 'percent', 'value', '', 'minSpend', 0, 'maxUses', 0, 'onePerPhone', true, 'stack', false, 'endsAt', '')) $$;

-- the rule an affiliator's coupon really follows: their own discount if the owner typed one, else the default ('{}' = none yet)
create or replace function public.aff_rule_eff(a public.affiliates) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := coalesce(a.crule, '{}'::jsonb); d jsonb := public.aff_cdef_vals();
begin
  if coalesce(nullif(r ->> 'value', ''), '') <> '' or r ->> 'type' = 'freedelivery' then return r; end if;
  if coalesce(nullif(d ->> 'value', ''), '') <> '' or d ->> 'type' = 'freedelivery' then
    return d || jsonb_build_object('canName', coalesce(r -> 'canName', 'true'::jsonb), 'on', coalesce(r -> 'on', 'true'::jsonb), 'desc', coalesce(r -> 'desc', '""'::jsonb));
  end if;
  return '{}'::jsonb;
end $$;

-- keeps the coupons row of one affiliator in step with their name + rule (internal)
create or replace function public.aff_sync_coupon(p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.affiliates; r jsonb; cid text; d jsonb;
begin
  select * into a from public.affiliates where id = p_id;
  if a.id is null then return; end if;
  cid := 'affc_' || a.id;
  if coalesce(a.coupon, '') = '' then
    update public.coll set data = data || '{"on": false}'::jsonb where coll = 'coupons' and id = cid;
    return;
  end if;
  r := public.aff_rule_eff(a);
  if r = '{}'::jsonb then return; end if;   -- no rule set by the owner and no default yet
  d := jsonb_build_object('id', cid, 'aff', a.id, 'code', upper(a.coupon),
    'on', a.status = 'active' and coalesce((r ->> 'on')::boolean, true),
    'desc', coalesce(nullif(btrim(r ->> 'desc'), ''), 'Code from ' || coalesce(nullif(a.name, ''), a.username)),
    'show', false, 'appliesTo', 'all',
    'type', case when r ->> 'type' in ('percent', 'amount', 'freedelivery') then r ->> 'type' else 'percent' end,
    'value', coalesce(nullif(r ->> 'value', '')::numeric, 0), 'minSpend', coalesce(nullif(r ->> 'minSpend', '')::numeric, 0),
    'startsAt', coalesce(r ->> 'startsAt', ''), 'endsAt', coalesce(r ->> 'endsAt', ''), 'maxUses', coalesce(nullif(r ->> 'maxUses', '')::int, 0),
    'onePerPhone', coalesce((r ->> 'onePerPhone')::boolean, true), 'stack', coalesce((r ->> 'stack')::boolean, false));
  insert into public.coll (coll, id, pos, data, updated_at)
  values ('coupons', cid, coalesce((select max(pos) + 1 from public.coll where coll = 'coupons'), 0), d, public.now_ms())
  on conflict (coll, id) do update set data = excluded.data, updated_at = excluded.updated_at;
end $$;

-- affiliator: what my coupon is and what it gives (the default unless the owner set something special for me)
create or replace function public.aff_coupon_info() returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates := public.aff_self(); r jsonb;
begin
  if a.id is null or a.status = 'disabled' then return jsonb_build_object('ok', false); end if;
  r := public.aff_rule_eff(a);
  return jsonb_build_object('ok', true, 'coupon', a.coupon, 'rate', a.rate, 'canName', coalesce((r ->> 'canName')::boolean, true),
    'ready', r <> '{}'::jsonb,
    'type', coalesce(nullif(r ->> 'type', ''), 'percent'), 'value', coalesce(nullif(r ->> 'value', '')::numeric, 0), 'minSpend', coalesce(nullif(r ->> 'minSpend', '')::numeric, 0),
    'stack', coalesce((r ->> 'stack')::boolean, false), 'endsAt', coalesce(r ->> 'endsAt', ''), 'changedAt', a.coupon_at);
end $$;

-- affiliator: choose / change my coupon name
create or replace function public.aff_coupon_save(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates := public.aff_self(); cd text := upper(btrim(coalesce(p_code, ''))); r jsonb; t bigint := public.now_ms();
begin
  if a.id is null or a.status = 'disabled' then perform public.bad('Please sign in again.'); end if;
  r := public.aff_rule_eff(a);
  if r = '{}'::jsonb then perform public.bad('Coupons are not ready yet. Please ask the owner to set the coupon discount first.'); end if;
  if not coalesce((r ->> 'canName')::boolean, true) then perform public.bad('The owner sets your coupon name. Please ask them to change it.'); end if;
  if cd !~ '^[A-Z0-9]{3,20}$' then perform public.bad('Coupon name: 3 to 20 letters or numbers, no spaces, like ALPHA001.'); end if;
  if cd = upper(coalesce(a.coupon, '')) then return public.aff_coupon_info(); end if;
  if a.coupon <> '' and a.coupon_at > t - 3600000 then perform public.bad('You can change your coupon name once an hour. Please try again later.'); end if;
  if not public.aff_name_free(a.id, cd) then perform public.bad('That name is already used. Please choose another one.'); end if;
  update public.affiliates set coupon = cd, coupon_at = t where id = a.id;
  perform public.aff_sync_coupon(a.id);
  return public.aff_coupon_info();
end $$;

-- owner: read (no argument) or save the default discount; "all": true also clears every affiliator's own discount
create or replace function public.admin_aff_cdef(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ty text; v numeric; ms numeric; mu int; r jsonb; x record; n int := 0;
begin
  perform public.assert_owner();
  if p is null or p = '{}'::jsonb then return public.aff_cdef_vals(); end if;
  ty := coalesce(p ->> 'type', 'percent');
  if ty not in ('percent', 'amount', 'freedelivery') then perform public.bad('Unknown coupon type.'); end if;
  begin v := nullif(p ->> 'value', '')::numeric; exception when others then perform public.bad('The discount must be a number.'); end;
  if ty <> 'freedelivery' and (v is null or v <= 0 or (ty = 'percent' and v > 100)) then perform public.bad('The discount must be more than 0, and 100 (%) at most.'); end if;
  begin ms := coalesce(nullif(p ->> 'minSpend', '')::numeric, 0); mu := coalesce(nullif(p ->> 'maxUses', '')::int, 0); exception when others then perform public.bad('Minimum order and uses must be numbers.'); end;
  r := jsonb_build_object('type', ty, 'value', case when ty = 'freedelivery' then '' else v::text end, 'minSpend', greatest(0, ms), 'maxUses', greatest(0, mu),
    'onePerPhone', coalesce((p ->> 'onePerPhone')::boolean, true), 'stack', coalesce((p ->> 'stack')::boolean, false), 'endsAt', left(coalesce(p ->> 'endsAt', ''), 16));
  insert into public.private_kv (key, data, updated_at) values ('aff_cdef', r, public.now_ms())
    on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
  if coalesce((p ->> 'all')::boolean, false) then
    update public.affiliates set crule = coalesce(crule, '{}'::jsonb) - 'type' - 'value' - 'minSpend' - 'maxUses' - 'startsAt' - 'endsAt' - 'onePerPhone' - 'stack';
  end if;
  for x in select id from public.affiliates where coalesce(coupon, '') <> '' loop perform public.aff_sync_coupon(x.id); n := n + 1; end loop;
  perform public.log_act('Affiliate coupon default changed', case ty when 'percent' then v::text || '%' when 'amount' then 'amount ' || v::text else 'free delivery' end || ' · ' || n || ' coupons updated');
  return public.aff_cdef_vals();
end $$;

revoke all on function public.aff_cdef_vals(), public.aff_rule_eff(public.affiliates) from public, anon, authenticated;
revoke all on function public.aff_sync_coupon(text) from public, anon, authenticated;
revoke all on function public.admin_aff_cdef(jsonb) from public, anon;
grant execute on function public.admin_aff_cdef(jsonb) to authenticated;
revoke all on function public.aff_coupon_info(), public.aff_coupon_save(text) from public, anon;
grant execute on function public.aff_coupon_info(), public.aff_coupon_save(text) to authenticated;

-- the existing coupons follow the default now
do $$ declare x record; begin for x in select id from public.affiliates where coalesce(coupon, '') <> '' loop perform public.aff_sync_coupon(x.id); end loop; end $$;

-- per-affiliator settings: an empty discount now means "use the default" (before, it was refused)
do $$ declare d text; begin
  select pg_get_functiondef('public.admin_aff_crule(text,jsonb)'::regprocedure) into d;
  if d like '%v is null or v < 0%' then
    d := replace(d, 'if ty <> ''freedelivery'' and (v is null or v < 0 or (ty = ''percent'' and v > 100)) then',
                    'if ty <> ''freedelivery'' and v is not null and (v < 0 or (ty = ''percent'' and v > 100)) then');
    execute d;
  end if;
end $$;
