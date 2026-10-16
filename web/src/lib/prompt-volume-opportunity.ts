/**
 * Insights' High Opportunity Prompts: a prompt makes the list from
 * OPPORTUNITY_MIN_VOLUME estimated AI searches a month, and is High rather
 * than Medium from OPPORTUNITY_HIGH_VOLUME.
 *
 * Set for the median-based estimate (00154). The old 5k and 10k suited the
 * sum of five keywords, which ran about 15 times higher: on the largest brand
 * the median prompt went from ~4.7k to ~540. These keep roughly the same share
 * of prompts on the list, about half, with the top third or so High.
 */
export const OPPORTUNITY_MIN_VOLUME = 500;
export const OPPORTUNITY_HIGH_VOLUME = 1000;

export function opportunityLevel(estAiVolume: number): 'high' | 'medium' | null {
  if (estAiVolume >= OPPORTUNITY_HIGH_VOLUME) return 'high';
  if (estAiVolume >= OPPORTUNITY_MIN_VOLUME) return 'medium';
  return null;
}
