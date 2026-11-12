/** Action Center › Today: the Action Center's first tab, where everyone lands. */
export const ACTION_CENTER_TODAY = '/dashboard/action-center/today';

/** KPIs' page: one of History's views, not a tab of its own. */
export const ACTION_CENTER_KPIS = '/dashboard/action-center/kpis';

/**
 * Needs review (AC-010): tasks an agent wrote without the exact page, the
 * change, Done when or how it is checked. No tab: its page is reached from
 * Today's Waiting for you, for admins and managers.
 */
export const ACTION_CENTER_REVIEW = '/dashboard/action-center/review';

/**
 * The Action Center's tabs, in order: Today first, then Actions, Signals,
 * Agents and History. Agents is Agent Center, at its own address
 * (/dashboard/agents), so its menu section, its links and Chat's routes to
 * it stay as they are; it shows only with the new Chat on, a plan with
 * agents and its section on the person's menu. KPIs is no tab: it opens
 * from History, which is the tab shown on its page. Needs review is no tab
 * either: its page stays, reached from Today.
 */
export const ACTION_CENTER_TABS = [
  { key: 'today', href: ACTION_CENTER_TODAY },
  { key: 'actions', href: '/dashboard/action-center/actions' },
  { key: 'signals', href: '/dashboard/action-center/signals' },
  { key: 'agents', href: '/dashboard/agents' },
  { key: 'history', href: '/dashboard/action-center/history' },
] as const;

export type ActionCenterTabKey = (typeof ACTION_CENTER_TABS)[number]['key'];

/**
 * How many of the person's agents wait on them: their newest run needs them
 * (the "Needs your OK" a card on Agents › Your agents shows), archived ones
 * aside. The count beside the Agents tab, from the list that tab shows
 * (GET /api/chat/agents?view=mine).
 */
export function agentsWaitingOn(
  agents: readonly { status: string; lastRun: { status: string } | null }[],
): number {
  return agents.filter(
    (agent) => agent.status !== 'archived' && agent.lastRun?.status === 'needs_you',
  ).length;
}

/** The menu section of the Agents tab (menu access): Agent Center's, by its route. */
export const AGENTS_SECTION = 'agents';

const under = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/** The tab a page is under: its own, History on KPIs, and none off the tabs (Needs review). */
export function actionCenterTabOf(pathname: string): ActionCenterTabKey | null {
  if (under(pathname, ACTION_CENTER_KPIS)) return 'history';
  return ACTION_CENTER_TABS.find((tab) => under(pathname, tab.href))?.key ?? null;
}
