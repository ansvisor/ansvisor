/**
 * Classify the intent of fan-out sub-queries stored before they were
 * classified on arrival, day by day, newest first, so Query Fan-out shows an
 * intent for them without waiting on the page.
 *
 * Run (from server/):
 *   node src/scripts/backfill-fanout-intents.js [options]
 *
 * Options:
 *   --days N        how many days back from --from (default 90, the tab's furthest range)
 *   --from DATE     resume: start on this day (YYYY-MM-DD, UTC), going back (default today)
 *   --pause-ms N    wait after each batch (default 500)
 *   --dry-run       count the queries still unclassified, classify nothing
 *
 * Cost: with the decision model (FANOUT_INTENTS_DECIDER and a configured
 * DECIDER_PROVIDER) it classifies 128 queries per request; without it, it
 * makes one chat-model call per query. Run --dry-run first to see how many
 * queries that is.
 *
 * Safe to stop and run again: a query already in fanout_query_intents is
 * never asked again, and a query that fails to classify is asked on the next
 * run. On a failure it prints the --from to resume with, and exits 1.
 */

import 'dotenv/config';
import { parseArgs } from 'node:util';
import supabaseAdmin from '../config/supabase.js';
import { cachedIntents, classifyAndCache, queryTexts } from '../lib/fanout-intent-cache.js';

const PAGE = 1000;
const BATCH = 128;
const DAY_MS = 24 * 60 * 60 * 1000;

function options() {
  const { values } = parseArgs({
    options: {
      days: { type: 'string' },
      from: { type: 'string' },
      'pause-ms': { type: 'string' },
      'dry-run': { type: 'boolean' },
    },
  });
  const days = values.days ? Number(values.days) : 90;
  const pauseMs = values['pause-ms'] ? Number(values['pause-ms']) : 500;
  const from = values.from ? new Date(`${values.from}T00:00:00Z`) : new Date();
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('--days: 1 to 365');
  if (!Number.isFinite(pauseMs) || pauseMs < 0) throw new Error('--pause-ms: 0 or more');
  if (Number.isNaN(from.getTime())) throw new Error('--from: YYYY-MM-DD');
  return { days, pauseMs, from, dryRun: !!values['dry-run'] };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dayOf = (date) => date.toISOString().slice(0, 10);

/** The day's distinct normalized sub-queries, read a page at a time. */
async function dayQueries(dayStart) {
  const queries = new Set();
  const end = new Date(dayStart.getTime() + DAY_MS).toISOString();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('prompt_results')
      .select('search_queries')
      .gte('created_at', dayStart.toISOString())
      .lt('created_at', end)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    for (const row of data ?? []) for (const q of queryTexts(row.search_queries)) queries.add(q);
    if ((data ?? []).length < PAGE) break;
  }
  return [...queries];
}

async function main() {
  const { days, pauseMs, from, dryRun } = options();
  const first = new Date(`${dayOf(from)}T00:00:00Z`);
  let total = 0;
  let classified = 0;
  for (let i = 0; i < days; i++) {
    const day = new Date(first.getTime() - i * DAY_MS);
    try {
      const queries = await dayQueries(day);
      const cached = await cachedIntents(queries);
      const missing = queries.filter((q) => !(q in cached));
      total += missing.length;
      if (!dryRun) {
        for (let j = 0; j < missing.length; j += BATCH) {
          const result = await classifyAndCache(missing.slice(j, j + BATCH));
          classified += result.classified;
          if (pauseMs) await sleep(pauseMs);
        }
      }
      console.log(
        `${dayOf(day)}: ${queries.length} queries, ${missing.length} unclassified${dryRun ? '' : ` (classified so far ${classified})`}`,
      );
    } catch (err) {
      console.error(`Failed on ${dayOf(day)}: ${err.message}`);
      console.error(`Resume with: --from ${dayOf(day)} --days ${days - i}`);
      process.exit(1);
    }
  }
  console.log(
    dryRun
      ? `Dry run: ${total} sub-queries still unclassified over ${days} days.`
      : `Done: ${classified} of ${total} classified; run again for any that failed.`,
  );
}

main();
