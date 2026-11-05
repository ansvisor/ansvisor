-- ============================================================================
-- 00476: Files takes JPEG images
-- ============================================================================
-- Chat files the images it makes in the private bucket chat-files (CHAT-15
-- item 24, W4-08). Google's image models (Nano Banana) answer in JPEG, which
-- the bucket's list (00411: PNG and WebP only) turns away. This adds
-- image/jpeg to it. Run again, it changes nothing; any type an admin added
-- stays. The person still downloads PNG: the result card converts in the
-- browser.

update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'image/jpeg')
where id = 'chat-files'
  and allowed_mime_types is not null
  and not ('image/jpeg' = any (allowed_mime_types));
