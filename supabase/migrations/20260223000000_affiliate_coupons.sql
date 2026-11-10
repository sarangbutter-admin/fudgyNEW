-- BakeByCulture migration 54: affiliator coupons.
--  * the owner sets a coupon rule for each affiliator (type, value, minimum spend, uses, validity, "can be used with a flash sale", "affiliator may choose the name")
--  * the affiliator picks their own coupon name (like ALPHA001) in their dashboard; it becomes a real coupon (coupons row "affc_<id>") with the owner's rule
--  * an order that uses the coupon is credited to the affiliator (existing rule: the coupon wins over the 30-day link memory) at the commission % the owner set
-- Safe to run more than once.
alter table public.affiliates add column if not exists crule jsonb not null default '{}'::jsonb;
alter table public.affiliates add column if not exists coupon_at bigint not null default 0;

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
  r := coalesce(a.crule, '{}'::jsonb);
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

-- is this coupon name free? (not another coupon, link code or coupon name)
create or replace function public.aff_name_free(p_aff text, p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.coll c where c.coll = 'coupons' and upper(c.data ->> 'code') = p_name and c.id <> 'affc_' || p_aff)
     and not exists (select 1 from public.affiliates x where x.id <> p_aff and (x.code = p_name or upper(x.coupon) = p_name))
     and not exists (select 1 from public.affiliates x where x.id = p_aff and x.code = p_name) $$;

-- affiliator: what my coupon is and what the owner's rule gives
create or replace function public.aff_coupon_info() returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates := public.aff_self(); r jsonb;
begin
  if a.id is null or a.status = 'disabled' then return jsonb_build_object('ok', false); end if;
  r := coalesce(a.crule, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'coupon', a.coupon, 'rate', a.rate, 'canName', coalesce((r ->> 'canName')::boolean, true),
    'ready', coalesce(nullif(r ->> 'value', ''), '') <> '' or r ->> 'type' = 'freedelivery',
    'type', coalesce(nullif(r ->> 'type', ''), 'percent'), 'value', coalesce(nullif(r ->> 'value', '')::numeric, 0), 'minSpend', coalesce(nullif(r ->> 'minSpend', '')::numeric, 0),
    'stack', coalesce((r ->> 'stack')::boolean, false), 'endsAt', coalesce(r ->> 'endsAt', ''), 'changedAt', a.coupon_at);
end $$;

-- affiliator: choose / change my coupon name
create or replace function public.aff_coupon_save(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates := public.aff_self(); cd text := upper(btrim(coalesce(p_code, ''))); r jsonb; t bigint := public.now_ms();
begin
  if a.id is null or a.status = 'disabled' then perform public.bad('Please sign in again.'); end if;
  r := coalesce(a.crule, '{}'::jsonb);
  if not coalesce((r ->> 'canName')::boolean, true) then perform public.bad('The owner sets your coupon name. Please ask them to change it.'); end if;
  if coalesce(nullif(r ->> 'value', ''), '') = '' and r ->> 'type' <> 'freedelivery' then perform public.bad('Your coupon is not set up yet. Please ask the owner to set its discount first.'); end if;
  if cd !~ '^[A-Z0-9]{3,20}$' then perform public.bad('Coupon name: 3 to 20 letters or numbers, no spaces, like ALPHA001.'); end if;
  if cd = upper(coalesce(a.coupon, '')) then return public.aff_coupon_info(); end if;
  if a.coupon <> '' and a.coupon_at > t - 3600000 then perform public.bad('You can change your coupon name once an hour. Please try again later.'); end if;
  if not public.aff_name_free(a.id, cd) then perform public.bad('That name is already used. Please choose another one.'); end if;
  update public.affiliates set coupon = cd, coupon_at = t where id = a.id;
  perform public.aff_sync_coupon(a.id);
  return public.aff_coupon_info();
end $$;

-- owner: every affiliator with their coupon rule and commission
create or replace function public.admin_aff_coupons() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_owner();
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'username', a.username, 'code', a.code, 'rate', a.rate, 'status', a.status,
    'coupon', a.coupon, 'crule', a.crule,
    'uses', (select count(*) from public.orders o where o.data -> 'aff' ->> 'id' = a.id and o.data ->> 'coupon' is not null and upper(o.data ->> 'coupon') = upper(a.coupon) and o.status <> 'cancelled')) order by a.created_at)
    from public.affiliates a), '[]'::jsonb);
end $$;

-- owner: set one affiliator's coupon rule, commission and (optionally) coupon name
create or replace function public.admin_aff_crule(p_id text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates; r jsonb := '{}'::jsonb; ty text := coalesce(p ->> 'type', 'percent'); v numeric; ms numeric; mu int; rt numeric; cd text; nm text := upper(btrim(coalesce(p ->> 'coupon', '')));
begin
  perform public.assert_owner();
  select * into a from public.affiliates where id = p_id;
  if a.id is null then perform public.bad('Affiliator not found.'); end if;
  if ty not in ('percent', 'amount', 'freedelivery') then perform public.bad('Unknown coupon type.'); end if;
  begin v := nullif(p ->> 'value', '')::numeric; exception when others then perform public.bad('The discount must be a number.'); end;
  if ty <> 'freedelivery' and (v is null or v < 0 or (ty = 'percent' and v > 100)) then perform public.bad('The discount must be 0 to 100 (%) or an amount.'); end if;
  begin ms := coalesce(nullif(p ->> 'minSpend', '')::numeric, 0); mu := coalesce(nullif(p ->> 'maxUses', '')::int, 0); exception when others then perform public.bad('Minimum spend and uses must be numbers.'); end;
  begin rt := coalesce(nullif(p ->> 'rate', '')::numeric, a.rate); exception when others then perform public.bad('Commission must be a number.'); end;
  if rt < 0 or rt > 90 then perform public.bad('Commission must be from 0 to 90 (%).'); end if;
  r := jsonb_build_object('type', ty, 'value', coalesce(v::text, ''), 'minSpend', greatest(0, ms), 'maxUses', greatest(0, mu),
    'onePerPhone', coalesce((p ->> 'onePerPhone')::boolean, true), 'stack', coalesce((p ->> 'stack')::boolean, false), 'canName', coalesce((p ->> 'canName')::boolean, true),
    'on', coalesce((p ->> 'on')::boolean, true), 'startsAt', left(coalesce(p ->> 'startsAt', ''), 16), 'endsAt', left(coalesce(p ->> 'endsAt', ''), 16), 'desc', left(coalesce(p ->> 'desc', ''), 80));
  cd := upper(coalesce(a.coupon, ''));
  if nm <> '' and nm <> cd then
    if nm !~ '^[A-Z0-9]{3,20}$' then perform public.bad('Coupon name: 3 to 20 letters or numbers, no spaces.'); end if;
    if not public.aff_name_free(a.id, nm) then perform public.bad('That coupon name is already used.'); end if;
    cd := nm;
  end if;
  update public.affiliates set crule = r, rate = rt, coupon = cd, coupon_at = case when cd <> upper(coalesce(a.coupon, '')) then public.now_ms() else a.coupon_at end where id = a.id;
  perform public.aff_sync_coupon(a.id);
  perform public.log_act('Changed affiliator coupon', a.username || ' (' || coalesce(nullif(cd, ''), 'no coupon') || ')');
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.aff_sync_coupon(text), public.aff_name_free(text, text) from public, anon, authenticated;
revoke all on function public.aff_coupon_info(), public.aff_coupon_save(text), public.admin_aff_coupons(), public.admin_aff_crule(text, jsonb) from public, anon;
grant execute on function public.aff_coupon_info(), public.aff_coupon_save(text), public.admin_aff_coupons(), public.admin_aff_crule(text, jsonb) to authenticated;

-- an affiliator who was switched off or paused: the coupon follows their status
create or replace function public.aff_coupon_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then perform public.aff_sync_coupon(new.id); end if;
  return null;
end $$;
create or replace trigger affiliates_coupon_trg after update of status on public.affiliates for each row execute function public.aff_coupon_status();

-- guard: an affiliator without a rule set by the owner keeps the old behaviour (the owner's own coupon of that name, if any). Nothing is created.
do $$ declare d text; begin
  select pg_get_functiondef('public.aff_sync_coupon(text)'::regprocedure) into d;
  if d not like '%no rule set%' then
    d := replace(d, E'  r := coalesce(a.crule, ''{}''::jsonb);\n  d := jsonb_build_object(', E'  r := coalesce(a.crule, ''{}''::jsonb);\n  if coalesce(nullif(r ->> ''value'', ''''), '''') = '''' and coalesce(r ->> ''type'', '''') <> ''freedelivery'' then return; end if;   -- no rule set by the owner\n  d := jsonb_build_object(');
    execute d;
  end if;
end $$;
