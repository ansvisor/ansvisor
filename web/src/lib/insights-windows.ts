import { expandDateToEndOfDay } from '@/lib/dates';

// ── Daily-rollup routing (00066) ────────────────────────────────────────────
//
// The aggregate RPCs used to rescan a brand's whole history per page load;
// past ~55k results that exceeds the authenticated role's 8s statement
// timeout and the wide presets die. Every preset except 24h now describes its
// window as whole UTC days, and calls that carry one are answered from the
// pre-aggregated daily tables instead — cost scales with days in the window,
// never with accumulated results.
//
// Topic-filtered calls deliberately stay on the raw RPCs: topic is a live
// prompt attribute (reassigning a prompt must move its history), the rollups
// have no prompt dimension at brand grain, and a topic slice is a small
// fraction of the scan that made the raw path unaffordable.

/**
 * Whole-day UTC window, 'YYYY-MM-DD' inclusive on both ends. Its presence in
 * an action's opts marks the call as servable from the daily rollups; either
 * bound may be absent (the All-time preset carries an empty window).
 */
export interface DayWindow {
  dayFrom?: string;
  dayTo?: string;
}

export interface WindowedOpts {
  topicId?: string;
  days?: DayWindow;
}

/** The day window to serve from rollups, or null when the raw path must answer. */
export function dailyWindow(opts?: WindowedOpts): DayWindow | null {
  return opts?.days && !opts.topicId ? opts.days : null;
}

export const DAY_MS = 86_400_000;

export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Current + previous equal-length day windows for the ↑/↓ delta math. An
 * unbounded window anchors to the trailing 7 days, mirroring what the raw
 * path's `now() - 7d` default has always compared against. The previous
 * window ends the day BEFORE the current one starts — the raw path's
 * timestamp arithmetic let the two windows share their boundary instant.
 */
export function deltaDayWindows(days: DayWindow): {
  cur: { dayFrom: string; dayTo: string };
  prev: { dayFrom: string; dayTo: string };
} {
  const curTo = days.dayTo ?? utcToday();
  const curFrom = days.dayFrom ?? addDays(curTo, -6);
  const len = Math.round((Date.parse(curTo) - Date.parse(curFrom)) / DAY_MS) + 1;
  const prevTo = addDays(curFrom, -1);
  return {
    cur: { dayFrom: curFrom, dayTo: curTo },
    prev: { dayFrom: addDays(prevTo, -(len - 1)), dayTo: prevTo },
  };
}

// ── Comparison windows (VIS-001) ────────────────────────────────────────────

/**
 * One window an Insights number is computed over: whole UTC days, answered
 * from the daily rollups, or a timestamp range, answered from the raw rows
 * (the 24h view and any topic filter). An absent bound is open.
 */
export type MetricWindow =
  | { kind: 'days'; days: DayWindow }
  | { kind: 'range'; from?: string; to?: string };

export interface ComparisonWindows {
  /** The window the number on screen covers. */
  cur: MetricWindow;
  /** The equal-length window right before it; null for All time, which has none. */
  prev: MetricWindow | null;
  /** Length of `cur` in days (24h is 1); null for All time. */
  windowDays: number | null;
}

/**
 * The windows behind the Visibility number and its change. The card, the
 * breakdown panel and the leaderboard all take their windows from here, so
 * the same filters always compare the same answers (VIS-001).
 *
 * - Whole-day windows compare against the equal run of whole days ending
 *   the day before (deltaDayWindows).
 * - Timestamp windows compare against the equal span ending where the
 *   current one starts.
 * - All time has no previous window: there is no earlier period of the same
 *   length to compare with, so it shows no change at all.
 */
export function comparisonWindows(
  opts?: WindowedOpts & { dateFrom?: string; dateTo?: string },
  now: Date = new Date(),
): ComparisonWindows {
  const daily = dailyWindow(opts);
  if (daily) {
    if (!daily.dayFrom) return { cur: { kind: 'days', days: daily }, prev: null, windowDays: null };
    const { cur, prev } = deltaDayWindows(daily);
    return {
      cur: { kind: 'days', days: daily },
      prev: { kind: 'days', days: prev },
      windowDays: dayCount(cur),
    };
  }

  const from = opts?.dateFrom || undefined;
  const to = expandDateToEndOfDay(opts?.dateTo) ?? now.toISOString();
  if (!from) return { cur: { kind: 'range', from: undefined, to }, prev: null, windowDays: null };
  const span = Date.parse(to) - Date.parse(from);
  return {
    cur: { kind: 'range', from, to },
    prev: { kind: 'range', from: new Date(Date.parse(from) - span).toISOString(), to: from },
    // A day preset read raw (a topic is selected) still covers whole days:
    // count them, as on the rollup path, rather than rounding elapsed time.
    windowDays: opts?.days?.dayFrom
      ? dayCount(deltaDayWindows(opts.days).cur)
      : Math.max(1, Math.round(span / DAY_MS)),
  };
}

function dayCount(days: { dayFrom: string; dayTo: string }): number {
  return Math.round((Date.parse(days.dayTo) - Date.parse(days.dayFrom)) / DAY_MS) + 1;
}

/**
 * A window's bounds for display: 'YYYY-MM-DD' UTC days for whole-day
 * windows, ISO timestamps otherwise; '' for an open bound.
 */
export function windowBounds(win: MetricWindow): { from: string; to: string } {
  return win.kind === 'days'
    ? { from: win.days.dayFrom ?? '', to: win.days.dayTo ?? '' }
    : { from: win.from ?? '', to: win.to ?? '' };
}

/**
 * The Visibility number and its change, from the scores of the two windows.
 * An empty current window reads as 0 (the card has always shown a number);
 * the change is null when there is nothing to compare with.
 */
export function visibilityChange(
  curScore: number | null,
  prevScore: number | null,
): { value: number; prev: number | null; change: number | null } {
  const value = curScore ?? 0;
  return {
    value,
    prev: prevScore,
    change: prevScore === null ? null : Math.round((value - prevScore) * 10) / 10,
  };
}
