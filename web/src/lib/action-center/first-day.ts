import { ALL_SCRAPERS } from '@/config/prompt-options';

/**
 * Today on a brand's first day (SIMPLE_NAV, simplification plan PR 11):
 * before its first tracking run is stamped, Today asks the person to check
 * the prompts tracked for them while the first answers come in. Pure: the
 * server action reads, this words what it read.
 */

/** Prompts the check lists; Show all opens Tracked Prompts. */
export const CHECK_PROMPTS = 7;

/** Stored suggestions "Worth tracking too" lists. */
export const WORTH_TRACKING = 3;

/** The brand record "Looks good" keeps (getting_started_steps, a text key: no migration). */
export const PROMPTS_CHECK_STEP = 'prompts_check';

export type Demand = 'high' | 'medium' | 'low';

/**
 * Each prompt's demand against the brand's own: the top third of the
 * prompts with a volume high, the middle medium, the rest low. A prompt
 * with no volume has none.
 */
export function demandTiers(volumes: ReadonlyMap<string, number>): Map<string, Demand> {
  const ranked = [...volumes.entries()]
    .filter(([, volume]) => volume > 0)
    .sort((a, b) => b[1] - a[1]);
  const tiers = new Map<string, Demand>();
  ranked.forEach(([id], index) => {
    const share = index / ranked.length;
    tiers.set(id, share < 1 / 3 ? 'high' : share < 2 / 3 ? 'medium' : 'low');
  });
  return tiers;
}

/**
 * The engines the first answers come from, by name, in the app's order:
 * those the brand's prompts track that the plan allows ("ChatGPT and
 * Google Gemini"). Shopping is the same engine's other face, and left out.
 */
export function engineNames(
  tracked: readonly string[],
  allowed: readonly string[] | null | undefined,
): string[] {
  const on = new Set(tracked);
  return ALL_SCRAPERS.filter(
    (scraper) =>
      on.has(scraper.id) &&
      scraper.id !== 'chatgpt-shopping' &&
      (!allowed || allowed.includes(scraper.id)),
  ).map((scraper) => scraper.label.replace(/\s*\(Web\)$/, ''));
}

/** The first word of a person's name, for "Welcome, Alex"; null without one. */
export function firstNameOf(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? first : null;
}
