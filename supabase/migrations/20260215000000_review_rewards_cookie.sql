-- Delidome migration 46: review rewards can give a cookie / flavor straight from the menu (type 'cookie', pool item has pid)
-- It must be on sale and in stock to be drawn; its name and picture come from the menu. Safe to run more than once.

create or replace function public.rv_item_ok(it jsonb, cfg jsonb) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare t bigint := public.now_ms(); c jsonb; en bigint; st bigint; need bigint := public.now_ms() + coalesce((cfg ->> 'validDays')::int, 7) * 86400000::bigint; stock int; used int; un bigint;
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
  un := nullif(it ->> 'until', '')::bigint;
  if un is not null and un < need then return false; end if;
  stock := case when (it ->> 'stock') ~ '^[0-9]{1,6}$' then (it ->> 'stock')::int end;
  if stock is null then return true; end if;
  select count(*) into used from public.review_rewards r where r.item ->> 'id' = it ->> 'id' and (r.used_order is not null or coalesce(r.exp, 0) > t);
  return stock - used > 0;
end $$;

create or replace function public.rv_label(it jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c jsonb; nm text;
begin
  if it ->> 'type' = 'coupon' then
    select data into c from public.coll where coll = 'coupons' and data ->> 'code' = upper(coalesce(it ->> 'code', '')) limit 1;
    nm := coalesce(nullif(btrim(it ->> 'name'), ''), case c ->> 'type' when 'percent' then (c ->> 'value') || '% off your box' when 'amount' then public.money_txt((c ->> 'value')::numeric) || ' off your box' else 'Free delivery' end);
  elsif it ->> 'type' = 'cookie' then
    select data into c from public.coll where coll = 'products' and id = it ->> 'pid';
    nm := coalesce(nullif(btrim(c ->> 'name'), ''), nullif(btrim(it ->> 'name'), ''), 'Free cookie');
    return jsonb_build_object('id', it ->> 'id', 'type', 'cookie', 'name', left(nm, 60), 'img', coalesce(nullif(c ->> 'img', ''), it ->> 'img', ''), 'pid', it ->> 'pid');
  else nm := coalesce(nullif(btrim(it ->> 'name'), ''), 'Surprise gift'); end if;
  return jsonb_build_object('id', it ->> 'id', 'type', it ->> 'type', 'name', left(nm, 60), 'img', coalesce(it ->> 'img', ''));
end $$;

-- the pool item's icon (emoji) and the cookie's id travel with the reward so the shop can show them
do $$ declare f text; d text; begin
  foreach f in array array['public.rv_gift_check(text,text)', 'public.rv_gift_claim(public.orders,text)', 'public.rv_label(jsonb)'] loop
    select pg_get_functiondef(f::regprocedure) into d;
    d := replace(d, $a$jsonb_build_object('name', r.item ->> 'name', 'img', coalesce(r.item ->> 'img', ''))$a$,
                    $a$jsonb_build_object('name', r.item ->> 'name', 'img', coalesce(r.item ->> 'img', ''), 'pid', r.item ->> 'pid', 'icon', coalesce(r.item ->> 'icon', ''))$a$);
    d := replace(d, $a$'name', left(nm, 60), 'img', coalesce(it ->> 'img', ''));$a$,
                    $a$'name', left(nm, 60), 'img', coalesce(it ->> 'img', ''), 'icon', coalesce(it ->> 'icon', ''));$a$);
    execute d;
  end loop;
end $$;
