import { ACTION_CENTER_TODAY } from '@/lib/action-center/tabs';

/**
 * Action Center › Today: where everyone lands (the owner's decisions of
 * 2026-11-11), whatever the plan, the day of the trial, the role or the
 * install, since the Action Center is on every menu. /dashboard and
 * /dashboard/action-center open it, so sign-in, onboarding, payment and a
 * new brand land here.
 */
export const DASHBOARD_HOME = ACTION_CENTER_TODAY;

/** Whether a sidebar item leads to the home page (it or a parent of it). */
export function isDashboardHomeItem(href: string): boolean {
  return DASHBOARD_HOME === href || DASHBOARD_HOME.startsWith(`${href}/`);
}
