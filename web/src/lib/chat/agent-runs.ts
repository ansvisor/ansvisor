import { supabaseAdmin } from '@/lib/supabase/admin';
import { MAX_QUEUED_PER_BRAND, RUN_NOW_REPEAT_MS, agentPlanLimits } from './agent-rules';
import {
  agentForAct,
  logAgentChange,
  readTriggerInputs,
  refused,
  runChecks,
  runnableBrands,
  type AgentContext,
  type AgentResult,
} from './agents';

/**
 * Run now (CHAT-21 §E Manual, §H, §M): an agent's run asked for by a person,
 * queued, then started when the workspace has room. Each brand of its scope
 * gets its own run (§H item 41); one run at a time per agent and brand, at
 * most 3 waiting (§M item 58: a fourth joins the last); a second click by
 * the same person within a minute is the first (edge case 14). A manual run
 * acts as the person who clicked (§H item 38) and goes before triggered
 * runs (§M item 59, chat_start_next_agent_run).
 *
 * Starting is the database's (chat_start_next_agent_run: the plan's runs at
 * once, in order); running a started run as a Chat run is the agent run
 * driver's (W2-16). Until there is one, nothing is started: a run left
 * `running` with no driver would hold its place and a slot for good, so the
 * runs wait queued. Server only.
 */

/**
 * Hands a started agent run to the Chat engine: its conversation and its
 * Chat run (W2-16). Resolves once the run is handed over, not when it ends.
 */
export type AgentRunDriver = (run: { id: string; organizationId: string }) => Promise<void>;

/** The driver the trigger runner (W2-16) brings; none yet, so runs wait queued. */
export const AGENT_RUN_DRIVER: AgentRunDriver | null = null;

/**
 * Starts the workspace's next queued agent runs while it has room
 * (`runsAtOnce`, the plan's) and hands each to the driver. Without a driver
 * nothing starts. A run the driver can't take fails, which frees its place.
 * Answers the runs started; never throws.
 */
export async function startQueuedAgentRuns(
  organizationId: string,
  runsAtOnce: number,
  driver: AgentRunDriver | null = AGENT_RUN_DRIVER,
): Promise<string[]> {
  if (!driver) return [];
  const started: string[] = [];
  for (let i = 0; i < runsAtOnce; i++) {
    const { data, error } = await supabaseAdmin.rpc('chat_start_next_agent_run', {
      p_organization_id: organizationId,
      p_workspace_limit: runsAtOnce,
    });
    if (error) {
      console.error('[chat/agents] could not start a queued run:', error);
      break;
    }
    if (!data) break;
    started.push(data);
    try {
      await driver({ id: data, organizationId });
    } catch (err) {
      console.error('[chat/agents] the driver could not take a run:', err);
      await supabaseAdmin
        .from('chat_agent_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString() })
        .eq('id', data)
        .eq('status', 'running');
    }
  }
  return started;
}

/** What Run now did for a brand: queued (or started), the earlier click's run, or joined the last. */
export interface RunNowItem {
  brand: string;
  status: string;
  /** A click within a minute of the person's last on this brand: that run, not a new one. */
  repeated: boolean;
  /** Three already wait: this one joins the last of them (§M item 58). */
  coalesced: boolean;
}

interface QueuedRow {
  id: string;
  acting_user_id: string | null;
  trigger_kind: string;
  queued_at: string;
}

/**
 * Run now on an agent the person may run (§K item 51: Admins and Managers;
 * a Manager's own private agent or any workspace agent), not archived, after
 * the checks before a run (§D item 21) for the person it acts as. `brandId`
 * picks one brand of its scope; without it, every brand of its scope gets a
 * run. Answers each brand's run.
 */
export async function runAgentNow(
  ctx: AgentContext,
  id: string,
  input: { brandId?: string },
  now = new Date(),
  driver: AgentRunDriver | null = AGENT_RUN_DRIVER,
): Promise<AgentResult<{ runs: RunNowItem[] }>> {
  const org = ctx.actor.organizationId;
  const found = await agentForAct(ctx, id, 'run');
  if (!found.ok) return found;
  const { agent } = found;
  const { row, version } = agent;
  if (row.status === 'archived') return refused('archived');
  if (!version) return refused('failed');

  const failing = await runChecks(ctx, agent, ctx.viewer.role, await readTriggerInputs(row.id));
  if (failing) return failing;
  let brands = await runnableBrands(org, version.scope);
  if (input.brandId) {
    brands = brands.filter((b) => b.id === input.brandId);
    if (brands.length === 0) return refused('brand_not_found');
  }

  const runs: RunNowItem[] = [];
  const ours: string[] = [];
  for (const brand of brands) {
    const { data, error } = await supabaseAdmin
      .from('chat_agent_runs')
      .select('id, acting_user_id, trigger_kind, queued_at')
      .eq('agent_id', row.id)
      .eq('brand_id', brand.id)
      .eq('status', 'queued')
      .order('queued_at', { ascending: true });
    if (error) throw new Error(`Could not read the agent's queue: ${error.message}`);
    const waiting = (data ?? []) as QueuedRow[];
    const repeat = waiting.find(
      (r) =>
        r.trigger_kind === 'manual' &&
        r.acting_user_id === ctx.actor.userId &&
        now.getTime() - Date.parse(r.queued_at) < RUN_NOW_REPEAT_MS,
    );
    if (repeat) {
      ours.push(repeat.id);
      runs.push({ brand: brand.name, status: 'queued', repeated: true, coalesced: false });
      continue;
    }
    if (waiting.length >= MAX_QUEUED_PER_BRAND) {
      ours.push(waiting[waiting.length - 1].id);
      runs.push({ brand: brand.name, status: 'queued', repeated: false, coalesced: true });
      continue;
    }
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('chat_agent_runs')
      .insert({
        organization_id: org,
        agent_id: row.id,
        agent_version: row.version,
        brand_id: brand.id,
        trigger_kind: 'manual',
        acting_user_id: ctx.actor.userId,
        status: 'queued',
        max_share: row.max_run_share,
        queued_at: now.toISOString(),
      })
      .select('id')
      .single();
    if (insertError || !inserted) {
      throw new Error(`Could not queue the agent's run: ${insertError?.message}`);
    }
    const runId = (inserted as { id: string }).id;
    ours.push(runId);
    runs.push({ brand: brand.name, status: 'queued', repeated: false, coalesced: false });
    await logAgentChange(ctx, row, 'agentRunQueued', {
      params: { brand: brand.name },
      brandId: brand.id,
      agentRunId: runId,
    });
  }

  await startQueuedAgentRuns(org, agentPlanLimits(ctx.plan).runsAtOnce, driver);
  // What the start made of them: running once a slot took them, else still queued.
  if (ours.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('chat_agent_runs')
      .select('id, status')
      .in('id', ours);
    if (error) throw new Error(`Could not read the agent's runs: ${error.message}`);
    const status = new Map(
      ((data ?? []) as { id: string; status: string }[]).map((r) => [r.id, r.status]),
    );
    runs.forEach((run, i) => {
      run.status = status.get(ours[i]) ?? run.status;
    });
  }
  return { ok: true, value: { runs } };
}
