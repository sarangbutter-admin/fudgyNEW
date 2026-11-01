-- Delidome migration 71: changing only the slider keeps the end time of a running boost (p_mins = null keeps it).
create or replace function public.aff_give_set(p_give numeric, p_mins integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.affiliates; info jsonb; mx numeric; v numeric; cap int; m int := coalesce(p_mins, -1); until_ms bigint;
begin
  perform public.aff_expire_gives();
  a := public.aff_self();
  if a.id is null or a.status = 'disabled' then perform public.bad('Please sign in again.'); end if;
  if m not in (-1, 0, 30, 60, 120, 1440, 4320, 10080, 43200) then perform public.bad('Please choose how long it lasts.'); end if;
  info := public.aff_coupon_info();
  mx := coalesce((info ->> 'giveMax')::numeric, 0);
  cap := coalesce((info ->> 'giveCap')::int, 0);
  if p_give is null or p_give < 0 or p_give > mx then perform public.bad('Choose a number from 0 to ' || trim(trailing '.' from trim(trailing '0' from mx::text)) || '.'); end if;
  if not public.throttle_ok('affgive:' || a.id, 20, 3600000) then perform public.bad('Too many changes. Please try again later.'); end if;
  v := round(p_give * 2) / 2;
  until_ms := case when v <= 0 then 0 when m > 0 then public.now_ms() + m::bigint * 60000 when m = 0 then 0 else coalesce(a.give_until, 0) end;
  if v > 0 and cap > 0 and (until_ms = 0 or until_ms > public.now_ms() + cap::bigint * 60000 + 1000) then
    perform public.bad('The longest boost is ' || case when cap >= 1440 then (cap / 1440)::text || ' day(s)' when cap >= 60 then (cap / 60)::text || ' hour(s)' else cap::text || ' minutes' end || '. Please choose a shorter time.'); end if;
  update public.affiliates set give = v, give_until = until_ms where id = a.id;
  return public.aff_coupon_info();
end $$;
revoke all on function public.aff_give_set(numeric, integer) from public, anon;
grant execute on function public.aff_give_set(numeric, integer) to authenticated;
