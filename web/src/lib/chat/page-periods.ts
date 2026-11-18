import { deltaDayWindows, type DayWindow } from '@/lib/insights-windows';
import { isRangePreset, rangeDays, rangeWindow, type ChatRange, type RangeWindow } from './range';

/**
 * A period as the page that shows a figure reads it (the owner's plan of
 * 2026-11-16, item 7: Chat's numbers equal the screen's). The same "Last 24
 * hours" or "Last 7 days" covers different answers on different pages, so a
 * read takes its period the way its own page (the tool's `route`) cuts it:
 *
 *   - Visibility Overview and Citations read "Last 24 hours" as the latest
 *     completed tracking run's UTC day or days, from their daily rollups
 *     (getTrackingWindow's runDays; Citations' rollupWindow), and the
 *     rolling 24 hours before a brand's first run;
 *   - Prompts (resolvePromptRange) and AI Referral Traffic (its page's
 *     getDateRange) read a preset as the last N × 24 hours up to now, not
 *     whole UTC days;
 *   - everywhere else a preset is whole UTC days (range.ts rangeWindow), and
 *     Mentions' function turns its window into the same days.
 *
 * And explain_change (the Why read) compares the run's period with as many
 * days just before it, as the pages' changes do. Pure: scope.ts applies it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);
const dayAt = (day: string) => Date.parse(`${day}T00:00:00.000Z`);

/** Pages that read "Last 24 hours" as the latest completed run's day(s). */
const RUN_DAY_ROUTES: readonly string[] = ['/dashboard/insights', '/dashboard/citations'];

/** Pages that read a preset as the last N × 24 hours (resolvePromptRange; AI Traffic's own). */
const ROLLING_ROUTES: readonly string[] = ['/dashboard/prompts', '/dashboard/traffic'];

const under = (route: string | null | undefined, roots: readonly string[]) =>
  !!route && roots.some((root) => route === root || route.startsWith(`${root}/`));

/** Whether a read's page takes "Last 24 hours" as the latest completed tracking run's days. */
export function readsRunDays(route: string | null | undefined): boolean {
  return under(route, RUN_DAY_ROUTES);
}

/** The latest run's days as a read's window: its first and last UTC day; null without both. */
export function runDaysWindow(days: DayWindow | null | undefined): RangeWindow | null {
  return days?.dayFrom && days.dayTo ? { dateFrom: days.dayFrom, dateTo: days.dayTo } : null;
}

/**
 * A preset as Prompts and AI Traffic read it: from N × 24 hours before
 * `now` to today (their reads have no end; today's last instant is the
 * same). Null for a read of another page, or a custom range (Prompts takes
 * its days in the viewer's time zone; Chat's are UTC days, as elsewhere).
 */
export function rollingWindow(
  route: string | null | undefined,
  range: ChatRange,
  now: Date,
): RangeWindow | null {
  if (!under(route, ROLLING_ROUTES) || !isRangePreset(range)) return null;
  return {
    dateFrom: new Date(now.getTime() - rangeDays(range) * DAY_MS).toISOString(),
    dateTo: dayOf(now.getTime()),
  };
}

/** The Why read's limits (lib/mcp/why.ts whyPeriods): a later period of 3 to 92 days, ending yesterday at most. */
export const WHY_MIN_DAYS = 3;
export const WHY_MAX_DAYS = 92;

/** explain_change's two periods, as its inputs name them. */
export interface WhyPeriods {
  period_a_from: string;
  period_a_to: string;
  period_b_from: string;
  period_b_to: string;
}

/**
 * The periods the Why read compares for a run's period, as the pages
 * compare a period's change (insights-windows.ts deltaDayWindows): its days
 * against as many days just before them. The later one ends yesterday at
 * most (today isn't tracked yet), so "Last 7 days" compares the 6 days to
 * yesterday with the 7 days before the page's period; a range over
 * WHY_MAX_DAYS keeps its last ones. Null when that leaves fewer than
 * WHY_MIN_DAYS (Last 24 hours, a range of today): the read keeps its own
 * last 7 days against the 7 before.
 */
export function whyPeriodsOf(range: ChatRange, now: Date): WhyPeriods | null {
  if (range === '24h') return null;
  const window = rangeWindow(range, now);
  const to = window.dateTo.slice(0, 10);
  const longest = dayOf(dayAt(to) - (WHY_MAX_DAYS - 1) * DAY_MS);
  const from = window.dateFrom.slice(0, 10) < longest ? longest : window.dateFrom.slice(0, 10);
  const { cur, prev } = deltaDayWindows({ dayFrom: from, dayTo: to });
  const yesterday = dayOf(dayAt(dayOf(now.getTime())) - DAY_MS);
  const end = cur.dayTo < yesterday ? cur.dayTo : yesterday;
  if (Math.round((dayAt(end) - dayAt(cur.dayFrom)) / DAY_MS) + 1 < WHY_MIN_DAYS) return null;
  return {
    period_a_from: prev.dayFrom,
    period_a_to: prev.dayTo,
    period_b_from: cur.dayFrom,
    period_b_to: end,
  };
}

/** The explain_change inputs that name its periods: any one given, the app sets none. */
export const WHY_PERIOD_FIELDS = [
  'period_a_from',
  'period_a_to',
  'period_b_from',
  'period_b_to',
  'around',
] as const;
