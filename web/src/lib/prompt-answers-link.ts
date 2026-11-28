/**
 * The prompt page's AI answers (Platform Results), reached straight from a
 * Tracked Prompts row or the positions panel: the page scrolls to the section
 * with this id when the address ends in its hash.
 */
export const PROMPT_ANSWERS_ANCHOR = 'ai-answers';

/** `/dashboard/prompts/{id}#ai-answers`: the prompt page, opened on its AI answers. */
export function promptAnswersHref(promptId: string): string {
  return `/dashboard/prompts/${promptId}#${PROMPT_ANSWERS_ANCHOR}`;
}
