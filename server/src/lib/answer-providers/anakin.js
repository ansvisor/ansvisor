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
  UNAVAILABLE_PLATFORMS,
} from '../anakin-scraper.js';

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
 * Where Anakin posts finished jobs (routes/anakin-callback.js, mounted at
 * /anakin/callback). Only with ANAKIN_WEBHOOK_SECRET too, since the route
 * accepts signed deliveries only; otherwise null, and each task is polled.
 */
export function webhookUrl(env = process.env) {
  if (!env.ANAKIN_WEBHOOK_URL || !env.ANAKIN_WEBHOOK_SECRET) return null;
  return env.ANAKIN_WEBHOOK_URL;
}
