import { createTranslator } from 'next-intl';
import { z } from 'zod';
import messages from '../../../../messages/en.json';
import { approveAgentPlanFromChat } from '@/lib/actions/chat-operator';
import { getAgentPlanFor } from '@/lib/mcp/agent-plan-reads';
import { contentUuid } from '@/lib/mcp/content-schemas';
import { actorOf } from '../actor/access';
import { FIXTURE_IDS, defineTool } from './define-tool';

/**
 * The AEO Operator's tools (AEO Operator plan §4.2 steps 4–6): offered only
 * in an Operator's run, where the engine offers nothing else but the
 * question card (engine.ts offeredInRun).
 *
 *   - run_agent_plan: today's plan on one card, which starts its agents.
 *     A WRITE that starts work spending the budget: a card in every mode
 *     (alwaysCard, at most Ask), Admins and Managers, Growth and up, on the
 *     plan's brand. Its input is the plan's id and brand, nothing else: the
 *     card (target, cardDetails) is read from the plan's row. Approved in the
 *     app through the person's session (lib/actions/chat-operator.ts), or
 *     from Slack with no session (sessionFree, runFor: the session's checks
 *     asked as its person), both by dispatchChildren, once. Its answer is
 *     codes and statuses: nothing another agent wrote, so it taints nothing.
 *     Skip declines the plan (onSkip).
 *   - get_agent_plan: the run's plan as its row keeps it, with its agents'
 *     names (the workspace's own words: untrusted.ts WORKSPACE_READS).
 *
 * The Operator's modules are read when a row runs, so the registry and the
 * agent modules don't load each other. No MCP tool.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatAgents.operator' });

const operator = () => import('@/lib/chat/operator/approve');
const card = () => import('@/lib/chat/operator/plan-card');

/** Offered only in an AEO Operator's run. A read that fails offers nothing. */
const inOperatorRun = async ({ agentRunId }: { agentRunId: string | null }) =>
  !!agentRunId && (await (await operator()).isOperatorRun(agentRunId));

const planInput = z.object({
  plan_id: contentUuid.describe("Today's plan, by its id from the run's scope (operator_plan)."),
  brand_id: contentUuid.describe("The plan's brand, by its id from the run's scope."),
});

/** The agent run a call is made in: its place (a write's) or its run (a read's). */
const agentRunOf = (ctx: {
  chat?: { agentRunId?: string | null };
  run?: { agentRunId: string | null };
}) => ctx.chat?.agentRunId ?? ctx.run?.agentRunId ?? null;

/** The Operator's card: a write, listed with the writes. */
export const OPERATOR_WRITES = [
  defineTool({
    name: 'run_agent_plan',
    class: 'write',
    area: 'agents',
    description:
      "Put today's plan on its card: the agents the app picked for this brand today, why each, and the day's AI budget. Call it once, with plan_id and brand_id exactly as the run's scope (operator_plan) gives them. The person approves or skips the card; once approved, the agents start in the background. Never call it twice, and never pick or change the agents yourself.",
    defaultPolicy: 'ask',
    maxPolicy: 'ask',
    flags: { alwaysCard: true },
    minRole: 'manager',
    planGate: { minPlan: 'growth' },
    brandOf: { input: 'brand_id' },
    costClass: 'C0',
    labelKey: 'operatorPlan',
    route: '/dashboard/agents',
    mcpTool: null,
    specRow: 'AEO Operator 4.2',
    inputSchema: planInput,
    offerIn: inOperatorRun,
    // Through the person's session, as the app's own changes (lib/actions/chat-operator.ts).
    run: (ctx, input) =>
      approveAgentPlanFromChat(input, {
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        agentRunId: agentRunOf(ctx),
      }),
    // Slack's Approve: no session, the same checks as its person (lib/chat/actor/access.ts).
    sessionFree: true,
    runFor: async (ctx, input) =>
      (await operator()).approvePlanFor(actorOf(ctx), input, agentRunOf(ctx)),
    onSkip: async (run, input) =>
      (await operator()).skipPlan(
        { userId: run.userId, organizationId: run.organizationId },
        input,
        run.agentRunId,
      ),
    // Within the run's workspace and the plan's brand: an id of another's names nothing.
    target: async (input, run) =>
      (await (await card()).planCard(run.organizationId, input.plan_id, input.brand_id))?.target ??
      null,
    cardDetails: async (input, run) =>
      (await (await card()).planCard(run.organizationId, input.plan_id, input.brand_id))?.details ??
      {},
    // "4 agents started", with "1 skipped" under it.
    doneStep: (_input, output) => {
      const done = output as { ok?: unknown; started?: unknown; skipped?: unknown } | null;
      if (done?.ok !== true || typeof done.started !== 'number') return null;
      const skipped = typeof done.skipped === 'number' ? done.skipped : 0;
      return {
        label: t('started', { count: done.started }),
        ...(skipped > 0 ? { detail: t('skipped', { count: skipped }) } : {}),
      };
    },
    fixture: { input: { plan_id: FIXTURE_IDS.item, brand_id: FIXTURE_IDS.brand } },
  }),
];

/** The Operator's read of its plan: listed with the reads. */
export const OPERATOR_READS = [
  defineTool({
    name: 'get_agent_plan',
    class: 'read',
    area: 'agents',
    description:
      "Today's plan of this AEO Operator run, as the app saved it: its plan_id and brand_id, the day, its status, the day's AI budget, and each agent with its id, name, share of the budget and why it runs (codes). Read it only when the run's scope has no operator_plan.",
    // Every role reads, as the other reads; only an Operator's run (its person's) is offered it.
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C0',
    labelKey: 'agentPlan',
    route: '/dashboard/agents',
    mcpTool: null,
    specRow: 'AEO Operator 4.2',
    inputSchema: z.object({ brand_id: contentUuid.describe("The run's brand, from its scope.") }),
    offerIn: inOperatorRun,
    run: (ctx, input) =>
      getAgentPlanFor(ctx, { brandId: input.brand_id, agentRunId: agentRunOf(ctx) }),
    fixture: { input: { brand_id: FIXTURE_IDS.brand } },
  }),
];
