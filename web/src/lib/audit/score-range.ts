/**
 * A Site Audit score's range, "64 ± 2" (customer priorities item 1, part 2):
 * worked out from the page's own audits, with no AI call. The rule lives in
 * SCORE_RANGE, so it changes in one place.
 */
export const SCORE_RANGE = {
  /** The page's latest complete audits it reads: five are a month of auto-audits. */
  audits: 5,
  /** With fewer complete audits than this, the score shows no range. */
  minAudits: 3,
} as const;

export interface ScoreRange {
  /** Half the gap between the lowest and highest score, in whole points, rounded up. */
  plusMinus: number;
  /** The lowest and highest score of those audits, in points. */
  low: number;
  high: number;
  /** How many audits it read. */
  audits: number;
}

/**
 * The range of a page's score from its trend: its completed scores (0–1),
 * oldest first, ending with the score shown, as the Pages list and the
 * report get them. Partial audits are never in it (they aren't compared).
 * Null with too few audits.
 */
export function scoreRange(trend: readonly number[] | null | undefined): ScoreRange | null {
  const points = (trend ?? []).slice(-SCORE_RANGE.audits).map((score) => Math.round(score * 100));
  if (points.length < SCORE_RANGE.minAudits) return null;
  const low = Math.min(...points);
  const high = Math.max(...points);
  return { plusMinus: Math.ceil((high - low) / 2), low, high, audits: points.length };
}

/**
 * A range handed back as data, such as the one a model passes from
 * get_site_audit to the Agent's audit card: kept only when scoreRange could
 * have given it, so a card never shows a range the rule doesn't.
 */
export function asScoreRange(value: unknown): ScoreRange | null {
  if (!value || typeof value !== 'object') return null;
  const { plusMinus, low, high, audits } = value as Record<string, unknown>;
  const whole = (n: unknown): n is number => Number.isInteger(n);
  if (!whole(plusMinus) || !whole(low) || !whole(high) || !whole(audits)) return null;
  if (audits < SCORE_RANGE.minAudits || audits > SCORE_RANGE.audits) return null;
  if (low < 0 || high > 100 || low > high || plusMinus !== Math.ceil((high - low) / 2)) return null;
  return { plusMinus, low, high, audits };
}
