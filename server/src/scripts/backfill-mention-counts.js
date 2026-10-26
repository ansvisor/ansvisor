/**
 * Recount brand and competitor mentions on historical prompt_results: re-runs
 * parseResponse over the stored answer text and rewrites what it derives
 * (mention-recount.js).
 *
 * Run: `node src/scripts/backfill-mention-counts.js [--entity-markup] [--brand <id>] [--dry-run]`
 *
 * Two fixes, two scopes:
 *   - by default (#871): names starting or ending with a character outside
 *     ASCII [A-Za-z0-9_] ("Ümit", "İpek", "Acme, Inc.", "星云科技") were never
 *     matched, so their answers were stored with zero mentions. Brands of
 *     active or trialing organizations whose own name or any competitor name
 *     is such a name; every other brand's counts are unchanged by the fix.
 *   - `--entity-markup` (#1097): ChatGPT answers saved with its
 *     `<Entity … value="X" …/>` tags in the text. The tags' attributes counted
 *     as mentions and shifted positions. Every brand of an active or trialing
 *     organization, and only its answers that still hold a tag: the text is
 *     saved without the tags, as new answers are, and recounted. The text
 *     can't be put back from here: keep a copy first, e.g.
 *       create table prompt_results_entity_markup_backup as
 *         select id, response, sentiment, mention_count, visibility_score,
 *                mention_position, mentioned_entity_count, competitor_mentions
 *         from prompt_results where response like '%<Entity%';
 * --brand narrows to one brand regardless. Rows are counted by today's parser
 * (mention-recount.js): the ones it rewrites pick up its other changes too.
 *
 * Idempotent: rows whose recomputed values equal the stored ones are skipped,
 * and a cleaned answer leaves the filter, so a stopped run is run again.
 * Afterwards, refresh each changed brand's rollups; the commands are printed
 * at the end.
 */
import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { IN_FILTER_CHUNK, selectInChunks } from '../lib/chunked-in.js';
import { addDays, dayChunks, resultDayBound } from '../lib/citations-rollups.js';
import { recountRow } from '../lib/mention-recount.js';

const BATCH_SIZE = 250;
const BATCH_PAUSE_MS = 250;
const CONCURRENCY = 20;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const entityMarkup = args.includes('--entity-markup');
const brandArg = args.includes('--brand') ? args[args.indexOf('--brand') + 1] : null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry transient network failures (connection resets on long walks). */
async function withRetry(fn, label) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 4) throw err;
      console.warn(`  retry ${attempt}/3 after error in ${label}: ${err.message}`);
      await sleep(attempt * 2000);
    }
  }
}

/** A name the old ASCII `\b` matcher could not match. */
const isAffectedName = (name) => Boolean(name) && !/^\w[\s\S]*\w$|^\w$/.test(name);

async function brandsInScope() {
  let query = supabaseAdmin.from('brands').select('id, name, organization_id');
  if (brandArg) {
    query = query.eq('id', brandArg);
  } else {
    const { data: orgs, error: orgErr } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .in('subscription_status', ['active', 'trialing']);
    if (orgErr) throw new Error(orgErr.message);
    query = query.in(
      'organization_id',
      (orgs ?? []).map((o) => o.id),
    );
  }
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

const ROW_COLUMNS =
  'id, response, citations, sentiment, mention_count, visibility_score, mention_position, mentioned_entity_count, competitor_mentions';

/** Recounts these rows and writes the ones that changed; returns [updated, skipped]. */
async function recountRows(rows, brandInfo, competitors) {
  let updated = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (row) => {
        const next = recountRow(row, brandInfo, competitors, { cleanMarkup: entityMarkup });
        if (!next) {
          skipped++;
          return;
        }
        if (!dryRun) {
          const { error: updateErr } = await withRetry(
            () => supabaseAdmin.from('prompt_results').update(next).eq('id', row.id),
            'row update',
          );
          if (updateErr) throw new Error(updateErr.message);
        }
        updated++;
      }),
    );
  }
  return [updated, skipped];
}

/** Tagged answers read per page: one UTC day of a brand's holds fewer. */
const ID_PAGE = 1000;

/**
 * The brand's answers that still hold a ChatGPT entity tag, by id, a UTC day
 * of answers at a time (the brand and date index; each answer's text read
 * once). Listed before any is cleaned: a cleaned answer leaves the filter,
 * which would shift offset pages taken during the writes.
 */
async function taggedRowIds(brandId) {
  const [first, last] = await withRetry(
    () => Promise.all([resultDayBound(brandId, true), resultDayBound(brandId, false)]),
    'answer days',
  );
  if (!first || !last) return [];
  const ids = [];
  for (const [day] of dayChunks(first, last, 1)) {
    for (let offset = 0; ; offset += ID_PAGE) {
      const { data, error } = await withRetry(
        () =>
          supabaseAdmin
            .from('prompt_results')
            .select('id')
            .eq('brand_id', brandId)
            .gte('created_at', `${day}T00:00:00Z`)
            .lt('created_at', `${addDays(day, 1)}T00:00:00Z`)
            .like('response', '%<Entity%')
            .order('id', { ascending: true })
            .range(offset, offset + ID_PAGE - 1),
        'tagged ids',
      );
      if (error) throw new Error(error.message);
      ids.push(...(data ?? []).map((r) => r.id));
      if (!data || data.length < ID_PAGE) break;
    }
  }
  return ids;
}

async function backfillTagged(brand) {
  const { brandInfo, competitors } = await brandContext(brand);
  const ids = await taggedRowIds(brand.id);
  let updated = 0;
  let skipped = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    // A URL of 100 ids at a time (chunked-in.js).
    const { data: rows, error } = await withRetry(
      () =>
        selectInChunks(
          ids.slice(i, i + BATCH_SIZE),
          (chunk) => supabaseAdmin.from('prompt_results').select(ROW_COLUMNS).in('id', chunk),
          IN_FILTER_CHUNK,
        ),
      'page fetch',
    );
    if (error) throw new Error(error.message);
    const [u, k] = await recountRows(rows ?? [], brandInfo, competitors);
    updated += u;
    skipped += k;
    console.log(
      `  ${brand.name}: ${updated} changed, ${skipped} unchanged of ${ids.length} tagged`,
    );
    await sleep(BATCH_PAUSE_MS);
  }
  return updated;
}

async function backfillBrand(brand) {
  if (entityMarkup) return backfillTagged(brand);
  const { brandInfo, competitors } = await brandContext(brand);
  let updated = 0;
  let skipped = 0;

  // Offset paging over a stable ordering: updates never change which rows
  // the filter selects, so pages stay consistent across the walk.
  for (let offset = 0; ; offset += BATCH_SIZE) {
    const { data: rows, error } = await withRetry(
      () =>
        supabaseAdmin
          .from('prompt_results')
          .select(ROW_COLUMNS)
          .eq('brand_id', brand.id)
          .not('response', 'is', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(offset, offset + BATCH_SIZE - 1),
      'page fetch',
    );
    if (error) throw new Error(error.message);
    if (!rows?.length) break;

    const [u, k] = await recountRows(rows, brandInfo, competitors);
    updated += u;
    skipped += k;

    console.log(`  ${brand.name}: ${updated} changed, ${skipped} unchanged`);
    if (rows.length < BATCH_SIZE) break;
    await sleep(BATCH_PAUSE_MS);
  }

  return updated;
}

const candidates = await brandsInScope();
const brands = [];
for (const brand of candidates) {
  if (brandArg || entityMarkup || isAffectedName(brand.name)) {
    brands.push(brand);
    continue;
  }
  const { data: comps } = await supabaseAdmin
    .from('competitors')
    .select('name')
    .eq('brand_id', brand.id);
  if ((comps ?? []).some((c) => isAffectedName(c.name))) brands.push(brand);
}

console.log(
  `Recounting mentions${entityMarkup ? ' in answers with entity tags' : ''} for ${brands.length} brand(s)${dryRun ? ' — DRY RUN' : ''}`,
);

const changed = [];
let total = 0;
for (const brand of brands) {
  const n = await backfillBrand(brand);
  total += n;
  if (n > 0) changed.push(brand);
}

console.log(`Done. ${total} row(s) ${dryRun ? 'would be ' : ''}updated.`);
if (changed.length && !dryRun) {
  // Each reads the counts: Insights' rollups; Mentions' with the answers'
  // terms (an entity's terms are kept only where it's mentioned), their
  // rollups and Perception's snapshots; Citations' (we_mention, comp_present).
  console.log('Refresh the rollups for the changed brands:');
  for (const brand of changed) {
    console.log(
      `  INSIGHTS_BACKFILL_BRAND=${brand.id} node src/scripts/backfill-insights-daily.js  # ${brand.name}`,
    );
    console.log(
      `  MENTIONS_BACKFILL_BRAND=${brand.id} node src/scripts/backfill-mentions-daily.js  # ${brand.name}`,
    );
    console.log(
      `  CITATIONS_BACKFILL_BRAND=${brand.id} node src/scripts/backfill-citations-daily.js  # ${brand.name}`,
    );
  }
}
process.exit(0);
