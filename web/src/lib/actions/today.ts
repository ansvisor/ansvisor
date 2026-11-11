'use server';

import { createClient } from '@/lib/supabase/server';
import { resolveAgentAuth } from '@/lib/agent/auth';
import { getVisibilitySummaryFor } from '@/lib/mcp/data';
import { getTrackingWindow } from '@/lib/actions/tracking';
import { getTrackedPromptCount } from '@/lib/actions/prompt';
import { getMyOpenActionCount } from '@/lib/actions/action-center-counts';
import { weekStart } from '@/lib/action-center/today';
import { standingFrom, type TodayStanding } from '@/lib/action-center/focus';
import { effectiveTimeZone } from '@/lib/time-zone';

/**
 * Action Center › Today's reads (SIMPLE_NAV), as the signed-in person.
 * Each part of the page reads on its own, so a slow or failed read hides
 * only its part. No model call: these are the counts and the overview read
 * the rest of the app already makes.
 */

/** The header and the loop strip: each count null when it couldn't be read. */
export interface TodayOverview {
  /** The person's time zone: the one they picked in Settings › Account, else their browser's. */
  zone: string;
  /** The brand's last completed tracking run; null before its first. */
  lastRunAt: string | null;
  trackedPrompts: number | null;
  /** Open actions that are the person's or no one's, as Today ranks them. */
  openActions: number | null;
  /** The brand's actions completed since Monday, on the person's clock. */
  doneThisWeek: number | null;
}

const settled = <T>(result: PromiseSettledResult<T>): T | null =>
  result.status === 'fulfilled' ? result.value : null;

/**
 * Today's header and loop strip: the person's zone, when AI answers last
 * came in, and the counts beside each step. Throws only when no one is
 * signed in; a count that fails is null, and its cell says nothing.
 */
export async function getTodayOverview(
  brandId: string,
  browserZone: string | null,
): Promise<TodayOverview> {
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

  const [window, tracked, open, done] = await Promise.allSettled([
    getTrackingWindow(brandId),
    getTrackedPromptCount(brandId),
    getMyOpenActionCount(brandId),
    supabase
      .from('actions')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('status', 'completed')
      .is('deleted_at', null)
      .gte('completed_at', weekStart(new Date(), zone))
      .then(({ count, error }) => {
        if (error) throw new Error(error.message);
        return count ?? 0;
      }),
  ]);
  return {
    zone,
    lastRunAt: settled(window)?.lastRunAt ?? null,
    trackedPrompts: settled(tracked),
    openActions: settled(open),
    doneThisWeek: settled(done),
  };
}

/**
 * Where the brand stands after its latest run: its score, the change since
 * the run before, its rank among the competitors its answers name, and the
 * gap to the next brand. The overview read behind Chat's
 * get_overview_summary (lib/mcp/overview-reads.ts), with the person's
 * session, over the latest run's days and the run's before them. Null
 * before the first run or without a score; throws on a failed read.
 */
export async function getTodayStanding(brandId: string): Promise<TodayStanding | null> {
  const auth = await resolveAgentAuth();
  if (!auth) throw new Error('Not authenticated');
  const window = await getTrackingWindow(brandId);
  if (!window.runDays) return null;
  const read = (days: { dayFrom?: string; dayTo?: string }) =>
    getVisibilitySummaryFor(auth, { brandId, dateFrom: days.dayFrom, dateTo: days.dayTo });
  const [current, previous] = await Promise.all([
    read(window.runDays),
    window.previousRunDays ? read(window.previousRunDays) : null,
  ]);
  if (!current) return null;
  return standingFrom(current, previous);
}
