-- Delidome migration 36: money in messages is written the Rupiah way (rounded up, no decimals, 20.000) when the currency is Rp.
create or replace function public.money_txt(v numeric) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(public.cfg() ->> 'currency', '$') ||
    case when coalesce(public.cfg() ->> 'currency', '$') ~* '^rp' then replace(to_char(ceil(round(v, 2)), 'FM999,999,999,990'), ',', '.')
         else to_char(round(v, 2), 'FM999999990.00') end $$;
