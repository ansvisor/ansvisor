import { isCloud } from '@/config/plans';
import { ACTION_CENTER_TODAY } from '@/lib/action-center/tabs';

/**
 * The Action Center's Actions, where Getting started and the actions live
 * (New Ansvisor, AC-ALT2 §3). /dashboard/action-center redirects here, and
 * it is where a person lands while Chat isn't theirs to start on
 * (landingPageFor). Sign-in, onboarding, payment and a new brand land on
 * /dashboard, which sends each person to their page.
 */
export const DASHBOARD_HOME = '/dashboard/action-center/actions';

/**
 * Action Center › Today: where everyone lands with the simplified layout on
 * (SIMPLE_NAV, the owner's decisions of 2026-11-11), whatever the plan, the
 * day of the trial, the role or the install. /dashboard/action-center opens
 * it then.
 */
export const TODAY_HOME = ACTION_CENTER_TODAY;

/** The dashboard's home: Today with SIMPLE_NAV on, the Action Center's Actions otherwise. */
export function dashboardHomeOf(simpleNav: boolean): string {
  return simpleNav ? TODAY_HOME : DASHBOARD_HOME;
}

/** Chat Home: where Ansvisor starts (owner decisions 2026-11-06 and 2026-11-09). */
export const CHAT_HOME = '/dashboard/chat';

/**
 * Insights (Visibility's Overview): where a paid workspace starts, and a
 * free trial from its second day (owner decisions 2026-11-10).
 */
export const INSIGHTS_HOME = '/dashboard/insights';

/**
 * The page a person lands on, each time they come to Ansvisor. With the
 * simplified layout on (`simpleNav`, SIMPLE_NAV): Action Center › Today, for
 * everyone, which is on every menu. Otherwise, on Ansvisor
 * Cloud: Insights while it is on the person's menu, for a workspace that
 * starts there (`onInsights`, startsOnInsights): its plan is active (set to
 * cancel at the period's end too), or its free trial is past its first day
 * (owner decisions 2026-11-10). Else Chat Home while the new Chat is on for
 * their workspace (CHAT_AGENTIC) and on their menu: the trial's first day,
 * the demo (2026-11-06), a payment due, an ended or canceled plan
 * (2026-11-09). The Action Center while Chat is off, when an Admin's menu
 * access or the person's work areas take Chat off their menu
 * (`chatHidden`), and self-hosted. The checkout's success route asks
 * without `onInsights`: a new buyer starts on Chat Home.
 */
export function landingPageFor({
  chatOn,
  chatHidden = false,
  onInsights = false,
  insightsHidden = false,
  simpleNav = false,
}: {
  chatOn: boolean;
  chatHidden?: boolean;
  onInsights?: boolean;
  insightsHidden?: boolean;
  simpleNav?: boolean;
}): string {
  if (simpleNav) return TODAY_HOME;
  if (!isCloud()) return DASHBOARD_HOME;
  if (onInsights && !insightsHidden) return INSIGHTS_HOME;
  return chatOn && !chatHidden ? CHAT_HOME : DASHBOARD_HOME;
}

const DAY_MS = 86_400_000;

/** The calendar day of a moment in a time zone, as YYYY-MM-DD; UTC's when the zone is unknown. */
function calendarDay(at: Date, timeZone: string | null): string {
  const format = (zone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  if (timeZone) {
    try {
      return format(timeZone);
    } catch {
      // Not a zone this runtime knows: UTC's day.
    }
  }
  return format('UTC');
}

/**
 * Whether a workspace starts on Insights (landingPageFor's `onInsights`):
 * its plan is active, or its free trial is past its first day. The trial
 * began TRIAL_DAYS before it ends (Checkout's trial_period_days, and the
 * trial's end is the subscription's period end, subscription_ends_at). Its
 * second day starts at midnight in the person's time zone (Settings,
 * profiles.time_zone), UTC's without one. A trial without an end date
 * stays on its first day.
 */
export function startsOnInsights({
  status,
  periodEnd,
  timeZone = null,
  trialDays,
  now = new Date(),
}: {
  status: string | null | undefined;
  periodEnd: string | null | undefined;
  timeZone?: string | null;
  trialDays: number;
  now?: Date;
}): boolean {
  if (status === 'active') return true;
  if (status !== 'trialing' || !periodEnd) return false;
  const end = new Date(periodEnd).getTime();
  if (Number.isNaN(end)) return false;
  const began = new Date(end - trialDays * DAY_MS);
  return calendarDay(now, timeZone) > calendarDay(began, timeZone);
}

/** Whether a sidebar item leads to the home page (it or a parent of it); Today's with SIMPLE_NAV on. */
export function isDashboardHomeItem(href: string, simpleNav = false): boolean {
  const home = dashboardHomeOf(simpleNav);
  return home === href || home.startsWith(`${href}/`);
}
