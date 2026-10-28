/**
 * The countries prompts can be tracked in, as the tracking engines answer
 * from them (PROMPT-015e): the API reads each engine's list from the
 * provider daily (cloro_countries, 00364); getTrackingCountries reads it.
 * Country names come from the browser's own region names, so any country
 * the provider adds reads right without a list here.
 */

/** The provider's engines, as the location picker names them. */
export const ENGINE_LABELS: Record<string, string> = {
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
  copilot: 'Copilot',
  gemini: 'Gemini',
  aimode: 'Google AI Mode',
  aioverview: 'Google AI Overview',
};

/** Engines that answer from a city, by the provider's model name (PROMPT-015d). */
export const CITY_MODELS: ReadonlySet<string> = new Set(['aimode', 'aioverview']);

export interface TrackingCountry {
  code: string;
  /** The provider's engines that answer from it. */
  models: string[];
}

// Two-letter codes that name a group, not a country, or nothing.
const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'ZZ', 'XA', 'XB']);

let names: Intl.DisplayNames | null = null;
function displayNames(): Intl.DisplayNames {
  names ??= new Intl.DisplayNames(['en'], { type: 'region' });
  return names;
}

/** True for an ISO 3166-1 country code the runtime knows (`PL`, `KE`), not a group (`EU`). */
export function isCountryCode(code: string): boolean {
  if (!/^[A-Z]{2}$/.test(code) || NOT_COUNTRIES.has(code)) return false;
  try {
    const name = displayNames().of(code);
    return Boolean(name) && name !== code;
  } catch {
    return false;
  }
}

/** A country's English name, from the runtime; the code when it has none. */
export function countryName(code: string): string {
  try {
    return displayNames().of(code) ?? code;
  } catch {
    return code;
  }
}

/** The engines a country isn't answered by, among those any country is. */
export function missingEngines(
  country: TrackingCountry,
  all: readonly TrackingCountry[],
): string[] {
  const engines = new Set(all.flatMap((c) => c.models));
  return [...engines].filter((m) => !country.models.includes(m)).sort();
}
