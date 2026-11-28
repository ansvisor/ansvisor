import supabaseAdmin from '../config/supabase.js';
import { resolveModel } from './ai-provider.js';
import { decide, isDeciderConfigured } from './decider.js';
import { classifyQueryIntents, normalizeIntentQuery } from './intent-extraction.js';
import { logger } from './logger.js';

/**
 * The search intent of fan-out sub-queries (#333), cached once per normalized
 * query in `fanout_query_intents`: brand-independent, so a query is
 * classified once and read everywhere after.
 *
 * With the decision model on (FANOUT_INTENTS_DECIDER and a configured
 * decider), sub-queries are classified as their answers are stored
 * (queueFanoutIntents, called by both result paths), 128 per request, so
 * Query Fan-out mostly reads the cache. Without it nothing is classified on
 * arrival: a chat-model call per query for every stored answer would cost
 * too much. The route behind the tab and the backfill script use
 * classifyAndCache for whatever is still missing.
 */

/** Cache reads per request: keeps each `.in('query', …)` URL short. */
export const LOOKUP_CHUNK = 40;

/** The normalized query texts of an answer's `search_queries`, each once. */
export function queryTexts(searchQueries) {
  if (!Array.isArray(searchQueries)) return [];
  const texts = searchQueries.map((entry) =>
    normalizeIntentQuery(typeof entry === 'string' ? entry : entry?.query),
  );
  return [...new Set(texts.filter(Boolean))];
}

/**
 * The cached intents of these normalized queries. Throws on a read error, so
 * a caller never classifies everything again because the cache was down.
 *
 * @param {string[]} queries
 * @param {{ db?: typeof supabaseAdmin }} [deps]
 * @returns {Promise<Record<string, string>>}
 */
export async function cachedIntents(queries, { db = supabaseAdmin } = {}) {
  const intents = {};
  for (let i = 0; i < queries.length; i += LOOKUP_CHUNK) {
    const { data, error } = await db
      .from('fanout_query_intents')
      .select('query, intent')
      .in('query', queries.slice(i, i + LOOKUP_CHUNK));
    if (error) throw error;
    for (const row of data ?? []) intents[row.query] = row.intent;
  }
  return intents;
}

/**
 * The intents of these normalized queries: the cached ones, and the misses
 * classified (a decision model in batches when configured, else the chat
 * model) and kept. A query that fails to classify stays out and is asked
 * again next time.
 *
 * @param {string[]} queries - normalized, each once
 * @param {{ db?: typeof supabaseAdmin, classify?: typeof classifyQueryIntents }} [deps]
 * @returns {Promise<{ intents: Record<string, string>, classified: number }>}
 */
export async function classifyAndCache(
  queries,
  { db = supabaseAdmin, classify = classifyQueryIntents } = {},
) {
  if (queries.length === 0) return { intents: {}, classified: 0 };
  const intents = await cachedIntents(queries, { db });
  const misses = queries.filter((q) => !(q in intents));
  if (misses.length === 0) return { intents, classified: 0 };
  const fresh = await classify(misses, {
    chatModel: () => resolveModel(),
    decideFn: decide,
    deciderConfigured: isDeciderConfigured,
  });
  const rows = Object.entries(fresh).map(([query, intent]) => ({ query, intent }));
  if (rows.length > 0) {
    Object.assign(intents, fresh);
    const { error } = await db
      .from('fanout_query_intents')
      .upsert(rows, { onConflict: 'query', ignoreDuplicates: true });
    if (error) throw error;
  }
  return { intents, classified: rows.length };
}

// ─── Classify as answers arrive ──────────────────────────────────────────────

/** Queries held before a flush: one decision-model batch. */
export const QUEUE_FLUSH_SIZE = 128;
/** How long a query waits for others before the batch goes anyway. */
export const QUEUE_FLUSH_MS = 30_000;
/** Most queries held at once; past it new ones are dropped (the tab still asks). */
const QUEUE_MAX = 5_000;

const queue = new Set();
let timer = null;
let flushing = null;

/**
 * True when sub-queries are classified on arrival: only with the decision
 * model (FANOUT_INTENTS_DECIDER and a configured decider), read on each call.
 */
export function classifiesOnArrival() {
  return Boolean(process.env.FANOUT_INTENTS_DECIDER) && isDeciderConfigured();
}

/**
 * Holds an answer's sub-queries to classify in the background: in batches of
 * QUEUE_FLUSH_SIZE, or after QUEUE_FLUSH_MS. Does nothing unless the
 * decision model is on (classifiesOnArrival). Never throws and never blocks
 * the caller: storing the answer matters, the intent can come later (the tab
 * classifies what's still missing).
 *
 * @param {unknown} searchQueries - the answer's `search_queries`
 */
export function queueFanoutIntents(searchQueries) {
  try {
    if (!classifiesOnArrival()) return;
    for (const query of queryTexts(searchQueries)) {
      if (queue.size >= QUEUE_MAX) break;
      queue.add(query);
    }
    if (queue.size === 0) return;
    if (queue.size >= QUEUE_FLUSH_SIZE) {
      void flushFanoutIntents();
    } else if (!timer) {
      timer = setTimeout(() => void flushFanoutIntents(), QUEUE_FLUSH_MS);
      timer.unref?.();
    }
  } catch (err) {
    logger.warn({ err }, '[fanout-intents] queue failed');
  }
}

/**
 * Classifies what the queue holds, one batch at a time. Logged, never thrown.
 *
 * @param {{ db?: typeof supabaseAdmin, classify?: typeof classifyQueryIntents }} [deps]
 */
export async function flushFanoutIntents(deps) {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (flushing) return flushing;
  // Cleared in a later tick (finally), so it never stays set after a drain
  // that had nothing to do.
  flushing = drain(deps).finally(() => {
    flushing = null;
  });
  return flushing;
}

async function drain(deps) {
  while (queue.size > 0) {
    const batch = [...queue].slice(0, QUEUE_FLUSH_SIZE);
    for (const query of batch) queue.delete(query);
    try {
      const { classified } = await classifyAndCache(batch, deps);
      if (classified > 0) logger.info({ classified }, '[fanout-intents] classified on arrival');
    } catch (err) {
      logger.warn({ err, queries: batch.length }, '[fanout-intents] batch failed');
    }
  }
}

/** For tests: what the queue holds. */
export function queuedFanoutIntents() {
  return [...queue];
}
