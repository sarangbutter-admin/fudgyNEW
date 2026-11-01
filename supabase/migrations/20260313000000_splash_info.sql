-- Delidome migration 72: a tiny public lookup for the loading screen (logo, name, colour), so a brand-new browser or device
-- shows the owner's own logo from the first moment. Only the logo address (https), the shop name, the brand colour and "show name" are returned.
create or replace function public.splash_info() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object(
      'logo', case when coalesce(data ->> 'logo', '') ~ '^https://[^ "''<>\\]+$' then data ->> 'logo' else '' end,
      'name', coalesce(nullif(left(data ->> 'name', 40), ''), 'delidome'),
      'brand', case when coalesce(data ->> 'brand', '') ~ '^#[0-9a-fA-F]{3,8}$' then data ->> 'brand' else '#000096' end,
      'show', coalesce((data ->> 'nameShow')::boolean, true))
    from public.docs where key = 'page'), jsonb_build_object('logo', '', 'name', 'delidome', 'brand', '#000096', 'show', true)) $$;
revoke all on function public.splash_info() from public;
grant execute on function public.splash_info() to anon, authenticated;
