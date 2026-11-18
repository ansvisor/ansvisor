import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/types/supabase';
import { operatorReasonsOf, type OperatorReason } from '../agent-children';
import type { DayPlan } from './plan';

/**
 * An AEO Operator's plans, as chat_agent_plans (00545) keeps them (AEO
 * Operator plan §4.2 steps 2, 5–8): the row its run writes once the day is
 * planned, the card reads, the approval claims (agent-children.ts), Skip
 * declines, the sweep expires at the end of its day, and the sweep marks
 * summarized once its summary is sent (operator/summary.ts). One plan in
 * force per Operator, brand and day (the partial unique index); a declined,
 * expired or empty one leaves room for Run now to make another.
 *
 * Every read and write is held to the plan's organization (and brand where
 * it is known): an id of another workspace's names nothing. What it keeps is
 * codes, counts and shares, never text from outside. Server only.
 */

/** The plan statuses that hold the day (chat_agent_plans_day_uidx). */
export const IN_FORCE = ['proposed', 'dispatching', 'dispatched', 'summarized'] as const;

/** The "not today" reasons a plan keeps at most: its row's passed is at most 32 KB. */
export const MAX_PASSED = 200;

/** One plan item as the row keeps it. */
export interface StoredPlanItem {
  agent_id: string;
  /** Its run's cap: its part of today's budget. */
  share: number;
  /** Its estimated cost; null when nothing is metered (self-hosted). */
  cost: number | null;
  value: number;
  reasons: OperatorReason[];
  /** Its child run, once started; with `skipped`, why it wasn't (agent-children.ts). */
  child_run_id: string | null;
  skipped?: string;
}

/** A plan as the card, the tools and the sweep read it. */
export interface PlanView {
  id: string;
  organizationId: string;
  agentId: string;
  runId: string;
  brandId: string;
  day: string;
  status: string;
  /** Today's budget after pacing; null when nothing is metered. */
  budgetShare: number | null;
  plannedShare: number | null;
  items: StoredPlanItem[];
  /** The agents passed over today, counted. */
  passedCount: number;
  decidedAt: string | null;
  /** When its agents were started (dispatched), or its claim's last renewal while dispatching. */
  dispatchedAt: string | null;
  createdAt: string;
}

const PLAN_COLUMNS =
  'id, organization_id, agent_id, run_id, brand_id, plan_day, status, budget_share, planned_share, items, passed, decided_at, dispatched_at, created_at';

const numberOr = (value: unknown, fallback: number | null) => {
  const n = Number(value);
  return value !== null && value !== undefined && Number.isFinite(n) ? n : fallback;
};

/** A stored item read back defensively: what doesn't read is left out. */
function itemOf(raw: unknown): StoredPlanItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.agent_id !== 'string' || !item.agent_id) return null;
  return {
    agent_id: item.agent_id,
    share: numberOr(item.share, 0) ?? 0,
    cost: numberOr(item.cost, null),
    value: numberOr(item.value, 0) ?? 0,
    reasons: operatorReasonsOf(item.reasons),
    child_run_id: typeof item.child_run_id === 'string' ? item.child_run_id : null,
    ...(typeof item.skipped === 'string' ? { skipped: item.skipped } : {}),
  };
}

function viewOf(row: Record<string, unknown>): PlanView {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    agentId: String(row.agent_id),
    runId: String(row.run_id),
    brandId: String(row.brand_id),
    day: String(row.plan_day),
    status: String(row.status),
    budgetShare: numberOr(row.budget_share, null),
    plannedShare: numberOr(row.planned_share, null),
    items: (Array.isArray(row.items) ? row.items : []).flatMap((raw) => {
      const item = itemOf(raw);
      return item ? [item] : [];
    }),
    passedCount: Array.isArray(row.passed) ? row.passed.length : 0,
    decidedAt: typeof row.decided_at === 'string' ? row.decided_at : null,
    dispatchedAt: typeof row.dispatched_at === 'string' ? row.dispatched_at : null,
    createdAt: String(row.created_at ?? ''),
  };
}

/** One plan of the workspace, by its id (and its brand, when the caller knows it); null otherwise. */
export async function readPlan(
  organizationId: string,
  planId: string,
  brandId?: string,
): Promise<PlanView | null> {
  let query = supabaseAdmin
    .from('chat_agent_plans')
    .select(PLAN_COLUMNS)
    .eq('id', planId)
    .eq('organization_id', organizationId);
  if (brandId) query = query.eq('brand_id', brandId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Could not read the Operator's plan: ${error.message}`);
  return data ? viewOf(data as Record<string, unknown>) : null;
}

/** The plan an Operator's run made (one a run); null before it made one. */
export async function readRunPlan(organizationId: string, runId: string): Promise<PlanView | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_agent_plans')
    .select(PLAN_COLUMNS)
    .eq('run_id', runId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the Operator's plan: ${error.message}`);
  return data ? viewOf(data as Record<string, unknown>) : null;
}

/** The Operator's plan in force for the brand and day (proposed, being started or started). */
export async function planInForce(
  organizationId: string,
  agentId: string,
  brandId: string,
  day: string,
): Promise<PlanView | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_agent_plans')
    .select(PLAN_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('agent_id', agentId)
    .eq('brand_id', brandId)
    .eq('plan_day', day)
    .in('status', [...IN_FORCE])
    .limit(1);
  if (error) throw new Error(`Could not read the Operator's plans: ${error.message}`);
  const row = (data ?? [])[0];
  return row ? viewOf(row as Record<string, unknown>) : null;
}

/** What one Operator run's plan writes. */
export interface NewPlan {
  organizationId: string;
  agentId: string;
  runId: string;
  brandId: string;
  day: string;
  plan: DayPlan;
}

/**
 * The plan's row: proposed with its items, or empty (nothing to do today).
 * Shares as the row keeps them: today's budget, and what the items' caps
 * add up to within it (never past it). Null when another plan holds the day
 * (the unique index, 23505), or this run made its plan already.
 */
export async function insertPlan(input: NewPlan): Promise<PlanView | null> {
  const { plan } = input;
  const items: StoredPlanItem[] = plan.items.map((item) => ({
    agent_id: item.agentId,
    share: item.share,
    cost: item.cost,
    value: item.value,
    reasons: item.reasons as OperatorReason[],
    child_run_id: null,
  }));
  const planned = items.reduce((total, item) => total + item.share, 0);
  const budget = plan.budgetToday;
  const { data, error } = await supabaseAdmin
    .from('chat_agent_plans')
    .insert({
      organization_id: input.organizationId,
      agent_id: input.agentId,
      run_id: input.runId,
      brand_id: input.brandId,
      plan_day: input.day,
      status: items.length > 0 ? 'proposed' : 'empty',
      budget_share: budget,
      planned_share: budget === null ? null : Math.min(budget, Math.round(planned * 100) / 100),
      items: items as unknown as Json,
      passed: plan.passed
        .slice(0, MAX_PASSED)
        .map((p) => ({ agent_id: p.agentId, reason: p.reason })) as unknown as Json,
    })
    .select(PLAN_COLUMNS)
    .single();
  if (error?.code === '23505') return null;
  if (error || !data) throw new Error(`Could not keep the Operator's plan: ${error?.message}`);
  return viewOf(data as Record<string, unknown>);
}

/**
 * Skip on the plan's card (§4.2 step 6): proposed → declined, by the person
 * who skipped it. Nothing runs, and Run now may make a new plan today. False
 * when it wasn't proposed any more (started, expired, declined already).
 */
export async function declinePlan(
  organizationId: string,
  planId: string,
  brandId: string,
  userId: string,
  now: Date,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('chat_agent_plans')
    .update({ status: 'declined', decided_by: userId, decided_at: now.toISOString() })
    .eq('id', planId)
    .eq('organization_id', organizationId)
    .eq('brand_id', brandId)
    .eq('status', 'proposed')
    .select('id');
  if (error) throw new Error(`Could not skip the Operator's plan: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * An unanswered plan at the end of its day, or one whose run ended without
 * an answer (§4.2 step 8): proposed → expired. False when it wasn't proposed.
 */
export async function expirePlan(organizationId: string, planId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('chat_agent_plans')
    .update({ status: 'expired' })
    .eq('id', planId)
    .eq('organization_id', organizationId)
    .eq('status', 'proposed')
    .select('id');
  if (error) throw new Error(`Could not expire the Operator's plan: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * The proposed plans whose day may have ended somewhere (on or before
 * `lastDay`, the latest day the zones ahead of UTC have closed), oldest
 * first: the sweep checks each against its own zone. `orgIds` holds the
 * read to those workspaces (null: every one), so plans of workspaces the
 * flag is off for can't fill the page and starve the rest.
 */
export async function proposedPlansThrough(
  lastDay: string,
  limit: number,
  orgIds: readonly string[] | null = null,
): Promise<PlanView[]> {
  if (orgIds?.length === 0) return [];
  let query = supabaseAdmin
    .from('chat_agent_plans')
    .select(PLAN_COLUMNS)
    .eq('status', 'proposed')
    .lte('plan_day', lastDay);
  if (orgIds) query = query.in('organization_id', [...orgIds]);
  const { data, error } = await query.order('plan_day', { ascending: true }).limit(limit);
  if (error) throw new Error(`Could not read the Operators' plans: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(viewOf);
}

/**
 * The plans whose agents were started and whose summary hasn't been sent
 * (dispatched), the longest started first: the sweep sends each one's
 * summary once its agents are done or wait for their person, or at its
 * deadline (operator/summary.ts). `orgIds` as proposedPlansThrough has it.
 */
export async function dispatchedPlans(
  limit: number,
  orgIds: readonly string[] | null = null,
): Promise<PlanView[]> {
  if (orgIds?.length === 0) return [];
  let query = supabaseAdmin
    .from('chat_agent_plans')
    .select(PLAN_COLUMNS)
    .eq('status', 'dispatched');
  if (orgIds) query = query.in('organization_id', [...orgIds]);
  const { data, error } = await query.order('dispatched_at', { ascending: true }).limit(limit);
  if (error) throw new Error(`Could not read the Operators' plans: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(viewOf);
}

/**
 * The summary is this sweep's to send (§4.2 step 7): dispatched →
 * summarized, with when and what it says, in one compare-and-set, so of two
 * sweeps at once only one sends it. False when the plan wasn't dispatched
 * any more (another sweep took it first).
 */
export async function markPlanSummarized(
  organizationId: string,
  planId: string,
  summary: Json,
  now: Date,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('chat_agent_plans')
    .update({ status: 'summarized', summarized_at: now.toISOString(), summary_json: summary })
    .eq('id', planId)
    .eq('organization_id', organizationId)
    .eq('status', 'dispatched')
    .select('id');
  if (error) throw new Error(`Could not keep the Operator's summary: ${error.message}`);
  return (data ?? []).length > 0;
}
