import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';
import { API_BASE_URL } from '@/config/api';
import { hasBrandAccess } from '@/lib/brand-access';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/types/supabase';
import type { AgentViewer } from '../agent-rules';
import { agentsSeen, readAgentContext } from '../agents';
import { readPendingApprovals, togetherOf } from '../pending-approvals';
import { percent } from './plan-card';
import { markPlanSummarized, type PlanView } from './plan-store';

/**
 * The AEO Operator's summary (AEO Operator plan §4.2 step 7, PR 5 of 6),
 * once the agents its approved plan started are done: every one has ended
 * or waits for its person, or 8 hours have passed since they were started
 * (SUMMARY_DEADLINE_MS). Made by code from the runs' own records, with no
 * model call:
 *
 *   - each agent of the plan: where its run is (done, failed, stopped,
 *     waits for you, still working, or not started and why, as a code);
 *     what it did, counted from the Activity log rows of its run (by
 *     agent_run_id, or its run's chat: a change an agent's run makes names
 *     its chat, and its run only when it went live on its own): drafts
 *     saved, Action Center findings, tasks set to Ready for review, pages
 *     sent or published; its chat and its agent, to open; and the AI it
 *     used against its share;
 *   - what the plan used in all (its own run and its agents') against the
 *     day's budget;
 *   - how many wait for the person, and Approve all in the Inbox where
 *     their changes are to the same draft (pending-approvals.ts).
 *
 * Built for the person the Operator's run acts as: an agent they can't see
 * (canSeeAgent) is "An agent you can't see", with no name, link or counts.
 * No outside text: the agents' names the person sees are the only words
 * not the app's own; never an action's title or a page's content.
 *
 * Sent once (the sweep, agent-sweep.ts): the plan moves from dispatched to
 * summarized with its summary in one compare-and-set; only the sweep that
 * made the move posts it in the Operator's run chat, as an assistant
 * message (as the tour's turns are, actions/chat-tour.ts), and asks the
 * server to write the Inbox notice (agent_plan_summary) and send it by the
 * person's "Notify me when an agent needs me": e-mail, or the brand's
 * Slack channel (server routes/internal-chat-notices.js /agent-plan). When
 * the server doesn't answer, the notice is written here, so the Inbox has
 * it all the same. A plan started 48 hours ago whose summary still can't be
 * read in full (SUMMARY_STALE_MS) is summarized anyway, from its own row.
 *
 * Every read is held to the plan's organization and brand. Server only.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatAgents.operatorSummary' });
const hiddenT = createTranslator({ locale: 'en', messages, namespace: 'chatAgents.calls.canCall' });
const unknownT = createTranslator({ locale: 'en', messages, namespace: 'chatAgents.operator' });
const childSkipT = createTranslator({
  locale: 'en',
  messages,
  namespace: 'chatAgents.children.skipped',
});
const runSkipT = createTranslator({
  locale: 'en',
  messages,
  namespace: 'chatAgents.skippedReason',
});
const stopT = createTranslator({ locale: 'en', messages, namespace: 'chatAgents.stopReason' });

/** Since its agents were started: the summary goes then, whoever is still working. */
export const SUMMARY_DEADLINE_MS = 8 * 60 * 60_000;
/** Since its agents were started: summarized anyway, from its own row if need be. */
export const SUMMARY_STALE_MS = 48 * 60 * 60_000;
/** Activity rows one summary reads at most. */
const ACTIVITY_ROWS = 2000;
/** How long the server may take to write the notice and send it. */
const NOTICE_TIMEOUT_MS = 15_000;

/** Where the Inbox lists what waits for the person, with Approve all for a draft's changes. */
export const APPROVE_ALL_HREF = '/dashboard/chat/inbox?tab=needsYou';

// ─── What a summary says ─────────────────────────────────────────────────────

/** Where one agent of the plan is. */
export type ChildState = 'done' | 'failed' | 'stopped' | 'waiting' | 'working' | 'not_started';

/** What one agent's run did, counted from its Activity log rows. */
export interface ChildCounts {
  /** Content drafts it saved or changed (each once). */
  drafts: number;
  /** Actions it sent to Action Center, and findings it added to one. */
  findings: number;
  /** Tasks it set to Ready for review (each once). */
  tasks: number;
  /** Pages it sent to a CMS or a webhook, or published. */
  shipped: number;
}

export interface SummaryChild {
  /** Its agent; null when the person can't see it (hidden) or the summary couldn't read it. */
  agent_id: string | null;
  name: string | null;
  hidden?: true;
  state: ChildState;
  /** Its run's chat, when the person can open it. */
  chat_id: string | null;
  /** Why it stopped (stop_reason) or wasn't started (the dispatch's or the run's code). */
  reason?: string;
  /** Its run's cap and what it used, as shares of the monthly AI limit; null when unmetered. */
  share: number | null;
  used: number | null;
  counts: ChildCounts;
  /** It waits on a change to a draft that Approve all covers (the Inbox's Needs you). */
  approve_all?: true;
}

/** Why it was sent: every agent ended or waits for its person, or the deadline. */
export type SummaryWhy = 'done' | 'deadline';

/** chat_agent_plans.summary_json: codes, counts, shares and the names the person sees. */
export interface PlanSummary {
  v: 1;
  why: SummaryWhy;
  /** Built from the plan's own row: what its agents did couldn't be read (SUMMARY_STALE_MS). */
  partial?: true;
  day: string;
  /** Today's budget, and what the plan used of it (its own run and its agents'); null unmetered. */
  budget: number | null;
  used: number | null;
  children: SummaryChild[];
  /** How many agents wait for the person. */
  waiting: number;
  approve_all: boolean;
}

const NO_COUNTS: ChildCounts = Object.freeze({ drafts: 0, findings: 0, tasks: 0, shipped: 0 });

/** The run statuses that are over. */
const ENDED = new Set(['done', 'failed', 'stopped', 'skipped']);

/** An agent run's status as the summary says it. */
export function stateOf(status: string): ChildState {
  switch (status) {
    case 'done':
    case 'failed':
    case 'stopped':
      return status;
    case 'skipped':
      return 'not_started';
    case 'needs_you':
      return 'waiting';
    default:
      // queued, running, paused_cap: still under way.
      return 'working';
  }
}

/** Whether a run counts as done for the summary: it ended, or it waits for its person. */
export const settledStatus = (status: string) => ENDED.has(status) || status === 'needs_you';

/**
 * Whether the plan's summary is due, and why: every agent it started has
 * ended or waits for its person (none started counts too), or its deadline
 * passed. Null while they work and the deadline is ahead.
 */
export function summaryDue(
  plan: Pick<PlanView, 'dispatchedAt' | 'createdAt'>,
  statuses: readonly string[],
  now: Date,
): SummaryWhy | null {
  if (statuses.every(settledStatus)) return 'done';
  return ageOf(plan, now) >= SUMMARY_DEADLINE_MS ? 'deadline' : null;
}

/** How long since the plan's agents were started. */
export function ageOf(plan: Pick<PlanView, 'dispatchedAt' | 'createdAt'>, now: Date): number {
  const at = Date.parse(plan.dispatchedAt ?? plan.createdAt);
  return Number.isFinite(at) ? now.getTime() - at : Infinity;
}

// ─── Building it (pure) ──────────────────────────────────────────────────────

/** One run the Operator's run started, as the summary reads it. */
export interface ChildRun {
  id: string;
  agent_id: string | null;
  status: string;
  stop_reason: string | null;
  skipped_reason: string | null;
  usage_share: number | null;
  max_share: number | null;
}

/** One Activity log row of a child's run: its run, or its chat, and what it was. */
export interface ActivityRow {
  id: string;
  agent_run_id: string | null;
  conversation_id: string | null;
  tool_key: string;
  target_id: string | null;
}

/** The Activity log's label keys each count is made of. */
const COUNTED: Record<keyof ChildCounts, ReadonlySet<string>> = {
  drafts: new Set(['saveDraft', 'reviseDraft', 'optimizePage', 'markDraftReady']),
  findings: new Set(['sendToActions', 'addToAction']),
  tasks: new Set(['taskReadyForReview']),
  shipped: new Set(['sendToCms', 'publishToCms', 'sendToWebhook']),
};
/** The counts of a target, not of a change: a draft saved, then changed, is one draft. */
const BY_TARGET: ReadonlySet<keyof ChildCounts> = new Set(['drafts', 'tasks']);

/** What each run did, by run id, from its Activity log rows (each row once). */
export function countActivity(
  rows: readonly ActivityRow[],
  runOfChat: ReadonlyMap<string, string>,
  runIds: ReadonlySet<string>,
): Map<string, ChildCounts> {
  const seen = new Set<string>();
  const marks = new Map<string, Map<keyof ChildCounts, Set<string>>>();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const runId =
      row.agent_run_id && runIds.has(row.agent_run_id)
        ? row.agent_run_id
        : row.conversation_id
          ? runOfChat.get(row.conversation_id)
          : undefined;
    if (!runId) continue;
    const kind = (Object.keys(COUNTED) as (keyof ChildCounts)[]).find((k) =>
      COUNTED[k].has(row.tool_key),
    );
    if (!kind) continue;
    const byKind = marks.get(runId) ?? new Map<keyof ChildCounts, Set<string>>();
    const marked = byKind.get(kind) ?? new Set<string>();
    marked.add(BY_TARGET.has(kind) && row.target_id ? `t:${row.target_id}` : `r:${row.id}`);
    byKind.set(kind, marked);
    marks.set(runId, byKind);
  }
  return new Map(
    [...marks].map(([runId, byKind]) => [
      runId,
      {
        drafts: byKind.get('drafts')?.size ?? 0,
        findings: byKind.get('findings')?.size ?? 0,
        tasks: byKind.get('tasks')?.size ?? 0,
        shipped: byKind.get('shipped')?.size ?? 0,
      },
    ]),
  );
}

/** What the summary is built from, read for the person it is for. */
export interface SummaryFacts {
  plan: Pick<PlanView, 'day' | 'budgetShare' | 'items'>;
  why: SummaryWhy;
  /** What the Operator's own run used (it made the plan and its card). */
  operatorUsed: number | null;
  runs: readonly ChildRun[];
  /** The agents by id, with whether the person sees each; absent: deleted, or unread. */
  agents: ReadonlyMap<string, { name: string; seen: boolean }>;
  /** Each run's chat the person can open, by run id. */
  chats: ReadonlyMap<string, string>;
  counts: ReadonlyMap<string, ChildCounts>;
  /** The runs whose waiting change Approve all covers. */
  approveAll: ReadonlySet<string>;
  /** Built from the plan's row alone: nothing about the agents or what they did was read. */
  partial?: boolean;
}

const shareOf = (value: unknown): number | null => {
  const n = Number(value);
  return value !== null && value !== undefined && Number.isFinite(n) ? n : null;
};

/** Two places, as the shares are kept. */
const round = (share: number) => Math.round(share * 10_000) / 10_000;

/**
 * The summary (above), in the plan's order: each item's run (its
 * child_run_id, else its agent's run), or why it wasn't started; a run of
 * the Operator's not on the plan after them.
 */
export function buildPlanSummary(facts: SummaryFacts): PlanSummary {
  const metered = facts.plan.budgetShare !== null;
  const byId = new Map(facts.runs.map((run) => [run.id, run]));
  const used = new Set<string>();
  const runOf = (item: PlanView['items'][number]) => {
    const run =
      (item.child_run_id ? byId.get(item.child_run_id) : undefined) ??
      facts.runs.find((r) => r.agent_id === item.agent_id && !used.has(r.id));
    if (run) used.add(run.id);
    return run;
  };

  const childOf = (agentId: string | null, run: ChildRun | undefined, skipped?: string) => {
    const agent = agentId ? facts.agents.get(agentId) : undefined;
    // Hidden: an agent the person can't see. Unnamed: deleted, or the summary is partial.
    const hidden = !facts.partial && !!agent && !agent.seen;
    const state: ChildState = run ? stateOf(run.status) : 'not_started';
    const reason =
      run?.status === 'stopped'
        ? (run.stop_reason ?? undefined)
        : run?.status === 'skipped'
          ? (run.skipped_reason ?? undefined)
          : run
            ? undefined
            : skipped;
    const child: SummaryChild = {
      agent_id: hidden || !agent ? null : agentId,
      name: hidden || !agent ? null : agent.name,
      ...(hidden ? { hidden: true as const } : {}),
      state,
      chat_id: hidden || !run ? null : (facts.chats.get(run.id) ?? null),
      ...(reason ? { reason } : {}),
      share: metered && run ? shareOf(run.max_share) : null,
      used: metered && run ? round(shareOf(run.usage_share) ?? 0) : null,
      counts: hidden || !run ? { ...NO_COUNTS } : { ...(facts.counts.get(run.id) ?? NO_COUNTS) },
      ...(!hidden && run && state === 'waiting' && facts.approveAll.has(run.id)
        ? { approve_all: true as const }
        : {}),
    };
    return child;
  };

  const children: SummaryChild[] = facts.plan.items.map((item) => {
    const run = runOf(item);
    return childOf(item.agent_id, run, item.skipped);
  });
  // A run of the Operator's not on the plan's row (never expected): listed all the same.
  for (const run of facts.runs) {
    if (!used.has(run.id)) children.push(childOf(run.agent_id, run));
  }

  const total = metered
    ? round((facts.operatorUsed ?? 0) + children.reduce((sum, child) => sum + (child.used ?? 0), 0))
    : null;
  return {
    v: 1,
    why: facts.why,
    ...(facts.partial ? { partial: true as const } : {}),
    day: facts.plan.day,
    budget: facts.plan.budgetShare,
    used: total,
    children,
    waiting: children.filter((child) => child.state === 'waiting').length,
    approve_all: children.some((child) => child.approve_all),
  };
}

// ─── Its words in Chat ───────────────────────────────────────────────────────

/** Workspace words (a name) as plain text in Markdown: nothing in them is a link or markup. */
export function plainMarkdown(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\\`*_{}[\]()#+!|<>~]/g, (ch) => `\\${ch}`)
    .slice(0, 240);
}

/** Why an agent wasn't started or stopped, in words; '' for a code with none. */
function reasonWords(child: SummaryChild): string {
  const code = child.reason;
  if (!code) return '';
  if (child.state === 'stopped') return stopT.has(code as never) ? stopT(code as never) : '';
  if (childSkipT.has(code as never)) return childSkipT(code as never);
  return runSkipT.has(code as never) ? runSkipT(code as never) : '';
}

/** What a run did, in words: "2 drafts saved · 1 Action Center finding". */
export function countsLine(counts: ChildCounts): string {
  return (Object.keys(COUNTED) as (keyof ChildCounts)[])
    .filter((kind) => counts[kind] > 0)
    .map((kind) => t(`counts.${kind}`, { count: counts[kind] }))
    .join(' · ');
}

/** One agent's line. */
function childLine(child: SummaryChild): string {
  const name = child.hidden
    ? hiddenT('hidden')
    : child.name
      ? plainMarkdown(child.name)
      : unknownT('unknownAgent');
  const parts = [t(`state.${child.state}`)];
  const why = reasonWords(child);
  if (why) parts.push(why);
  if (!child.hidden && child.state !== 'not_started') {
    const work = countsLine(child.counts);
    parts.push(work || t('counts.nothing'));
  }
  if (child.used !== null && child.share !== null) {
    parts.push(t('ai', { used: percent(child.used), share: percent(child.share) }));
  }
  if (child.chat_id) parts.push(t('openChat', { href: `/dashboard/chat/${child.chat_id}` }));
  if (child.agent_id) parts.push(t('openAgent', { href: `/dashboard/agents/${child.agent_id}` }));
  return t('item', { name, line: parts.join(' · ') });
}

/** A plan's day in words: "Nov 18". */
export const dayWords = (day: string) => {
  const at = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(at.getTime())
    ? day
    : at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/** The summary as the Operator's chat shows it: Markdown, in the app's words. */
export function summaryMarkdown(summary: PlanSummary, brand: string): string {
  const lines = [
    t('title', { day: dayWords(summary.day), brand: plainMarkdown(brand || t('yourBrand')) }),
    '',
    summary.partial ? t('partial') : t(summary.why),
    '',
    ...(summary.children.length > 0 ? summary.children.map(childLine) : [t('none')]),
  ];
  if (summary.budget !== null && summary.used !== null) {
    lines.push('', t('total', { used: percent(summary.used), budget: percent(summary.budget) }));
  }
  if (summary.waiting > 0) {
    lines.push('', t('waiting', { count: summary.waiting }));
    if (summary.approve_all) lines.push(t('approveAll', { href: APPROVE_ALL_HREF }));
  }
  lines.push('', t('footer'));
  return lines.join('\n');
}

// ─── The Inbox notice ────────────────────────────────────────────────────────

/** The dedupe key of a plan's notice (unique per person), as the server writes it. */
export const planSummaryKey = (planId: string) => `agent_plan_summary:${planId}`;

/** The notice's payload (chat_notices, ≤ 4 KB): the Operator, its chat, the day, counts. */
export function noticePayloadOf(
  summary: PlanSummary,
  facts: { operator: string; agentId: string; planId: string; chatId: string | null },
): Record<string, Json> {
  const count = (state: ChildState) => summary.children.filter((c) => c.state === state).length;
  return {
    agent: facts.operator.slice(0, 120),
    agentId: facts.agentId,
    planId: facts.planId,
    chatId: facts.chatId,
    day: summary.day,
    total: summary.children.length,
    done: count('done'),
    waiting: summary.waiting,
    failed: count('failed'),
    stopped: count('stopped'),
    working: count('working'),
    notStarted: count('not_started'),
    approveAll: summary.approve_all,
  };
}

// ─── Reading it ──────────────────────────────────────────────────────────────

/** The person a summary is for, and what the Operator is. */
export interface SummaryPerson {
  userId: string;
  /** What they see of agents; null when they aren't a member now. */
  viewer: AgentViewer | null;
  /** They may use the plan's brand now: the notice is theirs. */
  reachesBrand: boolean;
}

export interface ReadSummary {
  summary: PlanSummary;
  person: SummaryPerson | null;
  /** The Operator's name, and its run's chat (where the summary is posted). */
  operator: string;
  operatorChatId: string | null;
}

function must<T>(what: string, result: { data: unknown; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Could not read ${what}: ${result.error.message}`);
  return result.data as T;
}

/** The Operator's run, agent and chat, and the person the run acts as. */
async function readOperator(plan: PlanView) {
  const [run, agent, chat] = await Promise.all([
    supabaseAdmin
      .from('chat_agent_runs')
      .select('id, acting_user_id, usage_share')
      .eq('id', plan.runId)
      .eq('organization_id', plan.organizationId)
      .eq('brand_id', plan.brandId)
      .maybeSingle(),
    supabaseAdmin
      .from('chat_agents')
      .select('id, name, owner_id')
      .eq('id', plan.agentId)
      .eq('organization_id', plan.organizationId)
      .maybeSingle(),
    supabaseAdmin
      .from('chat_conversations')
      .select('id')
      .eq('agent_run_id', plan.runId)
      .eq('organization_id', plan.organizationId)
      .maybeSingle(),
  ]);
  const runRow = must<{ acting_user_id: string | null; usage_share: unknown } | null>(
    "the Operator's run",
    run,
  );
  const agentRow = must<{ name: string; owner_id: string | null } | null>('the Operator', agent);
  const chatRow = must<{ id: string } | null>("the Operator's chat", chat);
  return {
    personId: runRow?.acting_user_id ?? agentRow?.owner_id ?? null,
    operatorUsed: shareOf(runRow?.usage_share),
    name: agentRow?.name ?? '',
    chatId: chatRow?.id ?? null,
  };
}

/** The runs the Operator's run started, on its brand, oldest first. */
async function readChildRuns(plan: PlanView): Promise<ChildRun[]> {
  return (
    must<ChildRun[] | null>(
      "the Operator's runs",
      await supabaseAdmin
        .from('chat_agent_runs')
        .select('id, agent_id, status, stop_reason, skipped_reason, usage_share, max_share')
        .eq('organization_id', plan.organizationId)
        .eq('brand_id', plan.brandId)
        .eq('called_by_run_id', plan.runId)
        .order('queued_at', { ascending: true }),
    ) ?? []
  );
}

/** The children's chats: their run by chat (every one), and the ones the person may open. */
async function readChildChats(plan: PlanView, runIds: string[], personId: string | null) {
  const rows =
    runIds.length === 0
      ? []
      : (must<
          | {
              id: string;
              agent_run_id: string;
              user_id: string | null;
              deleted_at: string | null;
            }[]
          | null
        >(
          "the runs' chats",
          await supabaseAdmin
            .from('chat_conversations')
            .select('id, agent_run_id, user_id, deleted_at')
            .eq('organization_id', plan.organizationId)
            .in('agent_run_id', runIds),
        ) ?? []);
  const runOfChat = new Map(rows.map((row) => [row.id, row.agent_run_id]));
  // Theirs to open: the run's own chat is its person's (a deleted one isn't opened from here).
  const open = new Map(
    rows
      .filter((row) => personId !== null && row.user_id === personId && !row.deleted_at)
      .map((row) => [row.agent_run_id, row.id]),
  );
  return { runOfChat, open };
}

/**
 * The children's Activity log rows of the four counts, in the plan's
 * organization and brand, since the plan was decided: by their agent run,
 * and by their chats (a change names its run only when it went live on its
 * own). Changes undone don't count.
 */
async function readActivity(
  plan: PlanView,
  runIds: string[],
  chatIds: string[],
): Promise<ActivityRow[]> {
  if (runIds.length === 0) return [];
  const keys = [...Object.values(COUNTED).flatMap((set) => [...set])];
  const since = plan.decidedAt ?? plan.createdAt;
  const base = () =>
    supabaseAdmin
      .from('chat_activity_log')
      .select('id, agent_run_id, conversation_id, tool_key, target_id')
      .eq('organization_id', plan.organizationId)
      .eq('brand_id', plan.brandId)
      .eq('kind', 'change')
      .neq('status', 'undone')
      .in('tool_key', keys);
  const [byRun, byChat] = await Promise.all([
    base().in('agent_run_id', runIds).limit(ACTIVITY_ROWS),
    chatIds.length
      ? base().gte('created_at', since).in('conversation_id', chatIds).limit(ACTIVITY_ROWS)
      : Promise.resolve({ data: [], error: null }),
  ]);
  return [
    ...(must<ActivityRow[] | null>("the runs' changes", byRun) ?? []),
    ...(must<ActivityRow[] | null>("the runs' changes", byChat) ?? []),
  ];
}

/**
 * The waiting runs whose change Approve all covers: those the Inbox groups
 * by draft with another change it may make together (pending-approvals.ts).
 */
async function readApproveAll(
  plan: PlanView,
  personId: string,
  waitingChats: ReadonlyMap<string, string>,
): Promise<Set<string>> {
  const covered = new Set<string>();
  if (waitingChats.size === 0) return covered;
  const runOfChat = new Map([...waitingChats].map(([runId, chatId]) => [chatId, runId]));
  const groups = await readPendingApprovals(
    { userId: personId, email: null, organizationId: plan.organizationId },
    plan.brandId,
  );
  for (const group of groups) {
    if (group.items.length < 2 || !togetherOf(group.items)) continue;
    for (const item of group.items) {
      const runId = runOfChat.get(item.chatId);
      if (runId) covered.add(runId);
    }
  }
  return covered;
}

/** The person the Operator's run acts as: what they see, and whether the brand is theirs. */
async function readPerson(plan: PlanView, personId: string | null): Promise<SummaryPerson | null> {
  if (!personId) return null;
  const context = await readAgentContext({
    userId: personId,
    email: null,
    organizationId: plan.organizationId,
  });
  return {
    userId: personId,
    viewer: context?.viewer ?? null,
    reachesBrand: !!context && hasBrandAccess(context.viewer.brandAccess, plan.brandId),
  };
}

/** The plan's summary, read in full for the person the Operator's run acts as. */
export async function readPlanSummary(plan: PlanView, why: SummaryWhy): Promise<ReadSummary> {
  const operator = await readOperator(plan);
  const [person, runs] = await Promise.all([
    readPerson(plan, operator.personId),
    readChildRuns(plan),
  ]);
  const runIds = runs.map((run) => run.id);
  const chats = await readChildChats(plan, runIds, person?.userId ?? null);
  const agentIds = [
    ...new Set([
      ...plan.items.map((item) => item.agent_id),
      ...runs.flatMap((run) => (run.agent_id ? [run.agent_id] : [])),
    ]),
  ];
  const viewer = person?.viewer ?? null;
  // No one to see them as: every agent unseen.
  const agents = viewer
    ? await agentsSeen(plan.organizationId, viewer, agentIds)
    : new Map<string, { name: string; seen: boolean }>(
        agentIds.map((id) => [id, { name: '', seen: false }]),
      );
  const waitingChats = new Map(
    runs.flatMap((run) => {
      const chatId = chats.open.get(run.id);
      return run.status === 'needs_you' && chatId ? [[run.id, chatId] as const] : [];
    }),
  );
  const [activity, approveAll] = await Promise.all([
    readActivity(plan, runIds, [...chats.runOfChat.keys()]),
    person && viewer && person.reachesBrand
      ? readApproveAll(plan, person.userId, waitingChats)
      : Promise.resolve(new Set<string>()),
  ]);
  const summary = buildPlanSummary({
    plan,
    why,
    operatorUsed: operator.operatorUsed,
    runs,
    agents,
    chats: chats.open,
    counts: countActivity(activity, chats.runOfChat, new Set(runIds)),
    approveAll,
  });
  return { summary, person, operator: operator.name, operatorChatId: operator.chatId };
}

/**
 * The summary from the plan's own row, when it can't be read in full 48
 * hours on: each item's run as `statuses` found it (its child run's status),
 * unnamed, with no counts and no AI line.
 */
export function partialPlanSummary(
  plan: Pick<PlanView, 'day' | 'items'>,
  why: SummaryWhy,
  statuses: ReadonlyMap<string, string>,
): PlanSummary {
  return buildPlanSummary({
    plan: { ...plan, budgetShare: null },
    why,
    operatorUsed: null,
    runs: plan.items.flatMap((item): ChildRun[] => {
      const status = item.child_run_id ? statuses.get(item.child_run_id) : undefined;
      return item.child_run_id && status
        ? [
            {
              id: item.child_run_id,
              agent_id: item.agent_id,
              status,
              stop_reason: null,
              skipped_reason: null,
              usage_share: null,
              max_share: null,
            },
          ]
        : [];
    }),
    agents: new Map(),
    chats: new Map(),
    counts: new Map(),
    approveAll: new Set(),
    partial: true,
  });
}

// ─── Sending it, once ────────────────────────────────────────────────────────

/** Asks the server to write the notice and send it by the person's setting; whether it answered. */
export async function tellPlanSummary(organizationId: string, planId: string): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[chat/agents] CRON_SECRET must be configured to send an Operator’s summary');
    return false;
  }
  try {
    const res = await fetch(`${API_BASE_URL}/api/internal/chat/notices/agent-plan`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: organizationId, planId }),
      cache: 'no-store',
      signal: AbortSignal.timeout(NOTICE_TIMEOUT_MS),
    });
    return res.ok;
  } catch (err) {
    console.error(
      '[chat/agents] the Operator’s summary notice got no answer:',
      (err as Error)?.name ?? err,
    );
    return false;
  }
}

/** The notice, written here when the server didn't answer: the Inbox has it all the same. */
async function keepNotice(plan: PlanView, read: ReadSummary): Promise<void> {
  if (!read.person?.reachesBrand) return;
  const { error } = await supabaseAdmin.from('chat_notices').upsert(
    {
      organization_id: plan.organizationId,
      user_id: read.person.userId,
      kind: 'agent_plan_summary',
      brand_id: plan.brandId,
      dedupe_key: planSummaryKey(plan.id),
      payload: noticePayloadOf(read.summary, {
        operator: read.operator,
        agentId: plan.agentId,
        planId: plan.id,
        chatId: read.operatorChatId,
      }),
    },
    { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
  );
  if (error) console.error('[chat/agents] could not keep the Operator’s notice:', error.message);
}

/** The summary in the Operator's run chat, as an assistant message (no run, no model). */
async function postSummary(chatId: string, text: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('chat_messages')
    .insert({ conversation_id: chatId, role: 'assistant', content_md: text });
  if (error) throw new Error(`Could not post the Operator’s summary: ${error.message}`);
}

/** The plan's brand's name, for the summary's words; '' when it can't be read. */
async function brandName(plan: PlanView): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('name')
    .eq('id', plan.brandId)
    .eq('organization_id', plan.organizationId)
    .maybeSingle();
  if (error) return '';
  return (data as { name?: string } | null)?.name ?? '';
}

/**
 * Sends the plan's summary, once: marks it summarized with what it says
 * (the compare-and-set), then posts it in the Operator's chat and has the
 * notice written and sent. False when another sweep had sent it. A post or
 * a notice that fails is logged: the summary is kept on the plan's row.
 */
export async function sendPlanSummary(
  plan: PlanView,
  read: ReadSummary,
  now: Date,
  tell: typeof tellPlanSummary = tellPlanSummary,
): Promise<boolean> {
  const won = await markPlanSummarized(
    plan.organizationId,
    plan.id,
    read.summary as unknown as Json,
    now,
  );
  if (!won) return false;
  if (read.operatorChatId) {
    try {
      await postSummary(read.operatorChatId, summaryMarkdown(read.summary, await brandName(plan)));
    } catch (err) {
      console.error('[chat/agents] could not post an Operator’s summary:', err);
    }
  }
  if (!(await tell(plan.organizationId, plan.id))) await keepNotice(plan, read);
  return true;
}
