import { COMMERCIAL } from '../lib/priority-core.js';

/**
 * Ads' earn-or-pay thresholds (ADS-01 §2): the defaults product sets. A
 * workspace can change them (spec §2: "workspace settings with defaults set
 * by product"); adsThresholds() lays its own over these.
 *
 * - minIntentWeight: a prompt has buying intent when its intent weighs this
 *   much or more (INTENT_WEIGHTS, priority-core.js). The default is the
 *   Action Center's own line for commercial, so comparison, best-top,
 *   vs-review and recommendation count (lib/ads/intent.js).
 * - leadPosition: we lead a prompt when AI names us at or above this
 *   position (1 = named first), even where another brand is named first more
 *   often. The standing that names the leader reads it too.
 * - minPaidVolume: Google searches a month (prompt_volumes.total_google_volume)
 *   from which paying is suggested: "the prompt has volume" when a rival
 *   leads, and "paid only above a volume threshold" when no one does. Below
 *   it, or without a measured volume, the rule says earn.
 */
export const ADS_THRESHOLDS = Object.freeze({
  minIntentWeight: COMMERCIAL,
  leadPosition: 1,
  minPaidVolume: 1000,
});

/** What each threshold may be; anything else is left at its default. */
const VALID = {
  minIntentWeight: (n) => n >= 0 && n <= 1,
  leadPosition: (n) => n >= 1,
  minPaidVolume: (n) => n >= 0,
};

/**
 * The defaults with a workspace's own thresholds laid over them. Unknown
 * keys, and values that aren't finite numbers in range, are ignored, so a
 * bad setting can't turn the rule off.
 *
 * @param {Partial<typeof ADS_THRESHOLDS> | null | undefined} [overrides]
 * @returns {Readonly<typeof ADS_THRESHOLDS>}
 */
export function adsThresholds(overrides) {
  if (!overrides || typeof overrides !== 'object') return ADS_THRESHOLDS;
  const merged = { ...ADS_THRESHOLDS };
  for (const key of Object.keys(ADS_THRESHOLDS)) {
    const value = overrides[key];
    if (typeof value === 'number' && Number.isFinite(value) && VALID[key](value)) {
      merged[key] = value;
    }
  }
  return Object.freeze(merged);
}
