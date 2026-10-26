-- Delidome migration 47: reward pool chances are percentages (pct, decimals allowed, e.g. 0.5 = 0.5%).
-- Each item gets its own chance out of 100; what is left over (and the share of items that are out of stock) means "no reward this time".
-- If the percentages add up to more than 100 they are scaled down to fit. Items without a pct share the draw equally.
-- Safe to run more than once.
do $$ declare d text; begin
  select pg_get_functiondef('public.rv_claim(text,text,text)'::regprocedure) into d;
  if d not like '%luck%' then
    d := replace(d, $a$          r := random() * tot;
          for it in select * from jsonb_array_elements(valid) loop acc := acc + greatest(1, coalesce((it ->> 'weight')::numeric, 1)); if r <= acc then pick := it; exit; end if; end loop;
          if pick is null then pick := valid -> 0; end if;$a$,
    $a$          tot := 0;
          for it in select * from jsonb_array_elements(valid) loop tot := tot + greatest(0, coalesce(nullif(it ->> 'pct', '')::numeric, 100.0 / jsonb_array_length(valid))); end loop;
          r := random() * greatest(100, tot); acc := 0;
          for it in select * from jsonb_array_elements(valid) loop
            acc := acc + greatest(0, coalesce(nullif(it ->> 'pct', '')::numeric, 100.0 / jsonb_array_length(valid)));
            if r < acc then pick := it; exit; end if;
          end loop;$a$);
    d := replace(d, $a$        lab := public.rv_label(pick); ph := coalesce(o.phone_norm, '');$a$,
    $a$        if pick is null then rv := jsonb_build_object('st', 'none', 'why', 'luck', 'at', t); else
        lab := public.rv_label(pick); ph := coalesce(o.phone_norm, '');$a$);
    d := replace(d, $a$          rv := jsonb_build_object('st', 'win', 'item', lab, 'code', rc, 'kind', 'gift', 'exp', ex, 'at', t);
        end if;$a$,
    $a$          rv := jsonb_build_object('st', 'win', 'item', lab, 'code', rc, 'kind', 'gift', 'exp', ex, 'at', t);
        end if;
        end if;$a$);
    execute d;
  end if;
end $$;
