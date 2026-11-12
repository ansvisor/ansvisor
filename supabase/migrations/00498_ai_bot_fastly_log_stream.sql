-- ============================================================================
-- 00498: Fastly HTTPS log streaming for AI bot traffic (#2164)
-- ============================================================================
-- A Fastly logging endpoint posts JSON lines to /bots/ingest with the
-- connection's Authorization bearer secret. Its records are read by
-- server/src/lib/bot-log-formats.js; the existing verification pipeline
-- still checks the user agent and published source IP ranges before storage.

alter table public.ai_bot_connections
  drop constraint if exists ai_bot_connections_kind_check;
alter table public.ai_bot_connections
  add constraint ai_bot_connections_kind_check check (
    kind in (
      'cloudflare_worker', 'cloudflare_logpush', 'vercel_drain',
      'log_webhook', 'log_upload', 'fastly_log_stream'
    )
  );

notify pgrst, 'reload schema';