import type { BrandPrefKey, NavChild, NavItem } from '@/config/dashboard';

type Translator = (key: string) => string;

/** Every dashboard title rendered from dashboardNav is resolved through this
 * map. Keeping it outside either layout component prevents the desktop and
 * mobile menus from silently falling out of sync. */
export const dashboardNavLabelKeys: Record<string, string> = {
  Chat: 'chat',
  'Action Center': 'actionCenter',
  'Answer Engine Insights': 'insights',
  'AI Referral Traffic': 'traffic',
  Prompts: 'prompts',
  'Tracked Prompts': 'trackedPrompts',
  'Prompt Suggestions': 'promptSuggestions',
  Topics: 'topics',
  'Query Fan-outs': 'queryFanouts',
  'Prompts Insights': 'promptsInsights',
  Content: 'content',
  Plan: 'contentPlan',
  Editor: 'contentEditor',
  Opportunities: 'contentOpportunities',
  Library: 'contentLibrary',
  'Site Audit': 'audit',
  Citations: 'citations',
  Mentions: 'mentions',
  Shopping: 'shopping',
  Reports: 'reports',
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

export function getDashboardNavLabel(title: string, t: Translator): string {
  const key = dashboardNavLabelKeys[title];
  return key ? t(key) : title;
}

/**
 * The submenu entry the current page belongs to: its own route, or a page
 * under it (a topic's page sits under Topics, a draft under the Editor).
 * When one entry's route holds another's
 * (Opportunities is /dashboard/content, the Library is
 * /dashboard/content/library), the longer match wins, so only one is current.
 */
export function activeChildHref(children: NavChild[], pathname: string): string | null {
  let best: string | null = null;
  let bestLength = -1;
  for (const { href } of children) {
    const matches = pathname === href || pathname.startsWith(`${href}/`);
    if (matches && href.length > bestLength) {
      best = href;
      bestLength = href.length;
    }
  }
  return best;
}

/**
 * Where a submenu entry links: its route, or the page open under it when it
 * keeps it (the Editor, on a draft: clicking it doesn't open the draft again).
 */
export function childLinkHref(child: NavChild, pathname: string): string {
  return child.keepsPage && pathname.startsWith(`${child.href}/`) ? pathname : child.href;
}

/** Brand preferences hide a navigation item entirely; they are intentionally
 * separate from plan gates, which render a visible but disabled item. */
export function shouldShowDashboardNavItem(
  item: NavItem,
  brandPrefs: Record<BrandPrefKey, boolean>,
): boolean {
  return !item.requiresBrandPref || brandPrefs[item.requiresBrandPref];
}
