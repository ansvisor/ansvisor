import cron from 'node-cron';
import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';
import {
  perMillion,
  priceInEffect,
  setSyncedPrices,
  syncedRow,
  variesByTime,
} from './model-price-cache.js';

/**
 * The models' prices from OpenRouter's public catalog (CHAT-16 §A–B),
 * synced daily into chat_model_prices (00404), behind CHAT_AGENTIC.
 *
 * The catalog needs no key. A sync upserts every model it lists and removes
 * none: a failed or short read keeps the last good prices. A model Ansvisor
 * runs on some providers only (DeepSeek, LIMITED_HOSTS) is priced from its
 * endpoints at the dearest of them, not at the catalog's price. After a sync, and
 * when the server starts, the rows are loaded into model-price-cache.js, where
 * a Chat step's cost (improve-cost.js, for chat-budget.js only) and the
 * multipliers below read them.
 *
 * Multipliers (CHAT-16 §B): a model's blended cost is 3 × its input price +
 * its output price, at the price in effect; its multiplier is that over
 * Auto's, so Auto is 1x. Dollars stay on the server: what a browser is ever
 * sent is the multiplier's label.
 */

export const CATALOG_URL = 'https://openrouter.ai/api/v1/models';

/** One model's providers and their prices, for a model Ansvisor runs on some providers only. */
export const endpointsUrl = (modelId) => `${CATALOG_URL}/${modelId}/endpoints`;

/** Fewer models than this in a read means a broken one: nothing is written. */
const MIN_MODELS = 50;
/** More models than this is a broken read too (the catalog lists a few hundred). */
const MAX_MODELS = 5000;
/** The most of the catalog's answer read (it is a few MB); a longer one is refused. */
export const MAX_CATALOG_BYTES = 32 * 1024 * 1024;
/** Rows one read of chat_model_prices gets (PostgREST's default cap is 1000). */
const LOAD_PAGE = 1000;
/** Rows one upsert writes. */
const CHUNK = 200;
const FETCH_TIMEOUT_MS = 20_000;
/** A model's endpoints, a few at a time. */
const ENDPOINTS_TIMEOUT_MS = 10_000;
const ENDPOINTS_AT_ONCE = 3;
/** Older than this at start, and the server syncs at once instead of waiting for the schedule. */
const STALE_MS = 20 * 60 * 60 * 1000;

/**
 * Auto (CHAT-16 item 5): Claude Haiku 5.5 reads, Claude Sonnet 5.5 writes.
 * Its blended cost is theirs mixed by how a run's steps usually split, 60%
 * reading and 40% writing: the mix that gives every badge of the 2026-10-18
 * fixture (item 8; model-prices.test.js).
 */
export const AUTO_MIX = Object.freeze({
  'anthropic/claude-haiku-5.5': 0.6,
  'anthropic/claude-sonnet-5.5': 0.4,
});

/**
 * Model makers whose models Ansvisor runs on some of OpenRouter's providers
 * only (W4-34; owner decision 2026-11-02 evening): DeepSeek's on hosts in the
 * US or the EU, never DeepSeek's own API. The web routes each call by the
 * same list (web/src/lib/agent/openrouter.ts; web's models.test.ts keeps the
 * two equal). The catalog's price is its cheapest provider's, so such a
 * model is priced at the dearest of its hosts instead (W4-36): the AI budget
 * never counts less than a step costs.
 */
export const LIMITED_HOSTS = Object.freeze({
  deepseek: Object.freeze([
    'deepinfra',
    'together',
    'fireworks',
    'parasail',
    'crusoe',
    'azure',
    'nebius',
  ]),
});

/** The providers a model may run on, by OpenRouter's slug; null when any. */
export function hostsFor(modelId) {
  const maker = String(modelId ?? '')
    .split('/')[0]
    .toLowerCase();
  return Object.hasOwn(LIMITED_HOSTS, maker) ? LIMITED_HOSTS[maker] : null;
}

/** An endpoint's provider slug: its tag's first part ("deepinfra/fp8"), else its name's. */
function hostOf(endpoint) {
  const named = endpoint?.tag || endpoint?.provider_name || '';
  return String(named).split('/')[0].toLowerCase().replace(/\s+/g, '');
}

/**
 * A model's price at the dearest of the hosts it may run on, from its
 * endpoints (OpenRouter's `/models/{id}/endpoints`): input, output and cache
 * read each at their highest; a cache-read price only when every host has
 * one (a host without one bills a cached token as input). Null when none of
 * the hosts lists it at a price.
 *
 * @param {object} endpoints  the endpoints answer
 * @param {readonly string[]} hosts
 */
export function hostsPrice(endpoints, hosts) {
  const list = Array.isArray(endpoints?.data?.endpoints) ? endpoints.data.endpoints : [];
  const prices = list
    .filter((endpoint) => hosts.includes(hostOf(endpoint)))
    .map((endpoint) => ({
      input: perMillion(endpoint.pricing?.prompt),
      output: perMillion(endpoint.pricing?.completion),
      cacheRead: perMillion(endpoint.pricing?.input_cache_read),
    }))
    .filter((price) => price.input !== null && price.output !== null);
  if (prices.length === 0) return null;
  const highest = (field) => Math.max(...prices.map((price) => price[field]));
  return {
    input_per_m: highest('input'),
    output_per_m: highest('output'),
    cache_read_per_m: prices.every((price) => price.cacheRead !== null)
      ? highest('cacheRead')
      : null,
  };
}

/**
 * Prices each row of a model Ansvisor runs on some providers only at the
 * dearest of them (hostsPrice), ENDPOINTS_AT_ONCE reads at a time. Its
 * overrides go: they are the catalog provider's (DeepSeek's own off-peak
 * prices, say). A row whose endpoints can't be read, or that none of its
 * hosts lists, is left with no price: the model menu doesn't offer it, and a
 * step on it is charged improve-cost.js's FALLBACK_PRICE, never the
 * catalog's cheaper one. The next day's sync tries again.
 *
 * @param {object[]} rows  rowOf's rows, changed in place
 * @returns {Promise<number>} the rows priced at their hosts
 */
export async function priceAtHosts(rows, { fetcher = fetch } = {}) {
  const limited = rows.filter((row) => hostsFor(row.model_id));
  let next = 0;
  let priced = 0;
  const read = async () => {
    while (next < limited.length) {
      const row = limited[next++];
      let price = null;
      try {
        const res = await fetcher(endpointsUrl(row.model_id), {
          signal: AbortSignal.timeout(ENDPOINTS_TIMEOUT_MS),
        });
        if (res.ok) price = hostsPrice(await res.json(), hostsFor(row.model_id));
      } catch (err) {
        logger.warn({ model: row.model_id, err: err.message }, '[model-prices] endpoints unread');
      }
      if (price) priced += 1;
      else logger.warn({ model: row.model_id }, '[model-prices] no price at its hosts; unpriced');
      Object.assign(
        row,
        price ?? { input_per_m: null, output_per_m: null, cache_read_per_m: null },
        { overrides: [] },
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(ENDPOINTS_AT_ONCE, limited.length) }, read));
  return priced;
}

/**
 * One catalog model as a chat_model_prices row; null for one without an id.
 *
 * @param {object} model  an entry of the catalog's `data`
 * @param {string} syncedAt
 */
export function rowOf(model, syncedAt) {
  const id = typeof model?.id === 'string' ? model.id.trim() : '';
  if (!id || id.length > 200) return null;
  const pricing = model.pricing ?? {};
  const arch = model.architecture ?? {};
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  return {
    model_id: id,
    name: typeof model.name === 'string' ? model.name : '',
    provider: id.includes('/') ? id.split('/')[0] : '',
    input_modalities: list(arch.input_modalities),
    output_modalities: list(arch.output_modalities),
    input_per_m: perMillion(pricing.prompt),
    output_per_m: perMillion(pricing.completion),
    cache_read_per_m: perMillion(pricing.input_cache_read),
    image_output_per_m: perMillion(pricing.image_output),
    overrides: Array.isArray(pricing.overrides)
      ? pricing.overrides.filter((o) => o && typeof o === 'object')
      : [],
    is_batch: id.endsWith(':batch'),
    // What the model takes ("tools", "reasoning"…) and its window (00462):
    // the model menu offers only a model that can call tools.
    supported_parameters: list(model.supported_parameters).slice(0, 64),
    context_length: contextLengthOf(model.context_length),
    synced_at: syncedAt,
  };
}

/** The catalog's context_length as a whole number of tokens; null when it gives none. */
function contextLengthOf(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
}

/** The catalog's response as rows, the ones without an id left out. */
export function rowsOf(catalog, syncedAt) {
  const data = Array.isArray(catalog?.data) ? catalog.data : [];
  return data.map((m) => rowOf(m, syncedAt)).filter(Boolean);
}

/**
 * The catalog's answer as JSON, read up to MAX_CATALOG_BYTES: a longer one
 * (by its Content-Length, or as it streams) throws before it is all in memory.
 *
 * @param {Response} res
 * @param {number} [maxBytes]
 */
export async function readCatalog(res, maxBytes = MAX_CATALOG_BYTES) {
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('catalog too large');
  if (!res.body?.getReader) throw new Error('catalog unreadable');
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('catalog too large');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Reads the catalog and upserts every model it lists, then loads the rows
 * into the process. A read that fails, or lists fewer than MIN_MODELS, writes
 * nothing: the last good prices stay (CHAT-16 item 4).
 *
 * @returns {Promise<{ ok: boolean, models: number, syncedAt?: string, error?: string }>}
 */
export async function syncModelPrices({
  fetcher = fetch,
  db = supabaseAdmin,
  now = new Date(),
} = {}) {
  let catalog;
  try {
    const res = await fetcher(CATALOG_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`catalog answered ${res.status}`);
    catalog = await readCatalog(res);
  } catch (err) {
    logger.warn({ err: err.message }, '[model-prices] catalog unread; last prices kept');
    return { ok: false, models: 0, error: err.message };
  }
  const syncedAt = now.toISOString();
  const rows = rowsOf(catalog, syncedAt);
  if (rows.length < MIN_MODELS) {
    logger.warn({ models: rows.length }, '[model-prices] catalog too short; last prices kept');
    return { ok: false, models: rows.length, error: 'too_few_models' };
  }
  if (rows.length > MAX_MODELS) {
    logger.warn({ models: rows.length }, '[model-prices] catalog too long; last prices kept');
    return { ok: false, models: rows.length, error: 'too_many_models' };
  }
  await priceAtHosts(rows, { fetcher });
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db
      .from('chat_model_prices')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'model_id' });
    if (error) {
      logger.error({ err: error.message }, '[model-prices] upsert failed');
      return { ok: false, models: i, error: error.message };
    }
  }
  await loadModelPrices({ db });
  logger.info({ models: rows.length }, '[model-prices] synced');
  return { ok: true, models: rows.length, syncedAt };
}

/**
 * Loads every synced row into the process, LOAD_PAGE rows a read, and says
 * when the last sync was (the newest synced_at); null with none. A failed
 * read keeps what the process holds.
 */
export async function loadModelPrices({ db = supabaseAdmin } = {}) {
  const data = [];
  for (let from = 0; from < MAX_MODELS * 2; from += LOAD_PAGE) {
    const { data: page, error } = await db
      .from('chat_model_prices')
      .select('*')
      .order('model_id')
      .range(from, from + LOAD_PAGE - 1);
    if (error) {
      logger.warn({ err: error.message }, '[model-prices] rows unread');
      return null;
    }
    data.push(...(page ?? []));
    if (!page || page.length < LOAD_PAGE) break;
  }
  setSyncedPrices(data);
  const newest = data.reduce((max, r) => (r.synced_at > max ? r.synced_at : max), '');
  return newest || null;
}

/**
 * Started with the server while CHAT_AGENTIC is on: schedules the daily sync
 * at MODEL_PRICES_SCHEDULE (05:17 UTC by default), then loads the rows and
 * syncs at once when the last sync is older than a day (or there is none).
 * Scheduled first, so a failed first sync still leaves the daily one.
 */
export async function startModelPriceSync({
  schedule = process.env.MODEL_PRICES_SCHEDULE,
  db = supabaseAdmin,
  fetcher = fetch,
} = {}) {
  const at = schedule || '17 5 * * *';
  cron.schedule(at, () => {
    syncModelPrices({ db, fetcher }).catch((err) =>
      logger.error({ err }, '[model-prices] sync crashed'),
    );
  });
  logger.info({ schedule: at }, '[model-prices] daily sync scheduled');
  const last = await loadModelPrices({ db });
  if (!last || Date.now() - Date.parse(last) > STALE_MS) await syncModelPrices({ db, fetcher });
}

/** A model's blended cost at the price in effect (CHAT-16 item 6); null without a price. */
export function blendedCost(modelId, now = new Date()) {
  const price = priceInEffect(syncedRow(modelId), { now });
  return price ? 3 * price.input + price.output : null;
}

/** Auto's blended cost: its models' mixed by AUTO_MIX; null while one isn't synced. */
export function autoBlendedCost(now = new Date()) {
  let total = 0;
  for (const [id, share] of Object.entries(AUTO_MIX)) {
    const cost = blendedCost(id, now);
    if (cost === null) return null;
    total += share * cost;
  }
  return total;
}

/** A model's multiplier against Auto (Auto = 1x); null when either isn't priced. */
export function multiplierFor(modelId, now = new Date()) {
  const auto = autoBlendedCost(now);
  const cost = blendedCost(modelId, now);
  if (!auto || cost === null) return null;
  return cost / auto;
}

/** A multiplier as the menu shows it (CHAT-16 item 7): "1x", "2.3x", "<0.1x". */
export function multiplierLabel(multiplier) {
  if (multiplier < 0.1) return '<0.1x';
  return `${Number(multiplier.toFixed(1))}x`;
}

/**
 * What a model shows in a menu, and nothing that costs: its id, name, the
 * multiplier's label and whether its price moves by the hour. No price
 * leaves the server (CHAT-04).
 */
export function menuEntry(modelId, now = new Date()) {
  const row = syncedRow(modelId);
  const multiplier = multiplierFor(modelId, now);
  if (!row || multiplier === null) return null;
  return {
    id: row.model_id,
    name: row.name,
    multiplier: multiplierLabel(multiplier),
    variesByHour: variesByTime(row),
  };
}
