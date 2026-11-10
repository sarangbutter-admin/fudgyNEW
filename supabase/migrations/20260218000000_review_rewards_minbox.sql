-- BakeByCulture migration 49: a review-reward gift code can only be used on a box of at least "claimMin" (revrew doc, default 6).
-- Bigger boxes and custom boxes are fine. Safe to run more than once.
do $$ declare d text; begin
  select pg_get_functiondef('public.rv_gift_claim(public.orders,text)'::regprocedure) into d;
  if d not like '%needs a box of%' then
    d := replace(d, $a$  if r.exp is not null and r.exp < t then return jsonb_build_object('ok', false, 'err', 'This reward code has expired.'); end if;$a$,
      $a$  if r.exp is not null and r.exp < t then return jsonb_build_object('ok', false, 'err', 'This reward code has expired.'); end if;
  if coalesce((o.data ->> 'size')::int, 0) < greatest(1, coalesce(nullif(public.rv_cfg() ->> 'claimMin', '')::numeric::int, 6)) then
    return jsonb_build_object('ok', false, 'err', 'This reward needs a box of ' || greatest(1, coalesce(nullif(public.rv_cfg() ->> 'claimMin', '')::numeric::int, 6)) || ' or more.');
  end if;$a$);
    execute d;
  end if;
end $$;
