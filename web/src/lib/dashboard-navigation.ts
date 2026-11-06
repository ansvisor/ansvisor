import type { BrandPrefKey, NavChild, NavItem } from '@/config/dashboard';
import type { Feature } from '@/config/plans';
import { menuSectionOf } from '@/lib/menu-access';

type Translator = (key: string) => string;

/** Every dashboard title rendered from dashboardNav is resolved through this
 * map. Keeping it outside either layout component prevents the desktop and
 * mobile menus from silently falling out of sync. */
export const dashboardNavLabelKeys: Record<string, string> = {
  Chat: 'chat',
  'Agent Center': 'agentCenter',
  'Action Center': 'actionCenter',
  Visibility: 'insights',
  Overview: 'overview',
  Competitors: 'competitors',
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
  Products: 'products',
  // Products' section where menu access lists the sections.
  'Product Visibility': 'shopping',
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
 * Whether a menu item is the current page's: its route (`href`, where it
 * links), or one of its submenu's (Brand Visibility on its Mentions and
 * Citations tabs, whose routes aren't under its own).
 */
export function isNavItemActive(
  item: Pick<NavItem, 'href' | 'children'>,
  pathname: string,
  href: string = item.href,
): boolean {
  if (item.href === '/dashboard') return pathname === '/dashboard';
  if (pathname.startsWith(href)) return true;
  return !!item.children?.length && activeChildHref(item.children, pathname) !== null;
}

/**
 * What decides a gated submenu entry (Visibility's Products): the active
 * brand's preferences and the plan's features. Without them, a gated entry
 * is left out.
 */
export interface NavChildGates {
  brandPrefs: Record<BrandPrefKey, boolean>;
  canUse: (feature: Feature) => boolean;
}

/**
 * The submenu entries a person's menu shows: each entry's section is its
 * route's, so Brand Visibility's Mentions, Citations and Products go with
 * theirs (menu access), and Prompts' and Content's with the item's own. An
 * entry for some brands or plans only shows for them: off, it is off the
 * menu rather than locked.
 */
export function visibleNavChildren(
  item: Pick<NavItem, 'children'>,
  hiddenSections: ReadonlySet<string> = new Set(),
  gates?: NavChildGates,
): NavChild[] {
  return (item.children ?? []).filter((child) => {
    if (child.requiresBrandPref && !gates?.brandPrefs[child.requiresBrandPref]) return false;
    if (child.requiredFeature && !gates?.canUse(child.requiredFeature)) return false;
    const section = menuSectionOf(child.href);
    return !section || !hiddenSections.has(section);
  });
}

/**
 * Where a submenu entry links: its route, or the page open under it when it
 * keeps it (the Editor, on a draft: clicking it doesn't open the draft again).
 */
export function childLinkHref(child: NavChild, pathname: string): string {
  return child.keepsPage && pathname.startsWith(`${child.href}/`) ? pathname : child.href;
}

/** Brand preferences hide a navigation item entirely; they are intentionally
 * separate from plan gates, which render a visible but disabled item. So do
 * the sections the viewer's menu leaves out (menu access): off the menu, the
 * page still opens from a link. And so does the new Chat off for the
 * workspace (CHAT_AGENTIC) an item only it has (Agent Center), whose pages
 * aren't there then. */
export function shouldShowDashboardNavItem(
  item: NavItem,
  brandPrefs: Record<BrandPrefKey, boolean>,
  hiddenSections: ReadonlySet<string> = new Set(),
  chatAgentic = false,
  canUse?: (feature: Feature) => boolean,
): boolean {
  if (item.requiresChatAgentic && !chatAgentic) return false;
  if (item.children?.length) {
    // A submenu shows while one of its entries does: Brand Visibility with
    // only Citations on someone's menu still shows, with Citations alone.
    const gates = canUse ? { brandPrefs, canUse } : undefined;
    if (visibleNavChildren(item, hiddenSections, gates).length === 0) return false;
  } else {
    const section = menuSectionOf(item.href);
    if (section && hiddenSections.has(section)) return false;
  }
  return !item.requiresBrandPref || brandPrefs[item.requiresBrandPref];
}

/** Chat's menu item: its route stays /dashboard/agent. */
export const CHAT_HREF = '/dashboard/agent';

/** Chat's address with the new Chat on for the workspace (CHAT_AGENTIC, CHAT-01 item 1). */
export const CHAT_AGENTIC_HREF = '/dashboard/chat';

/**
 * Where a menu item links. With the new Chat on, Chat opens /dashboard/chat
 * (its old address would only redirect there) and is the current page on
 * every Chat route; the item keeps CHAT_HREF for its badge and menu section.
 */
export function navItemHref(item: Pick<NavItem, 'href'>, chatAgentic: boolean): string {
  return chatAgentic && item.href === CHAT_HREF ? CHAT_AGENTIC_HREF : item.href;
}

/**
 * The badge beside a menu item. Chat has its own: that it needs setting up
 * while the organization has no provider key for it (`chatSetUp`, the words
 * to show; cloud only), never with the new Chat on (`chatAgentic`), which
 * runs on the plan's AI limit without a key. The demo brand is no exception:
 * its Chat is the real one, locked as the rest of the demo. Every other item
 * keeps its own.
 */
export function dashboardNavBadge(
  item: NavItem,
  { chatAgentic = false, chatSetUp = null }: { chatAgentic?: boolean; chatSetUp?: string | null },
): string | undefined {
  if (item.href === CHAT_HREF && chatSetUp && !chatAgentic) return chatSetUp;
  return item.badge;
}
