import messages from '../../../messages/en.json';
import type { McpAuthContext } from '@/lib/mcp-auth';
import { AGENT_RUNS_MAX, type AgentListView } from '@/lib/chat/agent-rules';
import { percentOf, writesAgents } from '@/lib/chat/agent-view';
import type { AgentCallView, AgentContext, AgentListItem, AgentRunView } from '@/lib/chat/agents';
import { brandAllowed } from './data';
import { pageOfList } from './list-page';

/**
 * Chat's reads of Action Center › Agents (the owner's plan of 2026-11-16,
 * step 6b): Your agents as the page lists them for the person (listAgents:
 * the tab, its search, every agent they may see and nothing else, a private
 * agent only its owner's and the Admins'), and an agent's runs as its Runs
 * tab lists them (runsOf, runViews: the runs on brands they may see), held
 * to the brand asked about. The agents API's own functions, with the
 * person's context read fresh (readAgentContext), so a role or a brand taken
 * away counts at once. Never an id of a run, a version or a person; never a
 * dollar; never the name of an agent the person can't see, which a run
 * started or which started it. Server only.
 */

/** Chat's agents, read when needed: they import what the registry's own rows import. */
const agentsLib = () => import('@/lib/chat/agents');

/** The person's agent context in their workspace, or null when they can't act there now. */
async function contextOf(auth: McpAuthContext): Promise<AgentContext | null> {
  if (!auth.organizationId) return null;
  const { readAgentContext } = await agentsLib();
  return readAgentContext({
    userId: auth.userId,
    email: auth.email,
    organizationId: auth.organizationId,
  });
}

const VIEW_WORDS: Record<AgentListView, string> = {
  mine: 'Mine',
  workspace: 'Workspace',
  paused: 'Paused',
  archived: 'Archived',
};

const chatHref = (chatId: string | null) =>
  chatId ? (`/dashboard/chat/${encodeURIComponent(chatId)}` as const) : null;

/** An agent the person can't see, as the Runs tab names it: never by its name. */
const HIDDEN_AGENT = messages.chatAgents.calls.canCall.hidden;

/**
 * A run a run started, as its row opens it: its agent, status, chat and
 * agent page; one the person can't see only as "An agent you can't see".
 */
function ranAgent(call: AgentCallView) {
  if (call.hidden) return { agent: HIDDEN_AGENT, status: call.status };
  return {
    agent: call.agent,
    status: call.status,
    open: chatHref(call.chatId),
    agent_page: call.agentId ? `/dashboard/agents/${encodeURIComponent(call.agentId)}` : null,
  };
}

/** An agent as its card on Action Center › Agents shows it. */
function agentRow(agent: AgentListItem) {
  const next = agent.triggers
    .filter((trigger) => trigger.enabled && trigger.nextFireAt)
    .map((trigger) => trigger.nextFireAt as string)
    .sort()[0];
  return {
    id: agent.id,
    name: agent.name,
    status: agent.status,
    ...(agent.pausedReason ? { paused_reason: agent.pausedReason } : {}),
    visibility: agent.visibility,
    mine: agent.mine,
    skills: agent.skills,
    mode: agent.mode,
    triggers: agent.triggers.map((trigger) => ({
      kind: trigger.kind,
      enabled: trigger.enabled,
      ...(trigger.kind === 'schedule' ? { schedule: trigger.config } : {}),
      next_run: trigger.nextFireAt,
      last_fired: trigger.lastFiredAt,
    })),
    next_run: next ?? null,
    brands: agent.scope.allBrands ? 'all' : agent.scope.brands,
    last_run: agent.lastRun && {
      status: agent.lastRun.status,
      at: agent.lastRun.at,
      waits_on_you: agent.lastRun.status === 'needs_you',
      open: chatHref(agent.lastRun.chatId),
    },
    outcomes_30d: agent.outcomes30d,
    ai_use_30d: agent.usage30d
      ? { share_of_monthly_limit: percentOf(agent.usage30d.share), runs: agent.usage30d.runs }
      : null,
    ...(agent.goLiveLimit !== undefined ? { publishes_on_its_own_per_day: agent.goLiveLimit } : {}),
    open: `/dashboard/agents/${encodeURIComponent(agent.id)}`,
  };
}

/**
 * Your agents (list_my_agents), as Action Center › Agents lists them for the
 * person: a tab (Mine by default; Workspace for those who only read agents,
 * as the page opens for them) and its search by name or skill, newest
 * change first, a page at a time, with each tab's count and the agents on.
 */
export async function listMyAgentsFor(
  auth: McpAuthContext,
  params: { view?: AgentListView; search?: string; limit?: number; offset?: number },
) {
  const ctx = await contextOf(auth);
  if (!ctx) return null;
  const view = params.view ?? (writesAgents(ctx.viewer.role) ? 'mine' : 'workspace');
  const { listAgents } = await agentsLib();
  const list = await listAgents(ctx, { view, q: params.search?.trim() || undefined });
  const { rows, ...meta } = pageOfList(list.agents.map(agentRow), params, {
    what: `agents in ${VIEW_WORDS[view]}${params.search?.trim() ? ` matching "${params.search.trim()}"` : ''}`,
    order: 'most recently changed first',
  });
  return {
    ...meta,
    view,
    tabs: list.counts,
    agents_on: list.active,
    agents: rows,
  };
}

/** The statuses a run can be in, as the Runs tab shows them. */
export const AGENT_RUN_STATUSES = [
  'queued',
  'running',
  'needs_you',
  'done',
  'failed',
  'stopped',
  'skipped',
  'paused_cap',
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

/** A run as the Runs tab shows it: what started it, when, how it ended, and what waits on whom. */
function runRow(run: AgentRunView) {
  return {
    status: run.status,
    waits_on_you: run.status === 'needs_you',
    trigger: run.triggerKind,
    version: run.version,
    brand: run.brand,
    by: run.by,
    queued: run.queuedAt,
    started: run.startedAt,
    finished: run.finishedAt,
    ...(run.skippedReason ? { skipped_reason: run.skippedReason } : {}),
    ...(run.stopReason ? { stop_reason: run.stopReason } : {}),
    outcome: run.outcome,
    ...(run.outcomeConfidence ? { confidence: run.outcomeConfidence } : {}),
    ai_use: `${percentOf(run.usageShare)} of its ${percentOf(run.maxShare)} cap`,
    // The agent that started it, only when the person sees it (agents.ts readCalls).
    ...(run.calledBy ? { called_by: run.calledBy } : {}),
    ...(run.calls?.length ? { ran_agents: run.calls.map(ranAgent) } : {}),
    open: chatHref(run.chatId),
  };
}

/**
 * An agent's runs on a brand (list_agent_runs), as its Runs tab lists them
 * for the person: its last AGENT_RUNS_MAX runs, newest first, the ones on
 * brands they may see, held to this brand, and to a status when asked
 * (needs_you: the runs waiting for the person's OK). Null for a brand or an
 * agent they can't see: another workspace's, or another person's private one.
 */
export async function listAgentRunsFor(
  auth: McpAuthContext,
  params: {
    brandId: string;
    agentId: string;
    status?: AgentRunStatus;
    limit?: number;
    offset?: number;
  },
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const ctx = await contextOf(auth);
  if (!ctx) return null;
  const { runViews, runsOf, visibleAgent } = await agentsLib();
  const agent = await visibleAgent(ctx, params.agentId);
  if (!agent) return null;
  const runs = (await runsOf(agent.row.id, AGENT_RUNS_MAX)).filter(
    (run) => run.brand_id === params.brandId && (!params.status || run.status === params.status),
  );
  const views = await runViews(ctx.actor.organizationId, ctx.viewer, runs);
  const { rows, ...meta } = pageOfList(views.map(runRow), params, {
    what: `runs of ${agent.row.name} on this brand${params.status ? ` (${params.status})` : ''}`,
    order: 'newest first',
  });
  return {
    ...meta,
    agent: {
      name: agent.row.name,
      status: agent.row.status,
      open: `/dashboard/agents/${agent.row.id}`,
    },
    runs: rows,
  };
}
