/**
 * One-off signal backfill (Action Center).
 *
 * Runs the nightly signal recorder once for one brand or for every active
 * brand, so the Signals page has real rows before the next tracking cycle.
 * Safe to re-run: recording dedupes on (brand, dedup_key).
 *
 * Run: node src/scripts/backfill-signals.js [brandId|--all]
 */
import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { recordSignalsForBrand } from '../lib/signals/record.js';

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node src/scripts/backfill-signals.js <brandId|--all>');
  process.exit(1);
}

let brandIds;
if (arg === '--all') {
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('is_active', true)
    .limit(1000);
  if (error) throw new Error(error.message);
  brandIds = (data ?? []).map((b) => b.id);
} else {
  brandIds = [arg];
}

for (const brandId of brandIds) {
  try {
    const result = await recordSignalsForBrand(brandId);
    console.log(brandId, JSON.stringify(result));
  } catch (err) {
    console.error(brandId, 'FAILED:', err.message);
  }
}
process.exit(0);
