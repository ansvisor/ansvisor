-- Chat (00482): "When a brand is added", an agent trigger that fires once
-- per agent and brand when someone adds a brand to the workspace (AGENTS
-- plan §3.B row 11: Onboarding & Help starts on a new brand). The web fires
-- it once createBrand has saved the brand, never for the demo brand, for
-- active agents whose scope is All brands; the run acts as the agent's
-- owner, as every triggered run does (CHAT-21 §H item 38), and only when
-- the owner may use the new brand.

-- ─── The kind ───────────────────────────────────────────────────────────────

-- A trigger of the new kind. Its settings are empty: it has none.
alter table public.chat_agent_triggers
  drop constraint if exists chat_agent_triggers_kind_check;
alter table public.chat_agent_triggers
  add constraint chat_agent_triggers_kind_check
    check (kind in ('schedule', 'signal', 'kpi', 'watch_rule', 'brand_added'));

-- A run it started. Every kind 00466 allows stays: 'agent' included.
alter table public.chat_agent_runs
  drop constraint if exists chat_agent_runs_trigger_kind_check;
alter table public.chat_agent_runs
  add constraint chat_agent_runs_trigger_kind_check
    check (
      trigger_kind in (
        'schedule', 'signal', 'kpi', 'watch_rule', 'brand_added', 'manual', 'action', 'agent'
      )
    );

-- ─── Once per agent and brand ───────────────────────────────────────────────

-- A fire that may happen once per agent and brand claims its row first,
-- inserted with "on conflict do nothing": a second fire for the same brand
-- (a retry, two servers at once) finds the row taken and queues nothing.
create table if not exists public.chat_agent_trigger_claims (
  agent_id uuid not null references public.chat_agents(id) on delete cascade,
  kind text not null check (kind in ('brand_added')),
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- The trigger that fired; null once it is removed. The claim stays.
  trigger_id uuid references public.chat_agent_triggers(id) on delete set null,
  claimed_at timestamptz not null default now(),
  primary key (agent_id, kind, brand_id)
);

-- A brand's claims go with it.
create index if not exists chat_agent_trigger_claims_brand_idx
  on public.chat_agent_trigger_claims (brand_id);

comment on table public.chat_agent_trigger_claims is
  'Chat (00482): the fires an agent''s trigger makes once per brand (brand_added: When a brand is added), one row per agent, kind and brand, so a brand never fires the same agent twice. Readable where the agent and the brand are; the server writes.';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.chat_agent_trigger_claims enable row level security;

revoke all on table public.chat_agent_trigger_claims from anon, authenticated;
grant select on table public.chat_agent_trigger_claims to authenticated;
grant all on table public.chat_agent_trigger_claims to service_role;

-- As its trigger: where the agent is (00419, 00436), and for a brand the
-- person may use.
drop policy if exists "chat_agent_trigger_claims: agent select" on public.chat_agent_trigger_claims;
create policy "chat_agent_trigger_claims: agent select"
  on public.chat_agent_trigger_claims
  for select
  to authenticated
  using (
    agent_id in (select a.id from public.chat_agents a)
    and brand_id in (select public.user_brand_ids())
  );
