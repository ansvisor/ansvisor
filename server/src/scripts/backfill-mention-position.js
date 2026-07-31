/**
 * Backfill mention_position / mentioned_entity_count on historical
 * prompt_results from the stored answer text (00038).
 *
 * Run: `node src/scripts/backfill-mention-position.js [--days N] [--brand <id>] [--dry-run]`
 *
 * Scope: brands of organizations whose subscription is active or trialing
 * (churned orgs' data never surfaces in any dashboard, so recomputing it is
 * wasted work). Narrow further with --brand, or --days to limit history.
 *
 * Idempotent: only rows with `mentioned_entity_count IS NULL` are touched —
 * that column is the "computed" marker (0 = computed, nothing found), so
 * re-running skips everything already processed. Batches are small and
 * paced so the shared database stays responsive.
 *
 * Positions are computed against the brand's CURRENT competitor roster —
 * competitors added or removed since a result was scraped shift historical
 * positions accordingly, same as every other read-time aggregation here.
 */
import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { computeMentionPosition } from '../lib/response-parser.js';

const BATCH_SIZE = 500;
const BATCH_PAUSE_MS = 250;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const daysArg = args.includes('--days') ? Number(args[args.indexOf('--days') + 1]) : null;
const brandArg = args.includes('--brand') ? args[args.indexOf('--brand') + 1] : null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function eligibleBrands() {
  const { data: orgs, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .in('subscription_status', ['active', 'trialing']);
  if (orgErr) throw new Error(orgErr.message);

  let query = supabaseAdmin
    .from('brands')
    .select('id, name, organization_id')
    .in(
      'organization_id',
      (orgs ?? []).map((o) => o.id),
    );
  if (brandArg) query = query.eq('id', brandArg);

  const { data: brands, error } = await query;
  if (error) throw new Error(error.message);
  return brands ?? [];
}

async function brandContext(brand) {
  const [{ data: domains }, { data: competitors }] = await Promise.all([
    supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', brand.id),
    supabaseAdmin.from('competitors').select('id, name, domain').eq('brand_id', brand.id),
  ]);
  return {
    brandInfo: { brandName: brand.name, domains: (domains ?? []).map((d) => d.domain) },
    competitors: competitors ?? [],
  };
}

async function backfillBrand(brand) {
  const { brandInfo, competitors } = await brandContext(brand);
  let updated = 0;

  for (;;) {
    let query = supabaseAdmin
      .from('prompt_results')
      .select('id, response')
      .eq('brand_id', brand.id)
      .is('mentioned_entity_count', null)
      .not('response', 'is', null)
      .order('created_at', { ascending: false })
      .limit(BATCH_SIZE);
    if (daysArg) {
      query = query.gte('created_at', new Date(Date.now() - daysArg * 86_400_000).toISOString());
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    if (!rows?.length) break;

    for (const row of rows) {
      const { mentionPosition, mentionedEntityCount } = computeMentionPosition(
        row.response ?? '',
        brandInfo,
        competitors,
      );
      if (!dryRun) {
        const { error: updateErr } = await supabaseAdmin
          .from('prompt_results')
          .update({
            mention_position: mentionPosition,
            mentioned_entity_count: mentionedEntityCount,
          })
          .eq('id', row.id);
        if (updateErr) throw new Error(updateErr.message);
      }
      updated++;
    }

    console.log(`  ${brand.name}: ${updated} rows${dryRun ? ' (dry run)' : ''}`);
    if (dryRun) break; // dry run would loop forever — nothing gets marked
    if (rows.length < BATCH_SIZE) break;
    await sleep(BATCH_PAUSE_MS);
  }

  return updated;
}

const brands = await eligibleBrands();
console.log(
  `Backfilling mention positions for ${brands.length} brand(s)` +
    `${daysArg ? `, last ${daysArg} day(s)` : ', full history'}${dryRun ? ' — DRY RUN' : ''}`,
);

let total = 0;
for (const brand of brands) {
  total += await backfillBrand(brand);
}
console.log(`Done. ${total} row(s) ${dryRun ? 'would be' : ''} updated.`);
process.exit(0);
