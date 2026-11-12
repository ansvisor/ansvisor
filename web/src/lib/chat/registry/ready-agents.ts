import { z } from 'zod';
import { contentUuid } from '@/lib/mcp/content-schemas';
import { listReadyAgentsFor } from '@/lib/mcp/ready-agents';
import { FIXTURE_IDS, defineTool } from './define-tool';

/**
 * The ready-to-use agents to recommend (AGENTS plan §3 #11, §8; the
 * Onboarding & Help agent's /setup): Agent Center › Ready to use's agents
 * for the brand's site type and the person's work areas, by its own rule,
 * each with the link to its card. A read: it creates, turns on and runs
 * nothing, so it is open to every role, as Ready to use is. No MCP tool.
 */
export const READY_AGENT_READS = [
  defineTool({
    name: 'list_ready_agents',
    class: 'read',
    area: 'agents',
    description:
      'The ready-to-use agents to recommend for the brand and the person: 3 to 5 from Action Center › Agents › Ready to use, those made for the brand\'s site type or the person\'s work areas first, then ones for every brand. Each has its name, what it does, why it fits, its skills and `href`, the link to its card. For "which agents should I use" and setup. Recommend only these, each linked with its href; never create, turn on or run an agent: the person does that from its card.',
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C0',
    labelKey: 'readyAgents',
    route: '/dashboard/agents',
    mcpTool: null,
    specRow: 'AGENTS §8',
    inputSchema: z.object({ brand_id: contentUuid.describe('Brand id, from list_brands.') }),
    run: (ctx, input) => listReadyAgentsFor(ctx, { brandId: input.brand_id }),
    fixture: { input: { brand_id: FIXTURE_IDS.brand } },
  }),
];
