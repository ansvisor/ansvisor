import { MAX_PARTS, MIN_PARTS, SUBTASKS_TOOL, subtasksInput } from '@/lib/chat/subtasks';
import { defineTool } from './define-tool';

/**
 * run_subtasks (CHAT-27 phase 1, §A): a run splits a big request into 2–5
 * parts that work at the same time, each a child run that only reads, and
 * answers from what they found (lib/chat/subtasks.ts). A READ: it changes
 * nothing; a change a part finds is needed is made by the parent, under its
 * own mode and card. Open on every plan with agents (all of them, §F) and to
 * every role, as reads are. The engine works the call itself (its parts
 * need its driver), so `run` here only answers a call made outside it.
 * Never offered in a part (one level, item 3). No MCP tool.
 */

export const SUBTASK_TOOLS = [
  defineTool({
    name: SUBTASKS_TOOL,
    class: 'read',
    area: 'agents',
    description: `Split a big request into ${MIN_PARTS}–${MAX_PARTS} parts that work at the same time, then answer from what they found: one part per competitor, page or report section. Each part only reads; give it a short title and an instruction that stands on its own. A change a part finds is needed comes back to you to make. Use it only when the parts are independent and each needs several reads; at most twice a run.`,
    minRole: 'analyst',
    planGate: null,
    brandOf: null,
    costClass: 'C2',
    labelKey: 'splitWork',
    route: null,
    mcpTool: null,
    specRow: 'CHAT-27 1',
    inputSchema: subtasksInput,
    // Never in a part of a run: one level only.
    offerIn: async ({ parentRunId }) => !parentRunId,
    run: async () => ({ ok: false, code: 'engine_only' }),
    fixture: {
      input: {
        parts: [
          { title: 'Competitor B', instruction: "Read competitor B's citations, last 30 days." },
          { title: 'Competitor C', instruction: "Read competitor C's citations, last 30 days." },
        ],
      },
    },
  }),
];
