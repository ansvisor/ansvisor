/**
 * "Suggest a better translation" (LOC-009): the limits, the check of what a
 * person sends, and the lookup of a text's messages key. A plain module (a
 * 'use server' file may only export async functions), read by the form, the
 * server action and the staff review list.
 *
 * Accepting a suggestion only marks its row. Applying it to
 * messages/<locale>.json and to the glossary stays by hand: run
 * web/scripts/translate-messages.mjs again (branch feature/loc-translate).
 */

export const SUGGESTION_TEXT_MAX = 1000;
export const SUGGESTION_NOTE_MAX = 1000;
export const SUGGESTION_PATH_MAX = 500;

export const SUGGESTION_STATUSES = ['new', 'accepted', 'rejected'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/** What the form sends. */
export interface SuggestionInput {
  locale: string;
  path: string;
  currentText: string;
  suggestion: string;
  note?: string;
}

export type SuggestionProblem = 'locale' | 'currentText' | 'suggestion' | 'same' | 'tooLong';

const LOCALE_FORMAT = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

/** Whitespace collapsed to single spaces, ends trimmed. */
function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The text as it is kept, or the first thing wrong with it. */
export function cleanSuggestion(
  input: SuggestionInput,
): { ok: true; value: Required<SuggestionInput> } | { ok: false; problem: SuggestionProblem } {
  const locale = input.locale?.trim() ?? '';
  // English has nothing to suggest; the staff test language (en-XA) is no one's pick.
  if (!LOCALE_FORMAT.test(locale) || locale.split('-')[0] === 'en') {
    return { ok: false, problem: 'locale' };
  }
  const currentText = squash(input.currentText ?? '');
  const suggestion = squash(input.suggestion ?? '');
  const note = (input.note ?? '').trim();
  if (!currentText) return { ok: false, problem: 'currentText' };
  if (!suggestion) return { ok: false, problem: 'suggestion' };
  if (
    currentText.length > SUGGESTION_TEXT_MAX ||
    suggestion.length > SUGGESTION_TEXT_MAX ||
    note.length > SUGGESTION_NOTE_MAX
  ) {
    return { ok: false, problem: 'tooLong' };
  }
  if (currentText === suggestion) return { ok: false, problem: 'same' };
  const path = (input.path ?? '').split(/[?#]/)[0].slice(0, SUGGESTION_PATH_MAX);
  return { ok: true, value: { locale, path, currentText, suggestion, note } };
}

type Tree = { [key: string]: Tree | string };

/**
 * The messages key whose text is exactly `text` in `messages`, when exactly
 * one has it (dotted, like "settings.language.label"); null for none or
 * several, since the person copied what they saw and a text can serve many.
 */
export function findMessageKey(messages: unknown, text: string): string | null {
  const wanted = squash(text);
  if (!wanted) return null;
  const found: string[] = [];
  const walk = (node: unknown, prefix: string) => {
    if (found.length > 1 || typeof node !== 'object' || node === null) return;
    for (const [key, value] of Object.entries(node as Tree)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'string') {
        if (squash(value) === wanted) found.push(path);
      } else {
        walk(value, path);
      }
    }
  };
  walk(messages, '');
  return found.length === 1 ? found[0] : null;
}
