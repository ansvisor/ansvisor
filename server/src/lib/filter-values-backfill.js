/**
 * The 00544 backfill: corrects each brand's brand_filter_values counts for
 * the answers it had before 00544, a few months per
 * backfill_brand_filter_values call, oldest month first. The call that
 * reaches the current month lists the brand ready, and from then on
 * insights_filter_options (the region and model filter options) reads the
 * brand's counts instead of scanning its answers. Run by
 * src/scripts/backfill-filter-values.js.
 *
 * The database keeps where each brand stands (brand_filter_values_backfill),
 * so a run that stops is resumed by running it again: a brand goes on from
 * the month it reached, and a ready brand is skipped. Each call reads one
 * brand's answers for its months twice (the correction and a check that
 * fails the call, changing nothing, if the counts don't match), and goes one
 * at a time with a pause, as this shares the instance with live dashboards.
 * The first version of 00536 filled its rollups in one statement and took
 * production down (out of memory).
 */

import { parseArgs } from 'node:util';

export const FILTER_VALUES_CHUNK_MONTHS = 1;
export const FILTER_VALUES_PAUSE_MS = 250;
/** Calls for one brand before giving up: more months than any brand has. */
export const FILTER_VALUES_MAX_CALLS = 600;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function count(value, name, fallback, min, max) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

/**
 * The script's options (its header lists them), from the command line by
 * default. Throws with the option at fault.
 *
 * @param {string[]} [args]
 */
export function filterValuesOptions(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      'chunk-months': { type: 'string' },
      'pause-ms': { type: 'string' },
      brand: { type: 'string' },
      'dry-run': { type: 'boolean' },
    },
  });
  if (values.brand !== undefined && !UUID.test(values.brand)) {
    throw new Error('--brand must be a brand id (lower-case uuid)');
  }
  return {
    // backfill_brand_filter_values takes 1 to 24.
    chunkMonths: count(values['chunk-months'], '--chunk-months', FILTER_VALUES_CHUNK_MONTHS, 1, 24),
    pauseMs: count(values['pause-ms'], '--pause-ms', FILTER_VALUES_PAUSE_MS, 0, 60_000),
    brand: values.brand ?? null,
    dryRun: values['dry-run'] ?? false,
  };
}

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Walk the brands not ready yet, by id, each until it is ready; `brand`
 * names one (a ready one returns at once).
 *
 * @param {object} options
 * @param {(fn: string, args?: object) => PromiseLike<{ data: any, error: any }>} options.rpc
 * @param {number} [options.chunkMonths]  months per call
 * @param {number} [options.pauseMs]      wait after each call
 * @param {string|null} [options.brand]   this brand only
 * @param {boolean} [options.dryRun]      log the plan, call nothing
 * @returns {Promise<{ brands: number, ready: number, calls: number, ms: number, slowestMs: number }>}
 */
export async function backfillFilterValues({
  rpc,
  chunkMonths = FILTER_VALUES_CHUNK_MONTHS,
  pauseMs = FILTER_VALUES_PAUSE_MS,
  brand = null,
  dryRun = false,
  log = console.log,
  sleep = sleepFor,
  clock = Date.now,
}) {
  const { data, error } = await rpc('brand_filter_values_backfill_brands');
  if (error) throw new Error(`brand_filter_values_backfill_brands: ${error.message}`);

  const all = data ?? [];
  const brands = brand ? all.filter((b) => b.brand_id === brand) : all.filter((b) => !b.ready);
  if (brand && brands.length === 0) throw new Error(`${brand}: no such brand`);
  log(
    `${brands.length} brand(s) of ${all.length}, up to ${chunkMonths} month(s) per call, ` +
      `${pauseMs} ms apart${dryRun ? ' (dry run)' : ''}`,
  );
  if (dryRun) return { brands: brands.length, ready: 0, calls: 0, ms: 0, slowestMs: 0 };

  const started = clock();
  let calls = 0;
  let ready = 0;
  let slowestMs = 0;
  for (const [i, { brand_id: brandId }] of brands.entries()) {
    for (let call = 1; ; call++) {
      const t0 = clock();
      const { data: done, error: failed } = await rpc('backfill_brand_filter_values', {
        p_brand_id: brandId,
        p_months: chunkMonths,
      });
      if (failed?.code === 'P0002') {
        // Deleted since the list was read: its counts went with it.
        log(`[${i + 1}/${brands.length}] ${brandId} is gone, skipped`);
        break;
      }
      if (failed) {
        throw new Error(
          `${brandId}: ${failed.message}\n` +
            'Run the script again to resume: each brand goes on from the month it reached.',
        );
      }
      const ms = clock() - t0;
      if (ms > slowestMs) slowestMs = ms;
      calls++;
      const months = done?.month_from ? `${done.month_from}..${done.month_to}` : 'nothing left';
      log(
        `[${i + 1}/${brands.length}] ${brandId} ${months} ${ms} ms · ` +
          `counts corrected: ${done?.corrected ?? 0}${done?.ready ? ' · ready' : ''}`,
      );
      if (pauseMs > 0) await sleep(pauseMs);
      if (done?.ready) {
        ready++;
        break;
      }
      if (call >= FILTER_VALUES_MAX_CALLS) {
        throw new Error(`${brandId}: not ready after ${call} calls`);
      }
    }
  }
  return { brands: brands.length, ready, calls, ms: clock() - started, slowestMs };
}
