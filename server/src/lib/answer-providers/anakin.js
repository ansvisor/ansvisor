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
 * Anakin answers are polled for now: its webhook route comes next, so a run
 * never waits on deliveries nothing receives.
 */
export function webhookUrl() {
  return null;
}
