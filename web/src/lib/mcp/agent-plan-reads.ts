import type { McpAuthContext } from '@/lib/mcp-auth';
import { brandAllowed } from './data';

/**
 * Chat's read of an AEO Operator's plan (AEO Operator plan §4.2 step 4,
 * get_agent_plan): the plan this Operator run made, on its brand, as its
 * row keeps it (lib/chat/operator/approve.ts readAgentPlanFor): ids, codes,
 * counts and shares, and its agents' names in the workspace. Offered only
 * in an Operator's run; the person's brand access is checked first, so a
 * brand taken away answers nothing. Server only.
 */

/** Chat's Operator module, read when needed: it imports what the registry's own rows import. */
const approveLib = () => import('@/lib/chat/operator/approve');

export async function getAgentPlanFor(
  auth: McpAuthContext,
  input: { brandId: string; agentRunId: string | null },
): Promise<Record<string, unknown>> {
  if (!auth.organizationId || !(await brandAllowed(auth, input.brandId))) {
    return { ok: false, code: 'not_found' };
  }
  const plan = await (await approveLib()).readAgentPlanFor(auth.organizationId, input.agentRunId);
  // The run's plan is on its own brand: another brand's id names nothing here.
  if (plan.ok === true && plan.brand_id !== input.brandId) return { ok: false, code: 'not_found' };
  return plan;
}
