/**
 * Mentions daily-rollup maintenance (00157).
 *
 * The Mentions & Sentiment page reads per-day mention rows instead of
 * re-reading a window of answers per load; this module is the only thing
 * that writes them, through the `refresh_mentions_daily` SQL function. It
 * rides on the Insights rollup callers (insights-rollups.js), as the Citations
 * rollups do: a run's days are refreshed when the run stamps, and the daily
 * sweep re-refreshes the trailing days.
 *
 * Best-effort like the other rollups: the rows are derived state, always
 * recomputable from prompt_results, so a failure costs freshness until the
 * next sweep and never throws into a tracking run.
 */

import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';
import { dayChunks, resultDayBound } from './citations-rollups.js';

/**
 * Recompute one brand's mention rollups for an inclusive UTC day range.
 * Resolves to true on success, false otherwise; never throws.
 */
export async function refreshMentionsDaily(brandId, dayFrom, dayTo) {
  const { error } = await supabaseAdmin.rpc('refresh_mentions_daily', {
    p_brand_id: brandId,
    p_day_from: dayFrom,
    p_day_to: dayTo,
  });
  if (error) {
    logger.error({ err: error, brandId, dayFrom, dayTo }, '[mentions-rollups] refresh failed');
    return false;
  }
  return true;
}

/**
 * Recompute a brand's whole mention history, a chunk at a time so no call
 * nears the service role's statement timeout. Resolves to the number of
 * chunks written; throws when a chunk fails, so the caller can retry later.
 */
export async function refreshMentionHistory(brandId, { pauseMs = 0 } = {}) {
  const firstDay = await resultDayBound(brandId, true);
  if (!firstDay) return 0;
  const lastDay = await resultDayBound(brandId, false);

  const chunks = dayChunks(firstDay, lastDay);
  for (const [from, to] of chunks) {
    const ok = await refreshMentionsDaily(brandId, from, to);
    if (!ok) throw new Error(`mention rollup refresh failed for ${brandId} ${from}..${to}`);
    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  return chunks.length;
}
