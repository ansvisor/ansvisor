/**
 * The Tracked Prompts table's Positions cell (PROMPT-007): average mention
 * position over the selected range, its change against the previous period of
 * the same length, and one dot per platform.
 *
 * Pure on purpose: the server action loads per-platform sums
 * (prompt_position_summaries, 00123) and this turns them into the cell. The
 * average is the Positions panel's: the mean mention position over the
 * answers that mention the brand, on the plan-included platforms.
 */

import { positionTone } from '@/lib/position-tone';
import { MIN_MENTION_RATE } from '@/lib/prompt-improve';

/** One platform's sums for one prompt over a window. */
export interface PlatformPositionRow {
  platform: string;
  runs: number;
  mentionAnswers: number;
  positionSum: number;
  positionCount: number;
  entitySum: number;
  entityCount: number;
}

/**
 * - early     mentioned, in the first third of the brands named
 * - late      mentioned, but further down
 * - mentioned mentioned, with no stored position
 * - missing   mentioned in fewer than half the runs, or never: the Improve
 *             tab's "Not mentioned" (MIN_MENTION_RATE)
 * - no_runs   nothing tracked in the window
 */
export type PlatformDotState = 'early' | 'late' | 'mentioned' | 'missing' | 'no_runs';

export interface PlatformDot {
  id: string;
  label: string;
  state: PlatformDotState;
  /** The platform's average position; null when not mentioned or unknown. */
  avg: number | null;
  runs: number;
  /** Runs that mention the brand, for "mentioned in 8 of 120 runs". */
  mentionedRuns: number;
}

export interface PromptPositionCell {
  /** Average mention position over the window; null when never ranked. */
  avg: number | null;
  /** Previous period's average minus this one: positive means it moved up. */
  delta: number | null;
  dots: PlatformDot[];
  /** Late or missing on at least one platform — the "work queue" filter. */
  lateOrMissing: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function average(rows: PlatformPositionRow[]): number | null {
  const sum = rows.reduce((a, r) => a + r.positionSum, 0);
  const count = rows.reduce((a, r) => a + r.positionCount, 0);
  return count > 0 ? round1(sum / count) : null;
}

function dotState(row: PlatformPositionRow | undefined): PlatformDotState {
  if (!row || row.runs === 0) return 'no_runs';
  // Same rule as the Improve tab: #1 in 8 of 120 answers is mostly missing.
  if (row.mentionAnswers < row.runs * MIN_MENTION_RATE) return 'missing';
  if (row.positionCount === 0) return 'mentioned';
  const rank = row.positionSum / row.positionCount;
  const total = row.entityCount > 0 ? row.entitySum / row.entityCount : rank;
  return positionTone(rank, Math.max(total, rank)) === 'Early' ? 'early' : 'late';
}

/**
 * The cell for one prompt. `platforms` are the ones the prompt tracks that
 * the plan includes, in display order; rows for any other platform are
 * ignored, so the average matches the panel's.
 */
export function buildPositionCell(
  current: PlatformPositionRow[],
  previous: PlatformPositionRow[],
  platforms: { id: string; label: string }[],
): PromptPositionCell {
  const ids = new Set(platforms.map((p) => p.id));
  const now = current.filter((r) => ids.has(r.platform));
  const before = previous.filter((r) => ids.has(r.platform));
  const avg = average(now);
  const prev = average(before);
  const dots = platforms.map((p) => {
    const row = now.find((r) => r.platform === p.id);
    const state = dotState(row);
    return {
      id: p.id,
      label: p.label,
      state,
      avg:
        row && state !== 'missing' && row.positionCount > 0
          ? round1(row.positionSum / row.positionCount)
          : null,
      runs: row?.runs ?? 0,
      mentionedRuns: row?.mentionAnswers ?? 0,
    };
  });
  return {
    avg,
    delta: avg !== null && prev !== null ? round1(prev - avg) : null,
    dots,
    lateOrMissing: dots.some((d) => d.state === 'late' || d.state === 'missing'),
  };
}

/** The previous period of the same length, ending where this one starts. */
export function previousWindow(window: { from: string; to?: string }, now = Date.now()) {
  const from = Date.parse(window.from);
  const to = window.to ? Date.parse(window.to) : now;
  const span = Math.max(0, to - from);
  return { from: new Date(from - span).toISOString(), to: new Date(from).toISOString() };
}
