-- Delidome migration 58: FAQ for affiliators. The owner edits the questions in Affiliates; affiliators read them in the FAQ tab of their dashboard.
-- Kept in private_kv "aff_faq" as {items: [{q, a}]}. No questions saved = the website shows its built-in text. Safe to run more than once.

create or replace function public.aff_faq() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select data from public.private_kv where key = 'aff_faq'), '{"items": []}'::jsonb) $$;

-- owner: save the whole list (empty list = back to the built-in text)
create or replace function public.admin_aff_faq_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it jsonb; items jsonb := '[]'::jsonb; q text; a text;
begin
  perform public.assert_owner();
  if coalesce(jsonb_typeof(p -> 'items'), '') <> 'array' then perform public.bad('Nothing to save.'); end if;
  if jsonb_array_length(p -> 'items') > 30 then perform public.bad('At most 30 questions.'); end if;
  for it in select value from jsonb_array_elements(p -> 'items') loop
    q := left(btrim(coalesce(it ->> 'q', '')), 200);
    a := left(btrim(coalesce(it ->> 'a', '')), 3000);
    if q <> '' then items := items || jsonb_build_array(jsonb_build_object('q', q, 'a', a)); end if;
  end loop;
  insert into public.private_kv (key, data, updated_at) values ('aff_faq', jsonb_build_object('items', items), public.now_ms())
    on conflict (key) do update set data = excluded.data, updated_at = excluded.updated_at;
  perform public.log_act('Affiliate FAQ changed', jsonb_array_length(items) || ' questions');
  return public.aff_faq();
end $$;

revoke all on function public.aff_faq(), public.admin_aff_faq_save(jsonb) from public, anon;
grant execute on function public.aff_faq(), public.admin_aff_faq_save(jsonb) to authenticated;
