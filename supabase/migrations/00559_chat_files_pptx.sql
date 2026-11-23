-- ============================================================================
-- 00559: a file in Files may download as PowerPoint
-- ============================================================================
-- Chat turns a saved report into an editable .pptx deck (#2298) and files
-- it. The formats check (00411, last set by 00477) knew no 'pptx', and the
-- bucket's types (00411, with 00476's image/jpeg) knew no presentation type,
-- so the deck could be neither filed nor downloaded. The same list, with
-- 'pptx'; the bucket takes the deck's own type. Run again, both end the
-- same; any type an admin added stays.

alter table public.chat_files drop constraint if exists chat_files_formats_check;
alter table public.chat_files add constraint chat_files_formats_check check (
  formats <@ array[
    'md', 'html', 'docx', 'pdf', 'csv', 'xlsx', 'pptx', 'json', 'jsonld', 'txt', 'png', 'jpg', 'webp'
  ]::text[]
  and public.chat_text_array_distinct(formats)
);

update storage.buckets
set allowed_mime_types = array_append(
  allowed_mime_types,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
)
where id = 'chat-files'
  and allowed_mime_types is not null
  and not (
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    = any (allowed_mime_types)
  );
