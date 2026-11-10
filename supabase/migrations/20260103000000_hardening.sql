-- BakeByCulture migration 3: tighten permissions (from the Supabase security check). Safe to run more than once.

-- Supabase gives new functions to the public "anon" role by default.
-- Team functions already refuse anyone not signed in, but now visitors can't even call them.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'admin\_%' or p.proname in ('is_admin','is_owner','assert_admin','assert_owner','admin_role'))
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;

-- small helper functions: pin their search_path
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('valid_img','bad','now_ms','norm_phone','tok_hash','new_token','orders_sync')
  loop
    execute format('alter function %s set search_path = public, extensions', f.sig);
  end loop;
end $$;
