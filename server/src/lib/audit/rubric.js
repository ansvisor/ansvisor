/**
 * AEO/GEO scoring rubric we implement for the Site Audit feature. We run the
 * checks ourselves rather than calling any third-party API; this module just
 * exposes the rubric's metadata (categories, weights, and the per-signal
 * label / what / why / howToFix / impactTier / evidenceLevel copy) so the
 * engine and the UI can describe each signal.
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const rubric = require('./rubric.json');

export const RUBRIC_VERSION = rubric.version;

/** Category descriptors with their scoring weights (sum to 1.0). */
export const categories = rubric.categories;

/**
 * The evidence levels a signal carries (Site Audit spec §6.2, SA-010):
 * strong, likely, hygiene, and informational, which is shown but not scored.
 */
export const evidenceLevels = rubric.evidenceLevels;

/** signalKey -> full signal descriptor ({ key, category, label, what, why, howToFix, source, impactTier, evidenceLevel, evidenceNote? }). */
export const signalsByKey = Object.fromEntries(rubric.signals.map((s) => [s.key, s]));

/** Total number of signals in the standard (48), regardless of how many we've implemented. */
export const TOTAL_SIGNALS = rubric.signals.length;

const unscoredLevels = new Set(evidenceLevels.filter((l) => !l.scored).map((l) => l.key));

/**
 * Whether a signal counts toward the score. An informational one (llms.txt)
 * is shown in the report but left out; a key the rubric doesn't know isn't
 * scored either.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isScored(key) {
  const signal = signalsByKey[key];
  return Boolean(signal) && !unscoredLevels.has(signal.evidenceLevel);
}

/**
 * @param {string} key
 * @returns {object|null}
 */
export function describeSignal(key) {
  return signalsByKey[key] ?? null;
}
