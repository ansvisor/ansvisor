import type { BrandAccess } from '@/lib/brand-access';
import {
  SHIP_ROW_EMBEDS,
  impactRow,
  impactSummary,
  measurementOf,
  type ImpactRow,
  type ImpactSummary,
} from '@/lib/impact/report';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { namesOf, visibleAgent, type AgentContext } from './agents';

/**
 * "What this agent did" on an agent's page (the owner's approved mockup):
 * the changes its runs took live in the last 30 days, each with what the
 * impact ledger measured for it (ship_events by agent_id, with their
 * impact_measurements, 00421), and how many drafts its runs made in those
 * 30 days that aren't live. Rows, outcomes, confidence and the headline
 * are Reports' own (impactRow, impactSummary): nothing is judged here.
 *
 * Read with the service role on the brands the person may see, as the
 * ledger's policy has it (00424: their workspace, brand_id in
 * user_brand_ids()); a run's number counts only the runs they see, as Run
 * history lists them. A run's chat is given when they may open it, as
 * runViews has it. A draft is the agent's through its chat: content_drafts
 * .conversation_id → chat_conversations.agent_run_id → chat_agent_runs
 * .agent_id, so a draft a person approved in the run's chat counts too. It
 * isn't live while no ship event names it. What leaves for the browser:
 * titles, pages, numbers and names, never a ship event's, run's or draft's
 * own id. Server only.
 */

/** The days the card covers, as the agent list's "Outcomes · 30 days". */
export const AGENT_IMPACT_DAYS = 30;
const DAY_MS = 86_400_000;
/** Most changes a read lists, as Reports' month; past it the card says so (capped). */
const SHIPS_MAX = 500;
/** Ids one `in` filter takes: 100 UUIDs keep a request's address well under the edge's limit. */
const IN_CHUNK = 100;
/** Rows a page of runs reads: PostgREST's max_rows. */
const RUNS_PAGE = 1000;
/** Runs numbered at most, from the oldest one a change came from: past it, no number. */
const RUNS_MAX = 10_000;

/** Who took a change live: the agent on its own, the person reading, or a teammate. */
export type AgentShipCredit =
  | { who: 'own' }
  | { who: 'you' }
  | { who: 'teammate'; name: string | null };

/** A change the agent shipped, as the card lists it. */
export interface AgentImpactRow extends ImpactRow {
  credit: AgentShipCredit;
  /**
   * The agent run it came from: its number among the agent's runs the person
   * sees (the first is 1), and its chat when they may open it; null when the
   * ship event names no run, or one they can't see.
   */
  run: { number: number; chatId: string | null } | null;
}

export interface AgentImpact {
  /** Newest first. */
  rows: AgentImpactRow[];
  /** More changes than a read lists: the rows, and the headline, are the newest SHIPS_MAX. */
  capped: boolean;
  /** Reports' headline over the rows: Improved counts Medium and High verdicts only. */
  summary: ImpactSummary;
  /** Drafts its runs of the last 30 days made that no ship event names. */
  draftsNotLive: number;
}

/**
 * On its own when the agent published it (execution_mode automated, as
 * ship.js writes an agent's own send); otherwise the person who sent it:
 * the reader ("you approved") or a teammate, unnamed once they've left.
 */
export function shipCredit(row: Pick<ImpactRow, 'executionMode' | 'by'>): AgentShipCredit {
  if (row.executionMode === 'automated') return { who: 'own' };
  if (row.by.who === 'you') return { who: 'you' };
  return { who: 'teammate', name: row.by.who === 'teammate' ? row.by.name : null };
}

interface ShipRow {
  title: string;
  kind: string;
  source: string;
  shipped_at: string;
  shipped_by: string | null;
  execution_mode: string;
  url: string | null;
  agent_run_id: string | null;
  actions: { action_no: number | null } | null;
  impact_measurements: Record<string, unknown> | Record<string, unknown>[] | null;
}

interface RunRow {
  id: string;
  queued_at: string;
}

interface ChatRow {
  id: string;
  agent_run_id: string;
  user_id: string | null;
  shared_at: string | null;
  deleted_at: string | null;
}

type Query = {
  in: (column: string, values: readonly string[]) => Query;
} & PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>;

/** A read on the brands the person may see: every one with All brands, else theirs. */
function onTheirBrands<Q>(query: Q, access: BrandAccess): Q {
  return access === 'all'
    ? query
    : ((query as unknown as Query).in('brand_id', [...access]) as unknown as Q);
}

/** Every row a read by ids gives, IN_CHUNK ids a request. */
async function byIds<T>(
  ids: readonly string[],
  read: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) chunks.push(ids.slice(i, i + IN_CHUNK));
  const reads = await Promise.all(chunks.map(read));
  const failed = reads.find((r) => r.error);
  if (failed?.error) throw new Error(`Could not read ${what}: ${failed.error.message}`);
  return reads.flatMap((r) => (r.data ?? []) as T[]);
}

/**
 * The agent's runs the person sees, from `from` on, oldest first, each with
 * its number: the runs before `from` counted, then each one's place.
 */
async function numberedRuns(
  agentId: string,
  access: BrandAccess,
  from: string,
): Promise<{ runs: RunRow[]; numbers: Map<string, number> }> {
  const before = await onTheirBrands(
    supabaseAdmin
      .from('chat_agent_runs')
      .select('id', { count: 'exact', head: true })
      .eq('agent_id', agentId)
      .lt('queued_at', from),
    access,
  );
  if (before.error) throw new Error(`Could not count the agent's runs: ${before.error.message}`);
  const runs: RunRow[] = [];
  for (let page = 0; page * RUNS_PAGE < RUNS_MAX; page++) {
    const { data, error } = await onTheirBrands(
      supabaseAdmin
        .from('chat_agent_runs')
        .select('id, queued_at')
        .eq('agent_id', agentId)
        .gte('queued_at', from),
      access,
    )
      .order('queued_at', { ascending: true })
      .order('id', { ascending: true })
      .range(page * RUNS_PAGE, (page + 1) * RUNS_PAGE - 1);
    if (error) throw new Error(`Could not read the agent's runs: ${error.message}`);
    const rows = (data ?? []) as RunRow[];
    runs.push(...rows);
    if (rows.length < RUNS_PAGE) break;
  }
  const numbers = new Map(runs.map((run, i) => [run.id, (before.count ?? 0) + i + 1] as const));
  return { runs, numbers };
}

/** What the agent did in the last 30 days, or null when the person can't see the agent. */
export async function readAgentImpact(
  ctx: AgentContext,
  id: string,
  now = new Date(),
): Promise<AgentImpact | null> {
  const agent = await visibleAgent(ctx, id);
  if (!agent) return null;
  const org = ctx.actor.organizationId;
  const viewer = ctx.actor.userId;
  const access = ctx.viewer.brandAccess;
  const since = new Date(now.getTime() - AGENT_IMPACT_DAYS * DAY_MS).toISOString();

  const ships = await onTheirBrands(
    supabaseAdmin
      .from('ship_events')
      .select(
        `title, kind, source, shipped_at, shipped_by, execution_mode, url, agent_run_id, ${SHIP_ROW_EMBEDS}`,
      )
      .eq('organization_id', org)
      .eq('agent_id', agent.row.id)
      .gte('shipped_at', since),
    access,
  )
    .order('shipped_at', { ascending: false })
    // One more than it lists, to tell 30 days that have more.
    .limit(SHIPS_MAX + 1);
  if (ships.error) throw new Error(`Could not read what the agent shipped: ${ships.error.message}`);
  const read = (ships.data ?? []) as unknown as ShipRow[];
  const shipRows = read.slice(0, SHIPS_MAX);

  // Its runs are numbered from the oldest one a change came from, or the window's start.
  const shippedRunIds = [
    ...new Set(shipRows.map((s) => s.agent_run_id).filter((r): r is string => !!r)),
  ];
  const shippedRuns = await byIds<RunRow>(
    shippedRunIds,
    (chunk) =>
      supabaseAdmin
        .from('chat_agent_runs')
        .select('id, queued_at')
        .eq('agent_id', agent.row.id)
        .in('id', chunk),
    "the agent's runs",
  );
  const from = shippedRuns.reduce(
    (oldest, run) => (Date.parse(run.queued_at) < Date.parse(oldest) ? run.queued_at : oldest),
    since,
  );
  const teammates = [
    ...new Set(shipRows.map((s) => s.shipped_by).filter((p): p is string => !!p && p !== viewer)),
  ];
  const [{ runs, numbers }, names] = await Promise.all([
    numberedRuns(agent.row.id, access, from),
    namesOf(org, teammates),
  ]);

  // The chats of the runs that shipped, and of the window's runs (their drafts).
  const windowRunIds = runs
    .filter((run) => Date.parse(run.queued_at) >= Date.parse(since))
    .map((run) => run.id);
  const chats = await byIds<ChatRow>(
    [...new Set([...shippedRunIds, ...windowRunIds])],
    (chunk) =>
      supabaseAdmin
        .from('chat_conversations')
        .select('id, agent_run_id, user_id, shared_at, deleted_at')
        .eq('organization_id', org)
        .in('agent_run_id', chunk),
    "the agent's chats",
  );
  // A run's chat opens for its own person, or shared with the team; never a deleted one.
  const chatOf = new Map(
    chats
      .filter((c) => c.deleted_at === null && (c.user_id === viewer || c.shared_at !== null))
      .map((c) => [c.agent_run_id, c.id] as const),
  );

  const inWindow = new Set(windowRunIds);
  const draftChats = chats.filter((c) => inWindow.has(c.agent_run_id)).map((c) => c.id);
  const drafts = await byIds<{ id: string }>(
    draftChats,
    (chunk) =>
      onTheirBrands(
        supabaseAdmin
          .from('content_drafts')
          .select('id')
          .in('conversation_id', chunk)
          .is('archived_at', null),
        access,
      ),
    "the agent's drafts",
  );
  const draftIds = [...new Set(drafts.map((d) => d.id))];
  const live = await byIds<{ content_draft_id: string }>(
    draftIds,
    (chunk) =>
      supabaseAdmin
        .from('ship_events')
        .select('content_draft_id')
        .eq('organization_id', org)
        .in('content_draft_id', chunk),
    "the agent's drafts that went live",
  );
  const liveIds = new Set(live.map((s) => s.content_draft_id));

  const rows = shipRows.map((ship, i): AgentImpactRow => {
    const row = impactRow(
      {
        key: `r${i + 1}`,
        title: ship.title,
        kind: ship.kind,
        source: ship.source,
        shipped_at: ship.shipped_at,
        shipped_by: ship.shipped_by,
        execution_mode: ship.execution_mode,
        url: ship.url,
        actionNo: ship.actions?.action_no ?? null,
        measurement: measurementOf(ship.impact_measurements),
      },
      viewer,
      names,
    );
    const number = ship.agent_run_id ? numbers.get(ship.agent_run_id) : undefined;
    return {
      ...row,
      credit: shipCredit(row),
      run:
        ship.agent_run_id && number !== undefined
          ? { number, chatId: chatOf.get(ship.agent_run_id) ?? null }
          : null,
    };
  });
  return {
    rows,
    capped: read.length > SHIPS_MAX,
    summary: impactSummary(rows, null),
    draftsNotLive: draftIds.filter((d) => !liveIds.has(d)).length,
  };
}
