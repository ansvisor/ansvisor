/**
 * The Action Center's tabs, in order: Actions first (New Ansvisor, AC-ALT2 §3:
 * everything starts at Actions), then Signals, KPIs and History.
 */
export const ACTION_CENTER_TABS = [
  { key: 'actions', href: '/dashboard/action-center/actions' },
  { key: 'signals', href: '/dashboard/action-center/signals' },
  { key: 'kpis', href: '/dashboard/action-center/kpis' },
  { key: 'history', href: '/dashboard/action-center/history' },
] as const;

/**
 * Needs review (AC-010): tasks an agent wrote without the exact page, the
 * change, Done when or how it is checked. After the others, for admins and
 * managers only.
 */
export const REVIEW_TAB = { key: 'review', href: '/dashboard/action-center/review' } as const;

/** Action Center › Today (SIMPLE_NAV): where everyone lands with the simplified layout on. */
export const ACTION_CENTER_TODAY = '/dashboard/action-center/today';

/** KPIs' page: a tab of its own without SIMPLE_NAV, one of History's views with it. */
export const ACTION_CENTER_KPIS = '/dashboard/action-center/kpis';

/**
 * The tabs with the simplified layout on (SIMPLE_NAV), in order: Today first,
 * then Actions, Signals, Agents and History. Agents is Agent Center, at its
 * own address (/dashboard/agents), so its menu section, its links and Chat's
 * routes to it stay as they are; it shows only with the new Chat on, a plan
 * with agents and its section on the person's menu. KPIs is no tab: it opens
 * from History, which is the tab shown on its page. Needs review is no tab
 * either: its page stays, reached from Today.
 */
export const SIMPLE_TABS = [
  { key: 'today', href: ACTION_CENTER_TODAY },
  { key: 'actions', href: '/dashboard/action-center/actions' },
  { key: 'signals', href: '/dashboard/action-center/signals' },
  { key: 'agents', href: '/dashboard/agents' },
  { key: 'history', href: '/dashboard/action-center/history' },
] as const;

export type SimpleTabKey = (typeof SIMPLE_TABS)[number]['key'];

/** The menu section of the Agents tab (menu access): Agent Center's, by its route. */
export const AGENTS_SECTION = 'agents';

const under = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/**
 * The simplified layout's tab a page is under: its own, History on KPIs, and
 * none off the tabs (Needs review).
 */
export function simpleTabOf(pathname: string): SimpleTabKey | null {
  if (under(pathname, ACTION_CENTER_KPIS)) return 'history';
  return SIMPLE_TABS.find((tab) => under(pathname, tab.href))?.key ?? null;
}

/** The review page tells the tab when a task is approved or dismissed, so its count reads again. */
export const TASK_REVIEWS_CHANGED = 'action-task-reviews-changed';
