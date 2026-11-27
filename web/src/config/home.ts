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

/**
 * Brand Visibility's Overview: where someone lands once their workspace has
 * answers (the owner's decision of 2026-11-26), so a sign-in opens on how
 * visible the brand is and what changed. Before the first answers it would
 * be empty, so Tracked Prompts stays the home until then, with the first
 * run's progress.
 */
export const RESULTS_HOME = '/dashboard/insights';

/** The menu section the home is in (menu access): Prompts. */
const HOME_SECTION = menuSectionOf(DASHBOARD_HOME);

/**
 * A person's home, by the sections off their menu (menu access, as the
 * sidebar has them: MyMenu.hidden) and whether the workspace has answers
 * yet: Brand Visibility's Overview once it has (RESULTS_HOME), else
 * Tracked Prompts, else Action Center › Today, which is on every menu.
 * Nobody lands on a page their menu doesn't show.
 */
export function homeFor(
  hiddenSections: Iterable<string> = [],
  { hasResults = false }: { hasResults?: boolean } = {},
): string {
  const hidden = new Set(hiddenSections);
  if (hasResults && !hidden.has(menuSectionOf(RESULTS_HOME) ?? '')) return RESULTS_HOME;
  if (hidden.has(HOME_SECTION ?? '')) return ACTION_CENTER_TODAY;
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
