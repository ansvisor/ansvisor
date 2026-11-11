import { dayIn, nextDay, startOfDayIn } from '@/lib/time-zone';
import { weekStart } from '@/lib/action-center/today';

/**
 * Today on Mondays and after the plan ends (SIMPLE_NAV, simplification plan
 * PR 12). Pure: the week's days on the person's clock, and whether the
 * brand has a full week of runs to sum up.
 */

const DAY_MS = 86_400_000;

/** Whether it is Monday on the person's clock. */
export function isMondayIn(now: Date, zone: string): boolean {
  return new Date(`${dayIn(now.getTime(), zone)}T00:00:00Z`).getUTCDay() === 1;
}

/** A day `n` days after `day` (YYYY-MM-DD; negative goes back). */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Last week on the person's clock, Monday to Sunday, and the week before it:
 * as days for the overview's daily rollups, and as instants for what was
 * completed and validated in it.
 */
export function lastWeekOf(
  now: Date,
  zone: string,
): {
  days: { from: string; to: string };
  before: { from: string; to: string };
  start: string;
  end: string;
} {
  const thisMonday = dayIn(Date.parse(weekStart(now, zone)), zone);
  const monday = addDays(thisMonday, -7);
  return {
    days: { from: monday, to: addDays(monday, 6) },
    before: { from: addDays(monday, -7), to: addDays(monday, -1) },
    start: startOfDayIn(monday, zone),
    end: startOfDayIn(nextDay(addDays(monday, 6)), zone),
  };
}

/** A full week of runs: the brand's first completed run came before last week started. */
export function hasFullWeek(firstRunAt: string | null, lastWeekStart: string): boolean {
  return firstRunAt !== null && Date.parse(firstRunAt) <= Date.parse(lastWeekStart);
}
