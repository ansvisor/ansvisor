import supabaseAdmin from '../config/supabase.js';
import { CLORO_API } from './cloro-scraper.js';
import { logger } from './logger.js';
import { readAllRpcRows } from './rpc-pages.js';
import { locationsForScraper, parseLocation } from './locations.js';

/**
 * The countries each tracking engine answers from (PROMPT-015e, 00364).
 *
 * The provider supports a different set of countries per engine, and asking
 * an engine in a country it doesn't support fails. Its GET /v1/countries is
 * the only source of truth, so the daily run reads every engine's list
 * before tracking (refreshCloroCountries) and keeps it in `cloro_countries`:
 * the location picker offers only countries some engine answers from, and
 * the tracking run skips an engine in a country it doesn't support
 * (supportsCountry). A list that can't be read keeps the last one; with no
 * list at all (no provider key, or before the first read) nothing is
 * restricted.
 */

/** The provider's `model` for each scraper. The API models (OpenAI, Claude) aren't the provider's. */
export const CLORO_COUNTRY_MODELS = {
  'chatgpt-web': 'chatgpt',
  'chatgpt-shopping': 'chatgpt',
  'perplexity-web': 'perplexity',
  'copilot-web': 'copilot',
  'gemini-web': 'gemini',
  'google-aimode': 'aimode',
  // AI Overview is asked through Google Search; its own list says where one shows.
  'google-aio': 'aioverview',
};

const MODELS = [...new Set(Object.values(CLORO_COUNTRY_MODELS))];

/** One engine's list read takes this long at most: a slow provider can't hold the daily run. */
const READ_MS = 15_000;

/**
 * One engine's countries, as ISO codes; null when there's no key, the read
 * failed, or the answer isn't a list of codes (an empty list included, so
 * a bad answer never empties the table).
 */
export async function fetchCloroCountries(
  model,
  { fetchImpl = fetch, apiKey = process.env.CLORO_API_KEY } = {},
) {
  if (!apiKey) return null;
  const res = await fetchImpl(`${CLORO_API}/v1/countries?model=${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(READ_MS),
  });
  if (!res.ok) throw new Error(`countries ${model}: HTTP ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) return null;
  const codes = [
    ...new Set(
      body
        .filter((c) => typeof c === 'string')
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c)),
    ),
  ];
  return codes.length ? codes : null;
}

/**
 * Reads every engine's list and writes it: the codes it lists, and the ones
 * it no longer lists removed. An engine whose read fails keeps its last
 * list. Returns, per engine, how many countries it answers from, or why not.
 */
export async function refreshCloroCountries({
  db = supabaseAdmin,
  fetchImpl,
  apiKey = process.env.CLORO_API_KEY,
  now = new Date(),
} = {}) {
  if (!apiKey) return { skipped: 'no provider key' };
  const at = now.toISOString();
  const outcome = {};
  await Promise.all(
    MODELS.map(async (model) => {
      let codes;
      try {
        codes = await fetchCloroCountries(model, { fetchImpl, apiKey });
      } catch (err) {
        logger.warn({ err: { message: err?.message }, model }, '[cloro-countries] read failed');
        outcome[model] = 'kept';
        return;
      }
      if (!codes) {
        outcome[model] = 'kept';
        return;
      }
      const { error } = await db.from('cloro_countries').upsert(
        codes.map((country) => ({ model, country, refreshed_at: at })),
        { onConflict: 'model,country' },
      );
      if (error) {
        logger.error({ err: error, model }, '[cloro-countries] write failed');
        outcome[model] = 'kept';
        return;
      }
      // What it no longer lists wasn't stamped by this read.
      const { error: dropError } = await db
        .from('cloro_countries')
        .delete()
        .eq('model', model)
        .lt('refreshed_at', at);
      if (dropError) logger.error({ err: dropError, model }, '[cloro-countries] prune failed');
      outcome[model] = codes.length;
    }),
  );
  logger.info({ outcome }, '[cloro-countries] refreshed');
  return outcome;
}

/** The lists as kept: provider model → its countries. Empty when none were read. */
export async function loadSupportedCountries({ db = supabaseAdmin } = {}) {
  const { data, error } = await readAllRpcRows('cloro_countries', (from, to) =>
    db
      .from('cloro_countries')
      .select('model, country')
      .order('model')
      .order('country')
      .range(from, to),
  );
  if (error) throw new Error(`cloro_countries read: ${error.message}`);
  const supported = new Map();
  for (const { model, country } of data ?? []) {
    if (!supported.has(model)) supported.set(model, new Set());
    supported.get(model).add(country);
  }
  return supported;
}

/**
 * Whether a scraper can be asked from a country. True when there's nothing
 * to check against: no country (an untargeted run), a scraper the provider
 * doesn't list, or no list read for it.
 */
export function supportsCountry(supported, scraperId, country) {
  const model = CLORO_COUNTRY_MODELS[scraperId];
  if (!country || !model) return true;
  const countries = supported.get(model);
  return !countries?.size || countries.has(country);
}

/**
 * The locations a scraper is asked from: locationsForScraper's (cities only
 * for Google's engines, states collapsed where they can't be targeted),
 * less the countries the scraper doesn't answer from.
 */
export function supportedLocations(locations, scraperId, supported) {
  return locationsForScraper(locations, scraperId).filter((code) =>
    supportsCountry(supported, scraperId, parseLocation(code).country),
  );
}
