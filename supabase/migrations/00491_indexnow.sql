-- ============================================================================
-- 00491: IndexNow, telling search engines a page went live (#2142, part B)
-- ============================================================================
-- When Send to CMS confirms a page live, Ansvisor tells IndexNow (Bing,
-- Yandex, Seznam, Naver and the others that share it; Bing's index feeds
-- Microsoft Copilot) once. IndexNow trusts a site by a key file at its root,
-- https://<host>/<key>.txt, on the same host as the pages. Ansvisor can't put
-- a file on a brand's site, so a brand turns it on in Settings ›
-- Integrations: Ansvisor makes the key, the person puts the file on the
-- site, and Check reads it back.
--
--   * brands.indexnow_key: the brand's key, 32 hex characters; null: off.
--     It isn't a secret (the file is public), so members read it with the
--     brand. Only the server writes it, for admins and managers.
--   * brands.indexnow_host: the host the file is on (the brand's primary
--     domain when it was turned on). Only pages on this host are announced.
--   * brands.indexnow_verified_at: when Check found the key at its address;
--     null until then, and nothing is announced.
--   * content_drafts.indexnow_pinged_at: when the page was announced, kept
--     before the call, so a page is announced once however often it is read
--     as live. A failed call is logged and never tried again.

alter table public.brands
  add column if not exists indexnow_key text
    check (indexnow_key is null or indexnow_key ~ '^[a-f0-9]{32}$'),
  add column if not exists indexnow_host text
    check (
      indexnow_host is null
      or (char_length(indexnow_host) <= 253 and indexnow_host ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$')
    ),
  add column if not exists indexnow_verified_at timestamptz;

alter table public.content_drafts
  add column if not exists indexnow_pinged_at timestamptz;

comment on column public.brands.indexnow_key is
  'IndexNow (00491): the brand''s key, its file at https://<indexnow_host>/<key>.txt; null: off. Not a secret.';
comment on column public.brands.indexnow_host is
  'IndexNow (00491): the host the key file is on; only pages on it are announced.';
comment on column public.brands.indexnow_verified_at is
  'IndexNow (00491): when Check found the key file; null: nothing is announced.';
comment on column public.content_drafts.indexnow_pinged_at is
  'IndexNow (00491): when the page, live through Send to CMS, was announced; once per page.';

notify pgrst, 'reload schema';
