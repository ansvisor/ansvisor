/**
 * Correct each brand's region and model counts (brand_filter_values, 00544)
 * for the answers it had before 00544, and list it ready once every month
 * is in, so insights_filter_options reads its counts instead of scanning its
 * answers. Until then a brand reads as before; the triggers keep every
 * brand's counts current meanwhile. A brand added after 00544 is ready from
 * the start.
 *
 * Run (from server/):
 *   node src/scripts/backfill-filter-values.js [options]
 *
 * Options:
 *   --chunk-months N  months per backfill_brand_filter_values call (default
 *                     1, at most 24); each call should take well under a
 *                     second (the largest brand's month is ~110k answers)
 *   --pause-ms N      wait after each call (default 250)
 *   --brand ID        this brand only
 *   --dry-run         print how many brands, call nothing
 *
 * Order on a deploy (the PR that brought 00544 has the runbook): 00544,
 * then this. No index to build after it.
 *
 * Safe to stop and run again: the database keeps each brand's next month,
 * so a brand goes on from where it stopped, and a ready brand is skipped. A
 * call that fails changes nothing; the script prints it and exits 1.
 */

import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { backfillFilterValues, filterValuesOptions } from '../lib/filter-values-backfill.js';

async function main() {
  const done = await backfillFilterValues({
    ...filterValuesOptions(),
    rpc: (fn, args) => supabaseAdmin.rpc(fn, args),
  });
  console.log(
    `Done: ${done.ready} of ${done.brands} brand(s) ready, ${done.calls} call(s) in ` +
      `${Math.round(done.ms / 1000)} s, slowest ${done.slowestMs} ms.`,
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
