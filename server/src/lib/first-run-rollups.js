/**
 * A brand's first tracking run, folded into the daily rollups while its
 * answers are still landing.
 *
 * The rollups (Insights 00066, Citations 00118, Mentions 00157) take a run's
 * days once it stamps (run-settlement.js), so a half-delivered run never
 * replaces a complete day. A brand's first run has no complete day to keep:
 * until it stamps — at 95% of its answers, or when nothing is pending, or up
 * to two hours later — every view that reads the rollups (Citations,
 * Mentions, Brand Visibility's 7/30/90-day ranges) shows nothing. So a first
 * run refreshes its days as answers land, at most once per
 * PROGRESSIVE_REFRESH_MS, and the stamp's own refresh settles them.
 *
 * The refreshes are one at a time, and the worker waits for the last one
 * before the run stamps: two refreshes of the same days at once can each
 * delete before the other inserts.
 */

import supabaseAdmin from '../config/supabase.js';
import { refreshRunDays } from './insights-rollups.js';
import { logger } from './logger.js';

/** At most one refresh of a first run's days this often. */
export const PROGRESSIVE_REFRESH_MS = 2 * 60_000;

/**
 * How often a first run that ended short of complete checks again whether it
 * can stamp (run-settlement.js; two counts a poll). Its stamp is what fills
 * the Action Center, so a first run checks every 30 s instead of every 2 min.
 */
export const FIRST_RUN_LATE_POLL_MS = 30_000;

/**
 * Whether a brand has never had a run stamped, so the run starting now is its
 * first. A failed read says no: the run then behaves as any other.
 */
export async function isFirstRun(brandId) {
  const { data, error } = await supabaseAdmin
    .from('tracking_runs')
    .select('id')
    .eq('brand_id', brandId)
    .not('completed_at', 'is', null)
    .limit(1);
  if (error) {
    logger.warn({ err: error, brandId }, 'could not tell whether this is the first run');
    return false;
  }
  return (data ?? []).length === 0;
}

/**
 * The refresher for one run. `note(landed)` is called with how many answers
 * have landed so far (a count that only grows); it starts a refresh when more
 * have landed since the last one, none is running, and the last started at
 * least `intervalMs` ago. It never waits. `finish(landed)` waits for a
 * refresh still running, then refreshes once more if answers landed since.
 * Both do nothing unless `enabled`.
 *
 * @param {{ brandId: string, startedAt: string | null, enabled: boolean,
 *   intervalMs?: number, now?: () => number }} opts
 */
export function progressiveRollups({
  brandId,
  startedAt,
  enabled,
  intervalMs = PROGRESSIVE_REFRESH_MS,
  now = Date.now,
}) {
  const on = Boolean(enabled && startedAt);
  let lastStartedAt = null;
  let lastLanded = 0;
  let inFlight = null;

  const start = (landed) => {
    lastStartedAt = now();
    lastLanded = landed;
    inFlight = refreshRunDays(brandId, startedAt)
      .catch((err) => {
        logger.warn({ err, brandId }, 'first-run rollup refresh failed');
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return {
    note(landed) {
      if (!on || inFlight || landed <= lastLanded) return;
      if (lastStartedAt !== null && now() - lastStartedAt < intervalMs) return;
      start(landed);
    },
    async finish(landed) {
      if (!on) return;
      await inFlight;
      if (landed > lastLanded) await start(landed);
    },
  };
}
