import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { hasBrandAccess, readAccessProfile } from '@/lib/brand-access';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/types/supabase';
import { calleeCheck, type CalleeRefusal } from './agent-calls';
import {
  agentPlanLimits,
  canWriteAgents,
  operatorDenial,
  operatorJsonFromRow,
} from './agent-rules';
import { AGENT_RUN_DRIVER, startQueuedAgentRuns, type AgentRunDriver } from './agent-runs';
import { loadAgent, readAgentContext } from './agents';
import { chatOperatorEnabled } from './flag';
import { operatorReasonsOf, type OperatorReason } from './operator/reasons';

/**
 * Sub-agents (AEO Operator plan §4.1, PR 2 of 6): an AEO Operator's run
 * starts other agents' runs in the background, once its day's plan
 * (chat_agent_plans, 00545) is approved: the Operator's plan card
 * (run_agent_plan, operator/approve.ts), approved in Chat or in Slack.
 *
 *   - Linked: each child is a chat_agent_runs row queued with trigger agent
 *     and called_by_run_id, the Operator's run (00466's link), on its brand,
 *     acting as the person the Operator's run acts as (its owner, for the
 *     scheduled run), with evidence_json.operator = {agent, plan_id,
 *     reasons}: the Operator's name, the plan and why, as codes. Each is a
 *     run of its own with a chat of its own, started through the workspace's
 *     queue (chat_start_next_agent_run: its runs at once), never in the
 *     Operator's slot, and with no session: the same whether the plan was
 *     approved in the app or in Slack. It runs in its own mode, untainted
 *     (agent-driver.ts operatorScopeOf).
 *   - Checked: every child again for that person (calleeCheck, run_agent's
 *     checks, and the queue's: Required connections, its monthly cap, no run
 *     of it waiting or under way on the brand), and each plan item on the
 *     plan's row. An item that fails is skipped with a code and the rest go
 *     ahead; the database's refusals (00466/00545: one level, agents only, at
 *     most 10) are skipped the same way. openAgentRun checks again at start.
 *   - Capped: each child's max_share is its part of the plan's budget (the
 *     plan's split), at most its own Max per run and at least 1%, and all of
 *     them together at most the day's budget, which is at most the
 *     Operator's run's cap; at most its "N a day" (operator_json.max_runs,
 *     5 by default, never past MAX_CHILDREN) a run. On the server
 *     (chat-budget.js) a child is held within what is left of the Operator's
 *     run's cap too, so together they never pass it.
 *   - Once: the plan is claimed from proposed to dispatching (compare and
 *     set). The claim is renewed before every insert, and one not renewed
 *     for 5 minutes, a request's whole life, is taken over: its request is
 *     gone. Each child is looked for before it is added (called_by_run_id,
 *     agent) and its run's id is kept on its plan item, so a retried or
 *     half-finished approval adds none twice and a retried one answers the
 *     same children. A write that fails gives the claim back.
 *
 * Every read and write is held to the Operator's run's organization and
 * brand; nothing the model wrote is read. Server only.
 */

const childrenT = createTranslator({ locale: 'en', messages, namespace: 'chatAgents.children' });
const reasonT = createTranslator({
  locale: 'en',
  messages,
  namespace: 'chatAgents.runner.operatorReason',
});
const actionCategoryT = createTranslator({
  locale: 'en',
  messages,
  namespace: 'actionCenter.actionCategories',
});
const signalCategoryT = createTranslator({
  locale: 'en',
  messages,
  namespace: 'actionCenter.signalCategories',
});
const kpiT = createTranslator({ locale: 'en', messages, namespace: 'actionCenter.registry' });

/**
 * Runs one Operator's run starts at most, whatever its setting: the
 * setting's top (8); the database allows 10. Each run starts at most its
 * version's own "at most N a day" (operator_json.max_runs, 5 by default).
 */
export const MAX_CHILDREN = 8;
/** The smallest cap a child gets: chat_agent_runs.max_share is in whole percents. */
export const MIN_CHILD_SHARE = 0.01;
/**
 * A claim not renewed for this long belongs to a request that is gone: the
 * approve route's and Slack's decide route's maxDuration is 300 s.
 */
export const CLAIM_STALE_MS = 5 * 60_000;

// ─── Why a child runs ────────────────────────────────────────────────────────

/**
 * Why the Operator starts an agent: codes and their numbers, never text
 * (operator/reasons.ts, a plain module the pages read too). The child's
 * message words them (operatorReasonWords).
 */
export { operatorReasonsOf, type OperatorReason } from './operator/reasons';

/** One reason in words, for the child's message: "3 open Recover actions". */
export function operatorReasonWords(reason: OperatorReason): string {
  switch (reason.code) {
    case 'open_actions':
      return reasonT('open_actions', {
        count: reason.count,
        category: actionCategoryT(reason.category),
      });
    case 'new_signals':
      return reasonT('new_signals', {
        count: reason.count,
        category: signalCategoryT(reason.category),
      });
    case 'kpi_off_track':
      return reasonT('kpi_off_track', { kpi: kpiT(`${reason.kpi}.name`) });
    case 'overdue':
    case 'last_ran':
      return reasonT(reason.code, { days: reason.days });
    case 'never_ran':
      return reasonT('never_ran');
    default:
      return reasonT(reason.code, { count: reason.count });
  }
}

/** Why an Operator started a run, kept on the run (chat_agent_runs.evidence_json.operator). */
export interface OperatorScope {
  /** The Operator's name. */
  agent: string;
  planId: string;
  reasons: OperatorReason[];
}

/** An Operator's child run's scope, read defensively from its evidence; null for any other run. */
export function operatorScopeOf(evidence: unknown): OperatorScope | null {
  const operator = (evidence as { operator?: Record<string, unknown> } | null)?.operator;
  if (!operator || typeof operator.agent !== 'string' || typeof operator.plan_id !== 'string') {
    return null;
  }
  return {
    agent: operator.agent.slice(0, 120),
    planId: operator.plan_id.slice(0, 64),
    reasons: operatorReasonsOf(operator.reasons),
  };
}

// ─── What a dispatch answers ─────────────────────────────────────────────────

/**
 * Why one plan item wasn't started:
 *
 *   - not_in_plan: the approved item isn't on the plan's row;
 *   - not_found, not_allowed, kind, no_brand, missing_connection,
 *     month_cap, busy: its checks (calleeCheck);
 *   - no_budget: the day's budget has less than 1% left for it;
 *   - call_limit, depth, kind: the run's limit, or the database's refusal
 *     (00466/00545: at most 10, one level, agents only);
 *   - failed: the database refused it for another reason.
 */
export type ChildSkipReason =
  | 'not_in_plan'
  | 'not_found'
  | 'not_allowed'
  | 'kind'
  | 'no_brand'
  | 'missing_connection'
  | 'month_cap'
  | 'busy'
  | 'no_budget'
  | 'call_limit'
  | 'depth'
  | 'failed';

/** Why a dispatch started nothing. */
export type DispatchRefusal =
  | 'not_found'
  | 'not_yours'
  | 'closed'
  | 'in_progress'
  | 'depth'
  | 'not_operator'
  | 'cannot_run';

/** One plan item after its dispatch: its child run, or why it has none. */
export interface ChildOutcome {
  agent_id: string;
  /** Its run's status now (queued, running, …); skipped when it wasn't started. */
  status: string;
  run_id: string | null;
  /** Its run's cap, a share of the monthly AI limit; null when it wasn't started. */
  share: number | null;
  reason?: ChildSkipReason;
  /** The reason in words (chatAgents.children.skipped). */
  message?: string;
}

export type DispatchResult =
  | {
      ok: true;
      /** A retried approval: the plan was started before, these are its children. */
      repeated: boolean;
      children: ChildOutcome[];
    }
  | { ok: false; reason: DispatchRefusal; message: string };

const refuse = (reason: DispatchRefusal): DispatchResult => ({
  ok: false,
  reason,
  message: childrenT(`refused.${reason}`),
});

const skipped = (agentId: string, reason: ChildSkipReason): ChildOutcome => ({
  agent_id: agentId,
  status: 'skipped',
  run_id: null,
  share: null,
  reason,
  message: childrenT(`skipped.${reason}`),
});

/** Every skip code, for reading one back from a plan item. */
const CHILD_SKIP_REASONS: readonly ChildSkipReason[] = [
  'not_in_plan',
  'not_found',
  'not_allowed',
  'kind',
  'no_brand',
  'missing_connection',
  'month_cap',
  'busy',
  'no_budget',
  'call_limit',
  'depth',
  'failed',
];

const CALLEE_SKIP: Record<CalleeRefusal, ChildSkipReason> = {
  not_found: 'not_found',
  not_agent: 'kind',
  no_context: 'not_allowed',
  cannot_run: 'not_allowed',
  not_allowed: 'not_allowed',
  no_brand: 'no_brand',
  missing_connection: 'missing_connection',
  month_cap: 'month_cap',
  busy: 'busy',
};

/**
 * The database's refusal of a child's insert, as a skip: 00466/00545's
 * call rules (one level, agents only, at most 10 a run; 23514) and the
 * held-run index (23505). Null for any other error.
 */
export function insertRefusal(error: { code?: string; message: string }): ChildSkipReason | null {
  if (error.code === '23505') return 'busy';
  if (error.code !== '23514') return null;
  if (/never an Operator/i.test(error.message)) return 'kind';
  if (/at most \d+ times/i.test(error.message)) return 'call_limit';
  if (/wasn.t called itself/i.test(error.message)) return 'depth';
  return 'failed';
}

// ─── Rows ────────────────────────────────────────────────────────────────────

interface ParentRun {
  id: string;
  organization_id: string;
  agent_id: string;
  agent_version: number;
  brand_id: string;
  acting_user_id: string | null;
  called_by_run_id: string | null;
  status: string;
  max_share: number;
}

interface PlanRow {
  id: string;
  status: string;
  budget_share: number | null;
  items: Json;
  dispatched_at: string | null;
}

/** A plan item as its row keeps it (the fields this reads; the others are kept as they are). */
interface PlanItem {
  agent_id: string;
  /** Its run's cap, the plan's split of the budget; null when the plan didn't set one. */
  share: number | null;
  reasons: OperatorReason[];
  child_run_id: string | null;
  skipped: string | null;
}

interface ChildRow {
  id: string;
  agent_id: string | null;
  status: string;
  max_share: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** A plan item as stored, or null when it doesn't read. */
function planItemOf(raw: unknown): PlanItem | null {
  if (!isRecord(raw) || typeof raw.agent_id !== 'string' || !raw.agent_id) return null;
  const share = Number(raw.share);
  return {
    agent_id: raw.agent_id,
    share: raw.share !== null && raw.share !== undefined && Number.isFinite(share) ? share : null,
    reasons: operatorReasonsOf(raw.reasons),
    child_run_id: typeof raw.child_run_id === 'string' ? raw.child_run_id : null,
    skipped: typeof raw.skipped === 'string' ? raw.skipped : null,
  };
}

const rawItemsOf = (json: Json): unknown[] => (Array.isArray(json) ? json : []);

/** A share in whole percents, rounded down (0.0428 → 4). */
const pointsOf = (share: number) => Math.floor(share * 100 + 1e-9);

const PARENT_COLUMNS =
  'id, organization_id, agent_id, agent_version, brand_id, acting_user_id, called_by_run_id, status, max_share';
const PLAN_COLUMNS = 'id, status, budget_share, items, dispatched_at';

/** The Operator's run, in the person's workspace; null without its agent or brand. */
async function readParent(org: string, runId: string): Promise<ParentRun | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_agent_runs')
    .select(PARENT_COLUMNS)
    .eq('id', runId)
    .eq('organization_id', org)
    .maybeSingle();
  if (error) throw new Error(`Could not read the Operator's run: ${error.message}`);
  const row = data as
    | (Omit<ParentRun, 'agent_id' | 'brand_id'> & {
        agent_id: string | null;
        brand_id: string | null;
      })
    | null;
  if (!row?.agent_id || !row.brand_id) return null;
  return {
    ...row,
    agent_id: row.agent_id,
    brand_id: row.brand_id,
    max_share: Number(row.max_share),
  };
}

/**
 * The most runs the Operator's run may start: its version's setting (at most
 * N a day, 1–8, 5 by default), never past MAX_CHILDREN. A version that can't
 * be read: the default.
 */
async function childLimit(parent: ParentRun): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('chat_agent_versions')
    .select('operator_json')
    .eq('agent_id', parent.agent_id)
    .eq('version', parent.agent_version)
    .maybeSingle();
  if (error) throw new Error(`Could not read the Operator's settings: ${error.message}`);
  const settings = operatorJsonFromRow((data as { operator_json?: unknown } | null)?.operator_json);
  return Math.min(MAX_CHILDREN, settings.max_runs);
}

/** The plan, only as the Operator's run's own: its organization, brand, run and agent. */
async function readPlan(parent: ParentRun, planId: string): Promise<PlanRow | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_agent_plans')
    .select(PLAN_COLUMNS)
    .eq('id', planId)
    .eq('organization_id', parent.organization_id)
    .eq('brand_id', parent.brand_id)
    .eq('run_id', parent.id)
    .eq('agent_id', parent.agent_id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the Operator's plan: ${error.message}`);
  const row = data as PlanRow | null;
  return row
    ? { ...row, budget_share: row.budget_share === null ? null : Number(row.budget_share) }
    : null;
}

/** The runs the Operator's run started, oldest first. */
async function readChildren(parent: ParentRun, ids?: readonly string[]): Promise<ChildRow[]> {
  if (ids && ids.length === 0) return [];
  let query = supabaseAdmin
    .from('chat_agent_runs')
    .select('id, agent_id, status, max_share, queued_at')
    .eq('organization_id', parent.organization_id)
    .eq('brand_id', parent.brand_id)
    .eq('called_by_run_id', parent.id);
  if (ids) query = query.in('id', [...ids]);
  const { data, error } = await query
    .order('queued_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new Error(`Could not read the Operator's runs: ${error.message}`);
  return ((data ?? []) as ChildRow[]).map((row) => ({ ...row, max_share: Number(row.max_share) }));
}

// ─── The claim ───────────────────────────────────────────────────────────────

/**
 * Claims a proposed plan (proposed → dispatching), or takes over one whose
 * claim is CLAIM_STALE_MS old: its request is gone. While dispatching,
 * dispatched_at is the claim's last renewal (its token); decided_by and
 * decided_at are the approval. Null when another request holds it or
 * moved it first.
 */
async function claimPlan(
  parent: ParentRun,
  plan: PlanRow,
  actorUserId: string,
  now: Date,
): Promise<string | null> {
  const at = now.toISOString();
  const base = () =>
    supabaseAdmin
      .from('chat_agent_plans')
      .update(
        plan.status === 'proposed'
          ? { status: 'dispatching', decided_by: actorUserId, decided_at: at, dispatched_at: at }
          : { dispatched_at: at },
      )
      .eq('id', plan.id)
      .eq('organization_id', parent.organization_id)
      .eq('brand_id', parent.brand_id);
  const stale = new Date(now.getTime() - CLAIM_STALE_MS).toISOString();
  const { data, error } =
    plan.status === 'proposed'
      ? await base().eq('status', 'proposed').select('id')
      : await base()
          .eq('status', 'dispatching')
          .or(`dispatched_at.is.null,dispatched_at.lt."${stale}"`)
          .select('id');
  if (error) throw new Error(`Could not claim the Operator's plan: ${error.message}`);
  return (data ?? []).length > 0 ? at : null;
}

/** Renews the claim before a write; null when it isn't this request's any more. */
async function renewClaim(
  parent: ParentRun,
  planId: string,
  token: string,
  now: Date,
): Promise<string | null> {
  const at = now.toISOString();
  const { data, error } = await supabaseAdmin
    .from('chat_agent_plans')
    .update({ dispatched_at: at })
    .eq('id', planId)
    .eq('organization_id', parent.organization_id)
    .eq('brand_id', parent.brand_id)
    .eq('status', 'dispatching')
    .eq('dispatched_at', token)
    .select('id');
  if (error) throw new Error(`Could not keep the Operator's plan: ${error.message}`);
  return (data ?? []).length > 0 ? at : null;
}

/** Gives a claim back after a failure, so a retried approval goes on at once. */
async function releaseClaim(parent: ParentRun, planId: string, token: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('chat_agent_plans')
    .update({ status: 'proposed', dispatched_at: null })
    .eq('id', planId)
    .eq('organization_id', parent.organization_id)
    .eq('brand_id', parent.brand_id)
    .eq('status', 'dispatching')
    .eq('dispatched_at', token);
  if (error) console.error('[chat/agents] could not give back an Operator plan’s claim:', error);
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

/** A dispatched plan's children, as its row kept them: a retried approval's answer. */
async function dispatchedChildren(parent: ParentRun, plan: PlanRow): Promise<ChildOutcome[]> {
  const items = rawItemsOf(plan.items).flatMap((raw) => {
    const item = planItemOf(raw);
    return item ? [item] : [];
  });
  const runs = new Map(
    (
      await readChildren(
        parent,
        items.flatMap((item) => (item.child_run_id ? [item.child_run_id] : [])),
      )
    ).map((run) => [run.id, run]),
  );
  return items.flatMap((item): ChildOutcome[] => {
    const run = item.child_run_id ? runs.get(item.child_run_id) : undefined;
    if (run) {
      return [
        { agent_id: item.agent_id, status: run.status, run_id: run.id, share: run.max_share },
      ];
    }
    const reason = CHILD_SKIP_REASONS.find((code) => code === item.skipped);
    return reason ? [skipped(item.agent_id, reason)] : [];
  });
}

/** How a dispatch reads the clock and starts the queue: the app's by default. */
export interface DispatchDeps {
  now(): Date;
  /** The agent run driver: started with no session, whoever approved. */
  driver: AgentRunDriver | null;
}

/**
 * Starts an approved plan's agents (above): `items` are the plan's items
 * the person approved, as its card listed them; only their agent ids are
 * read, and each must be on the plan's row, whose split and reasons it
 * uses. `actorUserId` approved it: the person the Operator's run acts as,
 * in its workspace. Answers each item's child run, or why it has none.
 */
export async function dispatchChildren(
  actorUserId: string,
  parentRunId: string,
  planId: string,
  items: readonly { agent_id: string }[],
  deps: Partial<DispatchDeps> = {},
): Promise<DispatchResult> {
  const { now = () => new Date(), driver = AGENT_RUN_DRIVER } = deps;
  // The person's own workspace: the Operator's run has to be in it.
  const org = (await readAccessProfile(actorUserId))?.organization_id;
  if (!org) return refuse('not_found');
  const parent = await readParent(org, parentRunId);
  if (!parent) return refuse('not_found');
  // The card is the run's person's: only they start its plan (Slack's runFor checks the same).
  if (parent.acting_user_id !== actorUserId) return refuse('not_yours');
  const plan = await readPlan(parent, planId);
  if (!plan) return refuse('not_found');
  if (plan.status === 'dispatched' || plan.status === 'summarized') {
    return { ok: true, repeated: true, children: await dispatchedChildren(parent, plan) };
  }
  if (plan.status !== 'proposed' && plan.status !== 'dispatching') return refuse('closed');

  // One level (00466): a run another run started doesn't start runs.
  if (parent.called_by_run_id) return refuse('depth');
  if (parent.status !== 'running' && parent.status !== 'needs_you') return refuse('closed');
  const operator = await loadAgent(org, parent.agent_id);
  if (operator?.row.kind !== 'operator') return refuse('not_operator');
  // The person, read now: Admins and Managers, Growth and up, a workspace that may run agents,
  // with the AEO Operator on for it (CHAT_OPERATOR).
  if (!chatOperatorEnabled(org)) return refuse('cannot_run');
  const context = await readAgentContext({
    userId: actorUserId,
    email: null,
    organizationId: org,
  });
  if (
    !context ||
    !canWriteAgents(context.viewer.role) ||
    !context.plan.writable ||
    operatorDenial(operator.row.kind, context.plan)
  ) {
    return refuse('cannot_run');
  }
  // The brand, as they may use it now: one taken from them since is gone for them.
  if (!hasBrandAccess(context.viewer.brandAccess, parent.brand_id)) return refuse('not_found');

  const claimed = await claimPlan(parent, plan, actorUserId, now());
  if (!claimed) {
    const after = await readPlan(parent, planId);
    if (after?.status === 'dispatched' || after?.status === 'summarized') {
      return { ok: true, repeated: true, children: await dispatchedChildren(parent, after) };
    }
    return refuse(after?.status === 'dispatching' ? 'in_progress' : 'closed');
  }
  let token: string = claimed;

  const rawItems = rawItemsOf(plan.items);
  const onPlan = new Map(
    rawItems.flatMap((raw) => {
      const item = planItemOf(raw);
      return item ? [[item.agent_id, item] as const] : [];
    }),
  );
  const outcomes = new Map<string, ChildOutcome>();
  try {
    // The children a half-finished dispatch added: kept, never added again.
    const earlier = new Map<string, ChildRow>();
    for (const child of await readChildren(parent)) {
      if (child.agent_id && !earlier.has(child.agent_id)) earlier.set(child.agent_id, child);
    }
    let started = earlier.size;
    const limit = await childLimit(parent);
    // The day's budget in whole percents: the plan's, never past the Operator's run's cap.
    // Null when nothing is metered (self-hosted): each child keeps its own cap.
    const budget =
      plan.budget_share === null ? null : pointsOf(Math.min(plan.budget_share, parent.max_share));
    let used = [...earlier.values()].reduce((sum, c) => sum + Math.round(c.max_share * 100), 0);

    for (const { agent_id: agentId } of items) {
      if (typeof agentId !== 'string' || outcomes.has(agentId)) continue;
      const item = onPlan.get(agentId);
      if (!item) {
        outcomes.set(agentId, skipped(agentId, 'not_in_plan'));
        continue;
      }
      const before = earlier.get(agentId);
      if (before) {
        outcomes.set(agentId, {
          agent_id: agentId,
          status: before.status,
          run_id: before.id,
          share: before.max_share,
        });
        continue;
      }
      if (started >= limit) {
        outcomes.set(agentId, skipped(agentId, 'call_limit'));
        continue;
      }
      const checked = await calleeCheck({
        organizationId: org,
        actingUserId: actorUserId,
        agentId,
        brandId: parent.brand_id,
        context,
        forQueue: true,
      });
      if (!checked.ok) {
        outcomes.set(agentId, skipped(agentId, CALLEE_SKIP[checked.reason]));
        continue;
      }
      // Its part of the budget: the plan's split, at most its own Max per run and what is left.
      const own = pointsOf(checked.agent.row.max_run_share);
      const points = Math.min(
        item.share === null ? own : pointsOf(item.share),
        own,
        budget === null ? Infinity : budget - used,
      );
      if (points < pointsOf(MIN_CHILD_SHARE)) {
        outcomes.set(agentId, skipped(agentId, 'no_budget'));
        continue;
      }
      const share = points / 100;

      // Still this request's plan: never two requests adding children at once.
      const renewed = await renewClaim(parent, planId, token, now());
      if (!renewed) return refuse('in_progress');
      token = renewed;
      const { data: inserted, error } = await supabaseAdmin
        .from('chat_agent_runs')
        .insert({
          organization_id: org,
          agent_id: agentId,
          agent_version: checked.agent.row.version,
          brand_id: parent.brand_id,
          trigger_kind: 'agent',
          called_by_run_id: parent.id,
          acting_user_id: actorUserId,
          status: 'queued',
          max_share: share,
          queued_at: now().toISOString(),
          evidence_json: {
            operator: {
              agent: operator.row.name.slice(0, 120),
              plan_id: planId,
              reasons: item.reasons,
            },
          } as unknown as Json,
        })
        .select('id')
        .single();
      if (error || !inserted) {
        const reason = error ? insertRefusal(error) : null;
        if (!reason) {
          throw new Error(`Could not queue the Operator's agent: ${error?.message ?? 'no row'}`);
        }
        outcomes.set(agentId, skipped(agentId, reason));
        continue;
      }
      const runId = (inserted as { id: string }).id;
      started += 1;
      used += points;
      outcomes.set(agentId, { agent_id: agentId, status: 'queued', run_id: runId, share });
    }

    // Each item's child run, or why it has none, on the plan's row; the rest kept as they were.
    const written = rawItems.map((raw) => {
      const item = planItemOf(raw);
      const outcome = item ? outcomes.get(item.agent_id) : undefined;
      if (!isRecord(raw) || !outcome) return raw;
      const kept: Record<string, unknown> = { ...raw, child_run_id: outcome.run_id };
      if (outcome.reason) kept.skipped = outcome.reason;
      else delete kept.skipped;
      return kept;
    });
    const at = now().toISOString();
    const { data: done, error: doneError } = await supabaseAdmin
      .from('chat_agent_plans')
      .update({ status: 'dispatched', dispatched_at: at, items: written as unknown as Json })
      .eq('id', planId)
      .eq('organization_id', org)
      .eq('brand_id', parent.brand_id)
      .eq('status', 'dispatching')
      .eq('dispatched_at', token)
      .select('id');
    if (doneError) throw new Error(`Could not keep the Operator's plan: ${doneError.message}`);
    if ((done ?? []).length === 0) return refuse('in_progress');
  } catch (err) {
    await releaseClaim(parent, planId, token);
    throw err;
  }

  // The workspace's queue starts them as it has room, with no session: every child alike.
  const children = [...outcomes.values()];
  if (children.some((child) => child.status === 'queued')) {
    await startQueuedAgentRuns(org, agentPlanLimits(context.plan).runsAtOnce, driver, null);
    const statusOf = new Map(
      (
        await readChildren(
          parent,
          children.flatMap((child) => (child.run_id ? [child.run_id] : [])),
        )
      ).map((run) => [run.id, run.status]),
    );
    for (const child of children) {
      if (child.run_id) child.status = statusOf.get(child.run_id) ?? child.status;
    }
  }
  return { ok: true, repeated: false, children };
}
