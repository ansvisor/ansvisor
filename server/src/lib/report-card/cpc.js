import { getSearchVolumes, isDataForSeoConfigured } from '../dataforseo.js';
import { languageToCode, regionToLocationCode } from '../dataforseo-codes.js';
import logger from '../logger.js';

/**
 * The questions' keywords' figures (REPORT-CARD §1): their Google search
 * volume and the value table's cost per click, the median Google Ads CPC
 * in USD over the keywords that have one in the target country, from the
 * same search volume call tracking makes. One call, over the candidate
 * questions; none for a country DataForSEO's codes don't place, and then
 * no volumes and no table.
 */

/** The middle value, or the mean of the two middle ones. */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A keyword as looked up: trimmed, lower case. */
export const keywordKey = (keyword) =>
  String(keyword ?? '')
    .trim()
    .toLowerCase();

/**
 * Each keyword's Google searches a month and cost per click in the target
 * country, from one call: the question picker ranks candidates by the
 * searches (owner decision 2026-11-04) and the value table takes the cost
 * per click of the questions kept.
 *
 * @param {string[]} keywords
 * @param {{ country: string, language: string }} where
 * @returns {Promise<{ figures: Map<string, { volume: number|null, cpc: number|null }>, called: boolean }>}
 *   `called`: whether the paid call was made
 */
export async function keywordFigures(
  keywords,
  { country, language },
  { volumes = getSearchVolumes, configured = isDataForSeoConfigured } = {},
) {
  const locationCode = regionToLocationCode(country);
  const unique = [...new Set(keywords.map(keywordKey).filter(Boolean))];
  if (!locationCode || !unique.length || !configured()) {
    return { figures: new Map(), called: false };
  }
  try {
    const found = await volumes(unique, { locationCode, languageCode: languageToCode(language) });
    const figures = new Map();
    for (const [keyword, row] of Object.entries(found ?? {})) {
      figures.set(keywordKey(keyword), {
        volume: typeof row?.volume === 'number' ? row.volume : null,
        cpc: typeof row?.cpc === 'number' && row.cpc > 0 ? row.cpc : null,
      });
    }
    return { figures, called: true };
  } catch (err) {
    logger.warn({ err: err.message }, '[report-card] the keyword call failed');
    return { figures: new Map(), called: true };
  }
}

/**
 * The median cost per click over the keywords that have one, in USD, with
 * how many had one; null when none has.
 *
 * @param {string[]} keywords
 * @param {Map<string, { cpc: number|null }>} figures
 * @returns {{ usd: number, keywords: number } | null}
 */
export function medianCpc(keywords, figures) {
  const cpcs = [...new Set(keywords.map(keywordKey))]
    .map((keyword) => figures.get(keyword)?.cpc)
    .filter((cpc) => typeof cpc === 'number' && cpc > 0);
  const mid = median(cpcs);
  return mid === null
    ? null
    : { usd: Math.max(0.01, Math.round(mid * 100) / 100), keywords: cpcs.length };
}
