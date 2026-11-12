import type { BrandPrefKey, NavGroup, NavItem } from '@/config/dashboard';
import type { Feature } from '@/config/plans';
import { shouldShowDashboardNavItem, visibleNavChildren } from '@/lib/dashboard-navigation';
import { isNavArea, type NavArea } from '@/lib/user-brand-state';

/**
 * The menu's dots (Sadeleştirme PR 13, the owner's
 * decisions of 2026-11-11). Green, "New results": the night's tracking ran
 * since the person last opened the page. Yellow, "Needs you": something new
 * waits for someone who can act on it. Each clears when its page is opened
 * (nav_seen, 00529). Red, "Needs attention": something broke, and it stays
 * until it is fixed. Grey, pulsing, "Working on it": a job runs now, and it
 * goes when the job ends.
 *
 * The pure half: which menu entry is which area, and what lights a dot from
 * one read of the brand's newest times (getMenuState) and the person's last
 * visits. The menu (components/layout/menu-dots.tsx) shows them.
 */

export type DotColour = 'red' | 'yellow' | 'green' | 'grey';

/** The menu entries that carry a dot, by the area their page is. */
export const DOT_AREA_HREFS = {
  insights: '/dashboard/insights',
  mentions: '/dashboard/mentions',
  citations: '/dashboard/citations',
  'prompts/tracked': '/dashboard/prompts/tracked',
  'prompts/suggestions': '/dashboard/prompts/suggestions',
  traffic: '/dashboard/traffic',
  'action-center/actions': '/dashboard/action-center/actions',
  content: '/dashboard/content',
  'content/editor': '/dashboard/content/editor',
  'content/library': '/dashboard/content/library',
  agents: '/dashboard/agents',
  audit: '/dashboard/audit',
} as const;

export type DotArea = keyof typeof DOT_AREA_HREFS;

export const DOT_AREAS = Object.keys(DOT_AREA_HREFS) as DotArea[];

/** The areas whose dot opening the page clears: nav_seen's keys. Red and grey don't clear so. */
export type SeenArea = Extract<DotArea, NavArea>;

export const SEEN_AREAS = DOT_AREAS.filter((area): area is SeenArea => isNavArea(area));

/** Red, "Needs attention: …": what broke. */
export type BrokenReason =
  | 'searchConsole'
  | 'analytics'
  | 'aiBotsBlocked'
  | 'publishFailed'
  | 'agentFailed';

/** Grey, "Working on it: …": the job running now. */
export type WorkingReason = 'agentRunning' | 'writing' | 'trackingRunning' | 'auditRunning';

export type DotReason = BrokenReason | WorkingReason;

/**
 * Why a row's dot outside the menu shows (Chat's chats and Agents at work,
 * Action Center › Agents' cards): the same dots, in the row's own words.
 */
export type RowReason =
  | 'chatRunning'
  | 'chatWaiting'
  | 'chatResults'
  | 'chatFailed'
  | 'agentWorking'
  | 'agentNeedsOk'
  | 'agentRunFailed';

/** A row's dot: its colour, and why. */
export interface RowDot {
  colour: DotColour;
  reason: RowReason;
}

/** The entries that turn red, in the order Today lists their "Fix this" rows. */
export const BROKEN_AREAS: readonly DotArea[] = ['traffic', 'audit', 'content/library', 'agents'];

/** The entries that turn grey. */
export const WORKING_AREAS: readonly DotArea[] = [
  'agents',
  'content/editor',
  'insights',
  'prompts/tracked',
  'audit',
];

/** Only ever red, so read only for someone who sees red: the Library. */
export const RED_ONLY_AREAS: readonly DotArea[] = ['content/library'];

/** Green after each nightly tracking run: Visibility's Overview, Mentions and Citations, and Tracked Prompts. */
export const NIGHTLY_AREAS: readonly SeenArea[] = [
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
export function dotAreaOfPath(pathname: string): SeenArea | null {
  for (const area of SEEN_AREAS) {
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
  /**
   * Red, by area: what broke, from stored data only. Read for admins and
   * managers alone; absent when not read.
   */
  broken?: Partial<Record<DotArea, BrokenReason>>;
  /** Grey, by area: the job running now. */
  working?: Partial<Record<DotArea, WorkingReason>>;
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

/** Red is for the roles that can fix it, and not on the demo brand. */
export const redShown = (viewer: DotViewer) => viewer.canAct && !viewer.demo;

/** Which wins on one spot (an entry, a parent's icon, a folded group): red, yellow, green, grey. */
export const DOT_PRIORITY: readonly DotColour[] = ['red', 'yellow', 'green', 'grey'];

/**
 * How each dot looks (the Menu mockup): red is bigger and carries a white
 * "!", so it differs by shape as well as colour; grey pulses, and holds
 * still for someone who asked for less motion.
 */
export const DOT_STYLE: Record<DotColour, string> = {
  red: 'size-3 bg-red-600 text-white dark:bg-red-500',
  yellow: 'size-2 bg-yellow-600 dark:bg-yellow-400',
  green: 'size-2 bg-green-600 dark:bg-green-400',
  grey: 'size-2 bg-neutral-500 dark:bg-neutral-400 animate-menu-dot-pulse motion-reduce:animate-none',
};

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
 *   AI Referral Traffic, Audit,     red     what broke (state.broken), until fixed
 *   Library, Agents
 *   Agents, Editor, Visibility,     grey    a job running now (state.working)
 *   Tracked Prompts, Audit
 *
 * Yellow only for admins and managers, never on the demo brand or after the
 * plan ended: those see the green ones alone. Red for admins and managers,
 * not on the demo brand; grey for everyone. On one entry red beats yellow,
 * yellow green, green grey. Nothing compares with a visit that couldn't be
 * read.
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
    if (!onMenu.has(area)) return;
    const kept = dots[area];
    if (!kept || DOT_PRIORITY.indexOf(colour) < DOT_PRIORITY.indexOf(kept)) dots[area] = colour;
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
  if (redShown(viewer)) {
    for (const area of BROKEN_AREAS) if (state.broken?.[area]) light(area, 'red');
  }
  for (const area of WORKING_AREAS) if (state.working?.[area]) light(area, 'grey');
  return dots;
}

/** Why a red or grey dot is lit, for its words; null for green and yellow. */
export function dotReason(
  state: MenuState | null,
  dot: Pick<Dot, 'area' | 'colour'>,
): DotReason | null {
  if (dot.colour === 'red') return state?.broken?.[dot.area] ?? null;
  if (dot.colour === 'grey') return state?.working?.[dot.area] ?? null;
  return null;
}

/** What broke, in menu order: Today's "Fix this" rows, from the menu's own read. */
export function brokenReasons(state: MenuState | null): BrokenReason[] {
  return BROKEN_AREAS.flatMap((area) => state?.broken?.[area] ?? []);
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
  for (const [area, at] of Object.entries(opened) as [SeenArea, string][]) {
    const kept = navSeen[area];
    if (!kept || Date.parse(at) > Date.parse(kept)) navSeen[area] = at;
  }
  return { ...state, navSeen };
}

/** A dot, the area it is for, and for red and grey why. */
export interface Dot {
  area: DotArea;
  colour: DotColour;
  reason?: DotReason;
}

/** The dot that wins: red, then yellow, green, grey; of one colour the first. */
export function strongest(dots: readonly (Dot | null | undefined)[]): Dot | null {
  for (const colour of DOT_PRIORITY) {
    const dot = dots.find((each) => each?.colour === colour);
    if (dot) return dot;
  }
  return null;
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
 * their menu, less the yellow-only ones when they would see no yellow, and
 * the red-only ones when they would see no red.
 */
export function areasToRead(onMenu: ReadonlySet<DotArea>, viewer: DotViewer): DotArea[] {
  const yellow = needsYouShown(viewer);
  const red = redShown(viewer);
  return DOT_AREAS.filter(
    (area) =>
      onMenu.has(area) &&
      (yellow || !NEEDS_YOU_AREAS.includes(area)) &&
      (red || !RED_ONLY_AREAS.includes(area)),
  );
}
