-- ============================================================================
-- 00510: MCP over OAuth: apps, connections, codes, tokens, their log (#2141)
-- ============================================================================
-- Claude, ChatGPT and other MCP apps connect to /api/mcp by signing the person
-- in (OAuth 2.1), instead of a pasted ans_ key (00003), which keeps working.
-- Ansvisor is its own small authorization server: the tokens it issues are
-- opaque, kept here only as sha256 hashes like api_keys.key_hash, and good for
-- the MCP endpoint alone. Behind MCP_OAUTH_ENABLED: nothing writes these
-- tables while it is off.
--
--   * oauth_clients: the apps. A DCR client registers itself (RFC 7591) and
--     gets an ansc_ id; a public one (token_endpoint_auth_method 'none',
--     PKCE only) has no secret, a confidential one a hashed secret. Nothing
--     in metadata is fetched or shown (logo_uri, client_uri…).
--   * oauth_authorization_requests: a request to connect, checked and kept
--     while the person signs in and decides (10 minutes): the consent page's
--     address holds only its id. user_id is the person who opened it.
--   * oauth_codes: an approved request's one-time code (5 minutes), with what
--     the token request must match. grant_id is set when it is redeemed: a
--     second use revokes that connection (OAuth 2.1 §4.1.2).
--   * oauth_grants: a connection: one person, the organization they were in
--     when they approved it, one app, its scopes (mcp:read, and mcp:write
--     when they allowed changes) and the resource (the MCP endpoint's URL).
--     Revoking it ends every token at once; revoked_reason says why.
--   * oauth_tokens: access tokens (1 hour) and refresh tokens (30 days,
--     rotated on every use: rotated_at), hashed.
--   * oauth_events: the log: a connection made, refused or ended, a code or
--     refresh token used twice.
--   * oauth_rate_limits and oauth_rate_hit(): fixed-window counters for the
--     registration, token and consent endpoints.
--
-- Only the server reads and writes them, with the service role: RLS is on
-- with no policy, and anon and authenticated get nothing. Settings lists a
-- person's connections through an API route that reads them as the service
-- role for that person. No brand_id: a connection carries its person's brand
-- access, read again on every call (BRAND-ACCESS §5.3), as an API key does.

-- ─── Apps ───────────────────────────────────────────────────────────────────

create table if not exists public.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique check (char_length(client_id) between 8 and 2000),
  -- 'dcr': registered at /api/oauth/register.
  kind text not null default 'dcr' check (kind in ('dcr')),
  -- Self-asserted: the consent page shows it as the app's own word.
  client_name text check (client_name is null or char_length(client_name) between 1 and 100),
  -- https://… or a loopback http://… address, matched exactly (a loopback one
  -- on any port, RFC 8252 §7.3).
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 5),
  token_endpoint_auth_method text not null default 'none'
    check (token_endpoint_auth_method in ('none', 'client_secret_post', 'client_secret_basic')),
  client_secret_hash text check (client_secret_hash is null or client_secret_hash ~ '^[0-9a-f]{64}$'),
  -- The rest of the registration as sent, for support: never fetched or shown.
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  -- The last time a person connected it: a client never connected is
  -- removed after a day.
  last_used_at timestamptz,
  constraint oauth_clients_secret_check
    check ((token_endpoint_auth_method = 'none') = (client_secret_hash is null))
);

create index if not exists oauth_clients_unused_idx
  on public.oauth_clients (created_at)
  where last_used_at is null;

-- ─── Requests to connect ───────────────────────────────────────────────────

create table if not exists public.oauth_authorization_requests (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  redirect_uri text not null check (char_length(redirect_uri) <= 2000),
  -- S256 only: base64url of a sha256, 43 characters.
  code_challenge text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  scopes text[] not null
    check (scopes <@ array['mcp:read', 'mcp:write']::text[] and 'mcp:read' = any (scopes)),
  state text check (state is null or char_length(state) <= 1000),
  resource text not null check (char_length(resource) <= 2000),
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists oauth_authorization_requests_expires_idx
  on public.oauth_authorization_requests (expires_at);

-- ─── Connections ───────────────────────────────────────────────────────────

create table if not exists public.oauth_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  -- As the consent page showed them.
  client_name text check (client_name is null or char_length(client_name) <= 100),
  redirect_host text not null check (char_length(redirect_host) between 1 and 255),
  scopes text[] not null
    check (scopes <@ array['mcp:read', 'mcp:write']::text[] and 'mcp:read' = any (scopes)),
  resource text not null check (char_length(resource) <= 2000),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  -- person: Disconnect in Settings; client: the app at /api/oauth/revoke;
  -- member_left: no longer in the organization; code_reuse / refresh_reuse:
  -- a code or a rotated refresh token used again; expired: unused 30 days.
  revoked_reason text check (
    revoked_reason in ('person', 'client', 'member_left', 'code_reuse', 'refresh_reuse', 'expired')
  ),
  constraint oauth_grants_revoked_check check ((revoked_at is null) = (revoked_reason is null))
);

create index if not exists oauth_grants_user_idx
  on public.oauth_grants (user_id, created_at desc)
  where revoked_at is null;

-- ─── Codes and tokens ──────────────────────────────────────────────────────

create table if not exists public.oauth_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  redirect_uri text not null check (char_length(redirect_uri) <= 2000),
  code_challenge text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  scopes text[] not null
    check (scopes <@ array['mcp:read', 'mcp:write']::text[] and 'mcp:read' = any (scopes)),
  resource text not null check (char_length(resource) <= 2000),
  client_name text check (client_name is null or char_length(client_name) <= 100),
  redirect_host text not null check (char_length(redirect_host) between 1 and 255),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  grant_id uuid references public.oauth_grants (id) on delete cascade
);

create index if not exists oauth_codes_expires_idx on public.oauth_codes (expires_at);

create table if not exists public.oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.oauth_grants (id) on delete cascade,
  kind text not null check (kind in ('access', 'refresh')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null
    check (scopes <@ array['mcp:read', 'mcp:write']::text[] and 'mcp:read' = any (scopes)),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- A refresh token swapped for a new pair: the old one is dead from then on.
  rotated_at timestamptz,
  revoked_at timestamptz
);

create index if not exists oauth_tokens_grant_idx on public.oauth_tokens (grant_id);
create index if not exists oauth_tokens_expires_idx on public.oauth_tokens (expires_at);

-- ─── The log ───────────────────────────────────────────────────────────────

create table if not exists public.oauth_events (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id) on delete cascade,
  -- Null once the person's account is deleted: the row stays for the admins.
  user_id uuid references auth.users (id) on delete set null,
  grant_id uuid references public.oauth_grants (id) on delete set null,
  client_id text check (client_id is null or char_length(client_id) <= 2000),
  event text not null check (
    event in (
      'client_registered',
      'consent_granted',
      'consent_denied',
      'blocked_trial',
      'blocked_ended',
      'code_reuse',
      'refresh_reuse',
      'revoked_by_person',
      'revoked_by_client',
      'revoked_member_left'
    )
  ),
  -- The address shortened (IPv4 /24, IPv6 /48), and the client's user agent.
  ip text check (ip is null or char_length(ip) <= 64),
  user_agent text check (user_agent is null or char_length(user_agent) <= 200),
  created_at timestamptz not null default now()
);

create index if not exists oauth_events_org_idx
  on public.oauth_events (organization_id, created_at desc);

-- ─── Rate limits ───────────────────────────────────────────────────────────

create table if not exists public.oauth_rate_limits (
  key text not null check (char_length(key) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);

-- One hit on key in the current window of p_window_seconds: true while the
-- window holds p_max hits or fewer. Windows older than a day are cleared now
-- and then. The server's only (service role).
create or replace function public.oauth_rate_hit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_start timestamptz :=
    to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.oauth_rate_limits as r (key, window_start, hits)
  values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  if random() < 0.01 then
    delete from public.oauth_rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_max;
end;
$$;

revoke all on function public.oauth_rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.oauth_rate_hit(text, integer, integer) to service_role;

-- ─── Access: the server's only ─────────────────────────────────────────────

alter table public.oauth_clients enable row level security;
alter table public.oauth_authorization_requests enable row level security;
alter table public.oauth_grants enable row level security;
alter table public.oauth_codes enable row level security;
alter table public.oauth_tokens enable row level security;
alter table public.oauth_events enable row level security;
alter table public.oauth_rate_limits enable row level security;

revoke all on table
  public.oauth_clients,
  public.oauth_authorization_requests,
  public.oauth_grants,
  public.oauth_codes,
  public.oauth_tokens,
  public.oauth_events,
  public.oauth_rate_limits
from anon, authenticated;

grant all on table
  public.oauth_clients,
  public.oauth_authorization_requests,
  public.oauth_grants,
  public.oauth_codes,
  public.oauth_tokens,
  public.oauth_events,
  public.oauth_rate_limits
to service_role;

notify pgrst, 'reload schema';
