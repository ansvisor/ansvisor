-- ============================================================================
-- 00560: Ads' read connections: ad accounts, keys and daily metrics (Phase 1, A1)
-- ============================================================================
-- Ads Phase 1, behind ADS_ENABLED. Schema only: no rows are written here and
-- nothing is backfilled. The sync jobs (lib/ads, later PRs) fill the metric
-- tables in chunks, one account and date window at a time.
--
-- As with 00530–00532, only the server reads and writes these tables (service
-- role). It checks the person's role, their brand access and their plan
-- itself. A session reads no row: spend and keys are an Admin's business, and
-- the plan decides what the Ads area shows.
--
--   * ads_accounts: an ad account a brand reads, on Google Ads (through the
--     Account's Composio sign-in, integration_accounts) or ChatGPT Ads
--     (through the customer's own API key). One brand may read several.
--   * ads_account_keys: a ChatGPT Ads account's API key, encrypted by the API
--     (AES-256-GCM with CONNECTOR_CREDENTIALS_KEY, bound to the account id),
--     as catalog_source_credentials (00282) keeps a store's sign-in.
--   * ads_campaign_daily: each campaign's day: impressions, clicks, cost,
--     conversions. Both platforms, in the account's currency.
--   * ads_search_term_daily: Google's search terms per campaign and day, which
--     the Overlap view matches to tracked prompts.

create table if not exists public.ads_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  platform text not null check (platform in ('google', 'chatgpt')),
  -- Google's customer id (10 digits) or ChatGPT's ad account id.
  external_id text not null check (char_length(external_id) between 1 and 64),
  name text check (name is null or char_length(name) <= 300),
  currency_code text check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  time_zone text check (time_zone is null or char_length(time_zone) <= 64),
  -- Google only: the customer's manager account, when the account is reached through one.
  login_customer_id text check (login_customer_id is null or login_customer_id ~ '^[0-9]{10}$'),
  -- Google only: the Account's sign-in the account is read with.
  integration_account_id uuid references public.integration_accounts(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'error', 'disconnected')),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  -- The last finished sync, and the last day it has complete rows for.
  last_synced_at timestamptz,
  synced_through date,
  connected_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ads_accounts_brand_platform_external_key unique (brand_id, platform, external_id),
  constraint ads_accounts_google_fields_check check (
    platform = 'google' or (login_customer_id is null and integration_account_id is null)
  )
);

create index if not exists ads_accounts_organization_idx
  on public.ads_accounts (organization_id);
-- The sync's queue: active accounts, the longest waiting first.
create index if not exists ads_accounts_sync_due_idx
  on public.ads_accounts (last_synced_at nulls first)
  where status = 'active';

create table if not exists public.ads_account_keys (
  account_id uuid primary key references public.ads_accounts(id) on delete cascade,
  secret text not null check (char_length(secret) between 1 and 16384),
  set_at timestamptz not null default now(),
  set_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.ads_campaign_daily (
  account_id uuid not null references public.ads_accounts(id) on delete cascade,
  campaign_id text not null check (char_length(campaign_id) between 1 and 64),
  day date not null,
  campaign_name text check (campaign_name is null or char_length(campaign_name) <= 500),
  campaign_status text check (campaign_status is null or char_length(campaign_status) <= 40),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  -- Millionths of the account's currency, as Google reports cost.
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  conversions numeric(14, 2) not null default 0 check (conversions >= 0),
  conversion_value numeric(18, 2) not null default 0 check (conversion_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (account_id, campaign_id, day)
);

-- An account's date range, for the Campaigns tab and the sync's windows.
create index if not exists ads_campaign_daily_account_day_idx
  on public.ads_campaign_daily (account_id, day);

create table if not exists public.ads_search_term_daily (
  account_id uuid not null references public.ads_accounts(id) on delete cascade,
  campaign_id text not null check (char_length(campaign_id) between 1 and 64),
  search_term text not null check (char_length(search_term) between 1 and 1000),
  day date not null,
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  conversions numeric(14, 2) not null default 0 check (conversions >= 0),
  updated_at timestamptz not null default now(),
  primary key (account_id, campaign_id, search_term, day)
);

create index if not exists ads_search_term_daily_account_day_idx
  on public.ads_search_term_daily (account_id, day);

comment on table public.ads_accounts is
  'Ads Phase 1 (00560): an ad account a brand reads, on Google Ads (through an integration_accounts sign-in) or ChatGPT Ads (through the customer''s own key). Server only.';
comment on table public.ads_account_keys is
  'Ads Phase 1 (00560): a ChatGPT Ads account''s API key, encrypted by the API (AES-256-GCM, bound to the account id). Service role only; removed with its account.';
comment on table public.ads_campaign_daily is
  'Ads Phase 1 (00560): a campaign''s day (impressions, clicks, cost in micros, conversions) in the account''s currency, written by the sync. Server only.';
comment on table public.ads_search_term_daily is
  'Ads Phase 1 (00560): Google Ads search terms per campaign and day, written by the sync for the Overlap view. Server only.';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.ads_accounts enable row level security;
alter table public.ads_account_keys enable row level security;
alter table public.ads_campaign_daily enable row level security;
alter table public.ads_search_term_daily enable row level security;

revoke all on table public.ads_accounts from public, anon, authenticated;
revoke all on table public.ads_account_keys from public, anon, authenticated;
revoke all on table public.ads_campaign_daily from public, anon, authenticated;
revoke all on table public.ads_search_term_daily from public, anon, authenticated;
grant all on table public.ads_accounts to service_role;
grant all on table public.ads_account_keys to service_role;
grant all on table public.ads_campaign_daily to service_role;
grant all on table public.ads_search_term_daily to service_role;
-- No grant and no policy for a session (anon, authenticated): it reads no row.

notify pgrst, 'reload schema';
