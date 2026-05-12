-- Allow authenticated users to upload/overwrite files in the public `logos` bucket
-- (used for team logos AND per-player headshots stored as players/<team_id>/<player_id>.jpg).
-- Public reads are already allowed because the bucket is marked Public.

drop policy if exists "auth users write logos"  on storage.objects;
drop policy if exists "auth users update logos" on storage.objects;
drop policy if exists "auth users delete logos" on storage.objects;

create policy "auth users write logos" on storage.objects
  for insert
  with check (bucket_id = 'logos' and auth.uid() is not null);

create policy "auth users update logos" on storage.objects
  for update
  using      (bucket_id = 'logos' and auth.uid() is not null)
  with check (bucket_id = 'logos' and auth.uid() is not null);

create policy "auth users delete logos" on storage.objects
  for delete
  using (bucket_id = 'logos' and auth.uid() is not null);
