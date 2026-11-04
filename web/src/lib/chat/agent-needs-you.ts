import { API_BASE_URL } from '@/config/api';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * "Notify me when an agent needs me" (Settings › Chat, 00408; 00474): when an
 * agent's run stops to wait for its person (needs_you), the server e-mails
 * them by their pick, once per run (server routes/internal-chat-notices.js
 * `needs-you`), and records it as a chat_notices row; when the run goes on or
 * ends, the row closes. The Inbox lists the run's chat under Needs you
 * itself. Server only (CRON_SECRET). Neither throws: a missed e-mail never
 * holds the run.
 */

/** How long the server may take to write the notice and send the e-mail. */
const NOTICE_TIMEOUT_MS = 15_000;

/** The dedupe key of a run's notice, as the server writes it. */
export const needsYouKey = (agentRunId: string) => `agent_needs_you:${agentRunId}`;

/** Asks the server to tell the run's person it waits for them; whether the server answered. */
export async function tellAgentNeedsYou(
  organizationId: string,
  agentRunId: string,
): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(
      '[chat/agents] CRON_SECRET must be configured to tell a person their agent waits',
    );
    return false;
  }
  try {
    const res = await fetch(`${API_BASE_URL}/api/internal/chat/notices/needs-you`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: organizationId, agentRunId }),
      cache: 'no-store',
      signal: AbortSignal.timeout(NOTICE_TIMEOUT_MS),
    });
    return res.ok;
  } catch (err) {
    console.error('[chat/agents] the needs-you notice got no answer:', (err as Error)?.name ?? err);
    return false;
  }
}

/** Closes the run's notice once it no longer waits. */
export async function resolveAgentNeedsYou(agentRunId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('chat_notices')
    .update({ resolved_at: new Date().toISOString() })
    .eq('dedupe_key', needsYouKey(agentRunId))
    .is('resolved_at', null);
  if (error) console.error('[chat/agents] could not close the needs-you notice:', error.message);
}
