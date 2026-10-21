/**
 * Classify destinations on existing normalized shopping-card rows.
 *
 * Run after migration 00204:
 *   node src/scripts/backfill-shopping-card-merchants.js
 *
 * Pages across the normalized card table and uses the same pure classifier as
 * the live result handler. Cards without a merchant URL remain unclassified.
 */
import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { classifyMerchant } from '../lib/merchant-detection.js';

const BATCH_SIZE = Number.parseInt(process.env.SHOPPING_MERCHANT_BACKFILL_BATCH ?? '500', 10);
const UPDATE_CONCURRENCY = 20;

async function loadBrandDomains(brandId) {
  const { data, error } = await supabaseAdmin
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', brandId);
  if (error) throw new Error(`Failed to load domains for ${brandId}: ${error.message}`);
  return (data ?? []).map((row) => row.domain).filter(Boolean);
}

async function updateBatch(rows, domainCache) {
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  const withUrls = rows.filter(
    (row) => typeof row.merchant_url === 'string' && row.merchant_url.trim(),
  );
  skipped += rows.length - withUrls.length;

  for (let start = 0; start < withUrls.length; start += UPDATE_CONCURRENCY) {
    const slice = withUrls.slice(start, start + UPDATE_CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (row) => {
        let domains = domainCache.get(row.brand_id);
        if (!domains) {
          domains = await loadBrandDomains(row.brand_id);
          domainCache.set(row.brand_id, domains);
        }
        const destination = classifyMerchant(row.merchant_url, { brandDomains: domains });
        const { error } = await supabaseAdmin
          .from('prompt_result_shopping_cards')
          .update({
            merchant_kind: destination.kind,
            marketplace: destination.marketplace,
            listing_id: destination.listingId,
          })
          .eq('id', row.id);
        if (error) return { failed: true, error, id: row.id };
        return { updated: true };
      }),
    );

    for (const result of results) {
      if (result.failed) {
        failed += 1;
        console.error(`[backfill] Failed to classify ${result.id}: ${result.error.message}`);
      } else {
        updated += 1;
      }
    }
  }

  return { updated, skipped, failed };
}

async function main() {
  const domainCache = new Map();
  let offset = 0;
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  while (true) {
    const { data: rows, error } = await supabaseAdmin
      .from('prompt_result_shopping_cards')
      .select('id, brand_id, merchant_url')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) throw new Error(`Failed to read shopping cards: ${error.message}`);
    if (!rows?.length) break;

    const result = await updateBatch(rows, domainCache);
    scanned += rows.length;
    updated += result.updated;
    skipped += result.skipped;
    failed += result.failed;
    console.log(
      `[backfill] scanned=${scanned} updated=${updated} skipped(no URL)=${skipped} failed=${failed}`,
    );

    offset += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }

  console.log(`[backfill] complete: scanned=${scanned}, updated=${updated}, skipped=${skipped}, failed=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[backfill] Fatal:', error);
  process.exitCode = 1;
});
