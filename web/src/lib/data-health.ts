import type { DateRangePreset } from '@/components/filters/date-range-filter';
import { getDateRange } from '@/lib/date-range';

/**
 * Data health on Insights (00567): per AI platform, the answers the brand's
 * tracked prompts should have brought in over the page's window, how many
 * came in, how many are missing and when the last one landed.
 *
 * One expected answer is one prompt × platform × location × UTC day on or
 * after the day the prompt was added; received counts those cells with an
 * answer, in the same unit, so it never passes expected. Plain helpers, kept
 * out of the 'use server' module that reads it.
 */

/** The page's filters the card follows: the window, the region and the topic. */
export interface DataHealthFilters {
  datePreset: DateRangePreset;
  dateFrom: string;
  dateTo: string;
  region: string;
  topic: string;
}

/** What the read takes: whole UTC days (absent = open), the region and the topic. */
export interface DataHealthArgs {
  dayFrom?: string;
  dayTo?: string;
  region?: string;
  topicId?: string;
}

export interface DataHealthRow {
  platform: string;
  expected: number;
  received: number;
  /** expected − received, never below 0. */
  missing: number;
  /** Received as a whole percent of expected; null when nothing was expected. */
  percent: number | null;
  /** ISO time of the newest answer in the window, or null. */
  lastAnswerAt: string | null;
}

export interface DataHealth {
  rows: DataHealthRow[];
  expected: number;
  received: number;
  missing: number;
  percent: number | null;
}

/** The RPC's own row, as PostgREST returns it (bigints may come as strings). */
export interface DataHealthRpcRow {
  platform: string;
  expected: number | string | null;
  received: number | string | null;
  last_answer_at: string | null;
}

/**
 * The page's filters as the read's arguments. Whole-day presets keep their
 * days; 24h, a rolling window, reads the two UTC days it touches (today's
 * cells count once answered); all time is open on both ends.
 */
export function dataHealthArgs(f: DataHealthFilters, now: Date = new Date()): DataHealthArgs {
  let dayFrom: string | undefined;
  let dayTo: string | undefined;
  if (f.datePreset === '24h') {
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    dayFrom = yesterday.toISOString().slice(0, 10);
    dayTo = today;
  } else {
    const { days } = getDateRange(f.datePreset, { from: f.dateFrom, to: f.dateTo }, now);
    dayFrom = days?.dayFrom;
    dayTo = days?.dayTo;
  }
  return {
    dayFrom,
    dayTo,
    region: f.region || undefined,
    topicId: f.topic || undefined,
  };
}

/**
 * Received as a whole percent of expected. Rounded, except that anything
 * missing never reads as 100% and anything received never reads as 0%.
 */
export function receivedPercent(received: number, expected: number): number | null {
  if (expected <= 0) return null;
  const pct = Math.round((Math.min(received, expected) / expected) * 100);
  if (pct === 100 && received < expected) return 99;
  if (pct === 0 && received > 0) return 1;
  return pct;
}

const count = (v: number | string | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** The RPC's rows as the card's, with the totals across platforms. */
export function parseDataHealth(data: readonly DataHealthRpcRow[] | null | undefined): DataHealth {
  const rows: DataHealthRow[] = (data ?? [])
    .map((r) => {
      const expected = count(r.expected);
      // The SQL counts received in expected's cells; capped again here so a
      // stray row can't show more answers than were due.
      const received = Math.min(count(r.received), expected);
      return {
        platform: r.platform,
        expected,
        received,
        missing: Math.max(expected - received, 0),
        percent: receivedPercent(received, expected),
        lastAnswerAt: r.last_answer_at ?? null,
      };
    })
    .filter((r) => r.expected > 0);
  const expected = rows.reduce((s, r) => s + r.expected, 0);
  const received = rows.reduce((s, r) => s + r.received, 0);
  return {
    rows,
    expected,
    received,
    missing: Math.max(expected - received, 0),
    percent: receivedPercent(received, expected),
  };
}
