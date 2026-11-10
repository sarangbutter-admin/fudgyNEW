-- BakeByCulture migration 4: let the owner's picture uploads work on Supabase Storage.
-- Uploads use "upsert" (same picture = same file), which Supabase only allows when the
-- uploader may also SELECT the file. Public visitors still read pictures through the public URL.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    drop policy if exists "shop-media owner select" on storage.objects;
    create policy "shop-media owner select" on storage.objects for select to authenticated
      using (bucket_id = 'shop-media' and public.is_owner());
  end if;
end $$;
