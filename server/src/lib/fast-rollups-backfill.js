/**
 * The 00536 backfill: fills the summed Topics and Perception rollups
 * (topics_prompt_daily, topics_competitor_daily, mentions_terms_daily_all)
 * from the rollups they sum, brand by brand, a chunk of days per
 * backfill_fast_rollups call, and lists each brand in fast_rollups_ready
 * with its last chunk. Only then do its Topics and Perception reads use
 * them. Run by src/scripts/backfill-fast-rollups.js, which has the options.
 *
 * A call takes the brand's refresh locks and makes its days match the
 * sources, so any chunk can be run again; a run that stops can be resumed
 * from the brand and day it names. Chunks go one at a time with a pause, as
 * this shares the instance with live dashboards. The first version of 00536
 * filled them in one statement and took production down (out of memory).
 */

import { addDays, dayChunks } from './citations-rollups.js';
import { utcDay } from './insights-rollups.js';

export const FAST_ROLLUPS_CHUNK_DAYS = 14;
export const FAST_ROLLUPS_PAUSE_MS = 250;

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The calls for one brand: its days in chunks of `chunkDays`, the last one
 * through today. A refresh that was running when 00536 applied (whose old
 * definition writes the sources only) holds the brand's lock until it
 * commits, and the chunk waits for it, so its days are in as well.
 */
export function brandChunks({ dayFrom, dayTo, chunkDays, today }) {
  const end = dayTo > today ? dayTo : today;
  if (dayFrom > dayTo) return [[dayFrom, end]];
  const chunks = dayChunks(dayFrom, dayTo, chunkDays);
  chunks[chunks.length - 1][1] = end;
  return chunks;
}

/**
 * Walk the brands. With `lastDays`, every brand's last days, ready or not,
 * listing none (the runbook's last step, for days a refresh rewrote while
 * 00536 applied). Otherwise each brand not yet ready, whole, ready at its
 * end; `brand` names one, ready or not.
 *
 * @param {object} options
 * @param {(fn: string, args?: object) => PromiseLike<{ data: any, error: any }>} options.rpc
 * @param {number} [options.chunkDays]  days per call
 * @param {number} [options.pauseMs]    wait after each call
 * @param {string|null} [options.brand]      this brand only
 * @param {string|null} [options.fromBrand]  start at this brand id (brands go by id)
 * @param {string|null} [options.fromDay]    that brand (fromBrand or brand) from this day on
 * @param {number|null} [options.lastDays]   from this many days ago through today
 * @param {boolean} [options.dryRun]         log the plan, call nothing
 * @returns {Promise<{ brands: number, chunks: number, ms: number, slowestMs: number }>}
 */
export async function backfillFastRollups({
  rpc,
  chunkDays = FAST_ROLLUPS_CHUNK_DAYS,
  pauseMs = FAST_ROLLUPS_PAUSE_MS,
  brand = null,
  fromBrand = null,
  fromDay = null,
  lastDays = null,
  dryRun = false,
  today = utcDay(),
  log = console.log,
  sleep = sleepFor,
  clock = Date.now,
}) {
  const { data, error } = await rpc('fast_rollups_backfill_ranges');
  if (error) throw new Error(`fast_rollups_backfill_ranges: ${error.message}`);

  let ranges = data ?? [];
  if (brand) ranges = ranges.filter((r) => r.brand_id === brand);
  else if (lastDays === null) ranges = ranges.filter((r) => !r.ready);
  // Postgres orders uuids as their lower-case hex strings sort.
  if (fromBrand) ranges = ranges.filter((r) => r.brand_id >= fromBrand);

  const since = lastDays === null ? null : addDays(today, -lastDays);
  // A brand with no day since then has nothing a refresh rewrote.
  if (since) ranges = ranges.filter((r) => r.day_to >= since);

  const plan = ranges.map((r) => {
    let dayFrom = r.day_from;
    if (since && since > dayFrom) dayFrom = since;
    // Only the brand named: one listed ready since is skipped, not cut short.
    if (fromDay && r.brand_id === (fromBrand ?? brand) && fromDay > dayFrom) dayFrom = fromDay;
    return {
      brandId: r.brand_id,
      chunks: brandChunks({ dayFrom, dayTo: r.day_to, chunkDays, today }),
    };
  });
  const planned = plan.reduce((n, p) => n + p.chunks.length, 0);
  log(
    `${plan.length} brand(s), ${planned} call(s) of up to ${chunkDays} days, ${pauseMs} ms apart` +
      (since ? `, from ${since}` : '') +
      (dryRun ? ' (dry run)' : ''),
  );
  if (dryRun) return { brands: plan.length, chunks: 0, ms: 0, slowestMs: 0 };

  const mark = lastDays === null;
  const started = clock();
  let chunksDone = 0;
  let slowestMs = 0;
  for (const [i, { brandId, chunks }] of plan.entries()) {
    for (const [c, [from, to]] of chunks.entries()) {
      const last = c === chunks.length - 1;
      const t0 = clock();
      const { data: rows, error: failed } = await rpc('backfill_fast_rollups', {
        p_brand_id: brandId,
        p_day_from: from,
        p_day_to: to,
        p_mark_ready: mark && last,
      });
      if (failed) {
        const resume = [`--from-brand ${brandId}`, `--from-day ${from}`];
        if (lastDays !== null) resume.push(`--last-days ${lastDays}`);
        throw new Error(
          `${brandId} ${from}..${to}: ${failed.message}\nResume with: ${resume.join(' ')}`,
        );
      }
      const ms = clock() - t0;
      if (ms > slowestMs) slowestMs = ms;
      chunksDone++;
      log(
        `[${i + 1}/${plan.length}] ${brandId} ${from}..${to} ${ms} ms · ` +
          `rows written: ${rows?.prompt_rows ?? 0} prompt, ${rows?.competitor_rows ?? 0} competitor, ` +
          `${rows?.term_rows ?? 0} term${mark && last ? ' · ready' : ''}`,
      );
      if (pauseMs > 0) await sleep(pauseMs);
    }
  }
  return { brands: plan.length, chunks: chunksDone, ms: clock() - started, slowestMs };
}
