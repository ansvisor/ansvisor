-- ============================================================================
-- 00492: AI bot logs from any server, by upload or a generic webhook (#2170)
-- ============================================================================
-- AI Traffic's bot report reads a brand's own edge from three senders: a
-- Cloudflare Worker, Cloudflare Logpush and a Vercel drain (00183). A brand
-- on any other server or CDN had no way in. Two more kinds of connection:
--
--   * log_webhook: a generic sender that posts JSON lines with the
--     documented fields (bot-log-formats.js readJsonLinesBody) to
--     /bots/ingest with its secret, so any log shipper can send to it.
--   * log_upload: the brand's own uploads of an access log file (common or
--     combined log format, or the same JSON lines) on the AI Traffic page.
--     One per brand, made at the first upload; its secret is never shown,
--     since a person uploads through the app, signed in. A file is read
--     once and counts against the month's raw-record cap, as a log
--     sender's does (00189).

alter table public.ai_bot_connections
  drop constraint if exists ai_bot_connections_kind_check;
alter table public.ai_bot_connections
  add constraint ai_bot_connections_kind_check check (
    kind in ('cloudflare_worker', 'cloudflare_logpush', 'vercel_drain', 'log_webhook', 'log_upload')
  );

-- One live upload connection a brand: two first uploads at once make one.
create unique index if not exists ai_bot_connections_upload_uidx
  on public.ai_bot_connections (brand_id)
  where kind = 'log_upload' and revoked_at is null;

notify pgrst, 'reload schema';
