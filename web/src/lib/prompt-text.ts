/**
 * A prompt's text as it is saved: trimmed, its runs of spaces made one, at
 * most PROMPT_TEXT_MAX characters (as Bulk import takes them). Shared by the
 * Prompts page's editors and the server actions that save an edited text.
 */

export const PROMPT_TEXT_MAX = 500;

/** The text to save, or null when it is empty or longer than PROMPT_TEXT_MAX. */
export function cleanPromptText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text && text.length <= PROMPT_TEXT_MAX ? text : null;
}
