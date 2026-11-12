import type { createClient } from '@/lib/supabase/server';
import { agentStateOf } from '@/lib/content/drafts';
import type { ActionDotFacts } from '@/lib/page-dots';
import { ITEM_SEEN_DAYS, actionSeenKey, readSeenKeys } from '@/lib/user-brand-state';

type Client = Awaited<ReturnType<typeof createClient>>;

/** A run or a writer older than this is one a stopped server left open. */
const WORKING_WITHIN_MS = 6 * 60 * 60_000;
/** The task writer's claim: older than this, the writer died (00150). */
const TASKS_WRITING_MS = 10 * 60_000;
/** Measurements reach d90: a change shipped longer ago than this has none new. */
const SHIPPED_WITHIN_DAYS = 120;
const RUNS_READ = 100;
const DRAFTS_READ = 500;
const OUTCOMES_READ = 500;

const DAY_MS = 24 * 60 * 60_000;

function recent(at: unknown, within: number, now: number): boolean {
  const time = typeof at === 'string' ? Date.parse(at) : Number.NaN;
  return !Number.isNaN(time) && now - time < within;
}

function logged<T>(
  what: string,
  res: { data: T | null; error: { message: string } | null },
): T | null {
  if (res.error) console.error(`[actions] could not read ${what} for the dots:`, res.error.message);
  return res.error ? null : res.data;
}

/**
 * What lights each action's dot (lib/page-dots.ts), read with the Actions
 * list in parallel, a few brand-wide reads on their indexes, as the person:
 *
 *   agent runs on an action    chat_agent_runs, the brand's latest (chat_agent_runs_brand_idx)
 *   its drafts                 content_drafts with an action (agent_state, status), each
 *                              with its latest send to the CMS
 *   outcomes measured          ship_events of the brand's actions with an Improved or No
 *                              change measurement (ship_events_brand_shipped_idx)
 *   the person's openings      user_brand_state.nav_seen's action keys (their own row)
 *
 * The task statuses and the task writer's claim come with the list itself.
 * A read that fails lights nothing.
 */
export async function readActionDotSources(
  supabase: Client,
  brandId: string,
): Promise<ActionDotSources> {
  const now = Date.now();
  const [runsRes, draftsRes, outcomesRes, seenRes] = await Promise.all([
    supabase
      .from('chat_agent_runs')
      .select('action_id, status, started_at')
      .eq('brand_id', brandId)
      .not('action_id', 'is', null)
      .not('status', 'in', '(queued,skipped)')
      .order('queued_at', { ascending: false })
      .limit(RUNS_READ),
    supabase
      .from('content_drafts')
      .select('action_id, status, agent_state, agent_state_at, content_draft_deliveries(status)')
      .eq('brand_id', brandId)
      .not('action_id', 'is', null)
      .is('archived_at', null)
      .order('created_at', { referencedTable: 'content_draft_deliveries', ascending: false })
      .limit(1, { referencedTable: 'content_draft_deliveries' })
      .limit(DRAFTS_READ),
    supabase
      .from('ship_events')
      .select('action_id, impact_measurements!inner(outcome, measured_at)')
      .eq('brand_id', brandId)
      .not('action_id', 'is', null)
      .gte('shipped_at', new Date(now - SHIPPED_WITHIN_DAYS * DAY_MS).toISOString())
      .in('impact_measurements.outcome', ['improved', 'no_meaningful_change'])
      .gte('impact_measurements.measured_at', new Date(now - ITEM_SEEN_DAYS * DAY_MS).toISOString())
      .limit(OUTCOMES_READ),
    // The person's own row: the policies keep it theirs.
    supabase.from('user_brand_state').select('nav_seen').eq('brand_id', brandId).maybeSingle(),
  ]);

  const runs = new Map<string, 'running' | 'failed' | null>();
  for (const run of logged('the agent runs', runsRes) ?? []) {
    if (!run.action_id || runs.has(run.action_id)) continue;
    runs.set(
      run.action_id,
      run.status === 'failed'
        ? 'failed'
        : run.status === 'running' && recent(run.started_at, WORKING_WITHIN_MS, now)
          ? 'running'
          : null,
    );
  }

  const drafts = new Map<string, { writing: boolean; inReview: boolean; failed: boolean }>();
  for (const draft of logged('the drafts', draftsRes) ?? []) {
    if (!draft.action_id) continue;
    const kept = drafts.get(draft.action_id) ?? { writing: false, inReview: false, failed: false };
    const sends = draft.content_draft_deliveries as { status: string }[] | null;
    drafts.set(draft.action_id, {
      writing: kept.writing || agentStateOf(draft.agent_state, draft.agent_state_at) === 'writing',
      inReview: kept.inReview || draft.status === 'in_review',
      failed: kept.failed || sends?.[0]?.status === 'failed',
    });
  }

  const measured = new Map<string, string>();
  type Measurement = { measured_at: string | null };
  for (const event of logged('the outcomes', outcomesRes) ?? []) {
    if (!event.action_id) continue;
    const found = event.impact_measurements as Measurement | Measurement[] | null;
    for (const m of Array.isArray(found) ? found : found ? [found] : []) {
      const kept = measured.get(event.action_id);
      if (m.measured_at && (!kept || Date.parse(m.measured_at) > Date.parse(kept))) {
        measured.set(event.action_id, m.measured_at);
      }
    }
  }

  const seenRow = logged('the actions opened', seenRes);
  const seen = seenRes.error ? null : readSeenKeys(seenRow?.nav_seen);
  return { runs, drafts, measured, seen, now };
}

/** What readActionDotSources found, by action. */
export interface ActionDotSources {
  runs: Map<string, 'running' | 'failed' | null>;
  drafts: Map<string, { writing: boolean; inReview: boolean; failed: boolean }>;
  measured: Map<string, string>;
  /** The person's openings; null when they couldn't be read. */
  seen: Record<string, string> | null;
  now: number;
}

/** No source read: only what the list itself has. */
export const NO_DOT_SOURCES: ActionDotSources = {
  runs: new Map(),
  drafts: new Map(),
  measured: new Map(),
  seen: null,
  now: 0,
};

/** Each action's dot facts, from the sources and the list's own task statuses and writer claim. */
export function actionDotFactsOf(
  { runs, drafts, measured, seen, now }: ActionDotSources,
  actions: { id: string; tasksWritingSince: string | null; taskStatuses: readonly string[] }[],
): Map<string, ActionDotFacts> {
  const facts = new Map<string, ActionDotFacts>();
  for (const action of actions) {
    const draft = drafts.get(action.id);
    facts.set(action.id, {
      taskWaiting: action.taskStatuses.includes('waiting_approval'),
      taskFailed: action.taskStatuses.includes('failed'),
      agentRun: runs.get(action.id) ?? null,
      writingTasks: recent(action.tasksWritingSince, TASKS_WRITING_MS, now || Date.now()),
      draftWriting: draft?.writing ?? false,
      draftInReview: draft?.inReview ?? false,
      publishFailed: draft?.failed ?? false,
      measuredAt: measured.get(action.id) ?? null,
      ...(seen ? { seenAt: seen[actionSeenKey(action.id)] ?? null } : {}),
    });
  }
  return facts;
}
