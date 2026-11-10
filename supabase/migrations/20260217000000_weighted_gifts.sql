-- BakeByCulture migration 48: chance (%) for the random gifts of Flash sale "Gifts" promos and of the Pre-launch surprise gift.
-- A gift can have a "pct" (share of the draw, decimals ok, 0.5 = 0.5%). Gifts without one share equally. A gift is always given:
-- the numbers only decide how likely each gift is compared with the others that are still in stock.
-- Safe to run more than once.

-- flash sale: the deterministic (per order) random order of draw_gifts() becomes weighted (Efraimidis-Spirakis: smallest -ln(u)/w comes first)
do $$ declare d text; begin
  select pg_get_functiondef('public.draw_gifts(text,integer,bigint)'::regprocedure) into d;
  if d not like '%pct%' then
    d := replace(d, $a$order by case when md = 'random' then md5(sec || p_id || s.id || coalesce(r ->> 'id', '') || (e.value ->> 'id')) else lpad(e.ord::text, 6, '0') end$a$,
      $a$order by case when md = 'random' then -ln(greatest(1e-12, ((('x' || substr(md5(sec || p_id || s.id || coalesce(r ->> 'id', '') || (e.value ->> 'id')), 1, 13))::bit(52)::bigint)::numeric + 1) / 4503599627370497.0))
                          / greatest(0.0001, coalesce(nullif(e.value ->> 'pct', '')::numeric, 100.0 / greatest(1, jsonb_array_length(ids)))) else 0 end, e.ord$a$);
    execute d;
  end if;
end $$;

-- pre-launch: the pool carries each gift's pct, and the surprise draw uses it
create or replace function public.pre_gift_pool() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'img', x.img, 'stock', x.stock, 'used', x.used, 'pct', x.pct,
           'left', case when x.stock is null then null else greatest(0, x.stock - x.used) end) order by x.n), '[]'::jsonb)
  from (select coalesce(nullif(i.v ->> 'id', ''), 'i' || (i.n - 1)) id, coalesce(i.v ->> 'name', '') name, coalesce(i.v ->> 'img', '') img,
          case when (i.v ->> 'stock') ~ '^[0-9]{1,6}$' then (i.v ->> 'stock')::int end stock, i.n,
          case when (i.v ->> 'pct') ~ '^[0-9]+(\.[0-9]+)?$' then (i.v ->> 'pct')::numeric end pct,
          (select count(*) from public.prelaunch_regs r where r.gift_res @> to_jsonb(coalesce(nullif(i.v ->> 'id', ''), 'i' || (i.n - 1))))::int used
        from jsonb_array_elements(coalesce(public.pre_cfg() -> 'gifts' -> 'items', '[]'::jsonb)) with ordinality i(v, n)
        where btrim(coalesce(i.v ->> 'name', '')) <> '' or coalesce(i.v ->> 'img', '') <> '') x $$;

do $$ declare d text; begin
  select pg_get_functiondef('public.orders_pre_draw()'::regprocedure) into d;
  if d not like '%-ln(%' then
    d := replace(d, $a$if jsonb_array_length(av) > 0 then ids := jsonb_build_array((av -> floor(random() * jsonb_array_length(av))::int) ->> 'id'); end if;$a$,
      $a$if jsonb_array_length(av) > 0 then
      select jsonb_build_array(e ->> 'id') into ids from jsonb_array_elements(av) e
        order by -ln(greatest(1e-12, random())) / greatest(0.0001, coalesce(nullif(e ->> 'pct', '')::numeric, 100.0 / jsonb_array_length(av))) limit 1;
    end if;$a$);
    execute d;
  end if;
end $$;
