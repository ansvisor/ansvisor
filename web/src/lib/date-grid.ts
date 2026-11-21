/**
 * The date picker's arithmetic (components/ui/date-picker.tsx), on plain
 * "YYYY-MM-DD" days in UTC, as `<input type="date">` and the database's
 * `date` columns hold them: no time, so no time zone can shift a day.
 */

const DAY_MS = 86_400_000;

/** A day's UTC midnight. */
const at = (day: string) => Date.parse(`${day}T00:00:00Z`);
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Whether `value` is a real day, "2026-02-30" not. */
export function isDay(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return dayOf(at(value)) === value;
}

/** Today, in UTC. */
export const today = (now = new Date()) => dayOf(now.getTime());

export const addDays = (day: string, days: number) => dayOf(at(day) + days * DAY_MS);

/** The same day `months` later, the month's last day when it is shorter (Jan 31 + 1 → Feb 28). */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return dayOf(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last)));
}

/** The day kept between `min` and `max`, each optional. */
export function clampDay(day: string, min?: string, max?: string): string {
  if (min && day < min) return min;
  if (max && day > max) return max;
  return day;
}

export const inRange = (day: string, min?: string, max?: string) =>
  (!min || day >= min) && (!max || day <= max);

/** 0 Sunday … 6 Saturday, as Date#getUTCDay. */
const weekday = (day: string) => new Date(at(day)).getUTCDay();

/**
 * The weekday a locale's weeks start on, 0 Sunday … 6 Saturday: the
 * browser's week info where it has it, else Sunday for English (US) and
 * Monday elsewhere.
 */
export function weekStartOf(locale: string): number {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const firstDay = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    if (firstDay) return firstDay % 7;
  } catch {
    // An unknown locale: the fallback below.
  }
  return /^en(-US)?$/i.test(locale) ? 0 : 1;
}

/** The first day of the week `day` is in. */
export function startOfWeek(day: string, weekStart: number): string {
  return addDays(day, -((weekday(day) - weekStart + 7) % 7));
}

/**
 * The month of `day` as six weeks of seven days, starting on `weekStart`:
 * the days around it from the months before and after included, as a
 * calendar shows them.
 */
export function monthGrid(day: string, weekStart: number): { day: string; inMonth: boolean }[][] {
  const month = day.slice(0, 7);
  let cursor = startOfWeek(`${month}-01`, weekStart);
  const weeks: { day: string; inMonth: boolean }[][] = [];
  for (let w = 0; w < 6; w += 1) {
    const week = [];
    for (let i = 0; i < 7; i += 1) {
      week.push({ day: cursor, inMonth: cursor.startsWith(month) });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}
