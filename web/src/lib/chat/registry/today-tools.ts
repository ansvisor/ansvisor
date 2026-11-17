import { z } from 'zod';
import { actionRef } from '@/lib/action-center/action-ref';
import { AGENT_LIST_VIEWS } from '@/lib/chat/agent-rules';
import { AGENT_RUN_STATUSES, listAgentRunsFor, listMyAgentsFor } from '@/lib/mcp/agent-reads';
import { contentUuid } from '@/lib/mcp/content-schemas';
import { getSignalsSummaryFor, getTodayFor } from '@/lib/mcp/today-reads';
import { FIXTURE_IDS, defineTool } from './define-tool';
import { PAGED, pageInput } from './list-paging';

/**
 * Chat's reads of what Action Center › Today, Agents and Signals show (the
 * owner's plan of 2026-11-16, step 6b: Chat reads all a page shows): Today
 * as the person sees it, their agents and an agent's runs as Agents lists
 * them, and the Signals page's summary cards. Each calls the page's own
 * functions (lib/mcp/today-reads.ts, agent-reads.ts). History's range and
 * filters are on get_action_history (read-tools.ts).
 */

const brandId = contentUuid.describe('Brand id, from list_brands.');
const dateFrom = z.string().optional().describe('ISO timestamp (inclusive) lower bound.');
const dateTo = z.string().optional().describe('ISO timestamp (inclusive) upper bound.');

export const TODAY_READS = [
  defineTool({
    name: 'get_today',
    class: 'read',
    area: 'action_center',
    description: `Action Center › Today as the person sees it now, from the page's own reads: Today's focus (their 3 actions, in the cards' order: position, ref as ${actionRef(12)}, title, why, first step, effort, who does it, new), Since yesterday (the biggest changes since their last visit: code as S-07, title, up, down or rival, impact; not_listed and small_moves say what else changed), Waiting for you (what waits on this person: agent runs waiting for their OK, drafts in review, tasks due, weekly reminders, tasks to review, prompts waiting for a spot, new prompt ideas; finish_one when nothing waits), Where you stand (score, change, rank, the brand next to it), the Getting started steps left, and on Mondays Last week. "The first action", "what should I do first" or "my first card" asked on Today means the first card of its focus (focus.cards[0]), not the Actions list's order: name it by its title, with its ref. It is the person's own Today, read with their session.`,
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'today',
    route: '/dashboard/action-center/today',
    mcpTool: null,
    specRow: 'Chat page data 6b',
    inputSchema: z.object({ brand_id: brandId }),
    run: (ctx, input) =>
      getTodayFor(ctx, { brandId: input.brand_id, timezone: ctx.timezone ?? null }),
    fixture: { input: { brand_id: FIXTURE_IDS.brand } },
  }),
  defineTool({
    name: 'list_my_agents',
    class: 'read',
    area: 'agents',
    description: `The person's agents as Action Center › Agents lists them (Your agents): a tab, Mine by default (Workspace for those who only read agents, as the page opens for them), Workspace (shared agents; an Admin's: others' too), Paused or Archived, and its search by name or skill, most recently changed first. Each: name, status (and why it is paused), private or shared, theirs or not, skills, mode, triggers (a schedule's settings, next and last run), the brands it covers, its last run (status, when, waits_on_you, its chat), the last 30 days' outcomes and AI use. tabs counts each tab. Only agents the person may see: another person's private agent never is. For an agent's runs, read list_agent_runs with its id.${PAGED}`,
    minRole: 'analyst',
    planGate: null,
    brandOf: null,
    costClass: 'C1',
    labelKey: 'myAgents',
    route: '/dashboard/agents',
    mcpTool: null,
    specRow: 'Chat page data 6b',
    inputSchema: z.object({
      view: z
        .enum(AGENT_LIST_VIEWS)
        .optional()
        .describe('The tab: mine, workspace, paused or archived.'),
      search: z.string().trim().max(100).optional().describe("Words of an agent's name or skill."),
      ...pageInput,
    }),
    run: (ctx, input) =>
      listMyAgentsFor(ctx, {
        view: input.view,
        search: input.search,
        limit: input.limit,
        offset: input.offset,
      }),
    fixture: { input: {} },
  }),
  defineTool({
    name: 'list_agent_runs',
    class: 'read',
    area: 'agents',
    description: `An agent's runs on this brand, as its Runs tab on Action Center › Agents lists them for the person: its last 50 runs, newest first. Each: status (needs_you: waiting for the person's OK; waits_on_you says so), what started it, when it was queued, started and finished, why it stopped or was skipped, its outcome and how sure, its AI use against its cap, the agents it ran, and its chat, where what it changed is. status narrows to one status. An agent the person can't see (another person's private one, or another workspace's) is not found. The agent's id is from list_my_agents.${PAGED}`,
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'agentRuns',
    route: '/dashboard/agents',
    mcpTool: null,
    specRow: 'Chat page data 6b',
    inputSchema: z.object({
      brand_id: brandId,
      agent_id: contentUuid.describe('Agent id, from list_my_agents.'),
      status: z.enum(AGENT_RUN_STATUSES).optional().describe('needs_you: waiting for an OK.'),
      ...pageInput,
    }),
    run: (ctx, input) =>
      listAgentRunsFor(ctx, {
        brandId: input.brand_id,
        agentId: input.agent_id,
        status: input.status,
        limit: input.limit,
        offset: input.offset,
      }),
    fixture: { input: { brand_id: FIXTURE_IDS.brand, agent_id: FIXTURE_IDS.item } },
  }),
  defineTool({
    name: 'get_signals_summary',
    class: 'read',
    area: 'action_center',
    description:
      'The Signals page\'s summary cards over a period (the page\'s window, 30 days by default): the findings active in it, the high-impact ones, the new ones and the resolved ones, each against the same number of days before it, and the active ones by category and by source. For "how many signals", "how many are high impact" or "what kind of changes" questions; list_signals reads the signals themselves.',
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'signalsSummary',
    route: '/dashboard/action-center/signals',
    mcpTool: null,
    specRow: 'Chat page data 6b',
    inputSchema: z.object({ brand_id: brandId, date_from: dateFrom, date_to: dateTo }),
    run: (ctx, input) =>
      getSignalsSummaryFor(ctx, {
        brandId: input.brand_id,
        dateFrom: input.date_from,
        dateTo: input.date_to,
      }),
    fixture: { input: { brand_id: FIXTURE_IDS.brand } },
  }),
];
