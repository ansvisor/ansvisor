-- ============================================================================
-- 00477: a file in Files may download as JPEG
-- ============================================================================
-- A set of images Chat made (W4-08) is filed with its images' own format:
-- JPEG from Google's image models (00476 lets the bucket take them). The
-- formats check (00411) knew PNG and WebP only. The same list, with 'jpg'.
-- Run again, it ends the same.

alter table public.chat_files drop constraint if exists chat_files_formats_check;
alter table public.chat_files add constraint chat_files_formats_check check (
  formats <@ array[
    'md', 'html', 'docx', 'pdf', 'csv', 'xlsx', 'json', 'jsonld', 'txt', 'png', 'jpg', 'webp'
  ]::text[]
  and public.chat_text_array_distinct(formats)
);
