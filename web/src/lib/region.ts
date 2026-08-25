import { REGIONS, US_STATES } from '@/config/prompt-options';

/**
 * Tracking locations (#691).
 *
 * A location code is either a bare ISO country (`DE`) or an ISO 3166-2 US
 * state (`US-CA`). One code is one tracked location: one set of scraper and
 * model calls, one plan-quota unit, one `prompt_results.region` value.
 *
 * `server/src/lib/locations.js` keeps a deliberately identical parse — both
 * sides must agree on which codes are valid, or the picker would offer
 * targeting the worker cannot run.
 */

const REGION_LABELS: ReadonlyMap<string, string> = new Map(
  REGIONS.map((region) => [region.code, region.label]),
);

const STATE_LABELS: ReadonlyMap<string, string> = new Map(
  US_STATES.map((state) => [state.code, state.label]),
);

function normalizeRegionCode(code: string): string {
  return code.trim().toUpperCase();
}

export interface ParsedLocation {
  country: string;
  /** USPS code when the location targets a US state, else null. */
  state: string | null;
}

/**
 * Split a location code into country and state, or null when it is neither a
 * country we track nor a US state. Sub-country targeting exists for US
 * states only — every other engine mechanism is country-wide.
 */
export function parseLocation(code: string): ParsedLocation | null {
  const normalized = normalizeRegionCode(code);
  const [country, state, ...rest] = normalized.split('-');
  if (rest.length > 0 || !REGION_LABELS.has(country)) return null;
  if (state === undefined) return { country, state: null };
  if (country !== 'US' || !STATE_LABELS.has(state)) return null;
  return { country, state };
}

/** True when a code names a location the product can actually track. */
export function isValidLocation(code: string): boolean {
  return parseLocation(code) !== null;
}

/** Build the code for a country, or for one of its states. */
export function locationCode(country: string, state?: string | null): string {
  const normalizedCountry = normalizeRegionCode(country);
  if (!state) return normalizedCountry;
  return `${normalizedCountry}-${normalizeRegionCode(state)}`;
}

/**
 * The location's own name: the state for a state code, the country
 * otherwise. States are shown without their country because the flag beside
 * them already carries it, and lists group them under a country heading.
 */
export function regionLabel(code: string): string {
  const parsed = parseLocation(code);
  if (!parsed) return code.trim();
  if (parsed.state) return STATE_LABELS.get(parsed.state) ?? parsed.state;
  return REGION_LABELS.get(parsed.country) ?? parsed.country;
}

export function regionFlag(code: string): string {
  const parsed = parseLocation(code);
  if (!parsed) return '';

  const [first, second] = parsed.country;
  return String.fromCodePoint(
    0x1f1e6 + first.charCodeAt(0) - 65,
    0x1f1e6 + second.charCodeAt(0) - 65,
  );
}

export function formatRegionDisplay(code: string): string {
  const label = regionLabel(code);
  const flag = regionFlag(code);
  return flag ? `${flag} ${label}` : label;
}
