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
 * The submenu entry the current page belongs to: its own route, one it is
 * `activeFor` (the editor, for the Library), or a page under either (a
 * topic's page sits under Topics). When one entry's route holds another's
 * (Opportunities is /dashboard/content, the Library is
 * /dashboard/content/library), the longer match wins, so only one is current.
 */
export function activeChildHref(children: NavChild[], pathname: string): string | null {
  let best: string | null = null;
  let bestLength = -1;
  for (const child of children) {
    for (const route of [child.href, ...(child.activeFor ?? [])]) {
      const matches = pathname === route || pathname.startsWith(`${route}/`);
      if (matches && route.length > bestLength) {
        best = child.href;
        bestLength = route.length;
      }
    }
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
