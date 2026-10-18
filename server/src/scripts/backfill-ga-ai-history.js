/**
 * Re-read every mapped brand's Google Analytics AI traffic as far back as
 * storage keeps (AT-004), so the AI Traffic page can fill the days before the
 * tracking snippet was installed from it (spec §5.2).
 *
 * Run: `node src/scripts/backfill-ga-ai-history.js`
 *
 * Options via env:
 *   - GA_HISTORY_BRAND   limit the run to one brand id
 *
 * A brand mapped from now on gets this history on its first sync. Brands
 * synced before have 90 days, counted with the old source list; this run
 * reads the rest and re-counts every row with the current list (version
 * stamped on each row). Idempotent: rows are upserted on (brand, date,
 * source, entry URL), so it can be run again. It also refreshes the usual
 * last few days of page totals and products, as the daily sync does.
 */

import 'dotenv/config';
import { runGaSync } from '../lib/ga-sync.js';

const ONLY_BRAND = process.env.GA_HISTORY_BRAND || undefined;

async function main() {
  const { synced, skipped, results } = await runGaSync({ brandId: ONLY_BRAND, aiHistory: true });
  for (const result of results) {
    console.log(
      result.error
        ? `FAILED ${result.brandId}: ${result.error}`
        : `${result.brandId} — ${result.aiRows} AI traffic row(s)`,
    );
  }
  console.log(`Backfill complete: ${synced} brand(s), ${skipped} failure(s).`);
  if (skipped > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
