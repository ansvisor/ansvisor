import { hasBrandAccess, type BrandAccess } from '@/lib/brand-access';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { dayIn, isTimeZone } from '@/lib/time-zone';
import { operatorReasonsOf, shownReasons, type OperatorReason } from './reasons';

/**
 * The AEO Operator as Agent Center shows it (AEO Operator plan §4.3): the
 * line on its card for today's plan ("Today: 4 agents · waiting for you"),
 * and its page's Today panel (the plan's agents, why each, each one's run
 * and chat, the budget used) and its last 7 plans. Read from
 * chat_agent_plans (00545) and the runs it started (called_by_run_id),
 * always in the workspace and only on brands the person may see; agents
 * they can't see are never named. Codes, counts and shares only: the pages
 * put the words around them. Server only.
 */

/** Where a day's plan is, as the card and the panel say it. */
export type OperatorDayState =
  /** Proposed: its card waits for the person's OK. */
  | 'waiting'
  /** Approved: its agents are being started. */
  | 'starting'
  /** Approved: its agents were started (and maybe summed up). */
  | 'approved'
  /** Nothing to do today: no agent was picked. */
  | 'nothing'
  /** Skip on its card. */
  | 'skipped'
  /** Its day ended, or its run did, with no answer. */
  | 'expired';

const STATES: Record<string, OperatorDayState> = {
  proposed: 'waiting',
  dispatching: 'starting',
  dispatched: 'approved',
  summarized: 'approved',
  empty: 'nothing',
  declined: 'skipped',
  expired: 'expired',
};

/** A plan's status as its state; an unknown one reads as expired (nothing runs). */
export const dayStateOf = (status: string): OperatorDayState => STATES[status] ?? 'expired';

/** A started agent's run that has ended, one way or another: it counts as done. */
const ENDED = new Set(['done', 'failed', 'stopped', 'skipped']);

/** Today's plan on the Operator's card: its state, its agents, how many started and ended. */
export interface OperatorTodayLine {
  state: OperatorDayState;
  /** Agents in the plan. */
  agents: number;
  /** Of them, started (a run of their own). */
  started: number;
  /** Of those, ended. */
  done: number;
}

/** The Agents card of an AEO Operator: today's plan, or null before there is one today. */
export interface OperatorCardView {
  today: OperatorTodayLine | null;
}

/** One agent of a plan, as the Operator's Today panel shows it. */
export interface OperatorItemView {
  /** Its agent's handle, for its page; null when hidden or deleted. */
  agentId: string | null;
  /** Its agent's name; empty when hidden or deleted. */
  agent: string;
  /** An agent the person can't see: "An agent you can't see", with no name or links. */
  hidden?: true;
  /** Why it runs today: the reasons its line shows (shownReasons). */
  reasons: OperatorReason[];
  /** Its part of the day's budget: its run's cap. */
  share: number;
  /** What the plan expected it to cost; null when nothing is metered. */
  cost: number | null;
  /** Its run's status once started; null before (or never). */
  status: string | null;
  /** Why it wasn't started (agent-children.ts DispatchSkip), or null. */
  skipped: string | null;
  /** What its run used of the monthly AI limit; 0 before it starts. */
  usageShare: number;
  /** Its run's chat, when the person can open it. */
  chatId: string | null;
}

/** One plan as the Operator's page shows it. */
export interface OperatorPlanView {
  day: string;
  status: string;
  state: OperatorDayState;
  /** The day's budget after pacing; null when nothing is metered (self-hosted). */
  budgetShare: number | null;
  /** What it used: its own run and the runs it started. */
  usedShare: number;
  items: OperatorItemView[];
  /** Agents passed over that day, counted. */
  passedCount: number;
  /** The Operator's run's chat, where its card is, when the person can open it. */
  chatId: string | null;
}

/** One of the last plans: its day, state, the agents it ran and the AI they used. */
export interface OperatorHistoryRow {
  day: string;
  status: string;
  state: OperatorDayState;
  /** Agents it ran (runs it started). */
  agents: number;
  usedShare: number;
  budgetShare: number | null;
}

/** An AEO Operator's page: today's plan and its last 7 plans, newest first. */
export interface OperatorDetailView {
  /** The day it plans for now, on its schedule's clock. */
  day: string;
  today: OperatorPlanView | null;
  history: OperatorHistoryRow[];
}

/** Plans the page lists. */
export const HISTORY_PLANS = 7;

/**
 * The zone an Operator's day is counted in, as its run counts it
 * (agent-driver.ts planZoneOf): its first schedule that is on, else UTC.
 */
export function operatorZoneOf(
  triggers: readonly { kind: string; config_json: unknown; enabled: boolean }[],
): string {
  for (const trigger of triggers) {
    if (trigger.kind !== 'schedule' || !trigger.enabled) continue;
    const zone = (trigger.config_json as { timezone?: unknown } | null)?.timezone;
    if (isTimeZone(zone)) return zone;
  }
  return 'UTC';
}

// ─── Rows ────────────────────────────────────────────────────────────────────

interface PlanRow {
  id: string;
  agentId: string;
  runId: string;
  brandId: string;
  day: string;
  status: string;
  budgetShare: number | null;
  items: {
    agentId: string;
    share: number;
    cost: number | null;
    reasons: OperatorReason[];
    childRunId: string | null;
    skipped: string | null;
  }[];
  passedCount: number;
}

interface ChildRow {
  id: string;
  agent_id: string | null;
  brand_id: string | null;
  called_by_run_id: string | null;
  status: string;
  usage_share: number;
}

const PLAN_COLUMNS =
  'id, agent_id, run_id, brand_id, plan_day, status, budget_share, items, passed, created_at';

const numberOr = <T>(value: unknown, fallback: T): number | T => {
  const n = Number(value);
  return value !== null && value !== undefined && Number.isFinite(n) ? n : fallback;
};

/** A stored plan read back defensively: an item that doesn't read is left out. */
function planOf(row: Record<string, unknown>): PlanRow {
  const items = (Array.isArray(row.items) ? row.items : []).flatMap((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    if (typeof item.agent_id !== 'string' || !item.agent_id) return [];
    return [
      {
        agentId: item.agent_id,
        share: numberOr(item.share, 0),
        cost: numberOr(item.cost, null),
        reasons: operatorReasonsOf(item.reasons),
        childRunId: typeof item.child_run_id === 'string' ? item.child_run_id : null,
        skipped: typeof item.skipped === 'string' ? item.skipped : null,
      },
    ];
  });
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    runId: String(row.run_id),
    brandId: String(row.brand_id),
    day: String(row.plan_day),
    status: String(row.status),
    budgetShare: numberOr(row.budget_share, null),
    items,
    passedCount: Array.isArray(row.passed) ? row.passed.length : 0,
  };
}

/** The runs the plans started, in the workspace, by the Operator's runs that started them. */
async function childRunsOf(organizationId: string, runIds: string[]): Promise<ChildRow[]> {
  if (runIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('chat_agent_runs')
    .select('id, agent_id, brand_id, called_by_run_id, status, usage_share')
    .eq('organization_id', organizationId)
    .in('called_by_run_id', runIds);
  if (error) throw new Error(`Could not read the Operator's agents' runs: ${error.message}`);
  return (data ?? []) as ChildRow[];
}

/** The Operator's own runs' AI use, by run id, in the workspace. */
async function ownUseOf(organizationId: string, runIds: string[]): Promise<Map<string, number>> {
  if (runIds.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from('chat_agent_runs')
    .select('id, usage_share')
    .eq('organization_id', organizationId)
    .in('id', runIds);
  if (error) throw new Error(`Could not read the Operator's runs: ${error.message}`);
  return new Map(
    ((data ?? []) as { id: string; usage_share: number }[]).map((r) => [
      r.id,
      Number(r.usage_share) || 0,
    ]),
  );
}

/** A plan's line from its row and its started runs' statuses (by run id). */
export function todayLineOf(
  plan: Pick<PlanRow, 'status' | 'items'>,
  statuses: ReadonlyMap<string, string>,
): OperatorTodayLine {
  const started = plan.items.filter((item) => item.childRunId);
  const done = started.filter((item) => ENDED.has(statuses.get(item.childRunId!) ?? '')).length;
  return {
    state: dayStateOf(plan.status),
    agents: plan.items.length,
    started: started.length,
    done,
  };
}

/** The Today panel's plan as its card's line (the page's header shows the same). */
export function todayLineOfView(
  plan: Pick<OperatorPlanView, 'state' | 'items'>,
): OperatorTodayLine {
  const started = plan.items.filter((item) => item.status !== null);
  return {
    state: plan.state,
    agents: plan.items.length,
    started: started.length,
    done: started.filter((item) => ENDED.has(item.status!)).length,
  };
}

// ─── The Agents list ─────────────────────────────────────────────────────────

/**
 * Each Operator's line for today (Agent Center's cards): its plan of today
 * on its own clock, the newest if Run now made another after a Skip, on a
 * brand the person may see. One read for the plans and one for the runs
 * they started; none without an Operator.
 */
export async function readOperatorCards(
  organizationId: string,
  access: BrandAccess,
  operators: readonly { id: string; zone: string }[],
  now: Date,
): Promise<Map<string, OperatorCardView>> {
  const cards = new Map<string, OperatorCardView>();
  if (operators.length === 0) return cards;
  const todays = new Map(operators.map((op) => [op.id, dayIn(now.getTime(), op.zone)]));
  const since = [...todays.values()].sort()[0];
  const { data, error } = await supabaseAdmin
    .from('chat_agent_plans')
    .select(PLAN_COLUMNS)
    .eq('organization_id', organizationId)
    .in(
      'agent_id',
      operators.map((op) => op.id),
    )
    .gte('plan_day', since)
    .order('created_at', { ascending: false })
    .limit(operators.length * 10);
  if (error) throw new Error(`Could not read the Operators' plans: ${error.message}`);
  const plans = ((data ?? []) as Record<string, unknown>[])
    .map(planOf)
    .filter((plan) => hasBrandAccess(access, plan.brandId));
  const today = new Map<string, PlanRow>();
  for (const plan of plans) {
    if (plan.day === todays.get(plan.agentId) && !today.has(plan.agentId)) {
      today.set(plan.agentId, plan);
    }
  }
  const childIds = [...today.values()].flatMap((plan) =>
    plan.items.flatMap((item) => (item.childRunId ? [item.childRunId] : [])),
  );
  const statuses = new Map<string, string>();
  if (childIds.length > 0) {
    const read = await supabaseAdmin
      .from('chat_agent_runs')
      .select('id, status')
      .eq('organization_id', organizationId)
      .in('id', childIds);
    if (read.error) throw new Error(`Could not read the Operators' runs: ${read.error.message}`);
    for (const row of (read.data ?? []) as { id: string; status: string }[]) {
      statuses.set(row.id, row.status);
    }
  }
  for (const op of operators) {
    const plan = today.get(op.id);
    cards.set(op.id, { today: plan ? todayLineOf(plan, statuses) : null });
  }
  return cards;
}

// ─── The Operator's page ─────────────────────────────────────────────────────

/** What the page asks of the agents' reads (agents.ts): who the person sees, and which chats open. */
export interface OperatorLookups {
  /** The workspace's agents by id, with whether the person sees each; deleted ones left out. */
  agents(ids: string[]): Promise<ReadonlyMap<string, { name: string; seen: boolean }>>;
  /** The chats of these runs the person can open, by run id. */
  chats(runIds: string[]): Promise<ReadonlyMap<string, string>>;
}

/**
 * The Operator's Today panel and its last 7 plans: today's plan (its newest
 * of today) with each agent's reasons, run, chat and AI use; then each plan's
 * day, state, the agents it ran and the AI they used with its own run.
 */
export async function readOperatorDetail(
  organizationId: string,
  access: BrandAccess,
  operator: { id: string; zone: string },
  lookups: OperatorLookups,
  now: Date,
): Promise<OperatorDetailView> {
  const day = dayIn(now.getTime(), operator.zone);
  const { data, error } = await supabaseAdmin
    .from('chat_agent_plans')
    .select(PLAN_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('agent_id', operator.id)
    .order('plan_day', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(HISTORY_PLANS * 2);
  if (error) throw new Error(`Could not read the Operator's plans: ${error.message}`);
  const plans = ((data ?? []) as Record<string, unknown>[])
    .map(planOf)
    .filter((plan) => hasBrandAccess(access, plan.brandId))
    .slice(0, HISTORY_PLANS);
  if (plans.length === 0) return { day, today: null, history: [] };

  const runIds = plans.map((plan) => plan.runId);
  const [children, own] = await Promise.all([
    childRunsOf(organizationId, runIds),
    ownUseOf(organizationId, runIds),
  ]);
  const used = (plan: PlanRow) =>
    (own.get(plan.runId) ?? 0) +
    children
      .filter((child) => child.called_by_run_id === plan.runId)
      .reduce((total, child) => total + (Number(child.usage_share) || 0), 0);
  const history = plans.map(
    (plan): OperatorHistoryRow => ({
      day: plan.day,
      status: plan.status,
      state: dayStateOf(plan.status),
      agents: children.filter((child) => child.called_by_run_id === plan.runId).length,
      usedShare: used(plan),
      budgetShare: plan.budgetShare,
    }),
  );

  const current = plans.find((plan) => plan.day === day) ?? null;
  if (!current) return { day, today: null, history };
  const mine = children.filter((child) => child.called_by_run_id === current.runId);
  const byId = new Map(mine.map((child) => [child.id, child]));
  const [agents, chats] = await Promise.all([
    lookups.agents(current.items.map((item) => item.agentId)),
    lookups.chats([current.runId, ...mine.map((child) => child.id)]),
  ]);
  const items = current.items.map((item): OperatorItemView => {
    const agent = agents.get(item.agentId);
    const child = item.childRunId ? byId.get(item.childRunId) : undefined;
    // An agent the person can't see, or a run on a brand they can't use, is never named.
    const hidden =
      (!!agent && !agent.seen) ||
      (!!child && !!child.brand_id && !hasBrandAccess(access, child.brand_id));
    return {
      agentId: hidden || !agent ? null : item.agentId,
      agent: hidden ? '' : (agent?.name ?? ''),
      ...(hidden ? { hidden: true as const } : {}),
      reasons: shownReasons(item.reasons),
      share: item.share,
      cost: item.cost,
      status: child?.status ?? null,
      skipped: item.skipped,
      usageShare: child ? Number(child.usage_share) || 0 : 0,
      chatId: !hidden && child ? (chats.get(child.id) ?? null) : null,
    };
  });
  return {
    day,
    today: {
      day: current.day,
      status: current.status,
      state: dayStateOf(current.status),
      budgetShare: current.budgetShare,
      usedShare: used(current),
      items,
      passedCount: current.passedCount,
      chatId: chats.get(current.runId) ?? null,
    },
    history,
  };
}
