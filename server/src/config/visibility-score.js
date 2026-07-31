/**
 * AI Visibility Score — the single source of truth for the blend on the
 * server side (Daily Pulse, reports summary snapshots).
 *
 * score = 100 × (w.mention × mention rate
 *              + w.citation × citation rate
 *              + w.position × position factor)
 *
 * Mirrors web/src/lib/visibility-score.ts — keep the two in sync.
 */

export const VISIBILITY_SCORE_WEIGHTS = {
  mention: 0.6,
  citation: 0.25,
  position: 0.15,
};

/**
 * 0-100 score, one decimal. Returns null when the scope has no answers.
 * @param {{ answers: number, mentionAnswers: number, citationAnswers: number,
 *           positionFactor: number | null }} components
 */
export function computeAiVisibilityScore({
  answers,
  mentionAnswers,
  citationAnswers,
  positionFactor,
}) {
  if (!answers) return null;
  const w = VISIBILITY_SCORE_WEIGHTS;
  const raw =
    100 *
    (w.mention * (mentionAnswers / answers) +
      w.citation * (citationAnswers / answers) +
      w.position * (positionFactor ?? 0));
  return Math.round(raw * 10) / 10;
}
