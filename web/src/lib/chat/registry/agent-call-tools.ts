import { createTranslator } from 'next-intl';
import { z } from 'zod';
import messages from '../../../../messages/en.json';
import { runAgentFromChat } from '@/lib/actions/chat-agent-calls';
import { contentUuid } from '@/lib/mcp/content-schemas';
import { FIXTURE_IDS, defineTool } from './define-tool';

/**
 * run_agent (CHAT-27 phase 2, items 14–18; W4-26): an agent's run runs one
 * of the agents its Can call setting names, as that agent's own run, and
 * waits for what it answers (lib/chat/agent-calls.ts). A WRITE: it starts
 * work that spends the budget. Growth and up, Admins and Managers (as
 * agents are). A card in every mode: "Run {agent}? AI use: up to {N}% of the
 * monthly AI limit"; an agent's run has no session behind it anyway, so
 * the person approves it in their Inbox. Offered only in an agent's run
 * that has an agent to call, never in a person's own chat. No MCP tool.
 * agent-calls.ts is read when the row runs, so the registry and the agent
 * modules don't load each other.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatAgents.calls' });

const calls = () => import('@/lib/chat/agent-calls');

export const AGENT_CALL_TOOLS = [
  defineTool({
    name: 'run_agent',
    class: 'write',
    area: 'agents',
    description:
      "Run another of the workspace's agents, one this agent's run may call (named in the run's message; their ids are in the run's scope, can_call), as that agent's own run on this brand, and get back what it found or made. Say what you need from it in `ask`. It runs with the stricter permissions of the two agents, out of this run's AI limit. Use it only when that agent's job is part of this task; at most 3 calls a run.",
    defaultPolicy: 'ask',
    maxPolicy: 'ask',
    flags: { alwaysCard: true },
    minRole: 'manager',
    planGate: { minPlan: 'growth' },
    brandOf: null,
    costClass: 'C3',
    labelKey: 'callAgent',
    route: '/dashboard/agents',
    mcpTool: null,
    specRow: 'CHAT-27 14',
    inputSchema: z.object({
      agent: contentUuid.describe("The agent to run, by its id from the run's scope (can_call)."),
      ask: z
        .string()
        .trim()
        .min(1)
        .max(1000)
        .describe('What this run needs from that agent, in a sentence or two.'),
    }),
    taintsRun: true,
    offerIn: async ({ agentRunId }) =>
      !!agentRunId && (await (await calls()).callableAgentsOf(agentRunId)).length > 0,
    // Through the person's session, as the app's own changes (lib/actions/chat-agent-calls.ts).
    run: (ctx, input) =>
      runAgentFromChat(input, {
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        callerChatRunId: ctx.chat?.runId ?? null,
      }),
    // Within the run's workspace: an id of another's names nothing.
    target: async (input, run) => (await calls()).agentNameOf(input.agent, run.organizationId),
    cardDetails: async (input, run) => {
      const share = await (await calls()).callShareOf(input.agent, run.organizationId);
      return {
        why: input.ask,
        // Labelled "AI use", as the agent's page says it.
        ...(share !== null
          ? {
              targets: [
                {
                  kind: 'aiUse' as const,
                  values: [t('card.uses', { share: `${Math.round(share * 100)}%` })],
                },
              ],
            }
          : {}),
      };
    },
    doneStep: (_input, output) => {
      const done = output as {
        ok?: unknown;
        agent?: unknown;
        status?: unknown;
        used_share?: unknown;
      };
      if (done?.ok !== true || typeof done.agent !== 'string') return null;
      const share = typeof done.used_share === 'number' ? done.used_share : 0;
      const status = typeof done.status === 'string' ? done.status : 'done';
      return {
        label: t('step.ran', { agent: done.agent }),
        detail: t('step.detail', {
          status: t.has(`status.${status}` as never) ? t(`status.${status}` as never) : status,
          share: `${share > 0 && share < 0.001 ? '<0.1' : Math.round(share * 1000) / 10}%`,
        }),
      };
    },
    fixture: {
      input: { agent: FIXTURE_IDS.item, ask: 'Draft the FAQ block for /pricing.' },
    },
  }),
];
