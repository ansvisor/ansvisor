import type { BrandPrefKey, NavChild, NavItem } from '@/config/dashboard';

type Translator = (key: string) => string;

type NavLabelKey = { namespace: 'nav'; key: string } | { namespace: 'brands'; key: 'title' };

/** Every dashboard title rendered from dashboardNav is resolved through this
 * map. Keeping it outside either layout component prevents the desktop and
 * mobile menus from silently falling out of sync. */
export const dashboardNavLabelKeys: Record<string, NavLabelKey> = {
  Brands: { namespace: 'brands', key: 'title' },
  Chat: { namespace: 'nav', key: 'chat' },
  'Action Center': { namespace: 'nav', key: 'actionCenter' },
  'Answer Engine Insights': { namespace: 'nav', key: 'insights' },
  'AI Referral Traffic': { namespace: 'nav', key: 'traffic' },
  Prompts: { namespace: 'nav', key: 'prompts' },
  'Tracked Prompts': { namespace: 'nav', key: 'trackedPrompts' },
  'Prompt Suggestions': { namespace: 'nav', key: 'promptSuggestions' },
  Topics: { namespace: 'nav', key: 'topics' },
  'Query Fan-outs': { namespace: 'nav', key: 'queryFanouts' },
  'Prompts Insights': { namespace: 'nav', key: 'promptsInsights' },
  Content: { namespace: 'nav', key: 'content' },
  Opportunities: { namespace: 'nav', key: 'contentOpportunities' },
  Library: { namespace: 'nav', key: 'contentLibrary' },
  'Site Audit': { namespace: 'nav', key: 'audit' },
  Citations: { namespace: 'nav', key: 'citations' },
  Mentions: { namespace: 'nav', key: 'mentions' },
  Shopping: { namespace: 'nav', key: 'shopping' },
  Reports: { namespace: 'nav', key: 'reports' },
};

/** Map from the static group title string in dashboard.ts to its nav key. */
export const dashboardNavGroupKeys: Record<string, string> = {
  Execution: 'execution',
  Analytics: 'analytics',
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

/**
 * The submenu entry the current page belongs to: its own route or a page
 * under it (a topic's page sits under Topics). When one entry's route holds
 * another's (Opportunities is /dashboard/content, the Library is
 * /dashboard/content/library), the longer one wins, so only one is current.
 */
export function activeChildHref(children: NavChild[], pathname: string): string | null {
  let best: string | null = null;
  for (const child of children) {
    const matches = pathname === child.href || pathname.startsWith(`${child.href}/`);
    if (matches && (best === null || child.href.length > best.length)) best = child.href;
  }
  return best;
}

/** Brand preferences hide a navigation item entirely; they are intentionally
 * separate from plan gates, which render a visible but disabled item. */
export function shouldShowDashboardNavItem(
  item: NavItem,
  brandPrefs: Record<BrandPrefKey, boolean>,
): boolean {
  return !item.requiresBrandPref || brandPrefs[item.requiresBrandPref];
}
