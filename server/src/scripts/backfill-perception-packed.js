/**
 * Pack Perception's summed terms (00540): mentions_terms_daily_all as one row
 * per brand, entity and day (mentions_terms_daily_packed), and list each
 * brand as packed-ready once its whole history is in, so its unfiltered live
 * Perception read sums the packed days instead of a million index entries at
 * 90 days. Until then a brand reads as before; the nightly refreshes keep
 * every brand's packed days current meanwhile. Only the brands in
 * fast_rollups_ready are walked (backfill-fast-rollups.js lists them: their
 * mentions_terms_daily_all holds their whole history), and no demo brand.
 *
 * Run (from server/):
 *   node src/scripts/backfill-perception-packed.js [options]
 *
 * Options:
 *   --chunk-days N    days per backfill_mention_terms_packed call (default
 *                     14); each call should take about a second
 *   --pause-ms N      wait after each call (default 250)
 *   --brand ID        this brand only, even if it is packed-ready
 *   --from-brand ID   resume: start at this brand (brands go by id)
 *   --from-day DAY    resume: that brand from this UTC day (YYYY-MM-DD) on;
 *                     needs --from-brand or --brand
 *   --last-days N     every brand's days from N days ago through today,
 *                     packed-ready or not, listing none ready: the
 *                     runbook's last step
 *   --dry-run         print how many brands and calls, call nothing
 *
 * Order on a deploy (the PR that brought 00540 has the runbook): 00540, the
 * 00536 runbook where it hasn't run, this, this with --last-days 3, then
 * vacuum analyze the packed table.
 *
 * Safe to stop and run again. Each call makes its days match
 * mentions_terms_daily_all and takes the brand's terms refresh lock; a run
 * without --brand skips the brands already packed-ready. On a failure it
 * prints the --from-brand and --from-day to resume with, and exits 1.
 */

import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import {
  backfillFastRollups,
  backfillOptions,
  PACKED_TERMS,
} from '../lib/fast-rollups-backfill.js';

async function main() {
  const done = await backfillFastRollups({
    ...backfillOptions(),
    rollups: PACKED_TERMS,
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
