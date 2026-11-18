import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';
import { DemoBrandError, SubscriptionInactiveError } from '@/lib/subscription-guard';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { dispatchChildren, type DispatchDeps, type DispatchRefusal } from '../agent-children';
import { assertWritableFor, canAccessBrandFor, isManagerFor, type RunActor } from '../actor/access';
import { declinePlan, readPlan, readRunPlan, type PlanView } from './plan-store';

/**
 * The AEO Operator's plan card, decided (AEO Operator plan §4.2 steps 5–6):
 *
 *   - Approve, in the app (lib/actions/chat-operator.ts, through the
 *     person's session, the subscription guard first) or in Slack
 *     (approvePlanFor: the same checks asked with the service role, as a
 *     run with no session asks them, lib/chat/actor/access.ts). Both start
 *     the plan's agents with dispatchChildren, once: the engine's approval
 *     key answers a retried call, and the dispatch's claim and child per
 *     item answer a retried approval with the same children.
 *   - Skip: the plan is declined; nothing runs, and Run now may plan again.
 *
 * The call's input is ids only (the plan and its brand); the plan is read
 * from its row, in the run's workspace and brand, and has to be this run's
 * own. What it answers is codes and statuses: never a name or a title.
 * Server only.
 */

const childrenT = createTranslator({ locale: 'en', messages, namespace: 'chatAgents.children' });

/** run_agent_plan's input. */
export interface PlanInput {
  plan_id: string;
  brand_id: string;
}

/** Why the card's Approve started nothing (beside dispatchChildren's own refusals). */
export type ApprovalRefusal = DispatchRefusal | 'forbidden' | 'demo_brand' | 'read_only';

/** One agent of the plan after the Approve: its run's status, or skipped with its code. */
export interface ApprovedChild {
  agent_id: string;
  status: string;
  reason?: string;
}

export type PlanApproval =
  | {
      ok: true;
      plan_id: string;
      /** A retried approval: the plan had started before, these are its runs. */
      repeated: boolean;
      started: number;
      skipped: number;
      children: ApprovedChild[];
    }
  | { ok: false; reason: ApprovalRefusal; message: string };

/** Each refusal's words (chatAgents.children.refused), where the caller has none of its own. */
const REFUSAL_WORDS: Record<
  ApprovalRefusal,
  'not_found' | 'not_operator' | 'not_yours' | 'closed' | 'in_progress' | 'depth' | 'cannot_run'
> = {
  not_found: 'not_found',
  not_operator: 'not_operator',
  not_yours: 'not_yours',
  closed: 'closed',
  in_progress: 'in_progress',
  depth: 'depth',
  cannot_run: 'cannot_run',
  forbidden: 'cannot_run',
  demo_brand: 'cannot_run',
  read_only: 'cannot_run',
};

const refuse = (reason: ApprovalRefusal, message?: string): PlanApproval => ({
  ok: false,
  reason,
  message: message ?? childrenT(`refused.${REFUSAL_WORDS[reason]}`),
});

/** The plan, as this Operator run's own, on its brand and in its workspace; null otherwise. */
async function runPlan(
  organizationId: string,
  input: PlanInput,
  agentRunId: string,
): Promise<PlanView | null> {
  const plan = await readPlan(organizationId, input.plan_id, input.brand_id);
  return plan && plan.runId === agentRunId ? plan : null;
}

/**
 * Starts the approved plan's agents as `actor`, the person the Operator's
 * run acts as (dispatchChildren checks it is): every item of the plan (v1
 * approves the whole plan). After the caller's checks (the session's or
 * Slack's). `agentRunId`: the run the card is in, an Operator's.
 */
export async function approvePlan(
  actor: RunActor,
  input: PlanInput,
  agentRunId: string | null,
  deps: Partial<DispatchDeps> = {},
): Promise<PlanApproval> {
  if (!agentRunId) return refuse('not_operator');
  const plan = await runPlan(actor.organizationId, input, agentRunId);
  if (!plan) return refuse('not_found');
  const result = await dispatchChildren(
    actor.userId,
    agentRunId,
    plan.id,
    plan.items.map((item) => ({ agent_id: item.agent_id })),
    deps,
  );
  if (!result.ok) return refuse(result.reason, result.message);
  const children = result.children.map(
    (child): ApprovedChild => ({
      agent_id: child.agent_id,
      status: child.status,
      ...(child.reason ? { reason: child.reason } : {}),
    }),
  );
  const skipped = children.filter((child) => child.status === 'skipped').length;
  return {
    ok: true,
    plan_id: plan.id,
    repeated: result.repeated,
    started: children.length - skipped,
    skipped,
    children,
  };
}

/**
 * Approve from Slack, with no session (run_agent_plan's runFor): the checks
 * the person's session would get, asked with the service role (a workspace
 * that may write and not the demo brand, an Admin or a Manager now, the
 * brand theirs to use), then the same start as the app's.
 */
export async function approvePlanFor(
  actor: RunActor,
  input: PlanInput,
  agentRunId: string | null,
  deps: Partial<DispatchDeps> = {},
): Promise<PlanApproval> {
  try {
    await assertWritableFor(actor, input.brand_id);
  } catch (err) {
    if (err instanceof DemoBrandError) return refuse('demo_brand', err.message);
    if (err instanceof SubscriptionInactiveError) return refuse('read_only', err.message);
    if (err instanceof Error && err.message === 'not_found') return refuse('not_found');
    throw err;
  }
  if (!(await isManagerFor(actor, actor.organizationId))) return refuse('forbidden');
  if (!(await canAccessBrandFor(actor, input.brand_id))) return refuse('not_found');
  return approvePlan(actor, input, agentRunId, deps);
}

/**
 * Skip on the card, in the app or Slack (run_agent_plan's onSkip): the plan
 * is declined by the run's person. Only this run's own plan; a plan no
 * longer proposed stays as it is.
 */
export async function skipPlan(
  actor: RunActor,
  input: PlanInput,
  agentRunId: string | null,
  now = new Date(),
): Promise<boolean> {
  if (!agentRunId) return false;
  const plan = await runPlan(actor.organizationId, input, agentRunId);
  if (!plan) return false;
  return declinePlan(actor.organizationId, plan.id, plan.brandId, actor.userId, now);
}

/** Whether an agent run is an AEO Operator's (its agent's kind): what its tools are offered in. */
export async function isOperatorRun(agentRunId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('chat_agent_runs')
    .select('agent_id, organization_id')
    .eq('id', agentRunId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the agent run: ${error.message}`);
  const run = data as { agent_id: string | null; organization_id: string } | null;
  if (!run?.agent_id) return false;
  const agent = await supabaseAdmin
    .from('chat_agents')
    .select('kind')
    .eq('id', run.agent_id)
    .eq('organization_id', run.organization_id)
    .maybeSingle();
  if (agent.error) throw new Error(`Could not read the agent: ${agent.error.message}`);
  return (agent.data as { kind?: string } | null)?.kind === 'operator';
}

/**
 * get_agent_plan: the plan of this Operator run, as the model may read it.
 * Ids, codes, counts and shares, and the agents' names (the workspace's own
 * words, read as data: untrusted.ts WORKSPACE_READS). Null outside an
 * Operator's run, or before it has a plan.
 */
export async function readAgentPlanFor(
  organizationId: string,
  agentRunId: string | null,
): Promise<Record<string, unknown>> {
  if (!agentRunId) return { ok: false, code: 'not_operator' };
  const plan = await readRunPlan(organizationId, agentRunId);
  if (!plan) return { ok: false, code: 'no_plan' };
  const ids = plan.items.map((item) => item.agent_id);
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('chat_agents')
      .select('id, name')
      .eq('organization_id', organizationId)
      .in('id', ids);
    if (error) throw new Error(`Could not read the plan's agents: ${error.message}`);
    for (const row of (data ?? []) as { id: string; name: string }[]) names.set(row.id, row.name);
  }
  return {
    ok: true,
    plan_id: plan.id,
    brand_id: plan.brandId,
    day: plan.day,
    status: plan.status,
    budget_share: plan.budgetShare,
    agents: plan.items.map((item) => ({
      agent_id: item.agent_id,
      name: names.get(item.agent_id) ?? null,
      share: item.share,
      reasons: item.reasons,
      ...(item.child_run_id ? { started: true } : {}),
      ...(item.skipped ? { skipped: item.skipped } : {}),
    })),
    passed_over: plan.passedCount,
  };
}
