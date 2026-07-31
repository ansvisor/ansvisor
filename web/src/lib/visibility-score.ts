/**
 * AI Visibility Score — the single source of truth for the blend.
 *
 * score = 100 × (w.mention × mention rate
 *              + w.citation × citation rate
 *              + w.position × position factor)
 *
 * - mention rate / citation rate: share of answers (0..1) naming / citing
 *   the entity — deterministic parse-time detection, no LLM judges.
 * - position factor: mean of 1/mention_position over answers that name the
 *   entity (0..1; 1 = always named first). Null when never named.
 *
 * The same formula applies to ANY answer set — brand-wide, per prompt, per
 * topic, per platform, per day — which is what keeps every surface's number
 * identical for the same scope and window.
 *
 * Mirrors server/src/config/visibility-score.js — keep the two in sync.
 */

export const VISIBILITY_SCORE_WEIGHTS = {
  mention: 0.6,
  citation: 0.25,
  position: 0.15,
} as const;

export interface VisibilityScoreComponents {
  /** Total answers in the scope (the shared denominator). */
  answers: number;
  /** Answers with >= 1 mention of the entity. */
  mentionAnswers: number;
  /** Answers citing the entity's own domain. */
  citationAnswers: number;
  /** Mean of 1/position over mentioning answers; null when never mentioned. */
  positionFactor: number | null;
}

/** 0-100 score, one decimal. Returns null when the scope has no answers. */
export function computeAiVisibilityScore(c: VisibilityScoreComponents): number | null {
  if (!c.answers) return null;
  const w = VISIBILITY_SCORE_WEIGHTS;
  const raw =
    100 *
    (w.mention * (c.mentionAnswers / c.answers) +
      w.citation * (c.citationAnswers / c.answers) +
      w.position * (c.positionFactor ?? 0));
  return Math.round(raw * 10) / 10;
}
