'use server';

import { createClient } from '@/lib/supabase/server';
import { assertWritable } from '@/lib/subscription-guard';
import type { PlanApproval } from '@/lib/chat/operator/approve';

/**
 * The AEO Operator's plan card, approved in the app (run_agent_plan's
 * change; AEO Operator plan §4.2 step 6), through the signed-in person's
 * session as the app's other changes are: refused while the workspace is
 * read-only or on the demo brand (assertWritable, first), and for anyone but
 * the person the Operator's run acts as, who alone approves its card. The
 * start itself is lib/chat/operator/approve.ts's (dispatchChildren), with
 * the service role after its checks, as Slack's Approve is.
 *
 * A 'use server' file: async functions only, never a constant (#2347).
 */
export async function approveAgentPlanFromChat(
  input: { plan_id: string; brand_id: string },
  place: { userId: string; organizationId: string | null; agentRunId: string | null },
): Promise<PlanApproval> {
  await assertWritable({ brandId: input.brand_id });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== place.userId || !place.organizationId) {
    return {
      ok: false,
      reason: 'not_yours',
      message: 'Only the person this run acts as can start its plan.',
    };
  }
  const { approvePlan } = await import('@/lib/chat/operator/approve');
  return approvePlan(
    { userId: user.id, organizationId: place.organizationId },
    input,
    place.agentRunId,
  );
}
