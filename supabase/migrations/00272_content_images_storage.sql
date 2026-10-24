-- ============================================================================
-- 00272: Content images — upload an image instead of pasting its address
-- ============================================================================
-- Most people have the screenshot or photo on their computer, not at an
-- address. The Content Editor's image dialogs and an author's photo upload
-- it here: a public bucket (the page and the CMS show it by its address),
-- JPEG, PNG, WebP or GIF, 5 MB at most.
--
-- Each organization's images go under its own folder ({organization_id}/
-- {id}.{ext}). Members have no policy here: the app gives a one-time
-- upload address for a name it makes, and says who may upload and how
-- much (on the managed cloud, an organization with an active or trialing
-- subscription, a number a day; only the app knows a cloud from a
-- self-host). Nothing is overwritten or deleted from the app; anyone with
-- an image's address can see it, as any image on a published page.

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

notify pgrst, 'reload schema';
