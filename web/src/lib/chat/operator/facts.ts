import { API_BASE_URL } from '@/config/api';
import { pickFocus, skippedActions, isReminderKind } from '@/lib/action-center/focus';
import { storedPriorityLevel } from '@/lib/action-center/priority';
import { ACTION_CATEGORIES, type ActionCategory } from '@/lib/action-center/registry';
import { getKpiSnapshots } from '@/lib/actions/kpis';
import { hasBrandAccess } from '@/lib/brand-access';
import { getAiUsageFor } from '@/lib/mcp/account';
import { asService } from '@/lib/mcp/chat-facts';
import { signalGroupKey } from '@/lib/signals/group';
import type { Signal } from '@/lib/signals/map';
import { OPEN_SIGNAL_STATUSES, SIGNAL_CATEGORIES } from '@/lib/signals/registry';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readFocus, readHidden } from '@/lib/user-brand-state';
import { connectionGaps, neededConnections, readBrandConnections } from '../agent-connections';
import {
  agentActDenial,
  agentConnectionsSchema,
  agentScopeSchema,
  canSeeAgent,
  type AgentConnection,
  type AgentFacts,
  type AgentScope,
} from '../agent-rules';
import { nextScheduleFire, parseRecurringRule, scheduleConfigSchema } from '../agent-schedule';
import { readAgentShares } from '../agent-shares';
import { connectionKindOf } from '../agent-skills';
import { readAgentContext, type AgentContext } from '../agents';
import { OPERATOR_SKILL } from './defaults';
import {
  COST_RUNS,
  type CandidateFacts,
  type FactsRead,
  type LevelCounts,
  type OperatorFacts,
} from './plan';

/**
 * What the AEO Operator's plan is made from (AEO Operator plan §2, §4.2
 * step 2): one brand's numbers and the agents it could start there, read
 * for the Operator's owner, for plan.ts to weigh.
 *
 *   - Today's focus: the owner's pins (user_brand_state.focus) and the
 *     server's Today ranking (GET /api/internal/action-center/today), put
 *     together as Action Center › Today does (focus.ts pickFocus);
 *   - open actions (new, in progress; unassigned or the owner's) by category
 *     and priority level;
 *   - signals found in the last 24 hours and still open, by category, the
 *     copies of one finding once (signal_group_key's rule; signals_summary
 *     counts the signals open in a window by category, not the new ones);
 *   - the brand's KPIs and their status (getKpiSnapshots, as Chat's
 *     get_action_center_kpis reads them);
 *   - the workspace's agents the owner owns, and its workspace agents (never
 *     someone else's private one, nor a demo brand's sample, nor an
 *     Operator), with their current version, triggers, runs on the brand,
 *     month cap and Required connections, and whether the owner may run
 *     them there;
 *   - the month's AI use and when the period ends (getAiUsageFor).
 *
 * Every read is the organization's and the brand's: the brand is checked to
 * be the organization's first, each brand's table is read through its
 * brand's organization too (brands!inner), and the agents' through theirs.
 * The service role reads, as Chat's agents and their headless runs do: no
 * person is signed in. prompt_results is never read. A read that fails is
 * logged and gives neutral facts (nothing counted, nothing filtered on it)
 * with its name in `failed`; the plan is never thrown away for it. Text
 * from outside (titles, names, payloads) is never kept: the facts are ids,
 * categories, statuses, counts and times. Server only.
 */

export interface OperatorFactsInput {
  orgId: string;
  brandId: string;
  /** The Operator's owner: whom its plan is for and its runs act as. */
  ownerId: string;
  now: Date;
}

/** Actions, signals, agents and runs read at most. */
const OPEN_ACTIONS_MAX = 1000;
const NEW_SIGNALS_MAX = 500;
const AGENTS_MAX = 500;
const RUNS_MAX = 2000;
/** How long the Today ranking may take. */
const TODAY_TIMEOUT_MS = 5_000;
/** The window "new" signals are found in. */
const SIGNALS_WINDOW_MS = 24 * 3_600_000;
const OUTCOMES_WINDOW_MS = 30 * 86_400_000;

/** The statuses an open action is worked in (not on hold), as Today's ranking takes them. */
const WORKED_STATUSES = ['new', 'in_progress'];
/** A run that holds its agent's place on a brand, or waits for one. */
const OPEN_RUN_STATUSES = ['queued', 'running', 'needs_you', 'paused_cap'];
/** A run that ran and ended: what it used is its cost. */
const FINISHED_RUN_STATUSES = ['done', 'failed', 'stopped'];

const NO_AI: OperatorFacts['ai'] = { unlimited: false, monthUsed: null, periodEnd: null };

/** The facts when nothing could be read: nothing counted, no candidates. */
const neutralFacts = (failed: readonly FactsRead[]): OperatorFacts => ({
  focus: [],
  openActions: {},
  newSignals: {},
  kpis: [],
  ai: NO_AI,
  candidates: [],
  failed,
});

const isCategory = (value: unknown): value is ActionCategory =>
  ACTION_CATEGORIES.some((category) => category === value);

// ─── The reads ───────────────────────────────────────────────────────────────

/** Whether the brand is the organization's, and not a demo brand. */
async function brandInOrg(orgId: string, brandId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('id, is_demo')
    .eq('id', brandId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data && data.is_demo !== true;
}

interface OpenAction {
  id: string;
  kind: string;
  category: ActionCategory;
  status: string;
  level: keyof LevelCounts;
  assigneeId: string | null;
}

/** The brand's actions being worked (new, in progress), highest priority first. */
async function readOpenActions(orgId: string, brandId: string): Promise<OpenAction[]> {
  const { data, error } = await supabaseAdmin
    .from('actions')
    .select(
      'id, kind, category, status, priority_level, priority_score, assignee_id, brands!inner(organization_id)',
    )
    .eq('brand_id', brandId)
    .eq('brands.organization_id', orgId)
    .in('status', WORKED_STATUSES)
    .is('deleted_at', null)
    .order('priority_score', { ascending: false, nullsFirst: false })
    .limit(OPEN_ACTIONS_MAX);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((row) =>
    isCategory(row.category)
      ? [
          {
            id: row.id,
            kind: row.kind,
            category: row.category,
            status: row.status,
            level: storedPriorityLevel(row.priority_level, row.priority_score) ?? 'unscored',
            assigneeId: row.assignee_id,
          },
        ]
      : [],
  );
}

/** The open actions an agent of the owner's works: unassigned or theirs, no reminders. */
const ownersWork = (actions: readonly OpenAction[], ownerId: string) =>
  actions.filter(
    (action) =>
      (action.assigneeId === null || action.assigneeId === ownerId) && !isReminderKind(action.kind),
  );

function countByLevel(actions: readonly OpenAction[]): OperatorFacts['openActions'] {
  const out: Partial<Record<ActionCategory, LevelCounts>> = {};
  for (const action of actions) {
    const levels = (out[action.category] ??= {});
    levels[action.level] = (levels[action.level] ?? 0) + 1;
  }
  return out;
}

/** The server's Today ranking for the owner (ids and categories only), best first. */
async function readTodayRanking(
  orgId: string,
  brandId: string,
  ownerId: string,
): Promise<{ id: string; category: string }[]> {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET must be configured for the Today ranking');
  const query = new URLSearchParams({ org_id: orgId, brand_id: brandId, user_id: ownerId });
  const res = await fetch(`${API_BASE_URL}/api/internal/action-center/today?${query}`, {
    headers: { Authorization: `Bearer ${secret}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(TODAY_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`The Today ranking answered ${res.status}`);
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const ranked: { id: string; category: string }[] = [];
  for (const list of [body?.today, body?.next]) {
    for (const entry of Array.isArray(list) ? list : []) {
      const { id, category } = (entry ?? {}) as { id?: unknown; category?: unknown };
      if (typeof id !== 'string' || ranked.some((r) => r.id === id)) continue;
      ranked.push({ id, category: typeof category === 'string' ? category : '' });
    }
  }
  return ranked;
}

/** The owner's focus pins and the actions they skipped, on the brand. */
async function readOwnerState(
  orgId: string,
  brandId: string,
  ownerId: string,
  now: Date,
): Promise<{ pins: ReturnType<typeof readFocus>; skipped: ReadonlySet<string> }> {
  const { data, error } = await supabaseAdmin
    .from('user_brand_state')
    .select('focus, hidden, brands!inner(organization_id)')
    .eq('user_id', ownerId)
    .eq('brand_id', brandId)
    .eq('brands.organization_id', orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    pins: readFocus(data?.focus),
    skipped: skippedActions(readHidden(data?.hidden, now)),
  };
}

/** New signals by category: found in the window, still open, a finding's copies once. */
async function readNewSignals(
  orgId: string,
  brandId: string,
  now: Date,
): Promise<OperatorFacts['newSignals']> {
  const { data, error } = await supabaseAdmin
    .from('signals')
    .select(
      'id, kind, category, detected_at, prompt_id:payload->promptId, prompt_text:payload->promptText, brands!inner(organization_id)',
    )
    .eq('brand_id', brandId)
    .eq('brands.organization_id', orgId)
    .in('status', [...OPEN_SIGNAL_STATUSES])
    .gte('detected_at', new Date(now.getTime() - SIGNALS_WINDOW_MS).toISOString())
    .order('detected_at', { ascending: false })
    .limit(NEW_SIGNALS_MAX);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as {
    id: string;
    kind: string;
    category: string;
    detected_at: string;
    prompt_id: unknown;
    prompt_text: unknown;
  }[];
  const groups = new Map<string, string>();
  for (const row of rows) {
    if (!SIGNAL_CATEGORIES.some((category) => category === row.category)) continue;
    const key = signalGroupKey({
      id: row.id,
      kind: row.kind as Signal['kind'],
      detectedAt: row.detected_at,
      payload: { promptId: row.prompt_id, promptText: row.prompt_text },
    });
    if (!groups.has(key)) groups.set(key, row.category);
  }
  const out: Record<string, number> = {};
  for (const category of groups.values()) out[category] = (out[category] ?? 0) + 1;
  return out as OperatorFacts['newSignals'];
}

/** The brand's KPIs and their status, read as Chat's get_action_center_kpis does. */
async function readKpis(brandId: string): Promise<OperatorFacts['kpis']> {
  const snapshots = await asService(() => getKpiSnapshots(brandId));
  return snapshots.kpis.map((kpi) => ({ key: kpi.key, status: kpi.status }));
}

/** The month's AI use: a share used and when the period ends; self-hosted is unlimited. */
async function readAiUsage(orgId: string, ownerId: string): Promise<OperatorFacts['ai']> {
  const usage = await getAiUsageFor({
    userId: ownerId,
    email: null,
    organizationId: orgId,
    role: null,
    apiKeyId: 'chat-operator',
  });
  if (!usage) throw new Error('No AI usage for the organization');
  if (usage.unlimited) return { unlimited: true, monthUsed: null, periodEnd: null };
  return {
    unlimited: false,
    monthUsed: usage.percent_used === null ? null : usage.percent_used / 100,
    periodEnd: usage.period_end,
  };
}

interface AgentRead {
  id: string;
  status: string;
  ownerId: string | null;
  visibility: string;
  maxRunShare: number;
  maxMonthShare: number | null;
  failCount: number;
  skills: string[];
  connections: AgentConnection[];
  scope: AgentScope;
}

/**
 * The agents the Operator could start: the organization's, active or
 * paused, not a demo brand's sample, the owner's own or visible to the
 * workspace, with their current version; never an Operator.
 */
async function readAgents(orgId: string, ownerId: string): Promise<AgentRead[]> {
  const { data, error } = await supabaseAdmin
    .from('chat_agents')
    .select(
      'id, status, owner_id, visibility, version, max_run_share, max_month_share, fail_count, demo_brand_id',
    )
    .eq('organization_id', orgId)
    .in('status', ['active', 'paused'])
    .is('demo_brand_id', null)
    // An Operator never runs another, by its kind as well as by its skill below.
    .neq('kind', 'operator')
    .order('updated_at', { ascending: false })
    .limit(AGENTS_MAX);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).filter(
    (row) => row.visibility === 'workspace' || row.owner_id === ownerId,
  );
  if (rows.length === 0) return [];
  const versions = await supabaseAdmin
    .from('chat_agent_versions')
    .select('agent_id, version, skill_ids, connections, scope, chat_agents!inner(organization_id)')
    .in(
      'agent_id',
      rows.map((row) => row.id),
    )
    .in('version', [...new Set(rows.map((row) => row.version))])
    .eq('chat_agents.organization_id', orgId);
  if (versions.error) throw new Error(versions.error.message);
  const current = new Map(rows.map((row) => [row.id, row.version]));
  const versionOf = new Map(
    (versions.data ?? [])
      .filter((v) => current.get(v.agent_id) === v.version)
      .map((v) => [v.agent_id, v]),
  );
  return rows.flatMap((row): AgentRead[] => {
    const version = versionOf.get(row.id);
    // No version: a create that didn't finish, which can't run. An Operator never runs another.
    if (!version || version.skill_ids.includes(OPERATOR_SKILL)) return [];
    const scope = agentScopeSchema.safeParse(version.scope);
    const connections = agentConnectionsSchema.safeParse(version.connections);
    return [
      {
        id: row.id,
        status: row.status,
        ownerId: row.owner_id,
        visibility: row.visibility,
        maxRunShare: Number(row.max_run_share),
        maxMonthShare: row.max_month_share === null ? null : Number(row.max_month_share),
        failCount: Number(row.fail_count) || 0,
        skills: version.skill_ids,
        connections: connections.success ? connections.data : [],
        // A scope that doesn't read names no brand, as versionFromRow has it.
        scope: scope.success ? scope.data : { brand_ids: [] },
      },
    ];
  });
}

interface TriggerFacts {
  signalCategories: string[];
  kpis: string[];
  nextFireAt: string | null;
  cadenceDays: number | null;
}

const NO_TRIGGERS: TriggerFacts = {
  signalCategories: [],
  kpis: [],
  nextFireAt: null,
  cadenceDays: null,
};

/** The days between a recurring schedule's fires: daily 1, on n weekdays 7 ÷ n, monthly 30. */
function cadenceOf(config: unknown): number | null {
  const parsed = scheduleConfigSchema.safeParse(config);
  if (!parsed.success || parsed.data.type !== 'recurring') return null;
  const rule = parseRecurringRule(parsed.data.rrule);
  if (!rule) return null;
  if (rule.freq === 'MONTHLY') return 30;
  return rule.byDay ? 7 / rule.byDay.length : 1;
}

/** Each agent's triggers as the plan weighs them: what they fire on, and its own schedule. */
async function readTriggers(
  orgId: string,
  agentIds: readonly string[],
  now: Date,
): Promise<Map<string, TriggerFacts>> {
  const out = new Map<string, TriggerFacts>();
  if (agentIds.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from('chat_agent_triggers')
    .select('agent_id, kind, config_json, enabled, chat_agents!inner(organization_id)')
    .in('agent_id', [...agentIds])
    .eq('chat_agents.organization_id', orgId);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const facts = out.get(row.agent_id) ?? { ...NO_TRIGGERS, signalCategories: [], kpis: [] };
    const config = (row.config_json ?? {}) as Record<string, unknown>;
    // What it serves, from every trigger it has: a switched-off one still says what it is for.
    if (row.kind === 'signal' && typeof config.category === 'string') {
      facts.signalCategories.push(config.category);
    }
    if (row.kind === 'kpi' && typeof config.kpi === 'string') facts.kpis.push(config.kpi);
    if (row.kind === 'schedule' && row.enabled) {
      const next = nextScheduleFire(row.config_json, now);
      if (next && (!facts.nextFireAt || Date.parse(next) < Date.parse(facts.nextFireAt))) {
        facts.nextFireAt = next;
      }
      const cadence = cadenceOf(row.config_json);
      if (cadence !== null && (facts.cadenceDays === null || cadence < facts.cadenceDays)) {
        facts.cadenceDays = cadence;
      }
    }
    out.set(row.agent_id, facts);
  }
  return out;
}

interface RunFacts {
  runOpen: boolean;
  history: {
    lastRanAt: string | null;
    improved30: number;
    declined30: number;
    recentUsage: number[];
  };
}

/** Each agent's runs on the brand: one open, its last start, its 30-day outcomes, its recent costs. */
async function readRuns(
  orgId: string,
  brandId: string,
  agentIds: readonly string[],
  now: Date,
): Promise<Map<string, RunFacts>> {
  const out = new Map<string, RunFacts>(
    agentIds.map((id) => [
      id,
      {
        runOpen: false,
        history: { lastRanAt: null, improved30: 0, declined30: 0, recentUsage: [] },
      },
    ]),
  );
  if (agentIds.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from('chat_agent_runs')
    .select('agent_id, status, outcome, usage_share, queued_at, started_at, finished_at')
    .eq('organization_id', orgId)
    .eq('brand_id', brandId)
    .in('agent_id', [...agentIds])
    .order('queued_at', { ascending: false })
    .limit(RUNS_MAX);
  if (error) throw new Error(error.message);
  const since = now.getTime() - OUTCOMES_WINDOW_MS;
  for (const run of data ?? []) {
    const facts = run.agent_id ? out.get(run.agent_id) : undefined;
    if (!facts) continue;
    const { history } = facts;
    if (OPEN_RUN_STATUSES.includes(run.status)) facts.runOpen = true;
    if (
      run.started_at &&
      (!history.lastRanAt || Date.parse(run.started_at) > Date.parse(history.lastRanAt))
    ) {
      history.lastRanAt = run.started_at;
    }
    if (Date.parse(run.queued_at) >= since) {
      if (run.outcome === 'improved') history.improved30 += 1;
      if (run.outcome === 'declined') history.declined30 += 1;
    }
    if (
      FINISHED_RUN_STATUSES.includes(run.status) &&
      run.finished_at &&
      history.recentUsage.length < COST_RUNS
    ) {
      history.recentUsage.push(Number(run.usage_share) || 0);
    }
  }
  return out;
}

// ─── Together ────────────────────────────────────────────────────────────────

/**
 * Today's focus categories: the owner's pins that still fit, then the
 * ranking's best, as Today shows them (pickFocus). Without the actions
 * read, the ranking's first, by the categories it gives.
 */
function focusCategories(
  pins: ReturnType<typeof readFocus>,
  skipped: ReadonlySet<string>,
  ranking: readonly { id: string; category: string }[],
  actions: readonly OpenAction[] | null,
  ownerId: string,
  now: Date,
): ActionCategory[] {
  if (!actions) {
    return ranking
      .filter((entry) => !skipped.has(entry.id))
      .slice(0, 3)
      .flatMap((entry) => (isCategory(entry.category) ? [entry.category] : []));
  }
  const byId = new Map(actions.map((action) => [action.id, action]));
  const { slots } = pickFocus({
    pins,
    ranking: ranking.map((entry) => entry.id),
    actions: new Map(
      actions.map((action) => [
        action.id,
        { id: action.id, kind: action.kind, status: action.status, assigneeId: action.assigneeId },
      ]),
    ),
    skipped,
    userId: ownerId,
    now,
    seenAt: null,
  });
  return slots.flatMap((slot) => {
    const category = byId.get(slot.id)?.category;
    return category ? [category] : [];
  });
}

/** Whether the owner may run the agent, and on this brand. */
function ownerMay(
  owner: AgentContext | null,
  agent: AgentRead,
  brandId: string,
): { canRun: boolean; onBrand: boolean } {
  if (!owner) return { canRun: false, onBrand: false };
  const facts: AgentFacts = {
    ownerId: agent.ownerId,
    visibility: agent.visibility === 'workspace' ? 'workspace' : 'private',
    scope: agent.scope,
  };
  const canRun =
    canSeeAgent(facts, owner.viewer) &&
    agentActDenial('run', owner.viewer, facts, owner.settings) === null;
  const inScope =
    agent.scope.all_brands === true || (agent.scope.brand_ids ?? []).includes(brandId);
  return { canRun, onBrand: inScope && hasBrandAccess(owner.viewer.brandAccess, brandId) };
}

/** Whether the agent needs a Required connection at all (a read of the brand's is needed). */
const needsConnection = (agent: AgentRead) =>
  neededConnections(agent.skills, agent.connections).some(
    (c) => c.required && connectionKindOf(c.key),
  );

/** Everything the Operator's plan for the brand is made from; never throws. */
export async function readOperatorFacts(input: OperatorFactsInput): Promise<OperatorFacts> {
  const { orgId, brandId, ownerId, now } = input;
  const failed = new Set<FactsRead>();
  const attempt = async <T>(read: FactsRead, fallback: T, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      console.error(`[chat/operator] the ${read} read failed:`, error);
      failed.add(read);
      return fallback;
    }
  };

  // The brand first: every read after it is keyed by it.
  if (!(await attempt('brand', false, () => brandInOrg(orgId, brandId)))) {
    return neutralFacts(['brand']);
  }

  const [owner, actions, ranking, state, newSignals, kpis, ai, agents] = await Promise.all([
    attempt('owner', null, () =>
      readAgentContext({ userId: ownerId, email: null, organizationId: orgId }),
    ),
    attempt('actions', null, () => readOpenActions(orgId, brandId)),
    attempt('focus', [], () => readTodayRanking(orgId, brandId, ownerId)),
    attempt('focus', { pins: [], skipped: new Set<string>() }, () =>
      readOwnerState(orgId, brandId, ownerId, now),
    ),
    attempt('signals', {}, () => readNewSignals(orgId, brandId, now)),
    attempt('kpis', [], () => readKpis(brandId)),
    attempt('ai_usage', NO_AI, () => readAiUsage(orgId, ownerId)),
    attempt('agents', [], () => readAgents(orgId, ownerId)),
  ]);
  const work = actions ? ownersWork(actions, ownerId) : null;

  const ids = agents.map((agent) => agent.id);
  const [triggers, runs, shares, connected] = await Promise.all([
    attempt('triggers', new Map<string, TriggerFacts>(), () => readTriggers(orgId, ids, now)),
    attempt('runs', null, () => readRuns(orgId, brandId, ids, now)),
    agents.some((agent) => agent.maxMonthShare !== null)
      ? attempt('shares', null, async () => {
          const read = await readAgentShares(orgId, 'period');
          if (!read) throw new Error('The agents’ shares got no answer');
          return read;
        })
      : null,
    agents.some(needsConnection)
      ? attempt('connections', null, () => readBrandConnections(brandId))
      : null,
  ]);

  const candidates = agents.map((agent): CandidateFacts => {
    const may = ownerMay(owner, agent, brandId);
    const fires = triggers.get(agent.id) ?? NO_TRIGGERS;
    const ran = runs?.get(agent.id);
    const used = shares?.byAgent.get(agent.id);
    return {
      agentId: agent.id,
      status: agent.status,
      mine: agent.ownerId === ownerId,
      workspace: agent.visibility === 'workspace',
      operator: false,
      canRun: may.canRun,
      onBrand: may.onBrand,
      // Unread, it doesn't hold the agent back: its run checks again before it starts.
      missingConnection: connected
        ? connectionGaps(neededConnections(agent.skills, agent.connections), connected).required
            .length > 0
        : false,
      // As agentMonthCapReached has it: own-key steps count, a hair under is reached.
      monthCapReached:
        agent.maxMonthShare !== null && !!used
          ? used.share + used.ownKeyShare >= agent.maxMonthShare - 1e-9
          : false,
      runOpen: ran?.runOpen ?? false,
      failCount: agent.failCount,
      maxRunShare: agent.maxRunShare,
      skills: agent.skills,
      signalTriggerCategories: fires.signalCategories,
      kpiTriggers: fires.kpis,
      nextOwnFireAt: fires.nextFireAt,
      cadenceDays: fires.cadenceDays,
      history: ran?.history ?? null,
    };
  });

  return {
    focus: focusCategories(state.pins, state.skipped, ranking, work, ownerId, now),
    openActions: work ? countByLevel(work) : {},
    newSignals,
    kpis,
    ai,
    candidates,
    // In one order, whichever failed first.
    failed: [...failed].sort(),
  };
}
