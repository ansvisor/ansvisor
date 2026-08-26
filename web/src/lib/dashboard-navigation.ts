import type { BrandPrefKey, NavItem } from '@/config/dashboard';

type Translator = (key: string) => string;

type NavLabelKey = { namespace: 'nav'; key: string } | { namespace: 'brands'; key: 'title' };

/** Every dashboard title rendered from dashboardNav is resolved through this
 * map. Keeping it outside either layout component prevents the desktop and
 * mobile menus from silently falling out of sync. */
export const dashboardNavLabelKeys: Record<string, NavLabelKey> = {
  Brands: { namespace: 'brands', key: 'title' },
  Agent: { namespace: 'nav', key: 'agent' },
  'Answer Engine Insights': { namespace: 'nav', key: 'insights' },
  'AI Traffic Analytics': { namespace: 'nav', key: 'traffic' },
  Prompts: { namespace: 'nav', key: 'prompts' },
  Topics: { namespace: 'nav', key: 'topics' },
  'Content Optimization': { namespace: 'nav', key: 'content' },
  'Site Audit': { namespace: 'nav', key: 'audit' },
  Citations: { namespace: 'nav', key: 'citations' },
  Shopping: { namespace: 'nav', key: 'shopping' },
  Reports: { namespace: 'nav', key: 'reports' },
};

/** Map from the static group title string in dashboard.ts to its nav key. */
export const dashboardNavGroupKeys: Record<string, string> = {
  Analytics: 'analytics',
  Optimization: 'optimization',
};

/** Resolve a NavGroup.title to its translated label, or return the raw string
 *  as a fallback so new groups surface immediately rather than silently. */
export function getDashboardNavGroupLabel(title: string, t: Translator): string {
  const key = dashboardNavGroupKeys[title];
  return key ? t(key) : title;
}

export function getDashboardNavLabel(title: string, t: Translator, tBrands: Translator): string {
  const label = dashboardNavLabelKeys[title];
  if (!label) return title;

  return label.namespace === 'brands' ? tBrands(label.key) : t(label.key);
}

/** Brand preferences hide a navigation item entirely; they are intentionally
 * separate from plan gates, which render a visible but disabled item. */
export function shouldShowDashboardNavItem(
  item: NavItem,
  brandPrefs: Record<BrandPrefKey, boolean>,
): boolean {
  return !item.requiresBrandPref || brandPrefs[item.requiresBrandPref];
}
