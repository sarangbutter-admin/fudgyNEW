-- BakeByCulture migration 25: gift rules per box size, drawn when the payment proof is sent.
--  * a gifts promo now has a pool (sale.gifts: id, name, img, stock - blank = unlimited) and rules (sale.rules: from, to, limit, mode specific|random, ids)
--  * the gifts are chosen when the customer sends the payment proof (submit_proof), once per order; random picks can't be rerolled
--  * the gift only counts once the owner confirms the payment (labels already need a paid order)
--  * stock is reserved when a gift is drawn and given back if the order is cancelled
-- Safe to run more than once. Run after migration 24. Old-format gift promos (no rules) simply stop giving gifts; make a new one.

create table if not exists public.gift_use (
  promo text not null, gift text not null, used int not null default 0,
  primary key (promo, gift)
);
alter table public.gift_use enable row level security;     -- no policies: only the server functions touch it

create or replace function public.gift_rule(p_rules jsonb, p_n int) returns jsonb
language sql immutable set search_path = public as $$
  select r from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) r
  where coalesce(nullif(r ->> 'from', '')::int, 0) <= p_n and p_n <= coalesce(nullif(r ->> 'to', '')::int, 0) limit 1
$$;

-- gives reserved stock back
create or replace function public.gift_release(p_gifts jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare g jsonb;
begin
  for g in select value from jsonb_array_elements(case when jsonb_typeof(p_gifts) = 'array' then p_gifts else '[]'::jsonb end) loop
    continue when not coalesce((g ->> 'reserved')::boolean, false);
    update public.gift_use set used = greatest(0, used - 1) where promo = g ->> 'promoId' and gift = g ->> 'id';
  end loop;
end $$;

-- the gifts a box of p_n cookies earns for this order. Specific rules give the ticked gifts, random rules pick
-- (limit) of the ticked gifts in an order only the server can work out, so refreshing or changing things can't reroll.
create or replace function public.draw_gifts(p_id text, p_n int, p_at bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; r jsonb; g jsonb; res jsonb := '[]'::jsonb; sec text; lim int; md text; ids jsonb; cnt int; resv boolean;
begin
  sec := coalesce((select data ->> 'v' from public.private_kv where key = 'quote_secret'), '');
  for s in select c.id, c.data from public.coll c
           where c.coll = 'sales' and c.data ->> 'type' = 'gifts'
             and (c.data ->> 'start')::bigint <= p_at and p_at < (c.data ->> 'end')::bigint
           order by c.id loop
    r := public.gift_rule(s.data -> 'rules', p_n);
    continue when r is null;
    lim := greatest(1, least(5, coalesce(nullif(r ->> 'limit', '')::numeric, 1)::int));
    md := case when r ->> 'mode' = 'random' then 'random' else 'specific' end;
    ids := coalesce(r -> 'ids', '[]'::jsonb);
    cnt := 0;
    for g in
      select e.value from jsonb_array_elements(coalesce(s.data -> 'gifts', '[]'::jsonb)) with ordinality as e(value, ord)
      where btrim(coalesce(e.value ->> 'name', '')) <> '' and ids @> to_jsonb(e.value ->> 'id')
        and (coalesce(e.value ->> 'stock', '') = ''
             or coalesce((select u.used from public.gift_use u where u.promo = s.id and u.gift = e.value ->> 'id'), 0) < (e.value ->> 'stock')::numeric)
      order by case when md = 'random' then md5(sec || p_id || s.id || coalesce(r ->> 'id', '') || (e.value ->> 'id')) else lpad(e.ord::text, 6, '0') end
    loop
      exit when cnt >= lim;
      resv := false;
      if coalesce(g ->> 'stock', '') <> '' then
        insert into public.gift_use (promo, gift, used) values (s.id, g ->> 'id', 0) on conflict do nothing;
        update public.gift_use set used = used + 1 where promo = s.id and gift = g ->> 'id' and used < (g ->> 'stock')::numeric;
        continue when not found;
        resv := true;
      end if;
      res := res || jsonb_build_array(jsonb_build_object('id', g ->> 'id', 'name', left(g ->> 'name', 40), 'promo', s.data ->> 'name',
                                                         'promoId', s.id, 'random', md = 'random', 'reserved', resv));
      cnt := cnt + 1;
    end loop;
  end loop;
  return res;
end $$;
revoke all on function public.gift_rule(jsonb, int), public.gift_release(jsonb), public.draw_gifts(text, int, bigint) from public, anon, authenticated;

-- a cancelled order gives its reserved gifts back (and loses them; a reopened order is drawn again when its proof is sent)
create or replace function public.orders_gift_release() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.data ->> 'status') = 'cancelled' and (old.data ->> 'status') is distinct from 'cancelled' and new.data ? 'giftsAt' then
    perform public.gift_release(new.data -> 'gifts');
    new.data := (new.data - 'giftsAt') || jsonb_build_object('gifts', '[]'::jsonb);
  end if;
  return new;
end $$;
revoke all on function public.orders_gift_release() from public, anon, authenticated;
create or replace trigger orders_gift_release_trg before update on public.orders
  for each row execute function public.orders_gift_release();

-- the customer sends the payment proof: the gifts are drawn now (once per order)
create or replace function public.submit_proof(p_id text, p_token text, p_name text, p_img text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; t bigint := public.now_ms(); nm text := btrim(coalesce(p_name, '')); ms jsonb := '[]'::jsonb; ch text; msg text; d jsonb;
begin
  if not public.owns(p_id, p_token) then perform public.bad('We couldn''t find that order.'); end if;
  if length(nm) < 2 or length(nm) > 80 then perform public.bad('Please enter the name on the payment.'); end if;
  if not public.valid_img(p_img) then perform public.bad('Please attach a photo or screenshot (JPG, PNG or WebP, under 1 MB).'); end if;
  if not public.throttle_ok('proof:' || p_id, 8, 3600000) then perform public.bad('Too many tries. Please wait a while.'); end if;
  select * into o from public.orders where id = p_id for update;
  if o.status <> 'awaiting' then perform public.bad('This order is no longer waiting for payment.'); end if;
  insert into public.order_files (order_id, kind, idx, data, at) values (p_id, 'proof', 0, p_img, t)
    on conflict (order_id, kind, idx) do update set data = excluded.data, at = excluded.at;
  msg := 'Hi ' || coalesce(nullif(split_part(o.data #>> '{customer,name}', ' ', 1), ''), 'there') || ', we got your payment proof for order ' || (o.data ->> 'code') || ' and we''re checking it now.';
  for ch in select unnest(case coalesce(o.data ->> 'notify', 'both') when 'both' then array['whatsapp','email'] when 'none' then array[]::text[] else array[o.data ->> 'notify'] end) loop
    ms := ms || jsonb_build_array(jsonb_build_object('at', t, 'channel', ch, 'status', 'review', 'text', msg, 'by', 'system'));
  end loop;
  d := (o.data - 'rejected') || jsonb_build_object('status', 'review', 'proof', jsonb_build_object('name', nm, 'at', t, 'img', ''),
         'msgs', coalesce(o.data -> 'msgs', '[]'::jsonb) || ms);
  if not (o.data ? 'giftsAt') then
    d := d || jsonb_build_object('gifts', public.draw_gifts(p_id, coalesce((o.data ->> 'size')::int, 0), t), 'giftsAt', t);
  end if;
  update public.orders set data = d where id = p_id;
  return d;
end $$;

-- the owner's gift stock counter (used so far per promo and gift)
create or replace function public.admin_gift_used() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return coalesce((select jsonb_object_agg(promo, m) from (select promo, jsonb_object_agg(gift, used) m from public.gift_use group by promo) x), '{}'::jsonb);
end $$;
revoke all on function public.admin_gift_used() from public, anon;
grant execute on function public.admin_gift_used() to authenticated;

-- place_order: no gifts at checkout any more (they are drawn when the proof is sent). Editing an order keeps its draw while the box size stays the same.
do $$
declare d text; d0 text;
begin
  d0 := pg_get_functiondef('public.place_order(jsonb)'::regprocedure); d := d0;
  d := regexp_replace(d, 'if edit_id is not null and eo\.data \? ''gifts''.*?end if;',
    'if edit_id is not null and coalesce((eo.data ->> ''size'')::int, -1) = v_size then gifts := coalesce(eo.data -> ''gifts'', ''[]''::jsonb); else gifts := ''[]''::jsonb; end if;', 's');
  d := regexp_replace(d, 'update public\.orders set data = od where id = edit_id;',
    'if jsonb_array_length(gifts) = 0 and (eo.data ? ''giftsAt'') then perform public.gift_release(eo.data -> ''gifts''); od := od - ''giftsAt''; end if; update public.orders set data = od where id = edit_id;');
  if d = d0 then raise exception 'place_order patch did not apply'; end if;
  if position('giftsAt' in d) = 0 then raise exception 'place_order edit patch did not apply'; end if;
  if position('gifts_for' in d) > 0 then raise exception 'place_order still draws gifts at checkout'; end if;
  execute d;
end $$;
