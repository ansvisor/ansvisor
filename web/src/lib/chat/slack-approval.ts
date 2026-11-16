import { supabaseAdmin } from '@/lib/supabase/admin';
import { settleAgentRun } from './agent-driver';
import { decideForEngine, driveRun, prepareResume, type ResumeAction } from './engine';
import { loadRun, type LoadedRun } from './engine-store';
import { chatAgenticEnabled } from './flag';
import { readBrandIsDemo, readPrecedenceContext, readToolCall } from './precedence-context';
import { runsWithoutSession } from './registry/define-tool';
import { chatTool } from './registry/tools';

/**
 * Approve and Reject on Slack's "an agent needs you" message (#2139, N7),
 * for the API server, which takes Slack's click (its signature, its post,
 * the Slack workspace, the person found by e-mail) and calls these through
 * /api/internal/chat/slack/{card,decide}. Nothing new decides here: the
 * card is the one the agent run waits on, read limited to the post's
 * workspace, brand and agent run (a mismatch is not found); a decision is
 * the app's own (prepareResume, then driveRun), as the run's person, who
 * alone may decide its card, as in the app. Its change runs with no session
 * of theirs behind it, as an agent run on its own does: only a card whose
 * change runs that way (runsWithoutSession) is decided from Slack; another
 * opens in Ansvisor. Reject is the card's Skip. Server only.
 */

/** The agent run a Slack message is about: ids the server read from its own post. */
export interface SlackRunRef {
  organizationId: string;
  brandId: string;
  agentRunId: string;
}

export interface SlackCard {
  /** waiting: the run waits on this card now; decided: it no longer does. */
  state: 'waiting' | 'decided';
  /** A change's card, an EXECUTE's click or a question; null once decided. */
  kind: 'ask' | 'click' | 'question' | null;
  n: number | null;
  digest: string | null;
  /** What the card says, as its step does: the change ("Save drafts in Content") and its target. */
  title: string | null;
  target: string | null;
  /** Approve and Reject work from Slack. */
  fromSlack: boolean;
  agent: string | null;
  /** The person it waits for, by name. */
  person: string | null;
  conversationId: string;
  /** How a card that no longer waits ended. inSlack: approved from Slack. */
  decided: {
    how: 'approved' | 'rejected' | 'expired' | 'closed';
    at: string | null;
    inSlack: boolean;
  } | null;
}

export type SlackRefusal =
  | 'not_found'
  | 'chat_off'
  | 'not_yours'
  | 'not_member'
  | 'needs_app'
  | 'changed'
  | 'forbidden'
  | 'read_only'
  | 'demo';

export type SlackDecision =
  | { outcome: 'approved' | 'rejected' | 'decided'; card: SlackCard }
  | { outcome: 'refused'; reason: SlackRefusal; card: SlackCard | null };

interface FoundRun {
  run: LoadedRun;
  conversationId: string;
  agentId: string | null;
}

function must<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`Could not read ${what}: ${result.error.message}`);
  return result.data;
}

/** The agent run's Chat run, found only within the post's workspace and brand. */
async function findRun(ref: SlackRunRef): Promise<FoundRun | null> {
  const [agentRun, convo] = await Promise.all([
    supabaseAdmin
      .from('chat_agent_runs')
      .select('agent_id')
      .eq('id', ref.agentRunId)
      .eq('organization_id', ref.organizationId)
      .eq('brand_id', ref.brandId)
      .maybeSingle(),
    supabaseAdmin
      .from('chat_conversations')
      .select('id')
      .eq('agent_run_id', ref.agentRunId)
      .eq('organization_id', ref.organizationId)
      .eq('brand_id', ref.brandId)
      .maybeSingle(),
  ]);
  const owner = must(agentRun, 'the agent run');
  const chat = must(convo, "the agent run's chat");
  if (!owner || !chat) return null;
  const runs = must(
    await supabaseAdmin
      .from('chat_runs')
      .select('id')
      .eq('conversation_id', chat.id)
      // Its parts (CHAT-27) answer to it: never the agent run's chat run.
      .is('parent_run_id', null)
      .order('created_at', { ascending: false })
      .limit(1),
    "the agent run's chat",
  );
  const runId = (runs ?? [])[0]?.id;
  const run = runId ? await loadRun(runId) : null;
  if (!run || run.organizationId !== ref.organizationId) return null;
  return { run, conversationId: chat.id, agentId: owner.agent_id ?? null };
}

async function readStep(runId: string, by: { id: string } | { position: number }) {
  const query = supabaseAdmin
    .from('chat_run_steps')
    .select('id, status, label, detail, finished_at')
    .eq('run_id', runId);
  const keyed = 'id' in by ? query.eq('id', by.id) : query.eq('position', by.position);
  return must(await keyed.maybeSingle(), "a run's step");
}

/** How the card the message showed ended. Only the run's person approves or skips it. */
async function endOf(
  found: FoundRun,
  step: Awaited<ReturnType<typeof readStep>>,
): Promise<NonNullable<SlackCard['decided']>> {
  const at = step?.finished_at ?? null;
  if (step && (step.status === 'done' || step.status === 'error')) {
    const row = must(
      await supabaseAdmin
        .from('chat_activity_log')
        .select('summary_params')
        .eq('organization_id', found.run.organizationId)
        .eq('step_id', step.id)
        .limit(1),
      "a step's Activity row",
    );
    const params = (row ?? [])[0]?.summary_params as Record<string, unknown> | undefined;
    return { how: 'approved', at, inSlack: params?.via === 'slack' };
  }
  if (step?.status === 'skipped') return { how: 'rejected', at, inSlack: false };
  const expired = found.run.status === 'stopped' && found.run.progress.stoppedFor === 'expired';
  return { how: expired ? 'expired' : 'closed', at, inSlack: false };
}

async function cardOf(found: FoundRun, n?: number): Promise<SlackCard> {
  const { run } = found;
  const [agent, person] = await Promise.all([
    found.agentId
      ? supabaseAdmin.from('chat_agents').select('name').eq('id', found.agentId).maybeSingle()
      : null,
    supabaseAdmin.from('profiles').select('full_name').eq('id', run.userId).maybeSingle(),
  ]);
  const base = {
    agent: (agent && must(agent, 'the agent')?.name) || null,
    person: must(person, 'a person')?.full_name?.trim() || null,
    conversationId: found.conversationId,
  };
  const pending = run.status === 'waiting' ? run.pending : null;
  if (pending && (n === undefined || pending.n === n)) {
    const step = await readStep(run.id, { id: pending.stepId });
    const tool = chatTool(pending.calls[pending.index]?.toolName ?? '');
    return {
      ...base,
      state: 'waiting',
      kind: pending.kind,
      n: pending.n,
      digest: pending.digest,
      title: step?.label ?? null,
      target: step?.detail ?? null,
      fromSlack: pending.kind === 'ask' && tool?.class === 'write' && runsWithoutSession(tool),
      decided: null,
    };
  }
  const step = n === undefined ? null : await readStep(run.id, { position: n });
  return {
    ...base,
    state: 'decided',
    kind: null,
    n: n ?? null,
    digest: null,
    title: step?.label ?? null,
    target: step?.detail ?? null,
    fromSlack: false,
    decided: await endOf(found, step),
  };
}

/**
 * The card the agent run waits on (or, with `n`, the card the message
 * showed, and how it ended), for the Slack message; null when the run isn't
 * the post's workspace's and brand's.
 */
export async function readSlackCard(ref: SlackRunRef, n?: number): Promise<SlackCard | null> {
  const found = await findRun(ref);
  return found ? cardOf(found, n) : null;
}

/**
 * Approve or Reject from Slack, as the app's Approve and Skip, by the run's
 * person. Refused, nothing changes: Chat off, not their run, no longer a
 * member, a card that changed or doesn't work from Slack, the demo brand,
 * a read-only workspace, or a change their role or brand access no longer
 * allows (decided again as the engine does on Approve). A card no longer
 * waiting answers how it ended. Once taken, the run goes on in the
 * background, with no session behind it.
 */
export async function decideFromSlack(
  ref: SlackRunRef,
  input: { userId: string; decision: 'approve' | 'reject'; n: number; digest: string },
  background: (task: () => Promise<void>) => void,
): Promise<SlackDecision> {
  const refused = (reason: SlackRefusal, card: SlackCard | null = null): SlackDecision => ({
    outcome: 'refused',
    reason,
    card,
  });
  if (!chatAgenticEnabled(ref.organizationId)) return refused('chat_off');
  const found = await findRun(ref);
  if (!found) return refused('not_found');
  const { run } = found;
  // Only the run's own person decides its card, as in the app (prepareResume).
  if (run.userId !== input.userId) return refused('not_yours');
  const card = await cardOf(found, input.n);
  if (card.state === 'decided') return { outcome: 'decided', card };
  if (card.digest !== input.digest || !run.pending) return refused('changed', card);
  if (!card.fromSlack) return refused('needs_app', card);
  if (await readBrandIsDemo(ref.brandId)) return refused('demo', card);

  const ctx = await readPrecedenceContext({
    userId: input.userId,
    organizationId: ref.organizationId,
    mode: run.progress.injection ? 'ask_first' : run.mode,
    surface: 'chat',
    injectionDetected: run.progress.injection === true,
    agent: { runId: ref.agentRunId, mode: run.mode },
  });
  if (!ctx) return refused('not_member', card);
  if (!ctx.plan.writable) return refused('read_only', card);
  if (ctx.brandAccess !== 'all' && !ctx.brandAccess.includes(ref.brandId)) {
    return refused('forbidden', card);
  }
  if (input.decision === 'approve') {
    // Decided now as the engine decides it on Approve: a refusal changes nothing here.
    const call = run.pending.calls[run.pending.index];
    const tool = chatTool(call.toolName);
    const parsed = tool?.inputSchema.safeParse(call.input ?? {});
    if (!tool || !parsed?.success) return refused('changed', card);
    const facts = await readToolCall(
      ctx,
      tool,
      parsed.data as Record<string, unknown>,
      run.progress.tainted === true,
      run.progress.writes[tool.name] ?? 0,
    );
    if (decideForEngine(tool, ctx, facts).kind === 'deny') return refused('forbidden', card);
  }

  const actor = { userId: input.userId, email: null, organizationId: ref.organizationId };
  const prepared = await prepareResume(
    actor,
    run.id,
    input.decision === 'approve' ? 'approve' : 'skip',
    input.decision === 'approve' ? { n: input.n, digest: input.digest } : { n: input.n },
  );
  if (!prepared.ok) {
    // Decided meanwhile (a second click, the app): how it ended.
    if (prepared.code === 'not_waiting') {
      const again = await findRun(ref);
      return { outcome: 'decided', card: again ? await cardOf(again, input.n) : card };
    }
    if (prepared.code === 'subscription_inactive') return refused('read_only', card);
    if (prepared.code === 'approval_mismatch') return refused('changed', card);
    return refused('not_found', card);
  }
  const resume: ResumeAction =
    prepared.resume.kind === 'approve' ? { ...prepared.resume, via: 'slack' } : prepared.resume;
  background(async () => {
    await driveRun(actor, run.id, resume, { sessionUserId: null });
    // The agent run follows its Chat run now rather than on the next tick.
    await settleAgentRun(ref.agentRunId).catch((err) =>
      console.error('[chat/slack] could not settle the agent run:', (err as Error)?.name ?? err),
    );
  });
  return { outcome: input.decision === 'approve' ? 'approved' : 'rejected', card };
}
