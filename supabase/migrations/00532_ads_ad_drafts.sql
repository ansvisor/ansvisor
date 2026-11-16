-- ============================================================================
-- 00532: Ads' ad drafts, and the 'ads' AI usage feature (Phase 0 PR 11)
-- ============================================================================
-- ADS-01 §3.2 and §7a.2 rule 5, behind ADS_ENABLED. Schema only: no rows
-- are written or backfilled here, and it applies in seconds.
--
--   * ads_ad_drafts: one row per channel's draft of a prompt's ad (ChatGPT,
--     Google, Microsoft), saved only after it passed the claims gate
--     (server lib/ads/claims.js): its copy, keywords, the approved brand
--     facts its claims rest on and the gate's result. Nothing here reaches
--     an ad platform. Only the server reads and writes it (service role,
--     lib/ads/drafts.js): it checks the person's role and their plan's rows
--     itself. A person's session reads no row, as a draft of a prompt their
--     plan locks (Starter, the trial, a plan that went down) would show
--     what the plan hides; the API serves the rows the plan reads (00531's
--     reasoning).
--   * prompt_improve_usage.feature takes 'ads': the drafts' model calls on
--     the workspace's AI budget. The new check allows every value the old
--     one did and one more, so every row already passes it: it is added
--     NOT VALID (no scan of the table under its lock) and checks every row
--     written from now on. Validating it scans the whole table, so it isn't
--     done here, in the migration's transaction, which still holds the
--     table's lock: run it on its own afterwards (it locks nothing that
--     reads or writes rows):
--       alter table public.prompt_improve_usage
--         validate constraint prompt_improve_usage_feature_check;

create table if not exists public.ads_ad_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  prompt_id uuid not null references public.prompts(id) on delete cascade,
  channel text not null check (channel in ('chatgpt', 'google', 'microsoft')),
  -- The copy. ChatGPT: one headline, one description and its context hint;
  -- Google and Microsoft: search text ads' headlines and descriptions. The
  -- channels' character limits are the gate's (config/ad-limits.js); these
  -- bounds only keep a row's size in check.
  headlines text[] not null check (
    cardinality(headlines) between 1 and 20 and octet_length(array_to_string(headlines, '')) <= 4000
  ),
  descriptions text[] not null check (
    cardinality(descriptions) between 1 and 10 and octet_length(array_to_string(descriptions, '')) <= 4000
  ),
  context_hint text check (
    context_hint is null or (channel = 'chatgpt' and char_length(context_hint) between 1 and 1000)
  ),
  keywords text[] not null default '{}' check (
    cardinality(keywords) <= 50 and octet_length(array_to_string(keywords, '')) <= 4000
  ),
  -- The approved brand facts (brand_facts) its claims rest on: kept as ids,
  -- as a fact a later read removes mustn't remove the draft.
  fact_ids uuid[] not null default '{}' check (cardinality(fact_ids) <= 50),
  -- The claims gate's result: its claims, the limits confirmed or not, the
  -- keywords it dropped (a competitor's).
  gate jsonb not null default '{}'::jsonb
    check (jsonb_typeof(gate) = 'object' and octet_length(gate::text) <= 8192),
  -- Approving a draft and setting one aside come with the Pay card and the
  -- exports (PR 12, PR 13); this PR writes drafts only.
  status text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  -- Where it was made: the opportunity drawer, a Chat run, an agent's run.
  source text not null default 'drawer' check (source in ('drawer', 'chat', 'agent')),
  -- Who: the person, or the agent's run (chat_agent_runs) and its chat run.
  actor_user_id uuid references auth.users(id) on delete set null,
  agent_run_id uuid references public.chat_agent_runs(id) on delete set null,
  chat_run_id uuid references public.chat_runs(id) on delete set null,
  -- The caller's idempotency key: the same key again answers the drafts it made.
  request_key text check (request_key is null or char_length(request_key) between 8 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A prompt's latest drafts, per channel (the drawer's Pay card).
create index if not exists ads_ad_drafts_prompt_channel_created_idx
  on public.ads_ad_drafts (prompt_id, channel, created_at desc);
-- A brand's drafts, newest first (the exports).
create index if not exists ads_ad_drafts_brand_created_idx
  on public.ads_ad_drafts (brand_id, created_at desc);
-- One set of drafts per key and prompt: a retry, or two clicks, makes it once.
create unique index if not exists ads_ad_drafts_request_key_idx
  on public.ads_ad_drafts (prompt_id, request_key, channel)
  where request_key is not null;

comment on table public.ads_ad_drafts is
  'Ads (00532, ADS-01 §3.2): one channel''s ad draft of a prompt (chatgpt, google, microsoft), saved only after it passed the claims gate: its copy, keywords, the approved brand facts it rests on (fact_ids) and the gate''s result. Never sent to an ad platform. Server only: the API serves the rows the person''s plan reads.';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.ads_ad_drafts enable row level security;

revoke all on table public.ads_ad_drafts from anon, authenticated;
grant all on table public.ads_ad_drafts to service_role;
-- No grant and no policy for a session (anon, authenticated): it reads no row.

-- ─── The 'ads' AI usage feature ─────────────────────────────────────────────

-- A row waiting on the table's lock gives up after 3 s instead of holding
-- up every AI call behind it (run the migration again).
set lock_timeout = '3s';

alter table public.prompt_improve_usage
  drop constraint if exists prompt_improve_usage_feature_check,
  add constraint prompt_improve_usage_feature_check
    check (
      feature is null
      or feature in (
        'improve', 'content', 'action_center', 'quality', 'chat', 'agent', 'schedule', 'image',
        'ads'
      )
    ) not valid;

reset lock_timeout;

comment on column public.prompt_improve_usage.feature is
  'What the AI call was for: improve (the Improve tab), content (the Content Editor''s AI), action_center (the task writer), quality (the Content Editor''s Quality checks, 00264), chat (a Chat run''s model step, 00405), agent, schedule or image (Chat''s agents, scheduled runs and images), ads (Ads'' ad drafts, 00532). Null on rows from before 00242 whose prompt, draft or action was deleted.';

notify pgrst, 'reload schema';
