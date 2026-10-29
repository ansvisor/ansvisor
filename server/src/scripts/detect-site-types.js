/**
 * Detects the kind of site for brands that have none yet (action plan by
 * business type, Step 0; 00379), as setup now does for a new brand: from
 * the brand's own home page, and one small model call only when the page
 * doesn't settle it. A type a person chose is never touched; neither is a
 * brand with a catalog, which 00379 already made a shop.
 *
 * Run from server/:
 *   node src/scripts/detect-site-types.js [--limit 50] [--dry-run]
 *
 *   --limit    brands read this run (50; 500 at most), oldest first
 *   --dry-run  detect and print, write nothing
 *
 * Prints counts only: how many brands came out as each type, and how many
 * by their page or by the model. Re-running picks up where it stopped: a
 * brand already tried, placed or not, isn't read again.
 */
import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { applySiteTypeDetection } from '../lib/site-type-detect.js';

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const limit = Number(option('--limit') ?? 50);
if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
  console.error('--limit takes a whole number from 1 to 500.');
  process.exit(1);
}
const dryRun = args.includes('--dry-run');

const { data: brands, error } = await supabaseAdmin
  .from('brands')
  .select('id')
  .is('site_type', null)
  // Never tried: a brand a run couldn't place isn't read again.
  .is('site_type_detected_at', null)
  .order('created_at', { ascending: true })
  .limit(limit);
if (error) {
  console.error(`Couldn't read the brands: ${error.message}`);
  process.exit(1);
}

const counts = { b2b: 0, ecommerce: 0, b2c: 0, none: 0, failed: 0, page: 0, ai: 0 };
for (const { id } of brands ?? []) {
  try {
    const { detected } = await applySiteTypeDetection(id, { write: !dryRun });
    if (!detected) counts.none += 1;
    else {
      counts[detected.siteType] += 1;
      counts[detected.via] += 1;
    }
  } catch {
    counts.failed += 1;
  }
}

console.log(
  `${dryRun ? 'Dry run: ' : ''}${brands?.length ?? 0} brands read. ` +
    `b2b ${counts.b2b}, ecommerce ${counts.ecommerce}, b2c ${counts.b2c}, ` +
    `not told ${counts.none}, failed ${counts.failed}. By page ${counts.page}, by model ${counts.ai}.`,
);
