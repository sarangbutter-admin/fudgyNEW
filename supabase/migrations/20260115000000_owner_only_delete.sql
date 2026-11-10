-- BakeByCulture migration 15: only an owner account can delete flavors, extras, box sizes and categories
-- (staff who know the owner password still can't). Safe to run more than once. Run after migration 14.
do $do$
declare d text := pg_get_functiondef('public.coll_guard()'::regprocedure);
begin
  if position('Only an owner can delete this' in d) = 0 then
    d := replace(d,
      $a$if tg_op = 'DELETE' and c in ('products','categories','sizes','addons') and not public.sudo_ok() then$a$,
      $a$if tg_op = 'DELETE' and c in ('products','categories','sizes','addons') and not public.is_owner() then
    raise exception 'Only an owner can delete this.' using errcode = 'P0001'; end if;
  if tg_op = 'DELETE' and c in ('products','categories','sizes','addons') and not public.sudo_ok() then$a$);
    if position('Only an owner can delete this' in d) = 0 then raise exception 'coll_guard did not match, nothing changed'; end if;
    execute d;
  end if;
end $do$;
