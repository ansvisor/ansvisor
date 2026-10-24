-- ============================================================================
-- 00272: Content images — upload an image instead of pasting its address
-- ============================================================================
-- Most people have the screenshot or photo on their computer, not at an
-- address. The Content Editor's image dialogs and an author's photo upload
-- it here: a public bucket (the page and the CMS show it by its address),
-- JPEG, PNG, WebP or GIF, 5 MB at most.
--
-- Each organization writes under its own folder ({organization_id}/…): a
-- member uploads only there (the storage API records who). Nothing is
-- overwritten or deleted from the app; anyone with an image's address can
-- see it, as any image on a published page.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'content-images',
  'content-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
-- Run again, it leaves the bucket as an admin may have set it.
on conflict (id) do nothing;

-- A member uploads into their organization's folder, as themself.
drop policy if exists "content-images: member upload" on storage.objects;
create policy "content-images: member upload"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'content-images'
    and (storage.foldername(name))[1] = (
      select p.organization_id::text from public.profiles p where p.id = auth.uid()
    )
  );

-- Members read their organization's folder through the API (an upload
-- reads its row back); the images themselves are public by address.
drop policy if exists "content-images: member select" on storage.objects;
create policy "content-images: member select"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'content-images'
    and (storage.foldername(name))[1] = (
      select p.organization_id::text from public.profiles p where p.id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
