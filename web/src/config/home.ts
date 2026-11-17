import { PROMPTS_TRACKED } from '@/lib/prompts-routes';

/**
 * Prompts › Tracked Prompts: where everyone lands (the owner's decision of
 * 2026-11-17, replacing 2026-11-11's Action Center › Today), whatever the
 * plan, the day of the trial, the role, the demo or the install. /dashboard
 * opens it, so sign-in, onboarding (the trial, and the demo then a purchase),
 * payment, setup after purchase and a new brand land here. The Action Center
 * keeps its own address: /dashboard/action-center opens its Today tab.
 */
export const DASHBOARD_HOME = PROMPTS_TRACKED;

/** Whether a sidebar item leads to the home page (it or a parent of it). */
export function isDashboardHomeItem(href: string): boolean {
  return DASHBOARD_HOME === href || DASHBOARD_HOME.startsWith(`${href}/`);
}
