/**
 * The nightly signal pass, and the sweep that picks up the ones it lost.
 *
 * Recording signals and consolidating them into actions are two steps of one
 * thing: a night either produced both or produced nothing useful. They were
 * chained inline in the job runner, fire-and-forget, with a `.catch` that
 * logged. That is how the biggest brand went six days without a single signal
 * — every night its metric queries crossed the database's statement timeout,
 * every night the chain threw, and every night the error went into a log file
 * nobody reads while the Action Center quietly showed week-old work.
 *
 * Two things change here. The pass writes a row when it finishes, so "did it
 * run?" is a question the database can answer. And a sweep re-runs the passes
 * that have no row, so a night lost to a timeout, a deploy or an OOM is
 * recovered the next morning instead of never.
 *
 * The daily pulse has had both since #702. This is the same shape for the
 * half of the same trigger that never got it.
 */

import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { recordSignalsForBrand } from './record.js';
import { generateActionsForBrand } from '../action-center/generate.js';

/**
 * How far back the sweep looks. Long enough to cover a missed night plus the
 * gap between two runs, short enough that a brand paused a week ago does not
 * get a pass it has no use for.
 */
const CATCH_UP_WINDOW_MS = 36 * 60 * 60 * 1000;

/** The brand's most recent stamped nightly run, or null. */
async function latestStampedRun(brandId) {
  const { data, error } = await supabaseAdmin
    .from('tracking_runs')
    .select('completed_at')
    .eq('brand_id', brandId)
    .eq('source', 'cron')
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.completed_at ?? null;
}

/**
 * Record signals and consolidate them into actions for one brand, then log
 * the pass against the run it covered.
 *
 * The ledger row is written last and only on success: a pass that threw
 * halfway leaves no row, which is precisely what makes the sweep able to find
 * it. Idempotent on (brand, run) so a sweep racing the inline trigger cannot
 * run the same night twice.
 *
 * @param {string} brandId
 * @param {{ runAt?: string, now?: Date }} [options] runAt names the tracking
 *   run this pass covers; omitted, the brand's most recent stamped run.
 */
export async function runSignalPass(brandId, { runAt, now = new Date() } = {}) {
  const trackingRunAt = runAt ?? (await latestStampedRun(brandId));
  if (!trackingRunAt) {
    logger.info({ brandId }, '[signals] no stamped run to record against');
    return { skipped: 'no_stamped_run' };
  }

  const recorded = await recordSignalsForBrand(brandId, { now });
  const generated = recorded.skipped ? null : await generateActionsForBrand(brandId, { now });

  const { error } = await supabaseAdmin.from('signal_runs').upsert(
    {
      brand_id: brandId,
      tracking_run_at: trackingRunAt,
      ran_at: now.toISOString(),
      outcome: recorded.skipped ? 'skipped' : 'recorded',
      detail: { signals: recorded, actions: generated },
    },
    { onConflict: 'brand_id,tracking_run_at' },
  );
  if (error) throw new Error(error.message);

  return { trackingRunAt, signals: recorded, actions: generated };
}

/**
 * Re-run the passes that never finished.
 *
 * Every brand whose nightly run stamped within the window but has no pass
 * logged against that run. A brand whose pass succeeded is skipped by the
 * ledger row, so the sweep costs one query on a healthy night.
 */
export async function runSignalCatchUp({ now = new Date() } = {}) {
  try {
    const since = new Date(now.getTime() - CATCH_UP_WINDOW_MS).toISOString();
    const { data: runs, error } = await supabaseAdmin
      .from('tracking_runs')
      .select('brand_id, completed_at')
      .eq('source', 'cron')
      .not('completed_at', 'is', null)
      .gte('completed_at', since)
      .order('completed_at', { ascending: false });
    if (error) throw new Error(error.message);

    const latestByBrand = new Map();
    for (const run of runs ?? []) {
      if (!latestByBrand.has(run.brand_id)) latestByBrand.set(run.brand_id, run.completed_at);
    }
    if (latestByBrand.size === 0) return { recovered: 0, healthy: 0, failed: 0 };

    const { data: passes, error: passErr } = await supabaseAdmin
      .from('signal_runs')
      .select('brand_id, tracking_run_at')
      .gte('tracking_run_at', since);
    if (passErr) throw new Error(passErr.message);
    const done = new Set((passes ?? []).map((row) => `${row.brand_id}|${row.tracking_run_at}`));

    let recovered = 0;
    let healthy = 0;
    let failed = 0;

    for (const [brandId, completedAt] of latestByBrand) {
      if (done.has(`${brandId}|${completedAt}`)) {
        healthy += 1;
        continue;
      }
      try {
        await runSignalPass(brandId, { runAt: completedAt, now });
        logger.info({ brandId, runCompletedAt: completedAt }, '[signals] catch-up pass completed');
        recovered += 1;
      } catch (err) {
        // One brand's failure must not cost every brand behind it in the loop.
        logger.error({ err, brandId }, '[signals] catch-up pass failed');
        failed += 1;
      }
    }

    if (recovered > 0 || failed > 0) {
      logger.info({ recovered, healthy, failed }, '[signals] catch-up sweep completed');
    }
    return { recovered, healthy, failed };
  } catch (err) {
    logger.error({ err }, '[signals] catch-up sweep failed');
    return { error: true };
  }
}
