/**
 * Fill the summed Topics and Perception rollups (00536) from the rollups
 * they sum, and list each brand as ready once its whole history is in, so
 * its Topics and Perception reads move onto them. Until then a brand reads
 * as before; the nightly refreshes keep every brand's days current
 * meanwhile. Demo brands are left out (they read as before).
 *
 * Run (from server/):
 *   node src/scripts/backfill-fast-rollups.js [options]
 *
 * Options:
 *   --chunk-days N    days per backfill_fast_rollups call (default 14);
 *                     each call should take a few seconds
 *   --pause-ms N      wait after each call (default 250)
 *   --brand ID        this brand only, even if it is ready
 *   --from-brand ID   resume: start at this brand (brands go by id)
 *   --from-day DAY    resume: that brand from this UTC day (YYYY-MM-DD) on;
 *                     needs --from-brand or --brand
 *   --last-days N     every brand's days from N days ago through today,
 *                     ready or not, listing none ready: the runbook's last
 *                     step, after 00537
 *   --dry-run         print how many brands and calls, call nothing
 *
 * Order on a deploy (the PR that brought 00536 has the runbook): 00536,
 * this, 00537, this with --last-days 3, then vacuum analyze the tables.
 *
 * Safe to stop and run again. Each call makes its days match the sources
 * and takes the brand's refresh locks; a run without --brand skips the
 * brands already ready. On a failure it prints the --from-brand and
 * --from-day to resume with, and exits 1.
 */

import 'dotenv/config';
import { parseArgs } from 'node:util';
import supabaseAdmin from '../config/supabase.js';
import {
  backfillFastRollups,
  FAST_ROLLUPS_CHUNK_DAYS,
  FAST_ROLLUPS_PAUSE_MS,
} from '../lib/fast-rollups-backfill.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function count(value, name, fallback, min) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be a whole number >= ${min}`);
  return n;
}

function options() {
  const { values } = parseArgs({
    options: {
      'chunk-days': { type: 'string' },
      'pause-ms': { type: 'string' },
      brand: { type: 'string' },
      'from-brand': { type: 'string' },
      'from-day': { type: 'string' },
      'last-days': { type: 'string' },
      'dry-run': { type: 'boolean' },
    },
  });
  for (const name of ['brand', 'from-brand']) {
    if (values[name] !== undefined && !UUID.test(values[name])) {
      throw new Error(`--${name} must be a brand id (lower-case uuid)`);
    }
  }
  if (values['from-day'] !== undefined) {
    if (!DAY.test(values['from-day'])) throw new Error('--from-day must be YYYY-MM-DD');
    if (!values['from-brand'] && !values.brand) {
      throw new Error('--from-day needs --from-brand or --brand');
    }
  }
  return {
    chunkDays: count(values['chunk-days'], '--chunk-days', FAST_ROLLUPS_CHUNK_DAYS, 1),
    pauseMs: count(values['pause-ms'], '--pause-ms', FAST_ROLLUPS_PAUSE_MS, 0),
    brand: values.brand ?? null,
    fromBrand: values['from-brand'] ?? null,
    fromDay: values['from-day'] ?? null,
    lastDays:
      values['last-days'] === undefined ? null : count(values['last-days'], '--last-days', 0, 1),
    dryRun: values['dry-run'] ?? false,
  };
}

async function main() {
  const done = await backfillFastRollups({
    ...options(),
    rpc: (fn, args) => supabaseAdmin.rpc(fn, args),
  });
  console.log(
    `Done: ${done.brands} brand(s), ${done.chunks} call(s) in ${Math.round(done.ms / 1000)} s, ` +
      `slowest ${done.slowestMs} ms.`,
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
