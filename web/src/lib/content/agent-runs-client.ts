import { BROWSER_API_BASE_URL } from '@/config/api';
import { createClient } from '@/lib/supabase/client';
import { agentRunFrom, type AgentRun } from './agent-runs';

/**
 * The Content Agent's run, read and stopped from the browser (v1.1
 * CE-027/035): never through a server action, which Next runs one at a time —
 * Fix open rules' and the brief's wait for the whole run, so a read or a Stop
 * behind them would only go out once it ended.
 */

/** The draft's latest run (00249, its members may read it), or null. */
export async function readAgentRun(draftId: string): Promise<AgentRun | null> {
  const { data, error } = await createClient()
    .from('content_agent_runs')
    .select('id, kind, steps, step, started_at, finished_at, stopped_at, outcome')
    .eq('draft_id', draftId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('Failed to read the agent run:', error);
    return null;
  }
  return agentRunFrom(data);
}

/**
 * Stop (CE-027): ends the Content Agent's run on the draft — the one the
 * editor shows, so another tab's run goes on — through the API's same-origin
 * proxy; it keeps nothing of what it had. stopped is false when no run was
 * under way.
 */
export async function stopAgentRun(
  draftId: string,
  brandId: string,
  runId: string | null = null,
): Promise<{ stopped: boolean } | { error: 'failed' }> {
  const {
    data: { session },
  } = await createClient().auth.getSession();
  if (!session) return { error: 'failed' };
  try {
    const res = await fetch(
      `${BROWSER_API_BASE_URL}/api/content-drafts/${encodeURIComponent(draftId)}/stop`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(runId ? { brandId, runId } : { brandId }),
      },
    );
    if (!res.ok) return { error: 'failed' };
    const body = (await res.json().catch(() => ({}))) as { stopped?: unknown };
    return { stopped: body.stopped === true };
  } catch (err) {
    console.error('Failed to stop the Content Agent:', err);
    return { error: 'failed' };
  }
}
