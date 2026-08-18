/**
 * Backfill prompt_result_citations from the raw prompt_results.citations jsonb.
 *
 * Run: `node src/scripts/backfill-citations.js`
 *
 * Options via env:
 *   - CITATIONS_BACKFILL_BATCH   answers pulled per batch (default 200)
 *   - CITATIONS_BACKFILL_DAYS    only answers newer than this many days
 *                                (default: no limit — the whole history)
 *   - CITATIONS_BACKFILL_PAUSE   milliseconds to wait between batches
 *                                (default 100)
 *
 * Idempotent and restartable. `persistCitationRows` upserts on
 * `(prompt_result_id, position)` with `ignoreDuplicates`, so re-running skips
 * what is already there, and the walk is keyset-based on `(created_at, id)`
 * rather than OFFSET — a run that is interrupted can simply be started again.
 *
 * Deliberately unhurried. There are ~2M citations to write across ~177k
 * answers on a database that is already 1.1 GB on a 2 GB instance, and this
 * runs against the same instance serving the dashboard. Small batches with a
 * pause between them keep it from evicting the cache that live queries depend
 * on; finishing in twenty minutes instead of five is a good trade.
 */

import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { persistCitationRows } from '../lib/citation-rows.js';

const BATCH = Number.parseInt(process.env.CITATIONS_BACKFILL_BATCH ?? '200', 10);
const PAUSE_MS = Number.parseInt(process.env.CITATIONS_BACKFILL_PAUSE ?? '100', 10);
const DAYS = process.env.CITATIONS_BACKFILL_DAYS
  ? Number.parseInt(process.env.CITATIONS_BACKFILL_DAYS, 10)
  : null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One page of answers, ordered by `(created_at, id)` so the cursor is total.
 *
 * Ordering on created_at alone would be ambiguous: a nightly run writes
 * thousands of answers inside the same second, and a cursor that cannot
 * separate them either repeats a page or skips one.
 */
async function fetchBatch(cursor) {
  let query = supabaseAdmin
    .from('prompt_results')
    .select('id, brand_id, created_at, citations')
    .not('citations', 'is', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(BATCH);

  if (DAYS !== null) {
    query = query.gte('created_at', new Date(Date.now() - DAYS * 86_400_000).toISOString());
  }
  if (cursor) {
    // `or` expresses the keyset condition: strictly later timestamp, or the
    // same timestamp and a later id.
    query = query.or(
      `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(`fetch batch: ${error.message}`);
  return data ?? [];
}

async function main() {
  const startedAt = Date.now();
  let cursor = null;
  let answers = 0;
  let citations = 0;
  let empty = 0;

  console.log(
    `Backfilling citations — batch ${BATCH}, pause ${PAUSE_MS}ms` +
      (DAYS !== null ? `, last ${DAYS} days` : ', full history'),
  );

  for (;;) {
    const batch = await fetchBatch(cursor);
    if (batch.length === 0) break;

    for (const row of batch) {
      const written = await persistCitationRows({
        promptResultId: row.id,
        brandId: row.brand_id,
        createdAt: row.created_at,
        citations: row.citations,
      });
      answers += 1;
      citations += written;
      if (written === 0) empty += 1;
    }

    const last = batch[batch.length - 1];
    cursor = { createdAt: last.created_at, id: last.id };

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `  ${answers} answers · ${citations} citations · ${empty} with none · ${elapsed}s · at ${last.created_at}`,
    );

    if (batch.length < BATCH) break;
    if (PAUSE_MS > 0) await sleep(PAUSE_MS);
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `\nDone. ${answers} answers scanned, ${citations} citation rows written, ` +
      `${empty} answers had none, ${elapsed}s.`,
  );
}

main().catch((err) => {
  // Exit non-zero so a wrapper can tell a crash from a clean finish. The walk
  // is restartable, so the fix is to run it again rather than to resume from
  // some recorded position.
  console.error('Backfill failed:', err);
  process.exit(1);
});
