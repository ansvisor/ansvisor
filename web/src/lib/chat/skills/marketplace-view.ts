/**
 * What the Library's page needs of the catalog without the catalog itself
 * (marketplace.ts, server only: its JSON never reaches a browser): the
 * topics in the chips' order, the sorts and how a count reads on a card.
 */

/** The Library's topics, in the chips' order (CHAT-17 item 2). */
export const MARKETPLACE_TOPICS = [
  'seo',
  'content',
  'brand',
  'analytics',
  'social',
  'cro',
  'email',
  'paid-ads',
  'growth',
  'gtm',
] as const;
export type MarketplaceTopic = (typeof MARKETPLACE_TOPICS)[number];

export type MarketplaceSort = 'stars' | 'installs';

/**
 * How many skills the catalog lists: the Library tab's count, without
 * the catalog (marketplace.test.ts keeps it the catalog's).
 */
export const MARKETPLACE_COUNT = 701;

/**
 * A count as the cards show it (CHAT-17 item 6): under 1,000 as is,
 * 1,000–9,999 with one decimal ("6.9K"), 10,000 and up without ("48K"),
 * millions with one ("1.2M"). A trailing ".0" is dropped.
 */
export function formatSkillCount(value: number): string {
  const n = Math.max(0, Math.round(value));
  const short = (num: number, digits: number) => num.toFixed(digits).replace(/\.0$/, '');
  if (n < 1000) return String(n);
  if (n < 9950) return `${short(n / 1000, 1)}K`;
  if (n < 999_500) return `${short(n / 1000, 0)}K`;
  return `${short(n / 1_000_000, 1)}M`;
}
