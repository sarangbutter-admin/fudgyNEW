-- BakeByCulture migration 19: optional Google Maps key for "Find my address on the map" (Biteship courier delivery).
-- Safe to run more than once. Run after migration 18.

create or replace function public.admin_biteship_get() returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text; c jsonb; w text; g text;
begin
  perform public.assert_owner();
  select data ->> 'v' into k from public.private_kv where key = 'biteship_key';
  select data into c from public.private_kv where key = 'biteship_cfg';
  select data ->> 'v' into w from public.private_kv where key = 'webhook_secret';
  select data ->> 'v' into g from public.private_kv where key = 'google_key';
  return jsonb_build_object('hasKey', k is not null and k <> '',
    'mode', case when k like 'biteship\_test%' then 'test' when k like 'biteship\_live%' then 'live' when k is null then '' else 'unknown' end,
    'cfg', coalesce(c, '{}'::jsonb), 'webhookSecret', coalesce(w, ''), 'hasGoogle', g is not null and g <> '');
end $$;

create or replace function public.admin_biteship_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_owner();
  if length(p::text) > 30000 then perform public.bad('That is too large.'); end if;
  if p ? 'key' then
    if btrim(coalesce(p ->> 'key', '')) = '' then delete from public.private_kv where key = 'biteship_key';
    else
      if length(btrim(p ->> 'key')) < 20 or length(btrim(p ->> 'key')) > 400 then perform public.bad('That does not look like a Biteship API key.'); end if;
      insert into public.private_kv (key, data, updated_at) values ('biteship_key', jsonb_build_object('v', btrim(p ->> 'key')), public.now_ms())
        on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
    end if;
  end if;
  if p ? 'gkey' then
    if btrim(coalesce(p ->> 'gkey', '')) = '' then delete from public.private_kv where key = 'google_key';
    else
      if btrim(p ->> 'gkey') !~ '^[A-Za-z0-9_-]{30,60}$' then perform public.bad('That does not look like a Google Maps API key.'); end if;
      insert into public.private_kv (key, data, updated_at) values ('google_key', jsonb_build_object('v', btrim(p ->> 'gkey')), public.now_ms())
        on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
    end if;
  end if;
  if p ? 'cfg' then
    insert into public.private_kv (key, data, updated_at) values ('biteship_cfg', p -> 'cfg', public.now_ms())
      on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
  end if;
end $$;

revoke all on function public.admin_biteship_get(), public.admin_biteship_save(jsonb) from public, anon, authenticated;
grant execute on function public.admin_biteship_get(), public.admin_biteship_save(jsonb) to authenticated;
