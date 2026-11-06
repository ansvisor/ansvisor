import { ALL_DATE_PRESETS } from '@/config/date-presets';
import { MODEL_PROVIDER_LABELS, PLATFORM_LABELS } from '@/config/platform-labels';
import { PROMPT_RANGE_PRESETS } from '@/config/prompt-options';
import { DEFAULT_MENTIONS_FILTERS } from '@/lib/mentions-filters';
import { modelLabel } from '@/lib/model-families';
import { POSITION_PLATFORMS } from '@/lib/prompt-positions';
import type { Brand } from '@/types';

/**
 * Brand Visibility (the owner's mockup, approved 2026-11): one page, with
 * Overview, Mentions and Citations, and for a brand that sells online
 * Product Visibility (owner, 2026-11-06; hasProductVisibilityTab). Each tab
 * keeps the address its page always had, so every link, bookmark, e-mail and
 * Chat card that opens one still lands on it, and the menu sections named
 * after them (menu access) stay as they are. The tabs share one layout (the
 * header, the run line and the tabs), which stays mounted while the tab
 * under it changes.
 */
export const BRAND_VISIBILITY_TABS = [
  { id: 'overview', href: '/dashboard/insights' },
  { id: 'mentions', href: '/dashboard/mentions' },
  { id: 'citations', href: '/dashboard/citations' },
  { id: 'products', href: '/dashboard/shopping' },
] as const;

export type BrandVisibilityTab = (typeof BRAND_VISIBILITY_TABS)[number]['id'];

/** The tabs that share the date range, engine, country and topic: all but Product Visibility. */
type FilterTab = Exclude<BrandVisibilityTab, 'products'>;

/** The tab a pathname (without its locale) is; null off the tabs' own routes. */
export function brandVisibilityTabOf(pathname: string): BrandVisibilityTab | null {
  const path = pathname.replace(/\/+$/, '');
  return BRAND_VISIBILITY_TABS.find((tab) => tab.href === path)?.id ?? null;
}

/**
 * A brand that sells online: Shopping mode on, or its site type is
 * e-commerce (set at setup, by its catalog or by a person) with Shopping
 * mode still off.
 */
export function isEcommerceBrand(
  brand: Pick<Brand, 'shoppingModeEnabled' | 'siteType'> | null | undefined,
): boolean {
  return !!brand && (brand.shoppingModeEnabled || brand.siteType === 'ecommerce');
}

/**
 * Whether Visibility shows Product Visibility as its fourth tab, and the
 * menu its Products entry: an e-commerce brand, on a plan with Product
 * Visibility. Other brands see neither; its address still opens the page.
 */
export function hasProductVisibilityTab(
  brand: Pick<Brand, 'shoppingModeEnabled' | 'siteType'> | null | undefined,
  canUse: (feature: 'shopping_analytics') => boolean,
): boolean {
  return canUse('shopping_analytics') && isEcommerceBrand(brand);
}

/** The Overview's range when its address names none: the latest run. */
export const OVERVIEW_DEFAULT_RANGE = '24h';

/**
 * How each tab names the filters the three share in its address. They grew
 * apart page by page (Citations' range is ?preset=, Overview's engine is
 * ?model=), and old links use those names, so each tab keeps its own and a
 * tab change translates between them.
 */
const TAB_PARAMS: Record<
  FilterTab,
  { range: string; ranges: readonly string[]; defaultRange: string; engine: string }
> = {
  overview: {
    range: 'range',
    ranges: ALL_DATE_PRESETS,
    defaultRange: OVERVIEW_DEFAULT_RANGE,
    engine: 'model',
  },
  mentions: {
    range: 'range',
    ranges: PROMPT_RANGE_PRESETS,
    defaultRange: DEFAULT_MENTIONS_FILTERS.range,
    engine: 'platform',
  },
  // As the Citations filter bar's DATE_PRESETS and default (brand-visibility.test.ts).
  citations: {
    range: 'preset',
    ranges: ALL_DATE_PRESETS,
    defaultRange: '24h',
    engine: 'platform',
  },
};

/**
 * The filters the three tabs share: the date range, the engine and the
 * topic, and the country, which all three filter by too. The engine is a
 * tab's own value: a model family on the Overview and Citations
 * ("chatgpt-web,gpt-5-chat-latest"), a platform on Mentions ("chatgpt-web").
 */
export interface SharedFilters {
  /**
   * The range the person picked; empty when they kept the tab's default,
   * which the next tab doesn't take over: the Overview's and Citations' 24h
   * is the latest run, Mentions' the last 24 hours, so a brand whose last
   * run is older (the demo's run every 3 days) would open Mentions empty.
   */
  range: string;
  /** A custom range's first and last day, `YYYY-MM-DD`; empty otherwise. */
  from: string;
  to: string;
  engine: string;
  region: string;
  topic: string;
}

/** The shared filters a tab's query string holds; a range only when one was picked. */
export function readSharedFilters(tab: FilterTab, search: URLSearchParams): SharedFilters {
  const names = TAB_PARAMS[tab];
  const asked = search.get(names.range);
  const range =
    asked !== null && asked !== names.defaultRange && names.ranges.includes(asked) ? asked : '';
  const custom = range === 'custom';
  return {
    range,
    from: custom ? (search.get('from') ?? '') : '',
    to: custom ? (search.get('to') ?? '') : '',
    engine: search.get(names.engine) ?? '',
    region: search.get('region') ?? '',
    topic: search.get('topic') ?? '',
  };
}

/**
 * The Mentions platform an engine filter names: one of the family's
 * platforms, else the platform shown by the family's name (Claude's API
 * models are "claude" there); empty when Mentions has no such platform.
 */
export function mentionsPlatformOf(engine: string): string {
  const slugs = engine
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean);
  if (slugs.length === 0) return '';
  const byId = POSITION_PLATFORMS.find((platform) => slugs.includes(platform.id));
  if (byId) return byId.id;
  // Only a slug with a name of its own: an unknown one would read as
  // ChatGPT (resolveAIProvider's default), as modelFamilyValue notes.
  const name = MODEL_PROVIDER_LABELS[slugs[0]] ?? PLATFORM_LABELS[slugs[0]];
  if (!name) return '';
  return (
    POSITION_PLATFORMS.find(
      (platform) => platform.label === name || modelLabel(platform.id) === name,
    )?.id ?? ''
  );
}

/**
 * The query string (with its `?`, or empty) that opens a tab on these
 * filters, in the tab's own names. No range picked, or one the tab doesn't
 * offer (Mentions has no All time), opens the tab's default, as mentionsHref
 * does; a Mentions engine reaches the Overview and Citations as one
 * platform, which they read as its family (modelFamilyValue).
 */
export function sharedFilterQuery(tab: FilterTab, filters: SharedFilters): string {
  const names = TAB_PARAMS[tab];
  const params = new URLSearchParams();
  const range = names.ranges.includes(filters.range) ? filters.range : names.defaultRange;
  if (range !== names.defaultRange) params.set(names.range, range);
  if (range === 'custom') {
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
  }
  const engine = tab === 'mentions' ? mentionsPlatformOf(filters.engine) : filters.engine;
  if (engine) params.set(names.engine, engine);
  if (filters.region) params.set('region', filters.region);
  if (filters.topic) params.set('topic', filters.topic);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Where a tab's link goes from the page shown: the tab with the shared
 * filters of the tab open now, so the date range, engine, country and topic
 * stay as they were. The tab open now keeps its whole address (its own
 * filters too); off Brand Visibility, a tab opens on its defaults. Product
 * Visibility's filters are its own (its dates, shopping channels and
 * regions): none carry to it or from it.
 */
export function brandVisibilityTabHref(
  tab: BrandVisibilityTab,
  current: BrandVisibilityTab | null,
  search: string,
): string {
  const href = BRAND_VISIBILITY_TABS.find((t) => t.id === tab)!.href;
  if (!current) return href;
  const params = new URLSearchParams(search);
  if (tab === current) {
    const query = params.toString();
    return query ? `${href}?${query}` : href;
  }
  if (tab === 'products' || current === 'products') return href;
  return `${href}${sharedFilterQuery(tab, readSharedFilters(current, params))}`;
}
