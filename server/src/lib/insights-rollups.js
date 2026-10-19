/**
 * Insights daily-rollup maintenance (00066).
 *
 * The Insights page reads pre-aggregated daily rows instead of recomputing a
 * brand's whole history per load; this module is the only thing that writes
 * them, by calling the `refresh_insights_daily` SQL function. Two callers:
 *
 *   - tracking-worker, the moment a run's ledger row is stamped — so a day
 *     enters the rollups only once its run completed, never mid-stream
 *   - the daily sweep, which re-refreshes the trailing days for every brand
 *     as a backstop: runs that never stamped (partial, crashed, ghost tasks)
 *     and out-of-run writes (a prompt analyzed the moment it was added, #754)
 *     all get their day picked up the next morning
 *
 * Every entry point is best-effort. The rollups are derived state, always
 * recomputable from prompt_results; a refresh failure costs freshness until
 * the next sweep, so it must never take a tracking run down with it.
 */

import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';

/** How many trailing days the daily sweep recomputes, today included. */
export const SWEEP_DAYS = 3;

/** UTC calendar day of an ISO timestamp (or of now), as 'YYYY-MM-DD'. */
export function utcDay(iso = undefined) {
  return (iso ? new Date(iso) : new Date()).toISOString().slice(0, 10);
}

/**
 * Recompute one brand's rollup rows for an inclusive UTC day range.
 * Resolves to true when the refresh succeeded, false otherwise — callers
 * branch on it for logging only, never for control flow.
 */
export async function refreshInsightsDaily(brandId, dayFrom, dayTo) {
  const { error } = await supabaseAdmin.rpc('refresh_insights_daily', {
    p_brand_id: brandId,
    p_day_from: dayFrom,
    p_day_to: dayTo,
  });
  if (error) {
    logger.error({ err: error, brandId, dayFrom, dayTo }, '[insights-rollups] refresh failed');
    return false;
  }
  return true;
}

/**
 * Refresh the days a completed tracking run touched: from the run's start
 * day through today (a run crossing UTC midnight lands rows on two days).
 */
export async function refreshForCompletedRun(brandId, runStartedAtIso) {
  return refreshInsightsDaily(brandId, utcDay(runStartedAtIso), utcDay());
}

/**
 * Daily backstop: refresh the trailing SWEEP_DAYS for every brand.
 *
 * Deliberately every brand rather than "brands with recent results" — a
 * refresh over days with no rows deletes nothing and inserts nothing, so the
 * empty case costs one cheap call, and no discovery query can miss anyone.
 * Sequential on purpose: this shares the instance with live dashboards, and
 * finishing in half a minute instead of five seconds is the right trade.
 */
export async function sweepInsightsRollups({ days = SWEEP_DAYS } = {}) {
  const { data: brands, error } = await supabaseAdmin.from('brands').select('id');
  if (error) {
    logger.error({ err: error }, '[insights-rollups] sweep could not list brands');
    return { refreshed: 0, failed: 0 };
  }

  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  const dayFrom = utcDay(from.toISOString());
  const dayTo = utcDay(to.toISOString());

  let refreshed = 0;
  let failed = 0;
  for (const brand of brands ?? []) {
    const ok = await refreshInsightsDaily(brand.id, dayFrom, dayTo);
    if (ok) refreshed++;
    else failed++;
  }

  logger.info({ refreshed, failed, dayFrom, dayTo }, '[insights-rollups] sweep complete');
  return { refreshed, failed };
}
