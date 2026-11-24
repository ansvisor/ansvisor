/**
 * Cloro (cloro.dev) as an answer provider: the scraper in cloro-scraper.js
 * behind the shape every provider has (answer-providers/index.js). Nothing
 * here changes how Cloro is called.
 */
import { loadSupportedCountries } from '../cloro-countries.js';
import {
  isLegacyChatgptTask,
  parseScraperResponse,
  pollScraperResult,
  submitPromptTask,
  submitScraperTask,
  UNAVAILABLE_PLATFORMS,
} from '../cloro-scraper.js';

export const name = 'cloro';

export {
  isLegacyChatgptTask,
  parseScraperResponse,
  pollScraperResult,
  submitPromptTask,
  submitScraperTask,
};

/** The platforms Cloro can't deliver today: runs skip them. */
export function unavailablePlatforms() {
  return UNAVAILABLE_PLATFORMS;
}

/**
 * The countries each platform answers from on Cloro (cloro_countries, read
 * daily from Cloro): a run skips a platform × country Cloro can't answer.
 */
export function supportedCountries() {
  return loadSupportedCountries();
}

/** Where Cloro posts finished tasks (routes/cloro-callback.js); unset: poll each task. */
export function webhookUrl(env = process.env) {
  return env.CLORO_WEBHOOK_URL || null;
}
