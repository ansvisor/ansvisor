import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/types/supabase';
import type { ChatActor } from './engine';
import { CHAT_MODES, type ChatMode } from './precedence';
import { loadAgent, readAgentContext, runnableBrands } from './agents';
import {
  agentActDenial,
  canCallDenial,
  canSeeAgent,
  canWriteAgents,
  versionFromRow,
} from './agent-rules';
import { dataBlock, guardData } from './untrusted';

/**
 * An agent that runs another saved agent (CHAT-27 phase 2, items 14–18;
 * W4-26), behind CHAT_AGENTIC. A run of agent A calls run_agent for one of
 * the agents A's Can call names; once the person approves the card, the
 * called agent B runs as its own agent run (trigger agent,
 * called_by_run_id: 00466) in a chat of its own, and A's step waits for it,
 * at most 4 minutes. What B answered comes back to A as untrusted data.
 *
 *   - Who: only a run of an agent, never a person's own chat, and only for
 *     the agents its version's Can call names that are still on (active).
 *   - No chains: a called run can't call (so no cycle, A → B → A). At most
 *     3 calls a run (Technical T3). The database checks both too (00466).
 *   - Permissions, the stricter of the two: B acts as the person A acts as
 *     (their role and brands, read again when B starts), on A's brand,
 *     which B's own scope has to cover; in the stricter of A's mode and
 *     B's own, with B's own connections. Every change B makes asks first:
 *     no session is behind it (an EXECUTE always asks).
 *   - Budget: B's cap is the smaller of its own Max per run and what is
 *     left of A's; what B spends comes out of A's cap on the server
 *     (chat-budget.js), so what B doesn't use comes back to A.
 *   - Stop: A stopped while it waits stops B too.
 *
 * Server only.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatAgents.calls' });

/** Calls one run makes at most (Technical T3; 00466's trigger). */
export const MAX_CALLS_PER_RUN = 3;
/**
 * How long a caller's step waits for the agent it ran. Technical T3 says 10
 * minutes, but the wait runs inside the request that approved the card
 * (approve's maxDuration: 300 s): 4 minutes leaves the caller a minute to
 * finish its answer. A longer wait needs a longer maxDuration first.
 */
export const CALL_WAIT_MS = 4 * 60_000;
/** How often the wait looks for the caller's Stop, and keeps the caller's run alive. */
const POLL_MS = 3_000;
/** The called agent's answer, as the caller reads it, at most. */
const SUMMARY_MAX = 4_000;

const MODE_RANK: Record<ChatMode, number> = { ask_first: 0, auto: 1, full_auto: 2 };

/** The stricter of two modes (CHAT-27 item 16): Ask me first over Auto over Full auto. */
export function stricterMode(a: ChatMode, b: ChatMode): ChatMode {
  return MODE_RANK[a] <= MODE_RANK[b] ? a : b;
}

/** A called run's cap: the smaller of its own and what is left of its caller's, to 0.01. */
export function calleeShare(own: number, callerMax: number, callerUsed: number): number {
  const left = Math.max(0, callerMax - callerUsed);
  return Math.floor(Math.min(own, left) * 100) / 100;
}

/** What a call is about, kept on the called run (chat_agent_runs.evidence_json.call). */
export interface CallScope {
  /** The calling agent's name. */
  agent: string;
  mode: ChatMode;
  /** What the calling agent asks, in its words: untrusted. */
  ask: string;
}

/** A called run's call, read defensively from its evidence; null for any other run. */
export function callScopeOf(evidence: unknown): CallScope | null {
  const call = (evidence as { call?: Record<string, unknown> } | null)?.call;
  if (!call || typeof call.agent !== 'string' || typeof call.ask !== 'string') return null;
  const mode = CHAT_MODES.find((m) => m === call.mode) ?? 'ask_first';
  return { agent: call.agent.slice(0, 120), mode, ask: call.ask.slice(0, 1000) };
}

interface CallerRun {
  id: string;
  organization_id: string;
  agent_id: string | null;
  agent_version: number;
  brand_id: string | null;
  acting_user_id: string | null;
  called_by_run_id: string | null;
  max_share: number;
  usage_share: number;
}

const CALLER_COLUMNS =
  'id, organization_id, agent_id, agent_version, brand_id, acting_user_id, called_by_run_id, max_share, usage_share';

/** The agent run a Chat run is the run of (its chat's agent_run_id); null for a person's chat. */
export async function callerRunOf(chatRunId: string): Promise<CallerRun | null> {
  const { data: run, error } = await supabaseAdmin
    .from('chat_runs')
    .select('conversation_id')
    .eq('id', chatRunId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the run: ${error.message}`);
  const conversationId = (run as { conversation_id: string } | null)?.conversation_id;
  if (!conversationId) return null;
  const { data: chat, error: chatError } = await supabaseAdmin
    .from('chat_conversations')
    .select('agent_run_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (chatError) throw new Error(`Could not read the run's chat: ${chatError.message}`);
  const agentRunId = (chat as { agent_run_id: string | null } | null)?.agent_run_id;
  return agentRunId ? readAgentRunRow(agentRunId) : null;
}

async function readAgentRunRow(agentRunId: string): Promise<CallerRun | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_agent_runs')
    .select(CALLER_COLUMNS)
    .eq('id', agentRunId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the agent run: ${error.message}`);
  const row = data as CallerRun | null;
  return row
    ? { ...row, max_share: Number(row.max_share), usage_share: Number(row.usage_share) }
    : null;
}

/**
 * The agents an agent run may run now (CHAT-27 item 14): its version's Can
 * call, those still on (active) in its workspace, never its own agent, by
 * name. None for a run that was itself called (no chains). Never the demo
 * brand's sample agents (00475), even one a Can call named before: nothing
 * runs them, as Run agent's picker (runnableAgents) leaves them out.
 */
export async function callableAgentsOf(
  agentRunId: string,
): Promise<{ id: string; name: string }[]> {
  const run = await readAgentRunRow(agentRunId);
  if (!run || run.called_by_run_id || !run.agent_id) return [];
  const { data: version, error } = await supabaseAdmin
    .from('chat_agent_versions')
    .select('can_call')
    .eq('agent_id', run.agent_id)
    .eq('version', run.agent_version)
    .maybeSingle();
  if (error) throw new Error(`Could not read the agent's version: ${error.message}`);
  const ids = ((version as { can_call: string[] | null } | null)?.can_call ?? []).filter(
    (id) => id !== run.agent_id,
  );
  if (ids.length === 0) return [];
  const { data: agents, error: agentsError } = await supabaseAdmin
    .from('chat_agents')
    .select('id, name, status')
    .eq('organization_id', run.organization_id)
    .eq('status', 'active')
    .is('demo_brand_id', null)
    .in('id', ids);
  if (agentsError) throw new Error(`Could not read the agents: ${agentsError.message}`);
  const found = new Map(
    ((agents ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]),
  );
  // Can call's order, as the person set it.
  return ids.flatMap((id) => (found.has(id) ? [{ id, name: found.get(id)! }] : []));
}

/** What a call came to, for the model: a refusal it is told, or the called agent's answer. */
export type CallResult =
  | {
      ok: true;
      agent: string;
      status: string;
      /** Its use, as a share of the monthly AI limit. */
      used_share: number;
      /** What it answered, as untrusted data. */
      answer: string;
      /** Its chat, where its steps and any card it waits on are. */
      chat_href: `/dashboard/${string}` | null;
    }
  | {
      ok: false;
      reason: 'invalid' | 'not_found' | 'quota_exceeded' | 'conflict' | 'failed';
      message: string;
    };

const refuse = (
  reason: Extract<CallResult, { ok: false }>['reason'],
  message: string,
): CallResult => ({
  ok: false,
  reason,
  message,
});

/** How a call drives the called run: the engine's, with no session (every change asks). */
export interface CallDeps {
  drive(actor: ChatActor, chatRunId: string): Promise<void>;
  stop(actor: ChatActor, chatRunId: string): Promise<unknown>;
  now(): Date;
  sleep(ms: number): Promise<void>;
}

const defaultDeps: CallDeps = {
  drive: async (actor, chatRunId) =>
    (await import('./engine')).driveRun(actor, chatRunId, undefined, { sessionUserId: null }),
  stop: async (actor, chatRunId) => (await import('./engine')).stopChatRun(actor, chatRunId),
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** A Chat run's status, or null when it is gone. */
async function chatStatus(chatRunId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_runs')
    .select('status')
    .eq('id', chatRunId)
    .maybeSingle();
  if (error) throw new Error(`Could not read a run: ${error.message}`);
  return (data as { status: string } | null)?.status ?? null;
}

/** The answer a Chat run wrote, so far. */
async function answerOf(chatRunId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('chat_runs')
    .select('message_id')
    .eq('id', chatRunId)
    .maybeSingle();
  if (error) throw new Error(`Could not read a run: ${error.message}`);
  const messageId = (data as { message_id: string | null } | null)?.message_id;
  if (!messageId) return '';
  const { data: message, error: messageError } = await supabaseAdmin
    .from('chat_messages')
    .select('content_md')
    .eq('id', messageId)
    .maybeSingle();
  if (messageError) throw new Error(`Could not read an answer: ${messageError.message}`);
  return ((message as { content_md: string | null } | null)?.content_md ?? '').slice(
    0,
    SUMMARY_MAX,
  );
}

/**
 * Drives the called run, and waits for it: until it ends or waits on a
 * card, at most CALL_WAIT_MS. The caller's Stop stops it; meanwhile the
 * caller's run is kept alive, so the sweep doesn't take it for lost.
 */
async function driveAndWait(
  callerChatRunId: string,
  actor: ChatActor,
  calleeChatRunId: string,
  deps: CallDeps,
): Promise<'ended' | 'stopped' | 'timeout'> {
  let settled = false;
  const driving = deps.drive(actor, calleeChatRunId).finally(() => {
    settled = true;
  });
  const started = deps.now().getTime();
  while (!settled) {
    await Promise.race([driving.catch(() => {}), deps.sleep(POLL_MS)]);
    if (settled) break;
    if ((await chatStatus(callerChatRunId)) === 'stopped') {
      await deps.stop(actor, calleeChatRunId);
      await driving.catch(() => {});
      return 'stopped';
    }
    if (deps.now().getTime() - started >= CALL_WAIT_MS) {
      await deps.stop(actor, calleeChatRunId);
      await driving.catch(() => {});
      return 'timeout';
    }
    await supabaseAdmin
      .from('chat_run_state')
      .update({ heartbeat_at: deps.now().toISOString() })
      .eq('run_id', callerChatRunId);
  }
  await driving.catch((err) => console.error('[chat/agents] a called run failed:', err));
  return 'ended';
}

/**
 * run_agent (above): checks the call, starts the called agent's run as its
 * own, drives it and answers what it did. `callerChatRunId` is the run
 * whose card was approved (ChatToolContext.chat.runId).
 */
export async function runCalledAgent(
  ctx: { userId: string; organizationId: string | null; callerChatRunId: string | null },
  input: { agent: string; ask: string },
  deps: CallDeps = defaultDeps,
): Promise<CallResult> {
  const org = ctx.organizationId;
  if (!org || !ctx.callerChatRunId) return refuse('invalid', t('tool.notAgentRun'));
  const caller = await callerRunOf(ctx.callerChatRunId);
  if (!caller || caller.organization_id !== org || !caller.agent_id) {
    return refuse('invalid', t('tool.notAgentRun'));
  }
  // Only the person the caller acts as runs its calls (the card's Approve is theirs).
  if (caller.acting_user_id && caller.acting_user_id !== ctx.userId) {
    return refuse('invalid', t('tool.notAgentRun'));
  }
  if (caller.called_by_run_id) return refuse('invalid', t('tool.noChains'));
  const callable = await callableAgentsOf(caller.id);
  const callee = callable.find((a) => a.id === input.agent);
  if (!callee) {
    return refuse(
      'not_found',
      t('tool.notCallable', {
        agents: callable.map((a) => `${a.name} (${a.id})`).join(', ') || '—',
      }),
    );
  }
  const { data: earlier, error: countError } = await supabaseAdmin
    .from('chat_agent_runs')
    .select('usage_share')
    .eq('called_by_run_id', caller.id);
  if (countError) throw new Error(`Could not count the run's calls: ${countError.message}`);
  const earlierCalls = (earlier ?? []) as { usage_share: number | null }[];
  if (earlierCalls.length >= MAX_CALLS_PER_RUN) {
    return refuse('quota_exceeded', t('tool.tooMany', { max: MAX_CALLS_PER_RUN }));
  }

  const [callerAgent, calleeAgent] = await Promise.all([
    loadAgent(org, caller.agent_id),
    loadAgent(org, callee.id),
  ]);
  if (!calleeAgent?.version || calleeAgent.row.status !== 'active') {
    return refuse('not_found', t('tool.notCallable', { agents: callee.name }));
  }
  // The person the caller acts as, read now: their brands decide what the called agent may use.
  const actingUserId = caller.acting_user_id ?? ctx.userId;
  const agentCtx = await readAgentContext({
    userId: actingUserId,
    email: null,
    organizationId: org,
  });
  if (!agentCtx) return refuse('invalid', t('tool.notAgentRun'));
  // Their role and the plan, read now: Admins and Managers, Growth and up (run_agent's row).
  if (!canWriteAgents(agentCtx.viewer.role) || canCallDenial([callee.id], agentCtx.plan)) {
    return refuse('invalid', t('tool.notAgentRun'));
  }
  // Only an agent that person sees and may run: a private one of someone else's stays theirs.
  const calleeFacts = {
    ownerId: calleeAgent.row.owner_id,
    visibility: calleeAgent.row.visibility,
    scope: calleeAgent.version.scope,
  };
  if (
    !canSeeAgent(calleeFacts, agentCtx.viewer) ||
    agentActDenial('run', agentCtx.viewer, calleeFacts, agentCtx.settings) !== null
  ) {
    return refuse('not_found', t('tool.notCallable', { agents: callee.name }));
  }
  const brands = await runnableBrands(org, calleeAgent.version.scope, agentCtx.viewer.brandAccess);
  const brand = brands.find((b) => b.id === caller.brand_id);
  if (!brand) return refuse('not_found', t('tool.noBrand', { agent: callee.name }));

  // Its cap: the smaller of its own and what is left of the caller's (CHAT-27 item 21), after
  // the caller's own use and what the agents it ran before used.
  const calledUsed = earlierCalls.reduce((sum, r) => sum + (Number(r.usage_share) || 0), 0);
  const share = calleeShare(
    calleeAgent.row.max_run_share,
    caller.max_share,
    caller.usage_share + calledUsed,
  );
  if (share < 0.01) return refuse('quota_exceeded', t('tool.noRoom'));

  const callerVersion = await supabaseAdmin
    .from('chat_agent_versions')
    .select(
      'agent_id, version, skill_ids, instructions, mode, connections, model, effort, scope, notify_user_ids, followup_days, can_call',
    )
    .eq('agent_id', caller.agent_id)
    .eq('version', caller.agent_version)
    .maybeSingle();
  if (callerVersion.error)
    throw new Error(`Could not read the agent: ${callerVersion.error.message}`);
  const callerMode = callerVersion.data
    ? versionFromRow(callerVersion.data as Parameters<typeof versionFromRow>[0]).mode
    : 'ask_first';
  const scope: CallScope = {
    agent: callerAgent?.row.name ?? '',
    mode: stricterMode(callerMode, calleeAgent.version.mode),
    ask: input.ask.trim().slice(0, 1000),
  };

  const now = deps.now();
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('chat_agent_runs')
    .insert({
      organization_id: org,
      agent_id: callee.id,
      agent_version: calleeAgent.row.version,
      brand_id: brand.id,
      trigger_kind: 'agent',
      called_by_run_id: caller.id,
      acting_user_id: actingUserId,
      // It runs in its caller's place: the caller's slot of the workspace's runs waits for it.
      status: 'running',
      max_share: share,
      queued_at: now.toISOString(),
      started_at: now.toISOString(),
      evidence_json: { call: scope } as unknown as Json,
    })
    .select('id')
    .single();
  if (insertError?.code === '23505') {
    return refuse('conflict', t('tool.busy', { agent: callee.name, brand: brand.name }));
  }
  if (insertError?.code === '23514') {
    return refuse('quota_exceeded', t('tool.tooMany', { max: MAX_CALLS_PER_RUN }));
  }
  if (insertError || !inserted) {
    throw new Error(`Could not start the called agent: ${insertError?.message ?? 'no row'}`);
  }
  const calleeRunId = (inserted as { id: string }).id;

  const { openAgentRun, settleAgentRun } = await import('./agent-driver');
  const opened = await openAgentRun(calleeRunId, org, now);
  if (!opened) {
    const ended = await readAgentRunStatus(calleeRunId);
    return refuse(
      'failed',
      t('tool.didntStart', { agent: callee.name, status: ended ?? 'failed' }),
    );
  }
  const waited = await driveAndWait(ctx.callerChatRunId, opened.actor, opened.chatRunId, deps);
  await settleAgentRun(calleeRunId, { now: deps.now() });

  const [status, used, answer, chat] = await Promise.all([
    readAgentRunStatus(calleeRunId),
    readAgentRunRow(calleeRunId),
    answerOf(opened.chatRunId),
    supabaseAdmin
      .from('chat_conversations')
      .select('id')
      .eq('agent_run_id', calleeRunId)
      .maybeSingle(),
  ]);
  const chatId = (chat.data as { id: string } | null)?.id ?? null;
  const guarded = guardData(answer);
  return {
    ok: true,
    agent: callee.name,
    status: waited === 'timeout' ? 'timed_out' : (status ?? 'failed'),
    used_share: used?.usage_share ?? 0,
    // Another agent's words: data, never instructions (CHAT-20 §16a).
    answer: dataBlock(`agent:${callee.name}`, guarded.value, true),
    chat_href: chatId ? `/dashboard/chat/${chatId}` : null,
  };
}

async function readAgentRunStatus(agentRunId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_agent_runs')
    .select('status')
    .eq('id', agentRunId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the agent run: ${error.message}`);
  return (data as { status: string } | null)?.status ?? null;
}

/** An agent of the workspace's name, for run_agent's card; null when it is gone or not theirs. */
export async function agentNameOf(agentId: string, organizationId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_agents')
    .select('name')
    .eq('id', agentId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the agent: ${error.message}`);
  return (data as { name: string } | null)?.name ?? null;
}

/** The most a call of this agent may use (its own Max per run), for the card; null when gone. */
export async function callShareOf(agentId: string, organizationId: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_agents')
    .select('max_run_share')
    .eq('id', agentId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the agent: ${error.message}`);
  const share = (data as { max_run_share: number } | null)?.max_run_share;
  return share === undefined ? null : Number(share);
}
