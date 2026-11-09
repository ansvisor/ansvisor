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

/**
 * The page a person lands on, each time they come to Ansvisor: Chat Home on
 * Ansvisor Cloud while the new Chat is on for their workspace (CHAT_AGENTIC)
 * and on their menu, whatever the plan: the free trial and the demo (owner
 * decision 2026-11-06), and a paid, ended or canceled plan too (2026-11-09).
 * The Action Center while Chat is off, when an Admin's menu access or the
 * person's work areas take Chat off their menu (`chatHidden`), and
 * self-hosted.
 */
export function landingPageFor({
  chatOn,
  chatHidden = false,
}: {
  chatOn: boolean;
  chatHidden?: boolean;
}): string {
  return chatOn && !chatHidden && isCloud() ? CHAT_HOME : DASHBOARD_HOME;
}

/** Whether a sidebar item leads to the home page (it or a parent of it). */
export function isDashboardHomeItem(href: string): boolean {
  return DASHBOARD_HOME === href || DASHBOARD_HOME.startsWith(`${href}/`);
}
