import { adsThresholds } from '../../config/ads.js';
import { INTENT_WEIGHTS } from '../priority-core.js';

/**
 * Which tracked prompts have buying intent (ADS-01 §2: the rule runs per
 * prompt with buying intent). The intent is the one prompt_volumes.intent
 * keeps (intent-extraction.js); there is no "buying" label of its own. A
 * prompt has buying intent when its intent weighs at least the workspace's
 * minIntentWeight, COMMERCIAL by default (config/ads.js): comparison,
 * best-top, vs-review and recommendation.
 *
 * A prompt never analysed has no intent: it is "not analysed", never guessed
 * either way. An intent outside the taxonomy is not buying intent.
 *
 * Pure.
 */

/** @typedef {'buying' | 'not_buying' | 'not_analysed'} IntentClass */

/**
 * @param {string | null | undefined} intent prompt_volumes.intent
 * @param {object} [overrides] the workspace's thresholds (config/ads.js)
 * @returns {IntentClass}
 */
export function intentClass(intent, overrides) {
  if (typeof intent !== 'string' || intent.trim() === '') return 'not_analysed';
  const key = intent.trim();
  if (!Object.hasOwn(INTENT_WEIGHTS, key)) return 'not_buying';
  return INTENT_WEIGHTS[key] >= adsThresholds(overrides).minIntentWeight ? 'buying' : 'not_buying';
}

/**
 * @param {string | null | undefined} intent
 * @param {object} [overrides]
 */
export function isBuyingIntent(intent, overrides) {
  return intentClass(intent, overrides) === 'buying';
}

/**
 * The intents that count as buying, in INTENT_WEIGHTS' order.
 * @param {object} [overrides]
 * @returns {string[]}
 */
export function buyingIntents(overrides) {
  const { minIntentWeight } = adsThresholds(overrides);
  return Object.keys(INTENT_WEIGHTS).filter((intent) => INTENT_WEIGHTS[intent] >= minIntentWeight);
}
