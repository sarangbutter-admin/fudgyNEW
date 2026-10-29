-- Delidome migration 63: admin-only functions are not callable by signed-out visitors (anon).
-- (They already refused non-owners; this removes the permission itself.) Safe to run more than once.
revoke all on function public.admin_aff_join_save(jsonb), public.admin_game_clear(int) from public, anon;
grant execute on function public.admin_aff_join_save(jsonb), public.admin_game_clear(int) to authenticated;
