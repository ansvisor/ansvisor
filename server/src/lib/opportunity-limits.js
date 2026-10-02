/**
 * How many content opportunities one generation run may produce.
 *
 * The two generators — the automatic one fired after each tracking cycle and
 * the queued one behind the Generate button — used to carry this rule as a
 * hand-written sentence and a schema ceiling apiece, and had already drifted
 * apart in wording. They share it from here so the button and the nightly run
 * cannot disagree about how many a brand gets.
 *
 * Three, not the five-to-fifteen it was: the model reliably landed near ten,
 * which is more than anyone works through in a day. Generation appends
 * nightly, so anything the reader does not act on accumulates — a short list
 * that gets read beats a long one that gets scrolled past.
 */
export const OPPORTUNITIES_PER_RUN = 3;

/**
 * The count instruction, worded for a model that must now choose.
 *
 * At ten the ranking barely mattered; the good ones arrived alongside the
 * filler. At three there is no room for filler, so the instruction has to say
 * that the slots go to the highest-impact opportunities in the data rather
 * than to whichever the model composes first. The prompt data is already
 * ordered by score, which is what "provided" refers to.
 */
export const OPPORTUNITY_COUNT_RULE = `- Generate exactly ${OPPORTUNITIES_PER_RUN} opportunities: the ${OPPORTUNITIES_PER_RUN} highest-impact ones supported by the data provided, not the first ${OPPORTUNITIES_PER_RUN} that come to mind. Weigh volume, the visibility gap and the competitor gap together when choosing which ${OPPORTUNITIES_PER_RUN} to keep, and drop anything you would have ranked below them.`;

/**
 * Open (status 'new') opportunities a prompt may hold before the nightly run
 * skips it (#837). Prompts are ranked by a deterministic score, so without a
 * cap the same top prompts win every night and pile up rewordings of one idea
 * — one prompt had collected 38 open opportunities over 32 nights.
 */
export const MAX_OPEN_PER_PROMPT = 3;

/** Open opportunity count per prompt id, from rows carrying `prompt_id`. */
export function openCountsByPrompt(rows) {
  const counts = new Map();
  for (const r of rows || []) {
    if (r.prompt_id) counts.set(r.prompt_id, (counts.get(r.prompt_id) || 0) + 1);
  }
  return counts;
}

/** Candidates whose prompt still has room for another open opportunity. */
export function belowOpenCap(candidates, counts) {
  return candidates.filter((c) => (counts.get(c.promptId) || 0) < MAX_OPEN_PER_PROMPT);
}

/**
 * The candidate an opportunity's relatedPromptIndex points at, or null when
 * the model returned an index outside the list. Such an opportunity is
 * dropped: falling back to the first candidate attached it to the prompt that
 * was already the most crowded.
 */
export function relatedCandidate(candidates, index) {
  return Number.isInteger(index) && index >= 0 && index < candidates.length
    ? candidates[index]
    : null;
}
