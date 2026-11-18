-- ============================================================================
-- 00545: agents that run agents — the AEO Operator's kind, settings and plans
-- ============================================================================
-- AEO Operator, PR 1 of 6, behind CHAT_OPERATOR (a later PR). Each morning
-- an Operator picks, from the workspace's own numbers, which of its owner's
-- agents to run on its brand today within a daily budget, and starts them
-- after one approval. It reuses 00466's link (chat_agent_runs.
-- called_by_run_id), budget nesting and one-level rule: its children are
-- runs another agent's run started. Nothing writes these yet (as 00466).
--
--   * chat_agents.kind: 'agent', or 'operator' for an agent that runs
--     agents. Set when the agent is made and never changed (the trigger), so
--     a Can call list or a plan never ends up naming an Operator later.
--   * chat_agent_versions.operator_json: an Operator version's settings
--     (allowed agents, workspace agents, runs a day, ask first), an object of
--     at most 4 KB; null for every other agent.
--   * chat_agent_plans: one Operator run's plan for its brand and day: its
--     items (at most 10), the agents it passed over and why, the day's budget
--     and what it planned of it, as shares of the monthly AI limit (never
--     dollars), who approved or skipped it, when it started its agents and
--     their summary. One plan in force per agent, brand and day (the partial
--     unique index): a skipped, expired or empty one leaves room for a new
--     one. Read as the agent is, on brands the reader can access; the server
--     writes.
--   * chat_agent_runs_call_rules (00466's, otherwise word for word): the
--     called agent must be an agent, never an Operator (no Operator inside an
--     Operator), and an Operator's run may start 10 runs, any other run 3.
--   * chat_agent_versions_can_call_rules (00466's, otherwise word for word):
--     Can call names agents only, never an Operator.
--   * chat_notices kind agent_plan_summary: the Operator's summary once its
--     agents are done (a later PR writes it). The kind list keeps every kind
--     00474 allows, the last to rewrite it.
--
-- Schema and functions only: two columns (kind's constant default is
-- metadata only; operator_json has none), a new empty table and its
-- indexes, three functions and one trigger. Each check is added not valid,
-- then validated: chat_agents, chat_agent_versions and chat_notices are
-- small. No index is built on an existing table and no row is written.
-- Every statement is safe to run again.

-- The new table's foreign keys and the checks hold their tables' writes for
-- a moment: if a long transaction holds one, give up after 5 s instead of
-- queueing every write behind it (apply it again; everything here is
-- idempotent).
set lock_timeout = '5s';

-- ─── An agent's kind ────────────────────────────────────────────────────────

alter table public.chat_agents
  add column if not exists kind text not null default 'agent';

alter table public.chat_agents
  drop constraint if exists chat_agents_kind_check;
alter table public.chat_agents
  add constraint chat_agents_kind_check
    check (kind in ('agent', 'operator')) not valid;
alter table public.chat_agents
  validate constraint chat_agents_kind_check;

comment on column public.chat_agents.kind is
  'What the agent is (00545): agent, or operator, an agent that runs other agents (the AEO Operator). Set when it is made, never changed.';

-- Set at insert, never changed: an agent named in a Can call list, or run by
-- an Operator, stays an agent.
create or replace function public.chat_agents_kind_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'an agent''s kind is set when it is made and never changed'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chat_agents_kind_fixed on public.chat_agents;
create trigger trg_chat_agents_kind_fixed
  before update of kind on public.chat_agents
  for each row execute function public.chat_agents_kind_fixed();

-- ─── An Operator's settings ─────────────────────────────────────────────────

alter table public.chat_agent_versions
  add column if not exists operator_json jsonb;

alter table public.chat_agent_versions
  drop constraint if exists chat_agent_versions_operator_json_check;
alter table public.chat_agent_versions
  add constraint chat_agent_versions_operator_json_check
    check (
      operator_json is null
      or (jsonb_typeof(operator_json) = 'object' and octet_length(operator_json::text) <= 4096)
    ) not valid;
alter table public.chat_agent_versions
  validate constraint chat_agent_versions_operator_json_check;

comment on column public.chat_agent_versions.operator_json is
  'An Operator version''s settings (00545): {allowed, include_workspace, max_runs, ask_first}, at most 4 KB. Null for every other agent.';

-- ─── An Operator's plans ────────────────────────────────────────────────────

create table if not exists public.chat_agent_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- The Operator. Its plans go with it.
  agent_id uuid not null references public.chat_agents(id) on delete cascade,
  -- The Operator's run that made the plan: one plan a run.
  run_id uuid not null unique references public.chat_agent_runs(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- The day it is for, in the time zone of the schedule that fired it.
  plan_day date not null,
  -- empty: nothing to do today; proposed: on its card, waiting for a person;
  -- dispatching: approved, its runs being started; dispatched: started;
  -- summarized: its summary sent; declined: skipped; expired: unanswered at
  -- the end of its day.
  status text not null default 'proposed' check (
    status in (
      'empty', 'proposed', 'dispatching', 'dispatched', 'summarized', 'declined', 'expired'
    )
  ),
  -- Shares of the monthly AI limit, never dollars: the day's budget (the
  -- Operator's 1–10%, paced down to 0 near the month's limit) and the sum of
  -- its runs' caps within it. Null with no AI limit (self-hosted).
  budget_share numeric(3, 2) check (budget_share between 0 and 0.10),
  planned_share numeric(3, 2) check (planned_share >= 0),
  -- [{agent_id, share, reasons, child_run_id, …}]: the agents it runs, in order.
  items jsonb not null default '[]'::jsonb check (
    jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) <= 10
    and octet_length(items::text) <= 32768
  ),
  -- [{agent_id, reason}]: the agents it passed over today, and why (codes).
  passed jsonb not null default '[]'::jsonb check (
    jsonb_typeof(passed) = 'array' and octet_length(passed::text) <= 32768
  ),
  -- Who approved or skipped it, and when.
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  dispatched_at timestamptz,
  summarized_at timestamptz,
  -- What its runs did, made by code from their records.
  summary_json jsonb check (
    summary_json is null
    or (jsonb_typeof(summary_json) = 'object' and octet_length(summary_json::text) <= 32768)
  ),
  created_at timestamptz not null default now(),
  check (planned_share <= budget_share),
  check ((status = 'empty') = (jsonb_array_length(items) = 0)),
  check (status not in ('dispatched', 'summarized') or dispatched_at is not null),
  check (status <> 'summarized' or summarized_at is not null)
);

-- One plan in force per Operator, brand and day: a skipped, expired or empty
-- one leaves room for Run now to make another.
create unique index if not exists chat_agent_plans_day_uidx
  on public.chat_agent_plans (agent_id, brand_id, plan_day)
  where status in ('proposed', 'dispatching', 'dispatched', 'summarized');
-- The sweep: plans still waiting, being started, or waiting for their summary.
create index if not exists chat_agent_plans_open_idx
  on public.chat_agent_plans (status, plan_day)
  where status in ('proposed', 'dispatching', 'dispatched');
create index if not exists chat_agent_plans_brand_idx
  on public.chat_agent_plans (brand_id);
-- An Operator's last plans, newest first.
create index if not exists chat_agent_plans_agent_day_idx
  on public.chat_agent_plans (agent_id, plan_day desc);

comment on table public.chat_agent_plans is
  'Chat (00545): an AEO Operator run''s plan for its brand and day: the agents it runs and those it passed over, with reason codes; the day''s budget and its runs'' caps as shares of the monthly AI limit; who approved or skipped it; when it started them; their summary. One in force per Operator, brand and day. Read as the agent is, on brands the reader can access; the server writes.';

alter table public.chat_agent_plans enable row level security;

revoke all on table public.chat_agent_plans from anon, authenticated;
grant select on table public.chat_agent_plans to authenticated;
grant all on table public.chat_agent_plans to service_role;

-- As an agent run (00424): whoever sees the agent, on a brand they can access.
drop policy if exists "chat_agent_plans: agent select" on public.chat_agent_plans;
create policy "chat_agent_plans: agent select"
  on public.chat_agent_plans
  for select
  to authenticated
  using (
    agent_id in (select a.id from public.chat_agents a)
    and brand_id in (select public.user_brand_ids())
  );

-- ─── A run another agent started ────────────────────────────────────────────

-- 00466's, with two rules more: the called agent is an agent, never an
-- Operator, and an Operator's run may start 10 runs, any other run 3.
create or replace function public.chat_agent_runs_call_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_max integer;
begin
  if new.called_by_run_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.chat_agent_runs c
    where c.id = new.called_by_run_id
      and c.organization_id = new.organization_id
      and c.called_by_run_id is null
      and c.agent_id is distinct from new.agent_id
  ) then
    raise exception 'an agent run is called by a run of another agent of the workspace, which wasn''t called itself'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.chat_agents callee
    where callee.id = new.agent_id
      and callee.kind = 'agent'
  ) then
    raise exception 'a run calls agents only, never an Operator'
      using errcode = '23514';
  end if;

  select case when caller.kind = 'operator' then 10 else 3 end into v_max
  from public.chat_agent_runs c
  left join public.chat_agents caller on caller.id = c.agent_id
  where c.id = new.called_by_run_id;

  -- Calls of one run at once queue here, so one over the limit can't slip past the count.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('chat_agent_calls:' || new.called_by_run_id::text)
  );
  if (
    select count(*)
    from public.chat_agent_runs r
    where r.called_by_run_id = new.called_by_run_id
      and r.id <> new.id
  ) >= v_max then
    raise exception 'a run calls other agents at most % times', v_max using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on column public.chat_agent_runs.called_by_run_id is
  'The agent run whose run_agent call, or whose Operator plan, started this one (00466, 00545; trigger_kind agent). One level only, never an Operator; at most 10 for an Operator''s run, 3 for any other. Null for every other run.';

-- ─── Can call ───────────────────────────────────────────────────────────────

-- 00466's, with one rule more: Can call names agents only, never an Operator.
create or replace function public.chat_agent_versions_can_call_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if cardinality(new.can_call) = 0 then
    return new;
  end if;

  if exists (
    select 1
    from unnest(new.can_call) as wanted(id)
    where not exists (
      select 1
      from public.chat_agents callee
      join public.chat_agents caller on caller.organization_id = callee.organization_id
      where callee.id = wanted.id
        and caller.id = new.agent_id
    )
  ) then
    raise exception 'an agent calls only agents of its own workspace'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.chat_agents callee
    where callee.id = any (new.can_call)
      and callee.kind <> 'agent'
  ) then
    raise exception 'an agent calls agents only, never an Operator'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ─── The Operator's summary notice ──────────────────────────────────────────

-- Every kind 00474 allows (00441's, 00446's, 00461's and its own), and the
-- Operator's summary. Whichever migration rewrites this check last must list
-- every kind, or the others' notices are refused.
alter table public.chat_notices
  drop constraint if exists chat_notices_kind_check;
alter table public.chat_notices
  add constraint chat_notices_kind_check check (
    kind in (
      'own_key_failed',
      'own_key_limit_80',
      'own_key_limit_100',
      'agent_went_live',
      'agent_go_live_off',
      'schedule_failed',
      'schedule_paused',
      'followup_result',
      'agent_needs_you',
      'agent_plan_summary'
    )
  ) not valid;
alter table public.chat_notices
  validate constraint chat_notices_kind_check;

reset lock_timeout;

notify pgrst, 'reload schema';
