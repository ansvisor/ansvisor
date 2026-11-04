'use server';

import { createClient } from '@/lib/supabase/server';
import { assertWritable } from '@/lib/subscription-guard';
import type { CallResult } from '@/lib/chat/agent-calls';

/**
 * run_agent's change (CHAT-27 phase 2; W4-26), through the signed-in
 * person's session as the app's other changes are: refused while the
 * workspace is read-only, and for anyone but the person the caller's run
 * acts as (the card's Approve is theirs). The call itself is
 * lib/chat/agent-calls.ts's, with the service role after its checks.
 */
export async function runAgentFromChat(
  input: { agent: string; ask: string },
  place: { userId: string; organizationId: string | null; callerChatRunId: string | null },
): Promise<CallResult> {
  await assertWritable();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== place.userId) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Only the person this run acts as can run it.',
    };
  }
  const { runCalledAgent } = await import('@/lib/chat/agent-calls');
  return runCalledAgent(place, input);
}
