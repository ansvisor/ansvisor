-- ============================================================================
-- 00490: content images count toward a workspace's storage
-- ============================================================================
-- Images uploaded in the Content Editor and the AI images it makes are kept
-- in the public bucket content-images (00272), under the organization's
-- folder ("<organization id>/..."). Until now only the daily upload cap
-- counted them; the storage meter (plans' maxStorageGb and storage packs)
-- counted Chat's files alone (chat_storage_usage, 00411).
--
--   * content_images_bytes(p_organization_id): the bytes the workspace keeps
--     in content-images, read from storage.objects when asked, so an image
--     removed (an AI option not picked) leaves the count at once and no
--     trigger is needed on the storage schema. A browser upload goes
--     straight to its signed address, so the server never sees its size:
--     the object's own metadata is the one place it is known.
--
--     The folder is read as a range on name collate "C" ('<org>/' up to
--     '<org>0', '0' being the character after '/'), which the bucket's
--     (bucket_id, name collate "C") index serves; a LIKE on the database's
--     own collation could not use it. Service role only: the app reads it
--     on the server, for the workspace of the person asking.

create or replace function public.content_images_bytes(p_organization_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint
  from storage.objects o
  where o.bucket_id = 'content-images'
    and o.name collate "C" >= p_organization_id::text || '/'
    and o.name collate "C" < p_organization_id::text || '0';
$$;

revoke all on function public.content_images_bytes(uuid) from public, anon, authenticated;
grant execute on function public.content_images_bytes(uuid) to service_role;

comment on function public.content_images_bytes(uuid) is
  'Content images (00490): the bytes a workspace keeps in content-images (uploads and AI images, under its folder), for the storage meter with Chat''s files. Service role only.';

notify pgrst, 'reload schema';
