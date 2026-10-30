-- Delidome migration 65: default coupon code for every affiliator + "share my commission" (sacrifice mode).
--  * every new affiliator gets a coupon code made from their username (SARI, or SARI2 if taken); they can still change it. Existing affiliators without one get one too.
--  * the owner can switch on "share my commission" and sets the least share of the commission an affiliator must keep (default 50%; only for percent coupons)
--  * an affiliator who gives X points: their customers get the default discount + X on the coupon, and their commission on orders that use the coupon is the rate - X
--    (orders that come from their link without the coupon still earn the full rate). The rate is saved on each order when it is placed, so old orders never change.
-- Safe to run more than once.

alter table public.affiliates add column if not exists give numeric not null default 0;

create or replace function public.aff_cdef_vals() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('giveOn', false, 'giveKeep', 50) || coalesce((select data from public.private_kv where key = 'aff_cdef'),
    jsonb_build_object('type', 'percent', 'value', '', 'minSpend', 0, 'maxUses', 0, 'onePerPhone', true, 'stack', false, 'endsAt', '')) $$;

-- points this affiliator really gives away right now (0 when the mode is off, the coupon is not a percent coupon, or the owner's limit is lower)
create or replace function public.aff_give_eff(a public.affiliates) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare d jsonb := public.aff_cdef_vals(); r jsonb := coalesce(a.crule, '{}'::jsonb); ty text; mx numeric;
begin
  if coalesce(a.give, 0) <= 0 or not coalesce((d ->> 'giveOn')::boolean, false) then return 0; end if;
  ty := case when coalesce(nullif(r ->> 'value', ''), '') <> '' or r ->> 'type' = 'freedelivery' then r ->> 'type' else coalesce(d ->> 'type', 'percent') end;
  if ty is distinct from 'percent' then return 0; end if;
  mx := a.rate * (100 - coalesce(nullif(d ->> 'giveKeep', '')::numeric, 50)) / 100;
  return greatest(0, least(a.give, mx));
end $$;

create or replace function public.aff_rule_eff(a public.affiliates) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := coalesce(a.crule, '{}'::jsonb); d jsonb := public.aff_cdef_vals(); o jsonb; g numeric := public.aff_give_eff(a);
begin
  if coalesce(nullif(r ->> 'value', ''), '') <> '' or r ->> 'type' = 'freedelivery' then o := r;
  elsif coalesce(nullif(d ->> 'value', ''), '') <> '' or d ->> 'type' = 'freedelivery' then
    o := d || jsonb_build_object('canName', coalesce(r -> 'canName', 'true'::jsonb), 'on', coalesce(r -> 'on', 'true'::jsonb), 'desc', coalesce(r -> 'desc', '""'::jsonb));
  else return '{}'::jsonb;
  end if;
  if g > 0 and o ->> 'type' = 'percent' then o := o || jsonb_build_object('value', least(100, (o ->> 'value')::numeric + g)::text); end if;
  return o;
end $$;

-- an order with an affiliator's coupon is theirs; what they gave away comes off the commission of that order
create or replace function public.orders_aff() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.affiliates; cp text := upper(btrim(coalesce(new.data ->> 'coupon', ''))); g numeric;
begin
  if cp = '' or new.data ? 'aff' then return new; end if;
  select * into a from public.affiliates where upper(coupon) = cp and coupon <> '' and status = 'active' limit 1;
  if a.id is null or (a.phone_norm <> '' and a.phone_norm = coalesce(new.phone_norm, '')) then return new; end if;
  g := public.aff_give_eff(a);
  new.data := new.data || jsonb_build_object('aff', jsonb_build_object('id', a.id, 'code', a.code, 'src', 'coupon', 'via', 'coupon', 'rate', greatest(0, a.rate - g), 'give', g, 'at', public.now_ms()));
  return new;
end $$;

-- affiliator: my coupon, what customers get, and what I give away
create or replace function public.aff_coupon_info() returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates := public.aff_self(); r jsonb; d jsonb; g numeric; ty text; mx numeric;
begin
  if a.id is null or a.status = 'disabled' then return jsonb_build_object('ok', false); end if;
  r := public.aff_rule_eff(a); d := public.aff_cdef_vals(); g := public.aff_give_eff(a); ty := coalesce(nullif(r ->> 'type', ''), 'percent');
  mx := case when coalesce((d ->> 'giveOn')::boolean, false) and ty = 'percent' and r <> '{}'::jsonb then greatest(0, floor(a.rate * (100 - coalesce(nullif(d ->> 'giveKeep', '')::numeric, 50)) / 100 * 2) / 2) else 0 end;
  return jsonb_build_object('ok', true, 'coupon', a.coupon, 'rate', a.rate, 'canName', coalesce((r ->> 'canName')::boolean, true),
    'ready', r <> '{}'::jsonb,
    'type', ty, 'value', coalesce(nullif(r ->> 'value', '')::numeric, 0), 'minSpend', coalesce(nullif(r ->> 'minSpend', '')::numeric, 0),
    'stack', coalesce((r ->> 'stack')::boolean, false), 'endsAt', coalesce(r ->> 'endsAt', ''), 'changedAt', a.coupon_at,
    'giveMax', mx, 'give', g, 'baseValue', case when ty = 'percent' then coalesce(nullif(r ->> 'value', '')::numeric, 0) - g else 0 end);
end $$;

-- affiliator: choose how many percent points of my commission I give to my customers (0 = none)
create or replace function public.aff_give_save(p_give numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates := public.aff_self(); info jsonb; mx numeric; v numeric;
begin
  if a.id is null or a.status = 'disabled' then perform public.bad('Please sign in again.'); end if;
  info := public.aff_coupon_info();
  mx := coalesce((info ->> 'giveMax')::numeric, 0);
  if mx <= 0 then perform public.bad('Sharing your commission is not available right now.'); end if;
  if not public.throttle_ok('affgive:' || a.id, 20, 3600000) then perform public.bad('Too many changes. Please try again later.'); end if;
  if p_give is null or p_give < 0 or p_give > mx then perform public.bad('Choose a number from 0 to ' || trim(trailing '.' from trim(trailing '0' from mx::text)) || '.'); end if;
  v := round(p_give * 2) / 2;
  update public.affiliates set give = v where id = a.id;
  return public.aff_coupon_info();
end $$;

-- owner: read (no argument) or save the default discount + the share-commission switch
create or replace function public.admin_aff_cdef(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ty text; v numeric; ms numeric; mu int; r jsonb; x record; n int := 0; gk numeric;
begin
  perform public.assert_owner();
  if p is null or p = '{}'::jsonb then return public.aff_cdef_vals(); end if;
  ty := coalesce(p ->> 'type', 'percent');
  if ty not in ('percent', 'amount', 'freedelivery') then perform public.bad('Unknown coupon type.'); end if;
  begin v := nullif(p ->> 'value', '')::numeric; exception when others then perform public.bad('The discount must be a number.'); end;
  if ty <> 'freedelivery' and (v is null or v <= 0 or (ty = 'percent' and v > 100)) then perform public.bad('The discount must be more than 0, and 100 (%) at most.'); end if;
  begin ms := coalesce(nullif(p ->> 'minSpend', '')::numeric, 0); mu := coalesce(nullif(p ->> 'maxUses', '')::int, 0); exception when others then perform public.bad('Minimum order and uses must be numbers.'); end;
  begin gk := coalesce(nullif(p ->> 'giveKeep', '')::numeric, 50); exception when others then perform public.bad('The share an affiliator keeps must be a number.'); end;
  if gk < 0 or gk > 100 then perform public.bad('The share an affiliator keeps must be from 0 to 100 (%).'); end if;
  r := jsonb_build_object('type', ty, 'value', case when ty = 'freedelivery' then '' else v::text end, 'minSpend', greatest(0, ms), 'maxUses', greatest(0, mu),
    'onePerPhone', coalesce((p ->> 'onePerPhone')::boolean, true), 'stack', coalesce((p ->> 'stack')::boolean, false), 'endsAt', left(coalesce(p ->> 'endsAt', ''), 16),
    'giveOn', coalesce((p ->> 'giveOn')::boolean, false), 'giveKeep', gk);
  insert into public.private_kv (key, data, updated_at) values ('aff_cdef', r, public.now_ms())
    on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
  if coalesce((p ->> 'all')::boolean, false) then
    update public.affiliates set crule = coalesce(crule, '{}'::jsonb) - 'type' - 'value' - 'minSpend' - 'maxUses' - 'startsAt' - 'endsAt' - 'onePerPhone' - 'stack' where true;
  end if;
  for x in select id from public.affiliates where coalesce(coupon, '') <> '' loop perform public.aff_sync_coupon(x.id); n := n + 1; end loop;
  perform public.log_act('Affiliate coupon default changed', case ty when 'percent' then v::text || '%' when 'amount' then 'amount ' || v::text else 'free delivery' end
    || ' · share commission ' || case when coalesce((p ->> 'giveOn')::boolean, false) then 'keeps at least ' || gk::text || '%' else 'off' end || ' · ' || n || ' coupons updated');
  return public.aff_cdef_vals();
end $$;

-- default coupon code: the username in capitals (3 to 16 letters/numbers), with a number added if it is taken
create or replace function public.aff_default_name(p_id text, p_username text) returns text
language plpgsql stable security definer set search_path = public as $$
declare b text := upper(left(regexp_replace(coalesce(p_username, ''), '[^A-Za-z0-9]', '', 'g'), 16)); c text; i int := 1;
begin
  if length(b) < 3 then b := rpad(b, 3, 'X'); end if;
  c := b;
  while not public.aff_name_free(p_id, c) and i < 500 loop i := i + 1; c := b || i::text; end loop;
  return c;
end $$;

create or replace function public.affiliates_default_coupon() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(btrim(new.coupon), '') = '' then new.coupon := public.aff_default_name(new.id, new.username); end if;
  return new;
end $$;
create or replace trigger affiliates_default_coupon_trg before insert on public.affiliates for each row execute function public.affiliates_default_coupon();

-- keep the coupons list in step whenever an affiliator is added or their coupon / commission / status / sharing changes
create or replace function public.affiliates_sync_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.aff_sync_coupon(new.id);
  return null;
end $$;
create or replace trigger affiliates_sync_trg after insert or update of coupon, rate, status, give on public.affiliates for each row execute function public.affiliates_sync_trg();

revoke all on function public.aff_give_eff(public.affiliates), public.aff_default_name(text, text), public.affiliates_default_coupon(), public.affiliates_sync_trg() from public, anon, authenticated;
revoke all on function public.aff_give_save(numeric) from public, anon;
grant execute on function public.aff_give_save(numeric) to authenticated;
revoke all on function public.aff_coupon_info(), public.admin_aff_cdef(jsonb) from public, anon;
grant execute on function public.aff_coupon_info(), public.admin_aff_cdef(jsonb) to authenticated;

-- affiliators who have no coupon yet get the default one
do $$ declare x record; begin
  for x in select id, username from public.affiliates where coalesce(btrim(coupon), '') = '' loop
    update public.affiliates set coupon = public.aff_default_name(x.id, x.username) where id = x.id;
  end loop;
end $$;
