'use server';

import { createClient } from '@/lib/supabase/server';
import { resolveAgentAuth } from '@/lib/agent/auth';
import { getVisibilitySummaryFor } from '@/lib/mcp/data';
import { runDayWindow } from '@/lib/citations/rollup-window';
import { getTrackedPromptCount } from '@/lib/actions/prompt';
import { getMyOpenActionCount } from '@/lib/actions/action-center-counts';
import { standingFrom, type TodayStanding } from '@/lib/action-center/focus';
import { hasFullWeek, isMondayIn, lastWeekOf } from '@/lib/action-center/last-week';
import { effectiveTimeZone } from '@/lib/time-zone';

/** An action as a line names it: its kind and payload (actionTexts). */
export interface NamedAction {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
}

/** Monday's "Last week": each part null when it couldn't be read. */
export interface TodayLastWeek {
  /** Last week's visibility against the week before, and the rank. */
  visibility: TodayStanding | null;
  /** Actions completed last week, newest first. */
  done: { count: number; actions: NamedAction[] } | null;
  /** Actions whose result came in improved last week. */
  results: { count: number; actions: NamedAction[] } | null;
}

/** After the plan ends: what the trial found, and what waits for a plan. */
export interface TodayEnded {
  /** When tracking last ran; it is paused since. */
  lastRunAt: string | null;
  /** The last run against the first: the score's change over the trial, the rank and the gap. */
  trial: TodayStanding | null;
  prompts: number | null;
  competitors: number | null;
  /** Actions completed while the plan ran. */
  done: number | null;
  /** Actions whose result came in improved. */
  improved: { count: number; actions: NamedAction[] } | null;
  /** Open actions, the person's or no one's. */
  open: number | null;
  /** Drafts in review in the Library. */
  drafts: { count: number; title: string | null } | null;
}

type Client = Awaited<ReturnType<typeof createClient>>;

const settled = <T>(result: PromiseSettledResult<T>): T | null =>
  result.status === 'fulfilled' ? result.value : null;

const NAMED = 'id, kind, payload';
const named = (rows: unknown[] | null): NamedAction[] =>
  ((rows ?? []) as NamedAction[]).map((row) => ({
    id: row.id,
    kind: row.kind,
    payload: (row.payload ?? {}) as Record<string, unknown>,
  }));

/** The brand's first or last completed run. */
async function run(supabase: Client, brandId: string, first: boolean) {
  const { data, error } = await supabase
    .from('tracking_runs')
    .select('started_at, completed_at')
    .eq('brand_id', brandId)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: first })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { started_at: string; completed_at: string } | null;
}

/**
 * Monday's "Last week" on Action Center › Today (SIMPLE_NAV), on the
 * person's Monday once the brand has a full week of runs; null otherwise.
 * Visibility over last week against the week before and the rank (the
 * overview read behind Chat's get_overview_summary, over 7 days), the
 * actions completed last week, and the actions whose result came in
 * improved last week. As the person; no model call.
 */
export async function getTodayLastWeek(
  brandId: string,
  browserZone: string | null,
): Promise<TodayLastWeek | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const profile = await supabase
    .from('profiles')
    .select('time_zone')
    .eq('id', user.id)
    .maybeSingle();
  const zone = effectiveTimeZone(profile.data?.time_zone ?? null, browserZone);
  const now = new Date();
  if (!isMondayIn(now, zone)) return null;
  const week = lastWeekOf(now, zone);
  const first = await run(supabase, brandId, true);
  if (!hasFullWeek(first?.completed_at ?? null, week.start)) return null;

  const [visibility, done, results] = await Promise.allSettled([
    (async () => {
      const auth = await resolveAgentAuth();
      if (!auth) return null;
      const [current, previous] = await Promise.all([
        getVisibilitySummaryFor(auth, { brandId, dateFrom: week.days.from, dateTo: week.days.to }),
        getVisibilitySummaryFor(auth, {
          brandId,
          dateFrom: week.before.from,
          dateTo: week.before.to,
        }),
      ]);
      return current ? standingFrom(current, previous) : null;
    })(),
    supabase
      .from('actions')
      .select(NAMED, { count: 'exact' })
      .eq('brand_id', brandId)
      .eq('status', 'completed')
      .is('deleted_at', null)
      .gte('completed_at', week.start)
      .lt('completed_at', week.end)
      .order('completed_at', { ascending: false })
      .limit(5)
      .then(({ data, count, error }) => {
        if (error) throw new Error(error.message);
        return { count: count ?? 0, actions: named(data) };
      }),
    supabase
      .from('actions')
      .select(NAMED, { count: 'exact' })
      .eq('brand_id', brandId)
      .eq('outcome', 'improved')
      .is('deleted_at', null)
      .gte('validated_at', week.start)
      .lt('validated_at', week.end)
      .order('validated_at', { ascending: false })
      .limit(5)
      .then(({ data, count, error }) => {
        if (error) throw new Error(error.message);
        return { count: count ?? 0, actions: named(data) };
      }),
  ]);
  return {
    visibility: settled(visibility),
    done: settled(done),
    results: settled(results),
  };
}

/**
 * Today after the plan or trial ended (SIMPLE_NAV), read-only: when
 * tracking last ran, what the trial found (the last run's score against the
 * first's, the rank and the gap to the leader), the actions completed and
 * improved, what is kept (prompts, competitors), what waits for a plan
 * (open actions, drafts in review). As the person; nothing is written.
 */
export async function getTodayEnded(brandId: string): Promise<TodayEnded> {
  const supabase = await createClient();
  const [first, last] = await Promise.all([
    run(supabase, brandId, true),
    run(supabase, brandId, false),
  ]);
  const count = (query: PromiseLike<{ count: number | null; error: { message: string } | null }>) =>
    Promise.resolve(query).then(({ count: n, error }) => {
      if (error) throw new Error(error.message);
      return n ?? 0;
    });

  const [trial, prompts, competitors, done, improved, open, drafts] = await Promise.allSettled([
    (async () => {
      if (!last) return null;
      const auth = await resolveAgentAuth();
      if (!auth) return null;
      const read = (r: { started_at: string; completed_at: string }) => {
        const days = runDayWindow(r);
        return getVisibilitySummaryFor(auth, {
          brandId,
          dateFrom: days.dayFrom,
          dateTo: days.dayTo,
        });
      };
      const [current, previous] = await Promise.all([
        read(last),
        first && first.completed_at !== last.completed_at ? read(first) : null,
      ]);
      return current ? standingFrom(current, previous) : null;
    })(),
    getTrackedPromptCount(brandId),
    count(
      supabase.from('competitors').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
    ),
    count(
      supabase
        .from('actions')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .eq('status', 'completed')
        .is('deleted_at', null),
    ),
    supabase
      .from('actions')
      .select(NAMED, { count: 'exact' })
      .eq('brand_id', brandId)
      .eq('outcome', 'improved')
      .is('deleted_at', null)
      .order('validated_at', { ascending: false })
      .limit(3)
      .then(({ data, count: n, error }) => {
        if (error) throw new Error(error.message);
        return { count: n ?? 0, actions: named(data) };
      }),
    getMyOpenActionCount(brandId),
    supabase
      .from('content_drafts')
      .select('title', { count: 'exact' })
      .eq('brand_id', brandId)
      .eq('status', 'in_review')
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .then(({ data, count: n, error }) => {
        if (error) throw new Error(error.message);
        return { count: n ?? 0, title: (data?.[0]?.title as string | undefined) ?? null };
      }),
  ]);
  return {
    lastRunAt: last?.completed_at ?? null,
    trial: settled(trial),
    prompts: settled(prompts),
    competitors: settled(competitors),
    done: settled(done),
    improved: settled(improved),
    open: settled(open),
    drafts: settled(drafts),
  };
}
