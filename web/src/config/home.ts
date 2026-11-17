import { ACTION_CENTER_TODAY } from '@/lib/action-center/tabs';
import { menuSectionOf } from '@/lib/menu-access';
import { PROMPTS_TRACKED } from '@/lib/prompts-routes';

/**
 * Prompts › Tracked Prompts: where everyone lands (the owner's decision of
 * 2026-11-17, replacing 2026-11-11's Action Center › Today), whatever the
 * plan, the day of the trial, the role, the demo or the install, as long as
 * Prompts is on their menu (homeFor). /dashboard opens it, so sign-in,
 * onboarding (the trial, and the demo then a purchase), payment, setup after
 * purchase and a new brand land here. The Action Center keeps its own
 * address: /dashboard/action-center opens its Today tab.
 */
export const DASHBOARD_HOME = PROMPTS_TRACKED;

/** The menu section the home is in (menu access): Prompts. */
const HOME_SECTION = menuSectionOf(DASHBOARD_HOME);

/**
 * A person's home, by the sections off their menu (menu access, as the
 * sidebar has them: MyMenu.hidden): Tracked Prompts, or Action Center ›
 * Today, which is on every menu, when Prompts is off theirs. Nobody lands
 * on a page their menu doesn't show.
 */
export function homeFor(hiddenSections: Iterable<string> = []): string {
  for (const section of hiddenSections) {
    if (section === HOME_SECTION) return ACTION_CENTER_TODAY;
  }
  return DASHBOARD_HOME;
}

/** Whether a sidebar item leads to the home page (it or a parent of it). */
export function isDashboardHomeItem(href: string, home: string = DASHBOARD_HOME): boolean {
  return home === href || home.startsWith(`${href}/`);
}

/** A page with the first tracking run's job (?jobId=), for TrackingJobHandoff. */
export function withJobId(href: string, jobId: string | null | undefined): string {
  return jobId ? `${href}?jobId=${encodeURIComponent(jobId)}` : href;
}
