import { after } from 'next/server';
import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/types/supabase';
import { canWriteAgents, versionFromRow, type AgentPausedReason } from './agent-rules';
import { startQueuedAgentRuns, type AgentRunDriver } from './agent-runs';
import {
  agentMonthCapReached,
  evidenceOf,
  isTriggered,
  readArmedOrgs,
  type AgentEvidence,
} from './agent-triggers';
import {
  loadAgent,
  pauseAgentForSystem,
  readAgentContext,
  readTriggerInputs,
  runChecks,
  runnableBrands,
  type AgentRefusal,
} from './agents';
import { APPROVAL_TTL_MS, driveRun, endHeldRun, validTimezone, type ChatActor } from './engine';
import { loadRun, newProgress, type LoadedRun } from './engine-store';
import { chatAgenticEnabled } from './flag';

/**
 * The agent run driver (CHAT-21 §H, CHAT-27 §E; W2-16): runs a started
 * agent run as a Chat run, in the background, and keeps the agent run's
 * state in step with it.
 *
 * Handing a run over (openAgentRun): the run acts as the person it names
 * (Run now and Run agent: the clicking person), or for a trigger as the
 * agent's owner now (§H item 38), with their live role and what they may
 * see; the person needs to be an Admin or a Manager still (§K item 51),
 * else the run stops before it starts, and a triggered agent pauses
 * (owner_role). The checks before a run (§D item 21)
 * are read again for that person: a check that fails ends the run before
 * it starts, and pauses a triggered agent with the reason (plan,
 * brand_gone, cap; §G item 34). A read-only workspace starts nothing. Then
 * the run gets a chat of its own (origin agent, agent_run_id; §H item 36),
 * owned by the person it acts as, so it shows in their chat list and Inbox:
 * the agent's skills, instructions and what fired it as the message, the
 * evidence as its scope; the version's mode and effort. The Chat engine
 * drives it headless (no browser), each step held on the AI budget within
 * the run's cap (max_share of the monthly limit, CHAT-27 item 21).
 *
 * Keeping it in step (settleAgentRun), when the driver's drive ends and on
 * the sweep: Chat's waiting is Needs you, its paused_cap Paused · AI limit
 * reached (a month's limit pauses the agent, cap), its end the run's end.
 * A triggered run at its own cap is stopped at once, "Stopped at its limit"
 * (CHAT-27 item 22); a card left 7 days stops it, "No answer in 7 days"
 * (§H item 40), and a run held at a limit for 7 days stops at it. The
 * person it acts as finds them in their Inbox (the run's chat is theirs).
 * An ended run counts toward the agent's failed runs in a row (3 pause it,
 * failures); one that shipped something gets a Pending outcome until the
 * impact ledger measures it (§I). Each run's use is kept by the server as
 * the run spends (usage_share). A slot that frees is filled by the minute
 * tick (agent-sweep.ts), in a request of its own: a run that ends never
 * starts the next in what is left of its own request's time. Server only.
 */

const runnerT = createTranslator({ locale: 'en', messages, namespace: 'chatAgents.runner' });
const triggerT = createTranslator({ locale: 'en', messages, namespace: 'chatAgents.runTrigger' });

/** A started run with no chat after this long lost its driver: it fails. */
export const HANDOVER_GRACE_MS = 5 * 60_000;
/** Failed runs in a row that pause the agent (§G item 34, failures). */
export const FAILURES_TO_PAUSE = 3;

const AGENT_RUN_COLUMNS =
  'id, organization_id, agent_id, agent_version, brand_id, trigger_kind, trigger_ref, acting_user_id, status, evidence_json, queued_at, started_at';
const VERSION_COLUMNS =
  'agent_id, version, skill_ids, instructions, mode, connections, model, effort, scope, notify_user_ids, followup_days';

/** The agent run statuses a run holds its place in (00419's chat_agent_runs_active_uidx). */
const HELD = ['running', 'needs_you', 'paused_cap'];
const ENDED = ['done', 'failed', 'stopped', 'skipped'];

export interface AgentRunRow {
  id: string;
  organization_id: string;
  agent_id: string | null;
  agent_version: number;
  brand_id: string | null;
  trigger_kind: string;
  trigger_ref: string | null;
  acting_user_id: string | null;
  status: string;
  evidence_json: Json;
  queued_at: string;
  started_at: string | null;
}

async function readAgentRun(id: string): Promise<AgentRunRow | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_agent_runs')
    .select(AGENT_RUN_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the agent run: ${error.message}`);
  return (data as AgentRunRow | null) ?? null;
}

/**
 * Moves an agent run from `from` to an end or a held state, only from
 * there: false when another request moved it first.
 */
async function moveAgentRun(
  id: string,
  from: string,
  to: string,
  patch: { stopReason?: string | null; now?: Date } = {},
): Promise<boolean> {
  const ended = ENDED.includes(to);
  const { data, error } = await supabaseAdmin
    .from('chat_agent_runs')
    .update({
      status: to,
      ...(to === 'stopped' ? { stop_reason: patch.stopReason ?? null } : {}),
      ...(ended ? { finished_at: (patch.now ?? new Date()).toISOString() } : {}),
    })
    .eq('id', id)
    .eq('status', from)
    .select('id');
  if (error) throw new Error(`Could not change the agent run: ${error.message}`);
  return (data ?? []).length > 0;
}

// ─── Handing a run over ──────────────────────────────────────────────────────

/** A run handed to Chat: who it acts as and its Chat run. */
export interface OpenedAgentRun {
  agentRunId: string;
  organizationId: string;
  chatRunId: string;
  actor: ChatActor;
}

/** The pause a failed check before a run means for a triggered agent (§G item 34). */
function pauseFor(refusal: AgentRefusal): Exclude<AgentPausedReason, 'manual'> | null {
  // A plan gate or a Settings › Chat switch: Full auto, an engine (edge cases 4 and 6).
  if (refusal.kind === 'denied') return 'plan';
  if (refusal.code === 'no_brand') return 'brand_gone';
  if (refusal.code === 'ai_limit') return 'cap';
  return null;
}

/** A run that didn't start: it ends, and a triggered agent pauses for the reason. */
async function endBeforeStart(
  run: AgentRunRow,
  to: 'stopped' | 'failed',
  {
    pause = null,
    stopReason = null,
    now,
  }: {
    pause?: Exclude<AgentPausedReason, 'manual'> | null;
    stopReason?: 'brand_gone' | null;
    now: Date;
  },
): Promise<null> {
  if (pause && run.agent_id && isTriggered(run.trigger_kind)) {
    await pauseAgentForSystem(run.organization_id, run.agent_id, pause);
  }
  await moveAgentRun(run.id, 'running', to, { stopReason, now });
  return null;
}

/** "/winback, then /faq". */
const skillsLine = (skills: readonly string[]) =>
  skills.map((skill) => runnerT('skill', { skill })).join(runnerT('then'));

/**
 * The run's message: the agent and its brand, its skills in order, what
 * started it, its instructions, and for a triggered run how to work with
 * nobody watching (CHAT-12 item 12). Plain words; the evidence's ids go in
 * the run's scope, never in the message.
 */
export function agentRunMessage(input: {
  agent: string;
  brand: string;
  skills: readonly string[];
  instructions: string | null;
  triggerKind: string;
  evidence: AgentEvidence;
}): string {
  const signals = input.evidence.fires.filter((f) => f.kind === 'signal').length;
  const lines = [
    runnerT('message', {
      agent: input.agent,
      brand: input.brand,
      skills: skillsLine(input.skills),
    }),
    runnerT('started', { trigger: input.triggerKind, count: signals }),
  ];
  if (input.evidence.earlier.length > 0) {
    lines.push(runnerT('earlier', { count: input.evidence.earlier.length }));
  }
  if (input.instructions) lines.push(runnerT('instructions', { text: input.instructions }));
  if (isTriggered(input.triggerKind)) lines.push(runnerT('background'));
  return lines.join('\n\n');
}

/** Chips a message carries at most (engine.ts startRunInput). */
const MAX_CHIPS = 12;

/**
 * The run's scope for the model (its progress, never sent to a browser):
 * the agent, brand and trigger, then each fire's evidence (a signal's kind
 * and id, a schedule's slot), and how many earlier fires came with it.
 */
function runScope(
  input: { agent: string; brand: string; triggerKind: string },
  evidence: AgentEvidence,
  withIds: boolean,
) {
  const chips: { key: string; label: string; value?: string }[] = [
    { key: 'agent', label: runnerT('chip.agent'), value: input.agent },
    { key: 'brand', label: runnerT('chip.brand'), value: input.brand },
    {
      key: 'trigger',
      label: runnerT('chip.trigger'),
      value: triggerT(input.triggerKind as 'schedule'),
    },
  ];
  if (withIds) {
    for (const fire of evidence.fires) {
      if (chips.length >= MAX_CHIPS - 1) break;
      chips.push(
        fire.kind === 'signal'
          ? {
              key: 'signal',
              label: runnerT('chip.signal'),
              value: [fire.signalKind, fire.ref].filter(Boolean).join(' ').slice(0, 200),
            }
          : { key: 'slot', label: runnerT('chip.slot'), value: fire.ref.slice(0, 200) },
      );
    }
    if (evidence.earlier.length > 0) {
      chips.push({
        key: 'earlier',
        label: runnerT('chip.earlier'),
        value: evidence.earlier
          .map((f) => f.ref)
          .join(' ')
          .slice(0, 200),
      });
    }
  }
  return { context: { route: '/dashboard/agents', chips } };
}

async function insertId(table: string, row: Record<string, unknown>, what: string) {
  const { data, error } = await supabaseAdmin
    .from(table as 'chat_messages')
    .insert(row as never)
    .select('id')
    .single();
  if (error || !data) {
    const failure = new Error(`Could not ${what}: ${error?.message ?? 'no row'}`);
    (failure as Error & { code?: string }).code = error?.code;
    throw failure;
  }
  return (data as { id: string }).id;
}

/**
 * Makes a started agent run's Chat run, after the checks (above), or ends
 * the run when it can't start. Null when there is nothing to drive: the run
 * ended, isn't running, or already has its chat (a second driver).
 */
export async function openAgentRun(
  runId: string,
  organizationId: string,
  now = new Date(),
): Promise<OpenedAgentRun | null> {
  const run = await readAgentRun(runId);
  if (!run || run.organization_id !== organizationId || run.status !== 'running') return null;
  // With Chat off for the workspace nothing runs.
  if (!chatAgenticEnabled(organizationId)) return endBeforeStart(run, 'stopped', { now });

  const agent = run.agent_id ? await loadAgent(organizationId, run.agent_id) : null;
  if (!agent || agent.row.status === 'archived') {
    return endBeforeStart(run, 'stopped', { now });
  }
  // The version it was queued with, kept when edits made a new one (§C item 14).
  const { data: versionRow, error: versionError } = await supabaseAdmin
    .from('chat_agent_versions')
    .select(VERSION_COLUMNS)
    .eq('agent_id', agent.row.id)
    .eq('version', run.agent_version)
    .maybeSingle();
  if (versionError) throw new Error(`Could not read the agent: ${versionError.message}`);
  if (!versionRow) return endBeforeStart(run, 'failed', { now });
  const version = versionFromRow(versionRow as Parameters<typeof versionFromRow>[0]);

  // Who it acts as (§H item 38): the clicking person, or for a trigger the owner now,
  // an Admin or a Manager still (§K item 51): else it stops, and a triggered agent pauses.
  const triggered = isTriggered(run.trigger_kind);
  const actingUserId = triggered ? agent.row.owner_id : run.acting_user_id;
  if (!actingUserId) {
    return endBeforeStart(run, 'stopped', { pause: 'owner_role', now });
  }
  const actor: ChatActor = { userId: actingUserId, email: null, organizationId };
  const ctx = await readAgentContext(actor);
  if (!ctx || !canWriteAgents(ctx.viewer.role)) {
    return endBeforeStart(run, 'stopped', { pause: 'owner_role', now });
  }
  // Read-only after the trial: nothing runs (the AI budget can't be spent).
  if (!ctx.plan.writable) return endBeforeStart(run, 'stopped', { now });

  const failing = await runChecks(
    ctx,
    { row: agent.row, version },
    ctx.viewer.role,
    await readTriggerInputs(agent.row.id),
  );
  if (failing) {
    const pause = pauseFor(failing.refusal);
    return endBeforeStart(run, 'stopped', {
      pause,
      stopReason: pause === 'brand_gone' ? 'brand_gone' : null,
      now,
    });
  }
  // The agent's own monthly cap holds for every run, Run now's on an agent paused at
  // it too: the run ends before it starts, and a triggered agent pauses (cap).
  if (await agentMonthCapReached(organizationId, agent.row.id, agent.row.max_month_share)) {
    return endBeforeStart(run, 'stopped', { pause: 'cap', now });
  }
  const brand = (await runnableBrands(organizationId, version.scope)).find(
    (b) => b.id === run.brand_id,
  );
  if (!brand) return endBeforeStart(run, 'stopped', { stopReason: 'brand_gone', now });

  const evidence = evidenceOf(run.evidence_json);
  const timezone = validTimezone(evidence.fires.find((f) => f.timezone)?.timezone);
  const words = { agent: agent.row.name, brand: brand.name, triggerKind: run.trigger_kind };
  const text = agentRunMessage({
    ...words,
    skills: version.skill_ids,
    instructions: version.instructions,
    evidence,
  });

  let conversationId: string;
  try {
    conversationId = await insertId(
      'chat_conversations',
      {
        organization_id: organizationId,
        user_id: actingUserId,
        brand_id: brand.id,
        title: runnerT('title', { agent: agent.row.name, brand: brand.name }).slice(0, 200),
        origin: 'agent',
        agent_run_id: run.id,
      },
      "start the agent run's chat",
    );
  } catch (err) {
    // One chat per agent run: another driver made it already.
    if ((err as { code?: string }).code === '23505') return null;
    throw err;
  }
  await insertId(
    'chat_messages',
    {
      conversation_id: conversationId,
      role: 'user',
      content_md: text,
      context_json: runScope(words, evidence, false) as unknown as Json,
    },
    "keep the agent run's message",
  );
  const answerId = await insertId(
    'chat_messages',
    { conversation_id: conversationId, role: 'assistant', content_md: '', timezone },
    "make the agent run's answer",
  );
  // Started already: the agent's slot (chat_start_next_agent_run) is its place in line.
  const chatRunId = await insertId(
    'chat_runs',
    {
      message_id: answerId,
      conversation_id: conversationId,
      status: 'running',
      // The agent's model preference and effort (CHAT-16): the engine picks Auto's models today.
      model: version.model,
      effort: version.effort,
      started_at: now.toISOString(),
    },
    "make the agent run's Chat run",
  );
  const { error: stateError } = await supabaseAdmin.from('chat_run_state').insert({
    run_id: chatRunId,
    organization_id: organizationId,
    user_id: actingUserId,
    mode: version.mode,
    progress: {
      ...newProgress(timezone, brand.id, 'read'),
      question: text,
      scope: runScope(words, evidence, true),
    } as unknown as Json,
    heartbeat_at: now.toISOString(),
  });
  if (stateError) throw new Error(`Could not keep the agent run: ${stateError.message}`);
  if (actingUserId !== run.acting_user_id) {
    const { error } = await supabaseAdmin
      .from('chat_agent_runs')
      .update({ acting_user_id: actingUserId })
      .eq('id', run.id);
    if (error) console.error('[chat/agents] could not name who a run acts as:', error);
  }
  return { agentRunId: run.id, organizationId, chatRunId, actor };
}

// ─── Keeping it in step ──────────────────────────────────────────────────────

/** The Chat run of an agent run's chat, newest first; null before it has one. */
async function chatRunOf(agentRunId: string): Promise<string | null> {
  const { data: convo, error } = await supabaseAdmin
    .from('chat_conversations')
    .select('id')
    .eq('agent_run_id', agentRunId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the agent run's chat: ${error.message}`);
  if (!convo) return null;
  const { data, error: runError } = await supabaseAdmin
    .from('chat_runs')
    .select('id, created_at')
    .eq('conversation_id', (convo as { id: string }).id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (runError) throw new Error(`Could not read the agent run's chat: ${runError.message}`);
  return ((data ?? []) as { id: string }[])[0]?.id ?? null;
}

/** Whether a run held at its limit has had no sign of life for 7 days (§H item 40). */
async function heldTooLong(chatRunId: string, now: Date): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('chat_run_state')
    .select('heartbeat_at')
    .eq('run_id', chatRunId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the agent run's chat: ${error.message}`);
  const at = (data as { heartbeat_at: string | null } | null)?.heartbeat_at;
  return !!at && now.getTime() - Date.parse(at) > APPROVAL_TTL_MS;
}

/** The agent run's state for its Chat run's (§H item 37). */
export function agentStateOf(chat: Pick<LoadedRun, 'status' | 'progress'>): {
  status: string;
  stopReason?: string;
} {
  switch (chat.status) {
    case 'waiting':
      return { status: 'needs_you' };
    case 'paused_cap':
      return { status: 'paused_cap' };
    case 'done':
      return { status: 'done' };
    case 'error':
      return { status: 'failed' };
    case 'stopped': {
      const why = chat.progress?.stoppedFor;
      return {
        status: 'stopped',
        stopReason: why === 'expired' ? 'no_answer' : why === 'limit' ? 'run_cap' : 'user',
      };
    }
    default:
      return { status: 'running' };
  }
}

/** Counts an ended run toward the agent's failed runs in a row: a failure adds one, a success clears them. */
async function countRun(organizationId: string, agentId: string, failed: boolean) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabaseAdmin
      .from('chat_agents')
      .select('fail_count')
      .eq('id', agentId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) throw new Error(`Could not read the agent: ${error.message}`);
    if (!data) return;
    const before = Number((data as { fail_count: number }).fail_count) || 0;
    const after = failed ? before + 1 : 0;
    if (after === before) return;
    const { data: moved, error: moveError } = await supabaseAdmin
      .from('chat_agents')
      .update({ fail_count: after })
      .eq('id', agentId)
      .eq('fail_count', before)
      .select('id');
    if (moveError) throw new Error(`Could not count the agent's run: ${moveError.message}`);
    if ((moved ?? []).length === 0) continue;
    if (after >= FAILURES_TO_PAUSE) await pauseAgentForSystem(organizationId, agentId, 'failures');
    return;
  }
}

/** An ended run that shipped something waits for its measure: Pending (§I item 43). */
async function markShipped(agentRunId: string) {
  const { data, error } = await supabaseAdmin
    .from('ship_events')
    .select('id')
    .eq('agent_run_id', agentRunId)
    .limit(1);
  if (error) {
    console.error('[chat/agents] could not read what a run shipped:', error);
    return;
  }
  if ((data ?? []).length === 0) return;
  await supabaseAdmin
    .from('chat_agent_runs')
    .update({ outcome: 'pending' })
    .eq('id', agentRunId)
    .is('outcome', null);
}

/** Starts the workspace's next queued runs, while it has room and may run them. */
export async function startNextAgentRuns(
  organizationId: string,
  driver: AgentRunDriver | null,
): Promise<string[]> {
  const org = (await readArmedOrgs([organizationId])).get(organizationId);
  if (!org) return [];
  return startQueuedAgentRuns(organizationId, org.limits.runsAtOnce, driver);
}

/**
 * Brings an agent run in step with its Chat run (above); answers its state
 * after. Safe to call at any time, and twice: each move is made only from
 * the state it read.
 */
export async function settleAgentRun(
  agentRunId: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<string | null> {
  const run = await readAgentRun(agentRunId);
  if (!run || !HELD.includes(run.status)) return run?.status ?? null;

  const chatRunId = await chatRunOf(run.id);
  let target: { status: string; stopReason?: string } | null = null;
  let capHit: 'run' | 'month' | undefined;
  if (!chatRunId) {
    // Started, never handed to Chat: its driver was lost before the chat was made.
    const since = Date.parse(run.started_at ?? run.queued_at);
    if (run.status === 'running' && now.getTime() - since > HANDOVER_GRACE_MS) {
      target = { status: 'failed' };
    }
  } else {
    let chat = await loadRun(chatRunId);
    if (chat?.status === 'paused_cap') {
      const triggered = isTriggered(run.trigger_kind);
      // A triggered run at its own cap ends "Stopped at its limit" (CHAT-27 item 22).
      if (chat.progress.capHit === 'run' && triggered) {
        await endHeldRun(chat.id, 'paused_cap', 'limit');
      } else if (await heldTooLong(chat.id, now)) {
        // Nobody continued it in 7 days: it stopped at its limit, not for want of an answer.
        await endHeldRun(chat.id, 'paused_cap', 'limit');
      }
      chat = (await loadRun(chatRunId)) ?? chat;
    }
    target = chat ? agentStateOf(chat) : { status: 'failed' };
    capHit = chat?.progress?.capHit;
  }
  if (!target || target.status === run.status) return run.status;
  if (
    !(await moveAgentRun(run.id, run.status, target.status, { stopReason: target.stopReason, now }))
  ) {
    return (await readAgentRun(run.id))?.status ?? null;
  }

  if (run.agent_id) {
    // The month's AI limit (not the run's own cap) pauses the agent until it resets (§L item 55).
    if (target.status === 'paused_cap' && capHit !== 'run') {
      await pauseAgentForSystem(run.organization_id, run.agent_id, 'cap');
    }
    if (ENDED.includes(target.status)) {
      await markShipped(run.id);
      if (target.status === 'done' || target.status === 'failed') {
        await countRun(run.organization_id, run.agent_id, target.status === 'failed');
      }
    }
  }
  return target.status;
}

// ─── The driver ──────────────────────────────────────────────────────────────

export interface AgentRunDriverDeps {
  /** Runs the drive past the request's answer (next/server's after()). */
  background: (task: () => Promise<void>) => void;
  /** The Chat engine's driver. */
  drive: (actor: ChatActor, chatRunId: string) => Promise<void>;
  now: () => Date;
}

/** after() in a request; outside one (a script, a test), on its own. */
function inBackground(task: () => Promise<void>) {
  const guarded = () =>
    task().catch((err) => console.error('[chat/agents] a background run failed:', err));
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}

/**
 * The driver: hands a started run to Chat (openAgentRun) and drives it in
 * the background, then keeps the agent run in step (settleAgentRun). The
 * next queued run starts on the minute tick, not here. Resolves once the
 * run is handed over, not when it ends.
 */
export function createAgentRunDriver(deps: Partial<AgentRunDriverDeps> = {}): AgentRunDriver {
  const { background = inBackground, drive = driveRun, now = () => new Date() } = deps;
  const driver: AgentRunDriver = async ({ id, organizationId }) => {
    const opened = await openAgentRun(id, organizationId, now());
    if (!opened) return;
    background(async () => {
      try {
        await drive(opened.actor, opened.chatRunId);
      } finally {
        await settleAgentRun(opened.agentRunId, { now: now() });
      }
    });
  };
  return driver;
}

/** The driver the agents API, the triggers and the sweep start runs with. */
export const agentRunDriver: AgentRunDriver = createAgentRunDriver();
