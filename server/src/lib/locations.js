/**
 * Tracking locations (#691).
 *
 * A prompt's `regions` column holds location codes, not plain countries: a
 * bare ISO country (`DE`) or an ISO 3166-2 US state (`US-CA`). One code is
 * one tracked location — one set of scraper and model calls, one plan-quota
 * unit, one `prompt_results.region` value.
 *
 * Parsing lives here so exactly one definition decides what a code means.
 * The web tier keeps a deliberately identical copy in `web/src/lib/region.ts`
 * (same rule as the citation hostname split): both sides must agree on which
 * codes are valid, or the app would offer targeting the worker cannot run.
 */

/**
 * USPS code → full state name, for the AI providers' `user_location.region`,
 * which takes a human-readable region rather than a code.
 */
export const US_STATE_NAMES = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia',
};

/**
 * Scrapers with no sub-country targeting mechanism. Google AIO / AI Mode
 * locate through location/uule parameters Cloro's AI endpoints don't accept,
 * so a state code means nothing to them: they can only be run country-wide
 * (#691, carried over from #554).
 */
const COUNTRY_ONLY_SCRAPERS = new Set(['google-aio', 'google-aimode']);

/**
 * Split a location code into what the providers actually take.
 * `US-CA` → `{ country: 'US', state: 'CA' }`; `DE` → `{ country: 'DE',
 * state: null }`. Unparsable or empty input yields a null country, which the
 * callers treat as "no targeting" — the same as a prompt with no regions.
 */
export function parseLocation(code) {
  if (typeof code !== 'string') return { country: null, state: null };
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return { country: null, state: null };

  const [country, state] = trimmed.split('-');
  if (!/^[A-Z]{2}$/.test(country || '')) return { country: null, state: null };
  if (state === undefined) return { country, state: null };
  // Sub-country targeting exists for US states only; anything else is
  // treated as the bare country rather than silently sent as a bad code.
  if (country === 'US' && US_STATE_NAMES[state]) return { country, state };
  return { country, state: null };
}

/**
 * The locations one scraper should actually be run for.
 *
 * Every code a state-capable engine can use survives as-is. For the
 * country-only engines the list collapses to its distinct countries, so a
 * prompt targeting California and Texas submits ONE country-wide Google task
 * instead of two identical ones — which would have doubled the spend and
 * written two rows differing only in a state label neither run honoured.
 *
 * Order is preserved so task submission stays deterministic.
 */
export function locationsForScraper(locations, scraperId) {
  const list = Array.isArray(locations) && locations.length > 0 ? locations : [null];
  if (!COUNTRY_ONLY_SCRAPERS.has(scraperId)) return list;

  const seen = new Set();
  const collapsed = [];
  for (const code of list) {
    const { country } = parseLocation(code);
    const key = country ?? '';
    if (seen.has(key)) continue;
    seen.add(key);
    collapsed.push(country);
  }
  return collapsed;
}

/**
 * `user_location` for the API models' web-search tool, or null when the
 * prompt is untargeted. `region` carries the full state name because that is
 * what both providers document for the field — a USPS code is not a region
 * name. Country-only locations produce exactly the payload they did before
 * states existed, so untargeted and country-targeted runs are unchanged.
 */
export function userLocationFor(code) {
  const { country, state } = parseLocation(code);
  if (!country) return null;
  const location = { type: 'approximate', country };
  if (state) location.region = US_STATE_NAMES[state];
  return location;
}
