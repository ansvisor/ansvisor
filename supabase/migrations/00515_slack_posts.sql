-- ============================================================================
-- 00515: Slack posts — what Ansvisor posted to a brand's Slack channel (#2139)
-- ============================================================================
-- A brand posts to the Slack channel it picked (brand_integrations.settings,
-- 00470; server lib/slack/connection.js). Each message is kept here once,
-- before it is sent, so the same message never goes twice however the job
-- that sends it is retried or run on two servers (unique per brand and
-- dedupe key), and so a message can be found again (its channel and Slack's
-- ts) and the next one held back for a while (the drop alerts' 7 days).
--
--   * kind: what it was. The Daily Pulse first; the drop alert, the daily
--     suggestion and "an agent needs you" follow in their own pull requests,
--     so they are allowed here from the start.
--   * dedupe_key: the message's own key within the brand, e.g. pulse:{date}.
--   * status: sending while Slack is asked, then sent or failed. A failed
--     post is tried once more (a 429 after Slack's Retry-After, a 5xx or a
--     timeout after 2 seconds); error_code is Slack's code, or ours, never
--     its words.
--
-- Server only: the service role writes and reads it, after checking the
-- brand, its plan and the person who connected its workspace. No member
-- reads it (the brand's card reads brand_integrations), so it has no policy.
--
-- sent_pulses.slack_sent: whether the Pulse went to the brand's channel, as
-- email_sent and webhook_sent say for its other legs.

create table if not exists public.slack_posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    constraint slack_posts_organization_id_fkey
    references public.organizations(id) on delete cascade,
  brand_id uuid not null
    constraint slack_posts_brand_id_fkey
    references public.brands(id) on delete cascade,
  -- The workspace's sign-in it went through; null once that is gone.
  account_id uuid
    constraint slack_posts_account_id_fkey
    references public.integration_accounts(id) on delete set null,
  kind text not null check (kind in ('pulse', 'drop', 'suggestion', 'needs_you')),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  channel_id text not null check (channel_id ~ '^[CG][A-Z0-9]{6,20}$'),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  -- Slack's id of the message in its channel, once sent.
  message_ts text check (message_ts is null or message_ts ~ '^[0-9]{1,12}\.[0-9]{1,8}$'),
  error_code text check (error_code is null or char_length(error_code) between 1 and 100),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint slack_posts_brand_dedupe_key unique (brand_id, dedupe_key),
  check ((status = 'sent') = (message_ts is not null and sent_at is not null))
);

-- The brand's latest posts of a kind (a cooldown, the message to update).
create index if not exists slack_posts_brand_kind_created_idx
  on public.slack_posts (brand_id, kind, created_at desc);
-- The sign-in's posts, for its delete's set null.
create index if not exists slack_posts_account_id_idx
  on public.slack_posts (account_id) where account_id is not null;
create index if not exists slack_posts_organization_id_idx
  on public.slack_posts (organization_id);

comment on table public.slack_posts is
  'Slack (00515, #2139): each message posted to a brand''s Slack channel, kept once before it is sent (unique per brand and dedupe_key): its kind, channel, Slack''s ts, and Slack''s error code if it failed. Server only.';
comment on column public.slack_posts.dedupe_key is
  'The message''s key within the brand, e.g. pulse:{date}: the same message is never posted twice.';
comment on column public.slack_posts.error_code is
  'Slack''s error code (channel_not_found, ratelimited…) or ours (slack_unavailable, timeout), never a message''s words.';

alter table public.slack_posts enable row level security;
revoke all on table public.slack_posts from anon, authenticated;
grant all on table public.slack_posts to service_role;

alter table public.sent_pulses
  add column if not exists slack_sent boolean not null default false;

comment on column public.sent_pulses.slack_sent is
  'Whether the Pulse was posted to the brand''s Slack channel (00515, #2139).';
