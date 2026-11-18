import { after } from 'next/server';
import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { actionCode, actionCodeNo } from '@/lib/action-center/action-ref';
import type { Json } from '@/types/supabase';
import {
  actionClosed,
  actionScopeOf,
  categoryName,
  logActionRunEvent,
  snapshotNumbers,
  type ActionSnapshot,
} from './agent-action';
import {
  connectionGaps,
  connectionName,
  neededConnections,
  readBrandConnections,
} from './agent-connections';
import {
  canWriteAgents,
  operatorPlanSettings,
  versionFromRow,
  type AgentPausedReason,
  type AgentVersionData,
} from './agent-rules';
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
  type LoadedAgent,
} from './agents';
import {
  APPROVAL_TTL_MS,
  driveRun,
  endHeldRun,
  stopChatRun,
  validTimezone,
  type ChatActor,
} from './engine';
import { OPEN_RUN_STATUSES, loadRun, type LoadedRun } from './engine-store';
import { chatAgenticEnabled } from './flag';
import { resolveAgentNeedsYou, tellAgentNeedsYou } from './agent-needs-you';
import { openHeadlessRun } from './headless-run';
import { callScopeOf, callableAgentsOf, type CallScope } from './agent-calls';
import { operatorReasonWords, operatorScopeOf, type OperatorScope } from './agent-children';
import { openAgentFollowUps } from './schedule/followup';
import { readOperatorFacts } from './operator/facts';
import { planDay } from './operator/plan';
import {
  expirePlan,
  insertPlan,
  planInForce,
  readRunPlan,
  type PlanView,
} from './operator/plan-store';
import { dayIn } from '@/lib/time-zone';

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
 * brand_gone, cap; §G item 34). So does a Required connection the run's
 * brand lacks (connection, §H item 42; agent-connections.ts); a missing
 * Optional one is said in the run's message, and the run does the rest.
 * A read-only workspace starts nothing. Then
 * the run gets a chat of its own (origin agent, agent_run_id; §H item 36;
 * written as every headless run is, headless-run.ts),
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
 * So does a run an AEO Operator started (agent-children.ts): nobody watches
 * it either, so at its own cap it stops, as a triggered run does.
 * An ended run counts toward the agent's failed runs in a row (3 pause it,
 * failures); one that shipped something gets a Pending outcome until the
 * impact ledger measures it (§I). Each run's use is kept by the server as
 * the run spends (usage_share).
 *
 * A run on an Action Center action (Run agent, CHAT-21 §F) is scoped to it:
 * its chat is titled "{agent} · {action}", its message names the action by
 * number and category, and its scope carries an Action chip, the action as
 * an @ reference, and its title and open tasks as they were when the person
 * asked, read as untrusted data; it starts tainted (every change a card). It doesn't start on an action
 * closed since, and stops when the action closes while it runs (edge case
 * 7): both "The action was closed" (action_closed). Its start and its end
 * are written to the action's History, as the person it acts as (§F item
 * 31). A slot that frees is filled by the minute
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
  'id, organization_id, agent_id, agent_version, brand_id, trigger_kind, trigger_ref, acting_user_id, status, evidence_json, action_id, queued_at, started_at';
const VERSION_COLUMNS =
  'agent_id, version, skill_ids, instructions, mode, connections, model, effort, scope, notify_user_ids, followup_days, can_call, operator_json';

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
  /** The action a Run agent click scoped it to (§F item 28). */
  action_id: string | null;
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

/** Whether the brand is the demo brand (00380), whose sample agent runs nothing settles. */
async function onDemoBrand(brandId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('is_demo')
    .eq('id', brandId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the agent run's brand: ${error.message}`);
  return (data as { is_demo?: boolean } | null)?.is_demo === true;
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
  // The workspace's own key is marked failing (AGENT-OWN-KEY §5.2 item 4).
  if (refusal.code === 'own_key_failed') return 'own_key';
  // A skill it runs was turned off, rejected, deleted or changed (CHAT-13).
  if (refusal.code === 'skill_off') return 'skill_off';
  // All agents reached the month's limit on the workspace's own key (AGENT-OWN-KEY §4.2).
  if (refusal.code === 'own_key_cap') return 'own_key_cap';
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
    stopReason?: 'brand_gone' | 'action_closed' | 'own_key' | null;
    now: Date;
  },
): Promise<null> {
  if (pause && run.agent_id && isTriggered(run.trigger_kind)) {
    await pauseAgentForSystem(run.organization_id, run.agent_id, pause);
  }
  // A Run agent click that didn't start says so in its action's History.
  if (await moveAgentRun(run.id, 'running', to, { stopReason, now })) {
    await logActionRunEnd(run, to, stopReason);
  }
  return null;
}

/** "/winback, then /faq". */
const skillsLine = (skills: readonly string[]) =>
  skills.map((skill) => runnerT('skill', { skill })).join(runnerT('then'));

/** Why an AEO Operator started the run, in words the code writes from the plan's codes. */
function operatorLine(scope: OperatorScope): string {
  const reasons = scope.reasons.map(operatorReasonWords);
  return reasons.length > 0
    ? runnerT('operator', { reasons: reasons.join(', ') })
    : runnerT('operatorNoReasons');
}

/**
 * The run's message: the agent and its brand, its skills in order, what
 * started it, each Optional connection the brand lacks (done without, and
 * said so: §H item 42), its instructions, and for a triggered run how to
 * work with nobody watching (CHAT-12 item 12). Plain words; the evidence's
 * ids go in the run's scope, never in the message.
 */
export function agentRunMessage(input: {
  agent: string;
  brand: string;
  skills: readonly string[];
  instructions: string | null;
  triggerKind: string;
  evidence: AgentEvidence;
  /** The action a Run agent click scoped it to, as it was then (§F item 28). */
  action?: ActionSnapshot | null;
  /** The Optional connections the brand lacks, by key. */
  missing?: readonly string[];
  /** Another agent's run called it (CHAT-27 phase 2): that agent; what it asks is in the scope. */
  call?: CallScope | null;
  /** An AEO Operator's plan started it (agent-children.ts): why, as the plan's codes. */
  operator?: OperatorScope | null;
  /** The agents it may run with run_agent, by name (their ids are in the scope). */
  callable?: readonly { name: string }[];
}): string {
  const signals = input.evidence.fires.filter((f) => f.kind === 'signal').length;
  const lines = [
    runnerT('message', {
      agent: input.agent,
      brand: input.brand,
      skills: skillsLine(input.skills),
    }),
    input.operator
      ? operatorLine(input.operator)
      : runnerT('started', { trigger: input.triggerKind, count: signals }),
  ];
  // Its number and category only: the action's title and tasks may come from
  // outside, so they go in the scope as data (runScope), never in the message.
  if (input.action) {
    lines.push(
      runnerT('action', {
        no: actionCodeNo(snapshotNumbers(input.action)),
        category: categoryName(input.action.category),
      }),
    );
  }
  if (input.evidence.earlier.length > 0) {
    lines.push(runnerT('earlier', { count: input.evidence.earlier.length }));
  }
  for (const key of input.missing ?? []) {
    lines.push(runnerT('notConnected', { name: connectionName(key) }));
  }
  if (input.instructions) lines.push(runnerT('instructions', { text: input.instructions }));
  if (input.call) lines.push(runnerT('calledBy', { agent: input.call.agent }));
  if (input.callable?.length) {
    lines.push(runnerT('canCall', { agents: input.callable.map((a) => a.name).join(', ') }));
  }
  // Nobody watches a triggered run, nor one another agent called or an Operator started.
  if (isTriggered(input.triggerKind) || input.call || input.operator) {
    lines.push(runnerT('background'));
  }
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
  input: {
    agent: string;
    brand: string;
    triggerKind: string;
    action?: ActionSnapshot | null;
    call?: CallScope | null;
    operator?: OperatorScope | null;
    callable?: readonly { id: string; name: string }[];
  },
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
  // "Action · {title}" (§F item 28): its number on screen, its id for the run alone.
  const { action } = input;
  const code = action ? actionCode(snapshotNumbers(action)) : '';
  if (action) {
    chips.push({
      key: 'action',
      label: runnerT('chip.action'),
      value: (withIds ? `${code} ${action.id}` : `${code} · ${action.title}`).slice(0, 200),
    });
  }
  if (withIds) {
    for (const fire of evidence.fires) {
      if (chips.length >= MAX_CHIPS - 1) break;
      // A brand added names the run's own brand: its chip is there already.
      if (fire.kind === 'brand_added') continue;
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
  // The action as Ask about this attaches it (Chat's Action Center reads take its
  // id), with its title and open tasks when the person asked: data the models read
  // as untrusted (progress.scopeUntrusted), never instructions.
  const onAction =
    withIds && action
      ? {
          references: [{ type: 'task' as const, id: action.id, label: action.title.slice(0, 200) }],
          action: {
            number: code,
            title: action.title,
            category: action.category,
            open_tasks: action.tasks,
          },
        }
      : {};
  // What the calling agent asks, as data (CHAT-27 phase 2), and the agents it may run, by id.
  const onCall =
    withIds && input.call ? { call: { agent: input.call.agent, ask: input.call.ask } } : {};
  // An Operator's plan: its id and why, as codes the plan's code wrote (never text).
  const onPlan =
    withIds && input.operator
      ? { operator: { plan_id: input.operator.planId, reasons: input.operator.reasons } }
      : {};
  const canCall =
    withIds && input.callable?.length
      ? { can_call: input.callable.map((a) => ({ agent_id: a.id, name: a.name })) }
      : {};
  return {
    context: { route: '/dashboard/agents', chips },
    ...onAction,
    ...onCall,
    ...onPlan,
    ...canCall,
  };
}

/** A started run that passed the checks before a run (below), ready for its chat or its plan. */
interface CheckedRun {
  run: AgentRunRow;
  agent: LoadedAgent;
  version: AgentVersionData;
  actor: ChatActor;
  brand: { id: string; name: string };
  /** The Optional connections its brand lacks, by key. */
  optional: string[];
  action: ActionSnapshot | null;
  evidence: AgentEvidence;
  timezone: string;
  call: CallScope | null;
  operator: OperatorScope | null;
  callable: { id: string; name: string }[];
}

/**
 * The checks before a run (above), for the person it acts as now: a run
 * that can't start ends here (and a triggered agent pauses for the reason).
 * Null when there is nothing to drive: the run ended, or isn't running.
 */
async function checkAgentRun(
  runId: string,
  organizationId: string,
  now: Date,
): Promise<CheckedRun | null> {
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

  // An AEO Operator's too: CHAT_OPERATOR for the workspace, Growth and up (agents.ts runChecks).
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
      stopReason: pause === 'brand_gone' || pause === 'own_key' ? pause : null,
      now,
    });
  }
  // The agent's own monthly cap holds for every run, Run now's on an agent paused at
  // it too: the run ends before it starts, and a triggered agent pauses (cap).
  if (await agentMonthCapReached(organizationId, agent.row.id, agent.row.max_month_share)) {
    return endBeforeStart(run, 'stopped', { pause: 'cap', now });
  }
  // The run's brand, as the person it acts as may use it now (BRAND-ACCESS §5.3): one taken
  // from them since it was queued is gone for this run, as a deleted one is.
  const brand = (await runnableBrands(organizationId, version.scope, ctx.viewer.brandAccess)).find(
    (b) => b.id === run.brand_id,
  );
  if (!brand) return endBeforeStart(run, 'stopped', { stopReason: 'brand_gone', now });
  // What the brand has connected (§H item 42): without a Required connection nothing starts,
  // and a triggered agent pauses (connection); an Optional one missing is said in the run.
  const gaps = connectionGaps(
    neededConnections(version.skill_ids, version.connections),
    await readBrandConnections(brand.id),
  );
  if (gaps.required.length > 0) {
    return endBeforeStart(run, 'stopped', { pause: 'connection', now });
  }

  // A run on an action: the action as the person asked (§F item 28), still open (edge case 7).
  const action = run.action_id ? actionScopeOf(run.evidence_json) : null;
  if (run.action_id && (!action || (await actionClosed(run.action_id)))) {
    return endBeforeStart(run, 'stopped', { stopReason: 'action_closed', now });
  }

  const evidence = evidenceOf(run.evidence_json);
  const timezone = validTimezone(evidence.fires.find((f) => f.timezone)?.timezone);
  // Called by another agent's run (CHAT-27 phase 2): in the stricter mode, that run's ask as data.
  const call = run.trigger_kind === 'agent' ? callScopeOf(run.evidence_json) : null;
  // Started by an AEO Operator's plan (agent-children.ts): in its own mode, untainted, with the
  // plan's reasons in words the code writes. Nothing the Operator's model wrote reaches it.
  const operator =
    run.trigger_kind === 'agent' && !call ? operatorScopeOf(run.evidence_json) : null;
  // The agents it may run (none for a run another run started, nor for an Operator: no chains).
  const callable =
    call || operator || agent.row.kind === 'operator' ? [] : await callableAgentsOf(run.id);
  return {
    run,
    agent: { row: agent.row, version },
    version,
    actor,
    brand,
    optional: gaps.optional,
    action,
    evidence,
    timezone,
    call,
    operator,
    callable,
  };
}

/** Names who a run acts as on its row, once it has its chat: the owner now, for a trigger. */
async function nameActingUser(run: AgentRunRow, actingUserId: string): Promise<void> {
  if (actingUserId === run.acting_user_id) return;
  const { error } = await supabaseAdmin
    .from('chat_agent_runs')
    .update({ acting_user_id: actingUserId })
    .eq('id', run.id);
  if (error) console.error('[chat/agents] could not name who a run acts as:', error);
}

/** A checked run's chat (above): its message, its scope, its mode. Null when a second driver made it. */
async function openCheckedRun(checked: CheckedRun, now: Date): Promise<OpenedAgentRun | null> {
  const { run, agent, version, actor, brand, action, evidence, timezone, call } = checked;
  const organizationId = run.organization_id;
  const actingUserId = actor.userId;
  const words = {
    agent: agent.row.name,
    brand: brand.name,
    triggerKind: run.trigger_kind,
    action,
    call,
    operator: checked.operator,
    callable: checked.callable,
  };
  const text = agentRunMessage({
    ...words,
    skills: version.skill_ids,
    instructions: version.instructions,
    evidence,
    missing: checked.optional,
  });

  // Its chat, owned by the person it acts as; one per agent run: a second driver leaves it.
  const opened = await openHeadlessRun({
    origin: 'agent',
    organizationId,
    userId: actingUserId,
    chat: {
      create: {
        brandId: brand.id,
        title: action
          ? runnerT('actionTitle', { agent: agent.row.name, action: action.title })
          : runnerT('title', { agent: agent.row.name, brand: brand.name }),
        agentRunId: run.id,
      },
    },
    message: { text, context: runScope(words, evidence, false) as unknown as Json },
    timezone,
    brandId: brand.id,
    mode: call ? call.mode : version.mode,
    // The agent's model and effort (CHAT-16): the engine runs them as the plan allows (W4-03).
    model: version.model,
    effort: version.effort,
    // Started already: the agent's slot (chat_start_next_agent_run) is its place in line.
    status: 'running',
    progress: {
      scope: runScope(words, evidence, true),
      // An action's title and tasks, or another agent's ask, may come from outside: every
      // change is a card (§16a).
      ...(action || call ? { tainted: true, scopeUntrusted: true } : {}),
    },
    now,
  });
  if (!opened) return null;
  const { conversationId, chatRunId } = opened;
  await nameActingUser(run, actingUserId);
  if (run.action_id && action) {
    await logActionRunEvent(
      run.action_id,
      'agent_run_started',
      {
        run_id: run.id,
        agent_id: agent.row.id,
        agent: agent.row.name,
        conversation_id: conversationId,
        mode: version.mode,
      },
      actingUserId,
    );
  }
  return { agentRunId: run.id, organizationId, chatRunId, actor };
}

/**
 * Makes a started agent run's Chat run, after the checks (above), or ends
 * the run when it can't start. An AEO Operator's run plans its day first
 * (prepareAgentPlan), here in the request: the driver does that in the
 * background. Null when there is nothing to drive: the run ended, isn't
 * running, already has its chat (a second driver), or had nothing to do.
 */
export async function openAgentRun(
  runId: string,
  organizationId: string,
  now = new Date(),
): Promise<OpenedAgentRun | null> {
  const checked = await checkAgentRun(runId, organizationId, now);
  if (!checked) return null;
  if (checked.agent.row.kind === 'operator') return prepareAgentPlan(checked, { now });
  return openCheckedRun(checked, now);
}

// ─── An AEO Operator's day ───────────────────────────────────────────────────

/**
 * The plan step's own deadline, from the run's start: inside the 5 minutes
 * after which a started run with no chat counts as lost (HANDOVER_GRACE_MS),
 * with room to open its chat.
 */
export const PLAN_DEADLINE_MS = 4 * 60_000;

/** How the plan step reads its facts and plans: the app's by default (tests swap them). */
export interface PlanStepDeps {
  now: Date;
  readFacts?: typeof readOperatorFacts;
  plan?: typeof planDay;
}

/** "Nov 18, 2026": a plan's day as its chat's title says it. */
function dayWords(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? day
    : date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
}

/** A run that had nothing to do (or its day has a plan already): skipped, no chat, no model call. */
async function skipRun(
  run: AgentRunRow,
  reason: 'nothing_to_do' | 'daily_limit',
  now: Date,
): Promise<null> {
  const { error } = await supabaseAdmin
    .from('chat_agent_runs')
    .update({ status: 'skipped', skipped_reason: reason, finished_at: now.toISOString() })
    .eq('id', run.id)
    .eq('status', 'running');
  if (error) throw new Error(`Could not skip the agent run: ${error.message}`);
  return null;
}

/** The facts, or null when the plan step's deadline comes first. */
async function factsWithin<T>(read: Promise<T>, ms: number): Promise<T | null> {
  if (ms <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([read, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * An AEO Operator's day (AEO Operator plan §4.2 steps 2–3), after the
 * checks before a run: in the driver's background task, never the tick's
 * awaited path (many Operators fire at 07:00), and within PLAN_DEADLINE_MS
 * of the run's start.
 *
 *   - Its day is the fire's time zone's (a Run now's: its schedule's, else
 *     UTC). A plan in force for the Operator, brand and day already (an
 *     earlier run's, proposed or started): the run is skipped, daily_limit.
 *     A declined, expired or empty one leaves room for a new plan.
 *   - The facts (operator/facts.ts, as the run's person, on its brand), and
 *     the plan (operator/plan.ts), by code: no model.
 *   - Its row (chat_agent_plans): proposed with its agents, or empty.
 *   - Nothing to do: the run is skipped, nothing_to_do. No chat, no model call.
 *   - Else its chat opens, "{agent} · {brand} · {day}", with the /operator
 *     skill loaded, and the plan in its scope as the app's data: ids, codes,
 *     counts and shares, never an agent's name or an action's title.
 */
export async function prepareAgentPlan(
  checked: CheckedRun,
  deps: PlanStepDeps,
): Promise<OpenedAgentRun | null> {
  const { now, readFacts = readOperatorFacts, plan = planDay } = deps;
  const { run, agent, version, actor, brand } = checked;
  const organizationId = run.organization_id;
  const timezone = await planZoneOf(run, agent.row.id);
  const day = dayIn(now.getTime(), timezone);

  // A second driver of this run, or a run whose day already has its plan.
  if (await readRunPlan(organizationId, run.id)) return null;
  if (await planInForce(organizationId, agent.row.id, brand.id, day)) {
    return skipRun(run, 'daily_limit', now);
  }

  const startedAt = Date.parse(run.started_at ?? run.queued_at);
  const left = PLAN_DEADLINE_MS - (now.getTime() - (Number.isFinite(startedAt) ? startedAt : 0));
  const facts = await factsWithin(
    readFacts({ orgId: organizationId, brandId: brand.id, ownerId: actor.userId, now }),
    left,
  );
  // Its facts took past the deadline: the run fails rather than open a chat its sweep calls lost.
  if (!facts) return endBeforeStart(run, 'failed', { now });
  const settings = operatorPlanSettings(version.operator_json, agent.row.max_run_share, timezone);
  const dayPlan = plan(facts, settings, now);

  const saved = await insertPlan({
    organizationId,
    agentId: agent.row.id,
    runId: run.id,
    brandId: brand.id,
    day,
    plan: dayPlan,
  });
  // Another run's plan took the day between the read and the write.
  if (!saved) return skipRun(run, 'daily_limit', now);
  if (saved.items.length === 0) return skipRun(run, 'nothing_to_do', now);

  const words = {
    agent: agent.row.name,
    brand: brand.name,
    triggerKind: run.trigger_kind,
  };
  const text = [
    runnerT('message', {
      agent: agent.row.name,
      brand: brand.name,
      skills: skillsLine(version.skill_ids),
    }),
    runnerT('operatorPlan', { brand: brand.name, count: saved.items.length }),
    runnerT('operatorBackground'),
  ].join('\n\n');
  // The plan as the app's data: ids, codes, counts and shares only.
  const operatorPlan = {
    plan_id: saved.id,
    brand_id: brand.id,
    day,
    budget_share: saved.budgetShare,
    agents: saved.items.map((item) => ({
      agent_id: item.agent_id,
      share: item.share,
      reasons: item.reasons,
    })),
    passed_over: saved.passedCount,
  };
  const scope = runScope(words, checked.evidence, true);
  const opened = await openHeadlessRun({
    origin: 'agent',
    organizationId,
    userId: actor.userId,
    chat: {
      create: {
        brandId: brand.id,
        title: runnerT('operatorTitle', {
          agent: agent.row.name,
          brand: brand.name,
          day: dayWords(day),
        }),
        agentRunId: run.id,
      },
    },
    message: { text, context: runScope(words, checked.evidence, false) as unknown as Json },
    timezone,
    brandId: brand.id,
    mode: version.mode,
    model: version.model,
    effort: version.effort,
    status: 'running',
    progress: {
      scope: { ...scope, operator_plan: operatorPlan },
      // Its own skill, loaded from the start: nothing for the model to pick.
      skills: [...version.skill_ids],
      // Its own tools and the question card, nothing else (engine.ts OPERATOR_RUN_TOOLS).
      operatorRun: true,
    },
    now,
  });
  if (!opened) return null;
  await nameActingUser(run, actor.userId);
  return { agentRunId: run.id, organizationId, chatRunId: opened.chatRunId, actor };
}

/**
 * The zone an Operator's day is counted in: the fire's (its schedule's), or
 * for a run with none (Run now) its first enabled schedule's, else UTC.
 * The sweep counts the end of a plan's day the same way.
 */
export async function planZoneOf(
  run: Pick<AgentRunRow, 'evidence_json'>,
  agentId: string,
): Promise<string> {
  const fired = evidenceOf(run.evidence_json).fires.find((f) => f.timezone)?.timezone;
  if (fired) return validTimezone(fired);
  const { data, error } = await supabaseAdmin
    .from('chat_agent_triggers')
    .select('config_json, enabled')
    .eq('agent_id', agentId)
    .eq('kind', 'schedule');
  if (error) throw new Error(`Could not read the Operator's schedule: ${error.message}`);
  for (const row of (data ?? []) as { config_json: Json; enabled: boolean }[]) {
    const zone = (row.config_json as { timezone?: unknown } | null)?.timezone;
    if (row.enabled && typeof zone === 'string') return validTimezone(zone);
  }
  return 'UTC';
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
    // Its parts (CHAT-27) answer to it: never the agent run's chat run.
    .is('parent_run_id', null)
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

/**
 * The agent run's state for its Chat run's (§H item 37). A Chat run that
 * ended on the workspace's own key failing is stopped `own_key`, not failed
 * (AGENT-OWN-KEY §5.2): it doesn't count toward 3 failed runs in a row.
 */
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
      return chat.progress?.keyFailure
        ? { status: 'stopped', stopReason: 'own_key' }
        : { status: 'failed' };
    case 'stopped': {
      const why = chat.progress?.stoppedFor;
      return {
        status: 'stopped',
        stopReason:
          why === 'expired'
            ? 'no_answer'
            : why === 'limit'
              ? 'run_cap'
              : why === 'action_closed'
                ? 'action_closed'
                : 'user',
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
  // Its follow-up check, its version's follow-up days on (W3-05, schedule/followup.ts).
  await openAgentFollowUps(agentRunId);
}

/**
 * A run on an action that ended: "Agent run completed" (or failed, stopped)
 * in the action's History, as the person it acted as (§F item 31).
 */
async function logActionRunEnd(run: AgentRunRow, status: string, stopReason?: string | null) {
  if (!run.action_id) return;
  let agentName: string | null = null;
  if (run.agent_id) {
    const { data } = await supabaseAdmin
      .from('chat_agents')
      .select('name')
      .eq('id', run.agent_id)
      .maybeSingle();
    agentName = (data as { name: string } | null)?.name ?? null;
  }
  await logActionRunEvent(
    run.action_id,
    'agent_run_completed',
    {
      run_id: run.id,
      agent_id: run.agent_id,
      agent: agentName,
      to: status,
      stop_reason: stopReason ?? null,
    },
    run.acting_user_id,
  );
}

/**
 * The action a run works on closed while it ran (edge case 7): its Chat run
 * stops (after the step it is on, when it is driven elsewhere), and the run
 * ends "The action was closed" (action_closed). Nothing more is changed.
 */
async function stopForClosedAction(
  run: AgentRunRow,
  chatRunId: string | null,
  now: Date,
): Promise<string | null> {
  if (chatRunId && run.acting_user_id) {
    const stopped = await stopChatRun(
      { userId: run.acting_user_id, email: null, organizationId: run.organization_id },
      chatRunId,
      'action_closed',
    );
    if (!stopped.ok) console.error('[chat/agents] could not stop a closed action’s run:', stopped);
  }
  if (!(await moveAgentRun(run.id, run.status, 'stopped', { stopReason: 'action_closed', now }))) {
    return (await readAgentRun(run.id))?.status ?? null;
  }
  if (run.agent_id) await markShipped(run.id);
  await logActionRunEnd(run, 'stopped', 'action_closed');
  return 'stopped';
}

/**
 * An AEO Operator's plan still unanswered at the end of its day (§4.2 step
 * 8), in the zone its day is counted in: the Chat run waiting on its card
 * stops as expired, the agent run follows it (stopped, no_answer) and the
 * plan expires, so the run's held place (the unique index on held runs)
 * never blocks the next morning's. False while its day lasts, and for a plan
 * no longer waiting. Safe to call twice.
 */
export async function endUnansweredPlan(
  plan: Pick<PlanView, 'id' | 'organizationId' | 'agentId' | 'runId' | 'day' | 'status'>,
  now: Date,
): Promise<boolean> {
  if (plan.status !== 'proposed') return false;
  const run = await readAgentRun(plan.runId);
  if (run && run.organization_id !== plan.organizationId) return false;
  const zone = run ? await planZoneOf(run, plan.agentId) : 'UTC';
  if (dayIn(now.getTime(), zone) <= plan.day) return false;
  if (run && HELD.includes(run.status)) {
    const chatRunId = await chatRunOf(run.id);
    if (chatRunId) await endHeldRun(chatRunId, 'waiting', 'expired');
    // Stopped, no_answer; its plan expires with it (expireRunPlan).
    await settleAgentRun(run.id, { now });
  }
  // A run that ended some other way, or none: the plan expires all the same.
  await expirePlan(plan.organizationId, plan.id);
  return true;
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
  // The demo brand's sample runs (00475) stand as the demo built them: none has a
  // Chat run to follow, and nothing ends, counts or pauses on their account.
  if (run.brand_id && (await onDemoBrand(run.brand_id))) return run.status;

  const chatRunId = await chatRunOf(run.id);
  // Its action closed while its Chat run still works or waits (edge case 7). Not
  // yet handed over: its driver checks the action itself, within the grace.
  if (run.action_id && (await actionClosed(run.action_id))) {
    const chat = chatRunId ? await loadRun(chatRunId) : null;
    const handingOver =
      !chatRunId &&
      now.getTime() - Date.parse(run.started_at ?? run.queued_at) <= HANDOVER_GRACE_MS;
    if (!handingOver && (!chat || OPEN_RUN_STATUSES.includes(chat.status))) {
      return stopForClosedAction(run, chatRunId, now);
    }
  }
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
      // Nobody watches a triggered run, nor one an AEO Operator started (agent-children.ts).
      const unattended =
        isTriggered(run.trigger_kind) ||
        (run.trigger_kind === 'agent' && operatorScopeOf(run.evidence_json) !== null);
      // An unattended run at its own cap ends "Stopped at its limit" (CHAT-27 item 22).
      if (chat.progress.capHit === 'run' && unattended) {
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
  // Waiting for its person: an e-mail by their "Notify me when an agent needs me", once a
  // run (00474); going on or ending closes its notice.
  if (target.status === 'needs_you') await tellAgentNeedsYou(run.organization_id, run.id);
  else if (run.status === 'needs_you') await resolveAgentNeedsYou(run.id);

  if (run.agent_id) {
    // The month's AI limit (not the run's own cap) pauses the agent until it resets (§L item 55).
    if (target.status === 'paused_cap' && capHit !== 'run') {
      await pauseAgentForSystem(run.organization_id, run.agent_id, 'cap');
    }
    // The own key failed: a triggered agent pauses until it works (AGENT-OWN-KEY §5.2);
    // a person's Run now or Run agent doesn't pause it, as with a missing connection.
    if (target.stopReason === 'own_key' && isTriggered(run.trigger_kind)) {
      await pauseAgentForSystem(run.organization_id, run.agent_id, 'own_key');
    }
    if (ENDED.includes(target.status)) {
      await markShipped(run.id);
      if (target.status === 'done' || target.status === 'failed') {
        await countRun(run.organization_id, run.agent_id, target.status === 'failed');
      }
    }
  }
  if (ENDED.includes(target.status)) {
    await logActionRunEnd(run, target.status, target.stopReason);
    // An AEO Operator's run that ended with its plan unanswered: the plan expires, and Run now
    // (or tomorrow's run) may make another (§4.2 step 8).
    await expireRunPlan(run);
  }
  return target.status;
}

/** An ended run's plan still waiting for its answer (an AEO Operator's): expired. */
async function expireRunPlan(run: AgentRunRow): Promise<void> {
  const { error } = await supabaseAdmin
    .from('chat_agent_plans')
    .update({ status: 'expired' })
    .eq('run_id', run.id)
    .eq('organization_id', run.organization_id)
    .eq('status', 'proposed');
  if (error) console.error('[chat/agents] could not expire an Operator’s plan:', error.message);
}

// ─── The driver ──────────────────────────────────────────────────────────────

export interface AgentRunDriverDeps {
  /** Runs the drive past the request's answer (next/server's after()). */
  background: (task: () => Promise<void>) => void;
  /** The Chat engine's driver, with whose session the request carries (null for none). */
  drive: (actor: ChatActor, chatRunId: string, sessionUserId: string | null) => Promise<void>;
  now: () => Date;
}

const driveAgentRun: AgentRunDriverDeps['drive'] = (actor, chatRunId, sessionUserId) =>
  driveRun(actor, chatRunId, undefined, { sessionUserId });

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
 * run is handed over, not when it ends. The request's session drives the
 * run's changes only when it is the person the run acts as (their own Run
 * now or Run agent); otherwise (the tick, a signal, another person's
 * click) each change asks first.
 */
export function createAgentRunDriver(deps: Partial<AgentRunDriverDeps> = {}): AgentRunDriver {
  const { background = inBackground, drive = driveAgentRun, now = () => new Date() } = deps;
  const driveOpened = async (opened: OpenedAgentRun, sessionUserId: string | null) => {
    const session = sessionUserId === opened.actor.userId ? sessionUserId : null;
    try {
      await drive(opened.actor, opened.chatRunId, session);
    } finally {
      await settleAgentRun(opened.agentRunId, { now: now() });
    }
  };
  const driver: AgentRunDriver = async ({ id, organizationId, sessionUserId = null }) => {
    const checked = await checkAgentRun(id, organizationId, now());
    if (!checked) return;
    // An AEO Operator plans its day in the background, chat and all (§4.2 step 2): the tick
    // only checks it, however many Operators fire at 07:00.
    if (checked.agent.row.kind === 'operator') {
      background(async () => {
        const opened = await prepareAgentPlan(checked, { now: now() });
        if (opened) await driveOpened(opened, sessionUserId);
      });
      return;
    }
    const opened = await openCheckedRun(checked, now());
    if (!opened) return;
    background(() => driveOpened(opened, sessionUserId));
  };
  return driver;
}

/** The driver the agents API, the triggers and the sweep start runs with. */
export const agentRunDriver: AgentRunDriver = createAgentRunDriver();
