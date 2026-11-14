-- ============================================================================
-- 00531: Ads' opportunities: thresholds, decisions, weekly snapshots (PR 6)
-- ============================================================================
-- ADS-01 §2 and §3.2, behind ADS_ENABLED. Schema only: no rows are written
-- here, and nothing is backfilled. Only the server reads and writes all
-- three (service role, lib/ads/opportunities.js): it checks the person's
-- role, and their plan's rows (Starter and the trial see the first three,
-- §8), itself. A person's session reads no row of them, as the snapshots
-- and decisions of a locked row would show what the plan hides.
--
--   * ads_settings: a workspace's earn-or-pay thresholds (minIntentWeight,
--     leadPosition, minPaidVolume), laid over product's defaults
--     (server config/ads.js), and who changed them last. Admins read and
--     change them through the API only.
--   * ads_decision_overrides: a person's decision for a prompt (Earn, Pay,
--     Earn + pay), which beats the rule's until it is taken back. The API
--     serves them with the rows the plan reads.
--   * ads_opportunity_snapshots: each prompt's rule decision, its reasons
--     and its inputs, once per ISO week (2026-W46): the week's first read of
--     Opportunities writes it, and the key keeps it to one. "+6 new" and the
--     weekly agent compare with it, through the server.

create table if not exists public.ads_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- Only the keys a workspace changed, each a number; the rest are the defaults.
  thresholds jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint ads_settings_thresholds_check check (
    jsonb_typeof(thresholds) = 'object'
    and octet_length(thresholds::text) <= 1024
    and not jsonb_path_exists(thresholds, '$.* ? (@.type() != "number")')
  )
);

create table if not exists public.ads_decision_overrides (
  -- One per prompt: a prompt belongs to one brand.
  prompt_id uuid primary key references public.prompts(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  decision text not null check (decision in ('earn', 'pay', 'earn_pay')),
  set_by uuid references auth.users(id) on delete set null,
  set_at timestamptz not null default now()
);

create index if not exists ads_decision_overrides_brand_idx
  on public.ads_decision_overrides (brand_id);

create table if not exists public.ads_opportunity_snapshots (
  prompt_id uuid not null references public.prompts(id) on delete cascade,
  iso_week text not null check (iso_week ~ '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$'),
  brand_id uuid not null references public.brands(id) on delete cascade,
  decision text not null check (decision in ('earn', 'pay', 'earn_pay', 'overlap')),
  reasons jsonb not null default '[]'::jsonb
    check (jsonb_typeof(reasons) = 'array' and octet_length(reasons::text) <= 4096),
  inputs jsonb not null default '{}'::jsonb
    check (jsonb_typeof(inputs) = 'object' and octet_length(inputs::text) <= 4096),
  created_at timestamptz not null default now(),
  primary key (prompt_id, iso_week)
);

-- A brand's week, and the week before it.
create index if not exists ads_opportunity_snapshots_brand_week_idx
  on public.ads_opportunity_snapshots (brand_id, iso_week);

comment on table public.ads_settings is
  'Ads (00531, ADS-01 §2): a workspace''s earn-or-pay thresholds over product''s defaults, and who changed them last. Server only: Admins read and change them through the API.';
comment on table public.ads_decision_overrides is
  'Ads (00531, ADS-01 §2): a person''s decision for a prompt (earn, pay, earn_pay), which beats the rule''s. Server only: the API serves them with the rows the plan reads.';
comment on table public.ads_opportunity_snapshots is
  'Ads (00531, ADS-01 §3.2): each prompt''s rule decision, reasons and inputs, once per ISO week, written by the week''s first read. Server only: it holds every row, the ones the plan locks too.';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.ads_settings enable row level security;
alter table public.ads_decision_overrides enable row level security;
alter table public.ads_opportunity_snapshots enable row level security;

revoke all on table public.ads_settings from anon, authenticated;
revoke all on table public.ads_decision_overrides from anon, authenticated;
revoke all on table public.ads_opportunity_snapshots from anon, authenticated;
grant all on table public.ads_settings to service_role;
grant all on table public.ads_decision_overrides to service_role;
grant all on table public.ads_opportunity_snapshots to service_role;
-- No grant and no policy for a session (anon, authenticated): it reads no row.

notify pgrst, 'reload schema';
