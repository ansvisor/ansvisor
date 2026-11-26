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
 *   supportedCountries()     Map of platform → countries it answers from
 *                            (cloro-countries.js reads it); empty: none skipped
 *   webhookUrl()             where it posts finished tasks, or null to poll
 *
 * PLATFORM_PROVIDER_OVERRIDES moves single platforms to another provider,
 * e.g. `copilot-web=cloro` keeps Bing AI Mode on Cloro on an Anakin install
 * (providerFor). Unset: every platform on PLATFORM_PROVIDER.
 *
 * A run submits all its tasks at once and collects the answers as they
 * finish (webhook, else polling), whichever provider answers them.
 */
import * as anakin from './anakin.js';
import * as cloro from './cloro.js';
import { CLORO_COUNTRY_MODELS } from '../cloro-countries.js';
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

/**
 * PLATFORM_PROVIDER_OVERRIDES: `platform=provider` pairs, comma-separated,
 * as a Map of platform → provider id. A pair naming an unknown provider, or
 * not shaped `a=b`, is left out with a warning.
 */
export function platformOverrides(env = process.env) {
  const overrides = new Map();
  for (const pair of String(env.PLATFORM_PROVIDER_OVERRIDES ?? '').split(',')) {
    const entry = pair.trim();
    if (!entry) continue;
    const [platform, provider, ...rest] = entry.split('=').map((part) => part.trim().toLowerCase());
    if (!platform || !PROVIDERS[provider] || rest.length > 0) {
      if (!warned.has(`override:${entry}`)) {
        warned.add(`override:${entry}`);
        logger.warn(
          { entry, known: PROVIDER_NAMES },
          '[answer-providers] PLATFORM_PROVIDER_OVERRIDES entry ignored',
        );
      }
      continue;
    }
    overrides.set(platform, provider);
  }
  return overrides;
}

/** The provider that answers one platform: its override, else PLATFORM_PROVIDER's. */
export function providerFor(platform, env = process.env) {
  return answerProvider(platformOverrides(env).get(platform) ?? providerName(env));
}

/** Every provider some platform may be sent to: PLATFORM_PROVIDER's, then the overrides'. */
export function providersInUse(env = process.env) {
  const names = new Set([providerName(env), ...platformOverrides(env).values()]);
  return [...names].map((name) => answerProvider(name));
}

/**
 * The platforms runs skip: each one its own provider can't deliver now
 * (unavailablePlatforms). A platform moved to a provider that delivers it
 * isn't skipped for the default provider's sake.
 */
export function unavailablePlatforms(env = process.env) {
  const skipped = new Set();
  for (const provider of providersInUse(env)) {
    for (const platform of provider.unavailablePlatforms()) {
      if (providerFor(platform, env) === provider) skipped.add(platform);
    }
  }
  return [...skipped];
}

/**
 * The country lists the run checks (cloro-countries.js supportsCountry),
 * each from the provider that answers its platforms. A list keyed for
 * platforms that all went to another provider is left out, so it skips
 * nothing there. Lists are keyed by Cloro's model names
 * (CLORO_COUNTRY_MODELS); a key no platform maps to is kept with its
 * provider's list.
 */
export async function supportedCountries(env = process.env) {
  const merged = new Map();
  for (const provider of providersInUse(env)) {
    const lists = await provider.supportedCountries();
    for (const [key, countries] of lists) {
      const platforms = Object.keys(CLORO_COUNTRY_MODELS).filter(
        (platform) => CLORO_COUNTRY_MODELS[platform] === key,
      );
      if (
        platforms.length === 0 ||
        platforms.some((platform) => providerFor(platform, env) === provider)
      ) {
        merged.set(key, countries);
      }
    }
  }
  return merged;
}
