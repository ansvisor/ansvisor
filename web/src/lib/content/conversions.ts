import { getPlatformName, isNamedPlatform } from '@/lib/traffic-platforms';
import type { SiteType } from './page-types';

/**
 * Conversions of AI journeys through a page (CE-017), as
 * content_page_conversions (00287) reads them for the Live page tab's
 * window: from the AI Traffic snippet with conversions on (00286), credited
 * to the AI source of the journey's first visit.
 */

/** A conversion's goal (server traffic-events.js CONVERSION_GOALS). */
export type ConversionGoal = 'signup' | 'demo' | 'order' | 'booking' | 'newsletter' | 'custom';

export interface ContentConversions {
  /** The brand has conversions on. */
  enabled: boolean;
  goals: { goal: ConversionGoal; count: number; units: number }[];
  /** Value per currency: one without a currency isn't summed. */
  revenue: { currency: string; value: number }[];
  /** Per AI source the journey started from. */
  sources: { platform: string; conversions: number }[];
  /** The five most frequent: source, pages in order (page keys), goal. */
  journeys: { source: string; pages: string[]; goal: ConversionGoal; count: number }[];
}

/** What a result card shows: a goal's count, the revenue, or the units ordered. */
export type ResultKey = ConversionGoal | 'revenue' | 'units';

/**
 * What each kind of site counts (spec §7 point 26): a B2B site its signups
 * and demo forms (its revenue comes with CE-024), a shop its orders, revenue
 * and units, a B2C site its bookings, revenue and newsletter signups.
 */
export const SITE_RESULTS: Record<SiteType, readonly ResultKey[]> = {
  b2b: ['signup', 'demo'],
  ecommerce: ['order', 'revenue', 'units'],
  b2c: ['booking', 'revenue', 'newsletter'],
};

export type ResultCard =
  | { key: ConversionGoal | 'units' | 'other'; value: number }
  | { key: 'revenue'; value: { currency: string; value: number }[] };

/**
 * The cards for a site: its own goals, revenue and units, always, at 0 when
 * there are none; then one for any other goal, with the conversions the
 * site's goals leave out.
 */
export function conversionCards(conversions: ContentConversions, site: SiteType): ResultCard[] {
  const count = (goal: ConversionGoal) =>
    conversions.goals.find((g) => g.goal === goal)?.count ?? 0;
  const keys = SITE_RESULTS[site];
  const cards: ResultCard[] = keys.map((key) => {
    if (key === 'revenue') return { key, value: conversions.revenue };
    if (key === 'units') {
      return { key, value: conversions.goals.find((g) => g.goal === 'order')?.units ?? 0 };
    }
    return { key, value: count(key) };
  });
  const other = conversions.goals
    .filter((g) => !(keys as readonly string[]).includes(g.goal))
    .reduce((sum, g) => sum + g.count, 0);
  return other > 0 ? [...cards, { key: 'other', value: other }] : cards;
}

/**
 * The by-source rows: one per platform name (ChatGPT's old hosts are
 * ChatGPT), keys the page can't name folded into Other, last; the most
 * conversions first.
 */
export function conversionSources(
  conversions: ContentConversions,
): { name: string | null; conversions: number }[] {
  const byName = new Map<string | null, number>();
  for (const { platform, conversions: n } of conversions.sources) {
    const name = isNamedPlatform(platform) ? getPlatformName(platform) : null;
    byName.set(name, (byName.get(name) ?? 0) + n);
  }
  return [...byName]
    .map(([name, n]) => ({ name, conversions: n }))
    .sort(
      (a, b) =>
        Number(a.name === null) - Number(b.name === null) ||
        b.conversions - a.conversions ||
        (a.name ?? '').localeCompare(b.name ?? ''),
    );
}

/**
 * A page as content_page_conversions keys it (lower(normalize_page_path)):
 * no host, query string, fragment or trailing slash, escapes decoded where
 * they decode, lower case; the site's root is "/".
 */
export function pageKey(url: string): string {
  const path = url
    .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*/, '')
    .split('?')[0]
    .split('#')[0];
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // A malformed escape stays as it is, as the database's url_decode_safe.
  }
  return (decoded.replace(/\/+$/, '') || '/').toLowerCase();
}

/**
 * A journey's pages as the tab shows them: all of them up to five, or the
 * first, a gap and the last three.
 */
export function journeyPages(pages: string[]): (string | null)[] {
  return pages.length <= 5 ? pages : [pages[0], null, ...pages.slice(-3)];
}
