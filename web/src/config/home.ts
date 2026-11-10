import { isCloud } from '@/config/plans';

/**
 * The Action Center's Actions, where Getting started and the actions live
 * (New Ansvisor, AC-ALT2 §3). /dashboard/action-center redirects here, and
 * it is where a person lands while Chat isn't theirs to start on
 * (landingPageFor). Sign-in, onboarding, payment and a new brand land on
 * /dashboard, which sends each person to their page.
 */
export const DASHBOARD_HOME = '/dashboard/action-center/actions';

/** Chat Home: where Ansvisor starts (owner decisions 2026-11-06 and 2026-11-09). */
export const CHAT_HOME = '/dashboard/chat';

/** Insights (Visibility's Overview): where a paid workspace starts (owner decision 2026-11-10). */
export const INSIGHTS_HOME = '/dashboard/insights';

/**
 * The page a person lands on, each time they come to Ansvisor, on Ansvisor
 * Cloud: Insights for a paid workspace (`paid`: its plan is active, set to
 * cancel at the period's end too) while Insights is on the person's menu
 * (owner decision 2026-11-10). Else Chat Home while the new Chat is on for
 * their workspace (CHAT_AGENTIC) and on their menu: the free trial and the
 * demo (2026-11-06), a payment due, an ended or canceled plan (2026-11-09).
 * The Action Center while Chat is off, when an Admin's menu access or the
 * person's work areas take Chat off their menu (`chatHidden`), and
 * self-hosted. The checkout's success route asks without `paid`: a new
 * buyer starts on Chat Home.
 */
export function landingPageFor({
  chatOn,
  chatHidden = false,
  paid = false,
  insightsHidden = false,
}: {
  chatOn: boolean;
  chatHidden?: boolean;
  paid?: boolean;
  insightsHidden?: boolean;
}): string {
  if (!isCloud()) return DASHBOARD_HOME;
  if (paid && !insightsHidden) return INSIGHTS_HOME;
  return chatOn && !chatHidden ? CHAT_HOME : DASHBOARD_HOME;
}

/** Whether a sidebar item leads to the home page (it or a parent of it). */
export function isDashboardHomeItem(href: string): boolean {
  return DASHBOARD_HOME === href || DASHBOARD_HOME.startsWith(`${href}/`);
}
