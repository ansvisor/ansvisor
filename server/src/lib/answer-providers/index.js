/**
 * The answer provider: the service that asks the AI platforms (ChatGPT,
 * Google AI Overviews, Gemini…) a prompt and returns their answers. Chosen
 * with PLATFORM_PROVIDER (`cloro` or `anakin`); Cloro when unset. Every provider exports the same
 * shape (see cloro.js):
 *
 *   name                     the provider's id
 *   submitPromptTask(task)   submits one prompt × platform × region task
 *   submitScraperTask(...)   the raw submit (report card)
 *   pollScraperResult(id, platform, opts)  waits for a task's answer
 *   parseScraperResponse(raw, platform)    the answer, normalized for
 *                            cloro-result-handler.js
 *   isLegacyChatgptTask(task)              whether a failed task may be
 *                            asked again without ChatGPT's fan-out
 *   unavailablePlatforms()   platforms it can't deliver now: runs skip them
 *   webhookUrl()             where it posts finished tasks, or null to poll
 *
 * A run submits all its tasks at once and collects the answers as they
 * finish (webhook, else polling), whichever provider answers them.
 */
import * as anakin from './anakin.js';
import * as cloro from './cloro.js';
import { logger } from '../logger.js';

export const DEFAULT_PROVIDER = 'cloro';

const PROVIDERS = { cloro, anakin };

/** The known providers' ids. */
export const PROVIDER_NAMES = Object.keys(PROVIDERS);

const warned = new Set();

/**
 * The provider PLATFORM_PROVIDER names. Unset, blank or unknown: Cloro, as
 * before PLATFORM_PROVIDER was read, with a warning for an unknown name.
 */
export function providerName(env = process.env) {
  const asked = String(env.PLATFORM_PROVIDER ?? '')
    .trim()
    .toLowerCase();
  if (!asked) return DEFAULT_PROVIDER;
  if (PROVIDERS[asked]) return asked;
  if (!warned.has(asked)) {
    warned.add(asked);
    logger.warn(
      { provider: asked, known: PROVIDER_NAMES },
      '[answer-providers] unknown PLATFORM_PROVIDER, using cloro',
    );
  }
  return DEFAULT_PROVIDER;
}

/** The provider in use (PLATFORM_PROVIDER), or the one named. */
export function answerProvider(name = providerName()) {
  return PROVIDERS[name] ?? PROVIDERS[DEFAULT_PROVIDER];
}
