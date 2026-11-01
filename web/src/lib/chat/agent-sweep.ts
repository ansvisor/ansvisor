import { getAiUsageFor } from '@/lib/mcp/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { FAILURES_TO_PAUSE, settleAgentRun, startNextAgentRuns } from './agent-driver';
import type { AgentRunDriver } from './agent-runs';
import { readAgentShares } from './agent-shares';
import { isTriggered, readArmedOrgs } from './agent-triggers';
import { pauseAgentForSystem } from './agents';
import { endHeldRun, sweepChatRuns } from './engine';
import { chatAgenticEnabled } from './flag';
import { chatRunsOnOwnKey } from './key';
import { readOwnKeyCap } from './own-key-cap';

/**
 * The agents' sweep (CHAT-21 §G, §H, §M; W2-16), on the server's minute
 * cron after the triggers: what no request picks up again.
 *   - Chat's own sweep first (sweepChatRuns): a card left 7 days stops its
 *     run, "No answer in 7 days"; a run with no sign of life for 10 minutes
 *     (its driver was lost) times out.
 *   - Every agent run still running, waiting on a person or at its limit
 *     follows its Chat run (settleAgentRun): an approval made in a chat
 *     carries the agent run on, a lost one fails, one started 5 minutes ago
 *     with no chat fails.
 *   - Runs queued longer than STALE_QUEUE_MS stop: nothing catches up later.
 *   - An active agent with 3 failed runs in a row pauses (failures).
 *   - An agent paused for the AI limit (cap) resumes by itself once the
 *     month's limit, and its own monthly cap, have room again (§G item 35);
 *     its triggered runs held at the limit stop then: the next trigger runs,
 *     not the stopped run (edge case 10).
 *   - Each workspace with runs waiting starts what it has room for: the
 *     only place a run starts after another ends, in this request.
 * Each part runs on its own: one that fails doesn't stop the others. Only
 * in workspaces where Chat is on. Safe to run at any time, and twice.
 * Server only.
 */

/** A queued run older than this never starts: it stops (no catch-up, §G item 33). */
export const STALE_QUEUE_MS = 6 * 60 * 60_000;
/** Most rows each part reads a sweep. */
const SWEEP_ROWS = 500;

export interface AgentSweep {
  expired: number;
  lost: number;
  settled: number;
  staleQueued: number;
  pausedForFailures: number;
  resumed: number;
  started: number;
  /** The parts that failed; the others ran. */
  failed: string[];
}

/** Agents paused for the AI limit whose workspace and own cap have room again resume. */
async function resumeCapPausedAgents(now: Date): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('chat_agents')
    .select('id, organization_id, max_month_share')
    .eq('status', 'paused')
    .eq('paused_reason', 'cap')
    .limit(SWEEP_ROWS);
  if (error) throw new Error(`Could not read the paused agents: ${error.message}`);
  const rows = (data ?? []) as {
    id: string;
    organization_id: string;
    max_month_share: number | null;
  }[];
  const armed = await readArmedOrgs(rows.map((r) => r.organization_id));
  let resumed = 0;
  for (const orgId of armed.keys()) {
    const agents = rows.filter((r) => r.organization_id === orgId);
    let usage;
    try {
      usage = await getAiUsageFor({
        userId: '',
        email: null,
        organizationId: orgId,
        role: 'admin',
        apiKeyId: 'chat-agents',
      });
    } catch (err) {
      console.error('[chat/agents] could not read the AI limit:', err);
      continue;
    }
    if (!usage || (!usage.unlimited && (usage.percent_used ?? 0) >= 100)) continue;
    const shares = agents.some((a) => a.max_month_share !== null)
      ? await readAgentShares(orgId, 'period')
      : null;
    for (const agent of agents) {
      if (agent.max_month_share !== null) {
        const mine = shares?.byAgent.get(agent.id);
        // Unread shares wait for the next sweep rather than resume past the cap.
        // As agentMonthCapReached: a hair under (floating point) counts as reached.
        const used = mine ? mine.share + mine.ownKeyShare : 0;
        if (!shares || used >= Number(agent.max_month_share) - 1e-9) {
          continue;
        }
      }
      const { data: moved, error: moveError } = await supabaseAdmin
        .from('chat_agents')
        .update({ status: 'active', paused_reason: null, activated_at: now.toISOString() })
        .eq('id', agent.id)
        .eq('status', 'paused')
        .eq('paused_reason', 'cap')
        .select('id');
      if (moveError) throw new Error(`Could not resume the agent: ${moveError.message}`);
      if ((moved ?? []).length === 0) continue;
      resumed += 1;
      await stopHeldTriggeredRuns(agent.id, now);
    }
  }
  return resumed;
}

/** A resumed agent's triggered runs held at the limit stop: the next trigger runs instead. */
async function stopHeldTriggeredRuns(agentId: string, now: Date): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('chat_agent_runs')
    .select('id, trigger_kind')
    .eq('agent_id', agentId)
    .eq('status', 'paused_cap');
  if (error) throw new Error(`Could not read the agent's runs: ${error.message}`);
  for (const run of (data ?? []) as { id: string; trigger_kind: string }[]) {
    if (!isTriggered(run.trigger_kind)) continue;
    const { data: moved, error: moveError } = await supabaseAdmin
      .from('chat_agent_runs')
      .update({ status: 'stopped', stop_reason: null, finished_at: now.toISOString() })
      .eq('id', run.id)
      .eq('status', 'paused_cap')
      .select('id');
    if (moveError) throw new Error(`Could not stop the agent's run: ${moveError.message}`);
    if ((moved ?? []).length === 0) continue;
    const { data: convo } = await supabaseAdmin
      .from('chat_conversations')
      .select('id')
      .eq('agent_run_id', run.id)
      .maybeSingle();
    if (!convo) continue;
    const { data: chatRuns } = await supabaseAdmin
      .from('chat_runs')
      .select('id')
      .eq('conversation_id', (convo as { id: string }).id)
      .eq('status', 'paused_cap');
    for (const chatRun of (chatRuns ?? []) as { id: string }[]) {
      await endHeldRun(chatRun.id, 'paused_cap', 'limit');
    }
  }
}

/**
 * Agents paused because all agents reached the month's limit on the
 * workspace's own key (own_key_cap, AGENT-OWN-KEY §4.2) start again once
 * there is room: the period renewed, or an Admin raised the limit; also
 * once Chat no longer runs on the key. Each workspace's guard is read fresh;
 * one that can't be read waits for the next sweep.
 */
async function resumeKeyCapPausedAgents(now: Date): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('chat_agents')
    .select('id, organization_id')
    .eq('status', 'paused')
    .eq('paused_reason', 'own_key_cap')
    .limit(SWEEP_ROWS);
  if (error) throw new Error(`Could not read the paused agents: ${error.message}`);
  const rows = (data ?? []) as { id: string; organization_id: string }[];
  let resumed = 0;
  for (const orgId of new Set(rows.map((r) => r.organization_id))) {
    if (
      (await chatRunsOnOwnKey(orgId)) &&
      (await readOwnKeyCap(orgId, { fresh: true }))?.reached !== false
    ) {
      continue;
    }
    const { data: moved, error: moveError } = await supabaseAdmin
      .from('chat_agents')
      .update({ status: 'active', paused_reason: null, activated_at: now.toISOString() })
      .eq('organization_id', orgId)
      .eq('status', 'paused')
      .eq('paused_reason', 'own_key_cap')
      .select('id');
    if (moveError) throw new Error(`Could not resume the agents: ${moveError.message}`);
    resumed += (moved ?? []).length;
  }
  return resumed;
}

/** One sweep (above); answers what each part did, for the cron's log. */
export async function sweepAgents(now: Date, driver: AgentRunDriver | null): Promise<AgentSweep> {
  const counts: AgentSweep = {
    expired: 0,
    lost: 0,
    settled: 0,
    staleQueued: 0,
    pausedForFailures: 0,
    resumed: 0,
    started: 0,
    failed: [],
  };
  // Each part on its own: one that fails is named in `failed`, and the rest still run.
  const part = async (name: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch (err) {
      counts.failed.push(name);
      console.error(`[chat/agents] the sweep's ${name} failed:`, err);
    }
  };

  await part('chat', async () => {
    const chat = await sweepChatRuns(now);
    counts.expired = chat.expired;
    counts.lost = chat.lost;
  });

  // Agent runs follow their Chat runs; the slots they free are filled below.
  await part('settle', async () => {
    const { data: open, error } = await supabaseAdmin
      .from('chat_agent_runs')
      .select('id, organization_id, status')
      .in('status', ['running', 'needs_you', 'paused_cap'])
      .order('queued_at', { ascending: true })
      .limit(SWEEP_ROWS);
    if (error) throw new Error(`Could not read the agent runs: ${error.message}`);
    for (const run of (open ?? []) as { id: string; organization_id: string; status: string }[]) {
      if (!chatAgenticEnabled(run.organization_id)) continue;
      try {
        const after = await settleAgentRun(run.id, { now });
        if (after !== run.status) counts.settled += 1;
      } catch (err) {
        console.error('[chat/agents] could not settle an agent run:', err);
      }
    }
  });

  // Runs that waited too long to start never will.
  await part('stale', async () => {
    const { data: stale, error } = await supabaseAdmin
      .from('chat_agent_runs')
      .update({ status: 'stopped', stop_reason: null, finished_at: now.toISOString() })
      .eq('status', 'queued')
      .lt('queued_at', new Date(now.getTime() - STALE_QUEUE_MS).toISOString())
      .select('id');
    if (error) throw new Error(`Could not stop the stale runs: ${error.message}`);
    counts.staleQueued = (stale ?? []).length;
  });

  // The failures rule's backstop: an ended run counts itself (settleAgentRun).
  await part('failures', async () => {
    const { data: failing, error } = await supabaseAdmin
      .from('chat_agents')
      .select('id, organization_id, fail_count')
      .eq('status', 'active')
      .gt('fail_count', FAILURES_TO_PAUSE - 1)
      .limit(SWEEP_ROWS);
    if (error) throw new Error(`Could not read the agents: ${error.message}`);
    for (const agent of (failing ?? []) as { id: string; organization_id: string }[]) {
      if (!chatAgenticEnabled(agent.organization_id)) continue;
      if (await pauseAgentForSystem(agent.organization_id, agent.id, 'failures')) {
        counts.pausedForFailures += 1;
      }
    }
  });

  await part('resume', async () => {
    counts.resumed = await resumeCapPausedAgents(now);
  });

  // The workspaces' waiting runs start here, in this request of their own (not chained).
  await part('start', async () => {
    const { data: queued, error } = await supabaseAdmin
      .from('chat_agent_runs')
      .select('organization_id')
      .eq('status', 'queued')
      .limit(SWEEP_ROWS);
    if (error) throw new Error(`Could not read the queue: ${error.message}`);
    const orgs = new Set(
      ((queued ?? []) as { organization_id: string }[]).map((r) => r.organization_id),
    );
    for (const orgId of orgs) {
      try {
        counts.started += (await startNextAgentRuns(orgId, driver)).length;
      } catch (err) {
        console.error('[chat/agents] could not start a workspace’s runs:', err);
      }
    }
  });

  // After the start: an agent resumed here runs on its next fire.
  await part('keyCap', async () => {
    counts.resumed += await resumeKeyCapPausedAgents(now);
  });
  return counts;
}
