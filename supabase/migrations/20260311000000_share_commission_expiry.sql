-- Delidome migration 70: a shared-commission boost can end by itself.
--  * an affiliator chooses how long the boost lasts: no end, 30 min, 1 h, 2 h, 1 day, 3 days, 7 days or 30 days
--  * the owner can set the longest allowed time (private_kv aff_cdef "giveCap" in minutes, 0 = no limit; with a limit, "no end" is not allowed)
--  * an ended boost is switched off on the server at once: expired boosts count as 0 everywhere, and they are cleaned up (the coupon goes back to the default discount)
--    whenever a coupon is checked, an order is placed, or the affiliator opens their coupon. Orders keep the rate they were placed with.
-- Safe to run more than once.
alter table public.affiliates add column if not exists give_until bigint not null default 0;

create or replace function public.aff_expire_gives() returns void
language sql security definer set search_path = public as $$
  update public.affiliates set give = 0, give_until = 0 where give > 0 and give_until > 0 and give_until <= public.now_ms() $$;
revoke all on function public.aff_expire_gives() from public, anon, authenticated;

create or replace function public.aff_give_eff(a public.affiliates) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare d jsonb := public.aff_cdef_vals(); r jsonb := coalesce(a.crule, '{}'::jsonb); ty text; mx numeric;
begin
  if coalesce(a.give, 0) <= 0 or not coalesce((d ->> 'giveOn')::boolean, false) then return 0; end if;
  if coalesce(a.give_until, 0) > 0 and a.give_until <= public.now_ms() then return 0; end if;
  ty := case when coalesce(nullif(r ->> 'value', ''), '') <> '' or r ->> 'type' = 'freedelivery' then r ->> 'type' else coalesce(d ->> 'type', 'percent') end;
  if ty is distinct from 'percent' then return 0; end if;
  mx := a.rate * (100 - coalesce(nullif(d ->> 'giveKeep', '')::numeric, 50)) / 100;
  return greatest(0, least(a.give, mx));
end $$;

create or replace function public.aff_coupon_info() returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates; r jsonb; d jsonb; g numeric; ty text; mx numeric;
begin
  perform public.aff_expire_gives();
  a := public.aff_self();
  if a.id is null or a.status = 'disabled' then return jsonb_build_object('ok', false); end if;
  r := public.aff_rule_eff(a); d := public.aff_cdef_vals(); g := public.aff_give_eff(a); ty := coalesce(nullif(r ->> 'type', ''), 'percent');
  mx := case when coalesce((d ->> 'giveOn')::boolean, false) and ty = 'percent' and r <> '{}'::jsonb then greatest(0, floor(a.rate * (100 - coalesce(nullif(d ->> 'giveKeep', '')::numeric, 50)) / 100 * 2) / 2) else 0 end;
  return jsonb_build_object('ok', true, 'coupon', a.coupon, 'rate', a.rate, 'canName', coalesce((r ->> 'canName')::boolean, true),
    'ready', r <> '{}'::jsonb,
    'type', ty, 'value', coalesce(nullif(r ->> 'value', '')::numeric, 0), 'minSpend', coalesce(nullif(r ->> 'minSpend', '')::numeric, 0),
    'stack', coalesce((r ->> 'stack')::boolean, false), 'endsAt', coalesce(r ->> 'endsAt', ''), 'changedAt', a.coupon_at,
    'giveMax', mx, 'give', g, 'giveUntil', case when g > 0 then coalesce(a.give_until, 0) else 0 end, 'giveCap', coalesce(nullif(d ->> 'giveCap', '')::int, 0),
    'baseValue', case when ty = 'percent' then coalesce(nullif(r ->> 'value', '')::numeric, 0) - g else 0 end);
end $$;

-- affiliator: choose how much to give and for how long (p_mins: 0 = no end)
create or replace function public.aff_give_set(p_give numeric, p_mins integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates; info jsonb; mx numeric; v numeric; cap int; m int := coalesce(p_mins, 0);
begin
  perform public.aff_expire_gives();
  a := public.aff_self();
  if a.id is null or a.status = 'disabled' then perform public.bad('Please sign in again.'); end if;
  if m not in (0, 30, 60, 120, 1440, 4320, 10080, 43200) then perform public.bad('Please choose how long it lasts.'); end if;
  info := public.aff_coupon_info();
  mx := coalesce((info ->> 'giveMax')::numeric, 0);
  cap := coalesce((info ->> 'giveCap')::int, 0);
  if p_give is null or p_give < 0 or p_give > mx then perform public.bad('Choose a number from 0 to ' || trim(trailing '.' from trim(trailing '0' from mx::text)) || '.'); end if;
  if not public.throttle_ok('affgive:' || a.id, 20, 3600000) then perform public.bad('Too many changes. Please try again later.'); end if;
  v := round(p_give * 2) / 2;
  if v > 0 and cap > 0 and (m = 0 or m > cap) then perform public.bad('The longest boost is ' || case when cap >= 1440 then (cap / 1440)::text || ' day(s)' when cap >= 60 then (cap / 60)::text || ' hour(s)' else cap::text || ' minutes' end || '. Please choose a shorter time.'); end if;
  update public.affiliates set give = v, give_until = case when v > 0 and m > 0 then public.now_ms() + m::bigint * 60000 else 0 end where id = a.id;
  return public.aff_coupon_info();
end $$;
revoke all on function public.aff_give_set(numeric, integer) from public, anon;
grant execute on function public.aff_give_set(numeric, integer) to authenticated;

-- the owner's longest allowed boost (giveCap, minutes) is kept with the other defaults
do $$ declare d text; begin
  select pg_get_functiondef('public.admin_aff_cdef(jsonb)'::regprocedure) into d;
  if d not like '%giveCap%' then
    d := replace(d, $a$'giveKeep', gk);$a$, $a$'giveKeep', gk, 'giveCap', greatest(0, coalesce(nullif(p ->> 'giveCap', '')::int, 0)));$a$);
    execute d;
  end if;
  -- clean up expired boosts before a coupon is checked or an order is placed
  for d in select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('check_coupon', 'place_order') loop
    if d not like '%aff_expire_gives%' then
      d := regexp_replace(d, E'\nbegin\n', E'\nbegin\n  perform public.aff_expire_gives();\n');
      execute d;
    end if;
  end loop;
end $$;
