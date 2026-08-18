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
