-- Delidome migration 51: review rewards all share ONE validity rule.
--  * cookie and gift rewards: the code is valid "redeemDays" days from the win (revrew doc, default 30)
--  * coupon rewards: the coupon's own end date (shown to the customer)
--  * a coupon is not drawn when it ends sooner than "validDays" days from now (revrew doc, default 7), when it is off, not started, or used up
--  * cookies and gifts are never skipped because of a date; a sold-out item is left out
--  * the old per-gift "until" date is no longer used
-- Safe to run more than once.

create or replace function public.rv_item_ok(it jsonb, cfg jsonb) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare t bigint := public.now_ms(); c jsonb; en bigint; st bigint; stock int; used int; need bigint := public.now_ms() + greatest(0, coalesce(nullif(cfg ->> 'validDays', '')::numeric::int, 7)) * 86400000::bigint;
begin
  if it ->> 'type' = 'coupon' then
    select data into c from public.coll where coll = 'coupons' and data ->> 'code' = upper(coalesce(it ->> 'code', '')) limit 1;
    if c is null or not coalesce((c ->> 'on')::boolean, false) then return false; end if;
    en := public.cp_ms(c ->> 'endsAt'); st := public.cp_ms(c ->> 'startsAt');
    if en is not null and en < need then return false; end if;
    if st is not null and st > t then return false; end if;
    if coalesce((c ->> 'maxUses')::int, 0) > 0 and public.cp_uses(upper(it ->> 'code'), null) >= (c ->> 'maxUses')::int then return false; end if;
    return true;
  end if;
  if it ->> 'type' = 'cookie' then                                         -- a flavor from the menu: needs to be on sale and in stock
    select data into c from public.coll where coll = 'products' and id = it ->> 'pid';
    if c is null or coalesce(c ->> 'status', '') <> 'available' then return false; end if;
    if coalesce((c ->> 'track')::boolean, false) then
      select count(*) into used from public.review_rewards r where r.item ->> 'id' = it ->> 'id' and (r.used_order is null and coalesce(r.exp, 0) > t);
      return coalesce((c ->> 'stock')::int, 0) - used > 0;
    end if;
    return true;
  end if;
  stock := case when (it ->> 'stock') ~ '^[0-9]{1,6}$' then (it ->> 'stock')::int end;
  if stock is null then return true; end if;
  select count(*) into used from public.review_rewards r where r.item ->> 'id' = it ->> 'id' and (r.used_order is not null or coalesce(r.exp, 0) > t);
  return stock - used > 0;
end $$;

do $$ declare d text; begin
  select pg_get_functiondef('public.rv_claim(text,text,text)'::regprocedure) into d;
  if d not like '%cp_ms(%endsAt%' then
    d := replace(d, $a$'code', upper(pick ->> 'code'), 'kind', 'coupon', 'at', t);$a$,
      $a$'code', upper(pick ->> 'code'), 'kind', 'coupon', 'at', t,
            'exp', public.cp_ms((select c2.data ->> 'endsAt' from public.coll c2 where c2.coll = 'coupons' and c2.data ->> 'code' = upper(pick ->> 'code') limit 1)));$a$);
    execute d;
  end if;
end $$;
