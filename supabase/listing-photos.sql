-- Public listing photos (2 MB jpeg/png/webp). Run in SQL Editor if CLI storage policies fail.

alter table public.providers
  add column if not exists photo_url text not null default '';

comment on column public.providers.photo_url is 'Public Storage URL for listing thumbnail';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listing-photos',
  'listing-photos',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read listing photos" on storage.objects;
create policy "Public read listing photos"
  on storage.objects
  for select
  to public
  using (bucket_id = 'listing-photos');

drop policy if exists "Owners upload listing photos" on storage.objects;
create policy "Owners upload listing photos"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'listing-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "Owners update listing photos" on storage.objects;
create policy "Owners update listing photos"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'listing-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'listing-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "Owners delete listing photos" on storage.objects;
create policy "Owners delete listing photos"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'listing-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );
