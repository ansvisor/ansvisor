import { getSearchVolumes, isDataForSeoConfigured } from '../dataforseo.js';
import { languageToCode, regionToLocationCode } from '../dataforseo-codes.js';
import logger from '../logger.js';

/**
 * The value table's cost per click (REPORT-CARD §1, page 3): the median
 * Google Ads CPC, in USD, over the questions' keywords that have one in the
 * target country, from the same search volume call tracking makes (its
 * `cpc` field). One call; none for a country DataForSEO's codes don't
 * place, and then no table.
 */

/** The middle value, or the mean of the two middle ones. */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * @param {string[]} keywords
 * @param {{ country: string, language: string }} where
 * @returns {Promise<{ cpc: { usd: number, keywords: number } | null, called: boolean }>}
 *   `called`: whether the paid call was made
 */
export async function medianCpc(
  keywords,
  { country, language },
  { volumes = getSearchVolumes, configured = isDataForSeoConfigured } = {},
) {
  const locationCode = regionToLocationCode(country);
  const unique = [...new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean))];
  if (!locationCode || !unique.length || !configured()) return { cpc: null, called: false };
  try {
    const found = await volumes(unique, { locationCode, languageCode: languageToCode(language) });
    const cpcs = Object.values(found)
      .map((row) => row?.cpc)
      .filter((cpc) => typeof cpc === 'number' && cpc > 0);
    const mid = median(cpcs);
    return {
      cpc:
        mid === null
          ? null
          : { usd: Math.max(0.01, Math.round(mid * 100) / 100), keywords: cpcs.length },
      called: true,
    };
  } catch (err) {
    logger.warn({ err: err.message }, '[report-card] the keyword call failed');
    return { cpc: null, called: true };
  }
}
