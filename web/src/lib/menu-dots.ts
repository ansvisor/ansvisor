import type { BrandPrefKey, NavGroup, NavItem } from '@/config/dashboard';
import type { Feature } from '@/config/plans';
import { shouldShowDashboardNavItem, visibleNavChildren } from '@/lib/dashboard-navigation';
import type { NavArea } from '@/lib/user-brand-state';

/**
 * The simplified menu's dots (SIMPLE_NAV; Sadeleştirme PR 13, the owner's
 * decisions of 2026-11-11). Green, "New results": the night's tracking ran
 * since the person last opened the page. Yellow, "Needs you": something new
 * waits for someone who can act on it. Each clears when its page is opened
 * (nav_seen, 00529).
 *
 * The pure half: which menu entry is which area, and what lights a dot from
 * one read of the brand's newest times (getMenuState) and the person's last
 * visits. The menu (components/layout/menu-dots.tsx) shows them.
 */

export type DotColour = 'green' | 'yellow';

/** The menu entries that carry a dot, by the area their page is (nav_seen's keys). */
export const DOT_AREA_HREFS = {
  insights: '/dashboard/insights',
  mentions: '/dashboard/mentions',
  citations: '/dashboard/citations',
  'prompts/tracked': '/dashboard/prompts/tracked',
  'prompts/suggestions': '/dashboard/prompts/suggestions',
  traffic: '/dashboard/traffic',
  'action-center/actions': '/dashboard/action-center/actions',
  content: '/dashboard/content',
} as const satisfies Partial<Record<NavArea, string>>;

export type DotArea = keyof typeof DOT_AREA_HREFS;

export const DOT_AREAS = Object.keys(DOT_AREA_HREFS) as DotArea[];

/** Green after each nightly tracking run: Visibility's Overview, Mentions and Citations, and Tracked Prompts. */
export const NIGHTLY_AREAS: readonly DotArea[] = [
  'insights',
  'mentions',
  'citations',
  'prompts/tracked',
];

/** Only ever yellow, so only for someone who can act: new suggestions, actions and opportunities. */
export const NEEDS_YOU_AREAS: readonly DotArea[] = [
  'prompts/suggestions',
  'action-center/actions',
  'content',
];

/** The menu item that says "New results" in words beside its dot: Visibility. */
export const NEW_RESULTS_ITEM = '/dashboard/insights';

/** The item whose row carries the open-action count. */
export const ACTION_CENTER_ITEM = '/dashboard/action-center';

/** Opened only at their own address: Visibility's Overview, and Content's Opportunities. */
const EXACT_AREAS: ReadonlySet<DotArea> = new Set(['insights', 'content']);

export function isDotArea(value: unknown): value is DotArea {
  return typeof value === 'string' && (DOT_AREAS as readonly string[]).includes(value);
}

/** The area a menu entry is, by its route. */
export function dotAreaOfHref(href: string): DotArea | null {
  return DOT_AREAS.find((area) => DOT_AREA_HREFS[area] === href) ?? null;
}

/**
 * The area the page shown belongs to, whose dot opening it clears: its
 * route or a page under it (an action's own page is in Actions), but
 * Visibility's Overview and Content's Opportunities only at their own
 * address, as their routes hold other pages.
 */
export function dotAreaOfPath(pathname: string): DotArea | null {
  for (const area of DOT_AREAS) {
    const href = DOT_AREA_HREFS[area];
    if (pathname === href) return area;
    if (!EXACT_AREAS.has(area) && pathname.startsWith(`${href}/`)) return area;
  }
  return null;
}

/**
 * One read of what the dots compare (getMenuState): the brand's newest
 * times, each null when there is none or it wasn't read, and the person's
 * last visit to each area.
 */
export interface MenuState {
  /** The latest nightly tracking run that finished. */
  nightlyRunAt: string | null;
  /** The newest prompt suggestion still new. */
  newSuggestionAt: string | null;
  /** The newest action still new, unassigned or the person's. */
  newActionAt: string | null;
  /** The newest content opportunity still new. */
  newOpportunityAt: string | null;
  /**
   * AI Referral Traffic: when it was connected (the snippet's first visit,
   * or Google Analytics), null while it isn't. Absent when not read.
   */
  traffic?: { connectedAt: string | null };
  /** Prompts waiting for a spot (read from PR 16 on): yellow on Tracked Prompts. */
  waitingPrompts?: number;
  /** The open actions, unassigned or the person's: the Action Center's count. */
  openActions: number | null;
  /** When the person last opened each area; null when it couldn't be read. */
  navSeen: Partial<Record<NavArea, string>> | null;
}

/** Who is looking: yellow is for those who can act, and not on the demo or a plan that ended. */
export interface DotViewer {
  /** Admin or manager. */
  canAct: boolean;
  /** The demo brand is the brand on screen. */
  demo: boolean;
  /** The plan or trial ended: the workspace is read-only. */
  ended: boolean;
}

export const needsYouShown = (viewer: DotViewer) => viewer.canAct && !viewer.demo && !viewer.ended;

export type MenuDots = Partial<Record<DotArea, DotColour>>;

/** `at` happened after `seen` (never seen counts as before). */
function since(at: string | null | undefined, seen: string | null | undefined): boolean {
  if (!at) return false;
  const time = Date.parse(at);
  if (Number.isNaN(time)) return false;
  return !seen || time > Date.parse(seen);
}

/**
 * The dots on the person's menu: only for the areas on it (`onMenu`: not off
 * their menu, not locked by the plan).
 *
 *   Overview, Mentions, Citations,  green   a nightly run finished since the
 *   Tracked Prompts                         page was last opened
 *   Tracked Prompts                 yellow  prompts wait for a spot (beats green)
 *   Prompt Suggestions              yellow  a new suggestion since the last visit
 *   Actions                         yellow  a new action in the person's scope since
 *   Opportunities                   yellow  a new opportunity since
 *   AI Referral Traffic             yellow  neither the snippet nor Analytics connected
 *                                   green   connected since the page was last opened
 *
 * Yellow only for admins and managers, never on the demo brand or after the
 * plan ended: those see the green ones alone. Nothing compares with a visit
 * that couldn't be read.
 */
export function menuDots(
  state: MenuState | null,
  viewer: DotViewer,
  onMenu: ReadonlySet<DotArea>,
): MenuDots {
  const dots: MenuDots = {};
  if (!state) return dots;
  const yellow = needsYouShown(viewer);
  const seen = state.navSeen;
  const light = (area: DotArea, colour: DotColour) => {
    if (onMenu.has(area)) dots[area] = colour;
  };
  if (seen) {
    for (const area of NIGHTLY_AREAS)
      if (since(state.nightlyRunAt, seen[area])) light(area, 'green');
    if (yellow) {
      if (since(state.newSuggestionAt, seen['prompts/suggestions'])) {
        light('prompts/suggestions', 'yellow');
      }
      if (since(state.newActionAt, seen['action-center/actions'])) {
        light('action-center/actions', 'yellow');
      }
      if (since(state.newOpportunityAt, seen.content)) light('content', 'yellow');
    }
  }
  if (yellow && (state.waitingPrompts ?? 0) > 0) light('prompts/tracked', 'yellow');
  if (state.traffic) {
    const { connectedAt } = state.traffic;
    if (connectedAt === null) {
      if (yellow) light('traffic', 'yellow');
    } else if (seen && since(connectedAt, seen.traffic)) {
      light('traffic', 'green');
    }
  }
  return dots;
}

/** The count beside the Action Center: none once the plan ended, or with nothing open. */
export function openActionCount(state: MenuState | null, viewer: DotViewer): number | null {
  if (viewer.ended || !state?.openActions) return null;
  return state.openActions > 0 ? state.openActions : null;
}

/**
 * The person's visits with the pages opened on this device since the read:
 * their dots clear at once, before the next read brings the visit back.
 */
export function withOpened(
  state: MenuState | null,
  opened: Partial<Record<DotArea, string>> | undefined,
): MenuState | null {
  if (!state?.navSeen || !opened) return state;
  const navSeen = { ...state.navSeen };
  for (const [area, at] of Object.entries(opened) as [DotArea, string][]) {
    const kept = navSeen[area];
    if (!kept || Date.parse(at) > Date.parse(kept)) navSeen[area] = at;
  }
  return { ...state, navSeen };
}

/** A dot and the area it is for. */
export interface Dot {
  area: DotArea;
  colour: DotColour;
}

/** The dot that wins: yellow beats green; else the first. */
export function strongest(dots: readonly (Dot | null | undefined)[]): Dot | null {
  return (
    dots.find((dot) => dot?.colour === 'yellow') ??
    dots.find((dot) => dot?.colour === 'green') ??
    null
  );
}

/** A menu entry's dot, by its route. */
export function dotOf(dots: MenuDots, href: string): Dot | null {
  const area = dotAreaOfHref(href);
  const colour = area ? dots[area] : undefined;
  return area && colour ? { area, colour } : null;
}

/**
 * An item's dot: its own, or the strongest of its submenu's, which its icon
 * shows while the submenu is closed or the menu is icons only.
 */
export function itemDot(dots: MenuDots, item: Pick<NavItem, 'href' | 'children'>): Dot | null {
  const hrefs = item.children?.length ? item.children.map((child) => child.href) : [item.href];
  return strongest(hrefs.map((href) => dotOf(dots, href)));
}

/** A titled group's dot, shown on its title while it is folded. */
export function groupDot(dots: MenuDots, group: Pick<NavGroup, 'items'>): Dot | null {
  return strongest(group.items.map((item) => itemDot(dots, item)));
}

/** What decides which entries a person's menu shows, as the menu decides it. */
export interface DotMenuGates {
  brandPrefs: Record<BrandPrefKey, boolean>;
  hiddenSections: ReadonlySet<string>;
  chatAgentic: boolean;
  ads: boolean;
  canUse: (feature: Feature) => boolean;
  /** Ansvisor Cloud: an item the plan lacks shows locked. */
  isCloud: boolean;
}

/**
 * The areas that can carry a dot on this menu: their entry shows, and its
 * item isn't locked by the plan. Off the person's menu (menu access) or
 * locked, a section has no dot, on itself or its parent.
 */
export function dotAreasOnMenu(nav: readonly NavGroup[], gates: DotMenuGates): Set<DotArea> {
  const areas = new Set<DotArea>();
  const childGates = {
    brandPrefs: gates.brandPrefs,
    canUse: gates.canUse,
    chatAgentic: gates.chatAgentic,
  };
  for (const group of nav) {
    for (const item of group.items) {
      const shown = shouldShowDashboardNavItem(
        item,
        gates.brandPrefs,
        gates.hiddenSections,
        gates.chatAgentic,
        gates.canUse,
        gates.ads,
      );
      if (!shown) continue;
      if (gates.isCloud && item.requiredFeature && !gates.canUse(item.requiredFeature)) continue;
      const children = visibleNavChildren(item, gates.hiddenSections, childGates);
      const hrefs = children.length ? children.map((child) => child.href) : [item.href];
      for (const href of hrefs) {
        const area = dotAreaOfHref(href);
        if (area) areas.add(area);
      }
    }
  }
  return areas;
}

/**
 * The areas worth reading for this person, in a stable order: those on
 * their menu, less the yellow-only ones when they would see no yellow.
 */
export function areasToRead(onMenu: ReadonlySet<DotArea>, viewer: DotViewer): DotArea[] {
  const yellow = needsYouShown(viewer);
  return DOT_AREAS.filter(
    (area) => onMenu.has(area) && (yellow || !NEEDS_YOU_AREAS.includes(area)),
  );
}
