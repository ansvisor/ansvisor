import type { CompetitorComparisonEntry } from '@/lib/actions/tracking';

/**
 * A brand named in fewer prompts than this is not ranked on a report's
 * Competitor Leaderboard (UX audit RP-07, decision D8): a score from one or
 * two answers says little, and ranked above a brand named in ninety it
 * misleads. Such brands are listed after the ranked ones as "Low sample".
 */
export const LEADERBOARD_MIN_PROMPTS = 10;

type LeaderboardEntry = Pick<
  CompetitorComparisonEntry,
  'name' | 'score' | 'visibilityRate' | 'avgVisibilityScore' | 'visiblePrompts'
>;

export interface LeaderboardRow<T> {
  entry: T;
  /** Named in fewer than LEADERBOARD_MIN_PROMPTS prompts: listed, not ranked. */
  lowSample: boolean;
}

/** The number a row is ranked by: the Visibility score, or an older report's own metric. */
function rankValue(e: LeaderboardEntry): number {
  if (typeof e.score === 'number') return e.score;
  if (typeof e.visibilityRate === 'number') return e.visibilityRate;
  return e.avgVisibilityScore ?? 0;
}

/**
 * A saved report's leaderboard in the order it is shown, on the page and in
 * the PDF: the ranked brands by Visibility score, highest first (ties by
 * name), then the low-sample ones in the same order. A report saved before
 * the prompt counts existed (#492) has no sample to judge, so every brand in
 * it is ranked.
 */
export function leaderboardRows<T extends LeaderboardEntry>(entries: T[]): LeaderboardRow<T>[] {
  const byRank = (a: T, b: T) => rankValue(b) - rankValue(a) || a.name.localeCompare(b.name);
  const rows = entries.map((entry) => ({
    entry,
    lowSample:
      typeof entry.visiblePrompts === 'number' && entry.visiblePrompts < LEADERBOARD_MIN_PROMPTS,
  }));
  return [
    ...rows.filter((r) => !r.lowSample).sort((a, b) => byRank(a.entry, b.entry)),
    ...rows.filter((r) => r.lowSample).sort((a, b) => byRank(a.entry, b.entry)),
  ];
}
