/**
 * Recount brand and competitor mentions on historical prompt_results (#871).
 *
 * Names starting or ending with a character outside ASCII [A-Za-z0-9_]
 * ("Ümit", "İpek", "Acme, Inc.", "星云科技") were never matched, so
 * their answers were stored with zero mentions. This re-runs parseResponse
 * over the stored answer text and rewrites what it derives:
 *
 *   - mention_count, visibility_score, mention_position, mentioned_entity_count
 *   - mention_count, visibility_score and mention_position of each existing
 *     competitor_mentions entry whose competitor still exists
 *
 * Sentiment is not re-analysed: an answer that now counts as mentioning the
 * brand keeps the 'neutral' it was stored with, because re-running the model
 * over thousands of answers is a separate decision.
 *
 * Run: `node src/scripts/backfill-mention-counts.js [--brand <id>] [--dry-run]`
 *
 * Scope: brands of active or trialing organizations whose own name or any
 * competitor name starts or ends outside [A-Za-z0-9_] — every other brand's
 * counts are unchanged by the fix. --brand narrows to one brand regardless.
 *
 * Idempotent: rows whose recomputed values equal the stored ones are skipped.
 * Afterwards, refresh each changed brand's rollups with
 * `INSIGHTS_BACKFILL_BRAND=<id> node src/scripts/backfill-insights-daily.js`;
 * the ids are printed at the end.
 */
import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { parseResponse } from '../lib/response-parser.js';

const BATCH_SIZE = 250;
const BATCH_PAUSE_MS = 250;
const CONCURRENCY = 20;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
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

/** The row's new values, or null when nothing changes. */
function recount(row, brandInfo, competitors) {
  const metrics = parseResponse(
    { text: row.response ?? '', citations: Array.isArray(row.citations) ? row.citations : [] },
    brandInfo,
    row.sentiment ?? 'neutral',
    competitors,
  );
  const fresh = new Map(metrics.competitorMentions.map((m) => [m.competitor_id, m]));
  const entries = Array.isArray(row.competitor_mentions) ? row.competitor_mentions : [];
  const competitorMentions = entries.map((entry) => {
    const m = fresh.get(entry.competitor_id);
    if (!m) return entry;
    return {
      ...entry,
      mention_count: m.mention_count,
      visibility_score: m.visibility_score,
      mention_position: m.mention_position,
    };
  });

  const next = {
    mention_count: metrics.mentionCount,
    visibility_score: metrics.visibilityScore,
    mention_position: metrics.mentionPosition,
    mentioned_entity_count: metrics.mentionedEntityCount,
    competitor_mentions: competitorMentions,
  };
  const unchanged =
    next.mention_count === row.mention_count &&
    next.visibility_score === row.visibility_score &&
    next.mention_position === row.mention_position &&
    next.mentioned_entity_count === row.mentioned_entity_count &&
    JSON.stringify(competitorMentions) === JSON.stringify(entries);
  return unchanged ? null : next;
}

async function backfillBrand(brand) {
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
          .select(
            'id, response, citations, sentiment, mention_count, visibility_score, mention_position, mentioned_entity_count, competitor_mentions',
          )
          .eq('brand_id', brand.id)
          .not('response', 'is', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(offset, offset + BATCH_SIZE - 1),
      'page fetch',
    );
    if (error) throw new Error(error.message);
    if (!rows?.length) break;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (row) => {
          const next = recount(row, brandInfo, competitors);
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

    console.log(`  ${brand.name}: ${updated} changed, ${skipped} unchanged`);
    if (rows.length < BATCH_SIZE) break;
    await sleep(BATCH_PAUSE_MS);
  }

  return updated;
}

const candidates = await brandsInScope();
const brands = [];
for (const brand of candidates) {
  if (brandArg || isAffectedName(brand.name)) {
    brands.push(brand);
    continue;
  }
  const { data: comps } = await supabaseAdmin
    .from('competitors')
    .select('name')
    .eq('brand_id', brand.id);
  if ((comps ?? []).some((c) => isAffectedName(c.name))) brands.push(brand);
}

console.log(`Recounting mentions for ${brands.length} brand(s)${dryRun ? ' — DRY RUN' : ''}`);

const changed = [];
let total = 0;
for (const brand of brands) {
  const n = await backfillBrand(brand);
  total += n;
  if (n > 0) changed.push(brand);
}

console.log(`Done. ${total} row(s) ${dryRun ? 'would be ' : ''}updated.`);
if (changed.length && !dryRun) {
  console.log('Refresh the rollups for the changed brands:');
  for (const brand of changed) {
    console.log(
      `  INSIGHTS_BACKFILL_BRAND=${brand.id} node src/scripts/backfill-insights-daily.js  # ${brand.name}`,
    );
  }
}
process.exit(0);
