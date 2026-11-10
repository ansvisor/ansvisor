-- ============================================================================
-- 00511: MCP over OAuth: apps known by a Client ID Metadata Document (#2141)
-- ============================================================================
-- An MCP app can name itself by an https URL instead of registering first
-- (Client ID Metadata Documents: MCP authorization spec 2025-11-25, which
-- 2026-07-28 prefers to dynamic registration). Claude and ChatGPT use one
-- when the authorization server says it supports them, and Claude Code
-- always has one. Ansvisor fetches the document when the app first asks to
-- connect, checks it (its client_id equal to its URL, its redirect URIs),
-- and keeps it in oauth_clients as a 'cimd' client, by its URL, for as long
-- as its Cache-Control allows (five minutes to a day). It is a public
-- client: PKCE, no secret.

alter table public.oauth_clients drop constraint if exists oauth_clients_kind_check;
alter table public.oauth_clients
  add constraint oauth_clients_kind_check check (kind in ('dcr', 'cimd'));

alter table public.oauth_clients add column if not exists metadata_fetched_at timestamptz;
alter table public.oauth_clients add column if not exists metadata_expires_at timestamptz;

alter table public.oauth_clients drop constraint if exists oauth_clients_cimd_check;
alter table public.oauth_clients
  add constraint oauth_clients_cimd_check check (
    kind <> 'cimd'
    or (
      client_id ~ '^https://'
      and token_endpoint_auth_method = 'none'
      and metadata_fetched_at is not null
      and metadata_expires_at is not null
    )
  );

notify pgrst, 'reload schema';
