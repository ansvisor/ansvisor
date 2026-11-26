/**
 * Anakin (anakin.io) as an answer provider: anakin-scraper.js behind the
 * shape every provider has (answer-providers/index.js). Chosen with
 * PLATFORM_PROVIDER=anakin and keyed by ANAKIN_API_KEY.
 */
import {
  isLegacyChatgptTask,
  parseScraperResponse,
  pollScraperResult,
  submitPromptTask,
  submitScraperTask,
  GEMINI_COUNTRIES,
  UNAVAILABLE_PLATFORMS,
} from '../anakin-scraper.js';
import { CLORO_COUNTRY_MODELS } from '../cloro-countries.js';

export const name = 'anakin';

export {
  isLegacyChatgptTask,
  parseScraperResponse,
  pollScraperResult,
  submitPromptTask,
  submitScraperTask,
};

/** The platforms Anakin can't deliver today: runs skip them. */
export function unavailablePlatforms() {
  return UNAVAILABLE_PLATFORMS;
}

/**
 * The countries each platform answers from on Anakin, keyed as Cloro's
 * lists are (CLORO_COUNTRY_MODELS): Gemini's, which falls back to the US
 * outside its list (GEMINI_COUNTRIES; `UK` read as `GB`, as some brands
 * store it). The other platforms have no list, so no country is skipped for
 * them (supportsCountry reads a missing list as "nothing to check against").
 */
export async function supportedCountries() {
  return new Map([[CLORO_COUNTRY_MODELS['gemini-web'], new Set([...GEMINI_COUNTRIES, 'UK'])]]);
}

/**
 * Where Anakin posts finished jobs (routes/anakin-callback.js, mounted at
 * /anakin/callback). Only with ANAKIN_WEBHOOK_SECRET too, since the route
 * accepts signed deliveries only; otherwise null, and each task is polled.
 */
export function webhookUrl(env = process.env) {
  if (!env.ANAKIN_WEBHOOK_URL || !env.ANAKIN_WEBHOOK_SECRET) return null;
  return env.ANAKIN_WEBHOOK_URL;
}
