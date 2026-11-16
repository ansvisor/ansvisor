import {
  matchesActionCode,
  previousActionCode,
  searchedActionNo,
  type Numbered,
} from './action-ref';

/**
 * Actions looked up by the codes a person wrote (the owner's report of
 * 2026-11-16: "what is AC-481?" was answered from a page of the list that
 * didn't hold it, with "the closest" others in its place). Which actions a
 * code names, and what the answer is told about each code. Pure: Chat's
 * read (mcp/action-center-reads.ts listActionsByCodeFor) and the agents'
 * test set read the same words.
 */

/** The most codes one read looks up: every code of a message ("AC 481 and AC-63") in one read. */
export const ACTION_CODES_MAX = 10;

/** Which of an action's numbers a code named, in the words an answer says it with. */
export type ActionCodeMatch = 'its code' | 'its previous code';

/** A code as the person wrote it, and its number (searchedActionNo); null when it isn't one. */
export interface AskedCode {
  text: string;
  no: number | null;
}

/** Each code once, as first written, at most ACTION_CODES_MAX of them. */
export function askedCodes(codes: readonly string[]): AskedCode[] {
  const asked: AskedCode[] = [];
  for (const code of codes) {
    const text = code.trim();
    const no = searchedActionNo(text);
    if (!text || asked.some((a) => (no === null ? a.text === text : a.no === no))) continue;
    if (asked.length === ACTION_CODES_MAX) break;
    asked.push({ text, no });
  }
  return asked;
}

/**
 * Which of an action's numbers a code names, as the Actions list's search
 * reads it (matchesActionCode): its code (its brand's number once its brand
 * is numbered, else the old global number it still shows), or its previous
 * code (that old number, after). Null when it names neither.
 */
export function codeMatch(action: Numbered, code: AskedCode): ActionCodeMatch | null {
  if (!matchesActionCode(action, code.text)) return null;
  return action.brandNo && code.no !== action.brandNo ? 'its previous code' : 'its code';
}

/** One action a code named: its row, the code asked and which of its numbers matched. */
export type ActionByCode<T> = T & {
  /** The code as the person wrote it ("AC 481"). */
  asked: string;
  matched: ActionCodeMatch;
  /** "AC-648", its code before its brand was numbered (00534); only when it has one. */
  previous_ref?: string;
};

export interface ActionCodeLookup<T> {
  /** What each code found, in words the answer repeats. */
  note: string;
  /** Each action a code named, in the order the codes were asked. */
  actions: ActionByCode<T>[];
  /** The codes no action has, now or before, as written. */
  not_found: string[];
}

/** One code's line of the note, from what it found. */
export function actionCodeNote(
  code: AskedCode,
  found: readonly { ref: string; matched: ActionCodeMatch }[],
): string {
  if (code.no === null) return `"${code.text}" is not an action code.`;
  if (found.length === 0) {
    return `${code.text}: no action of this brand has this code, now or before (codes are per brand). Say so plainly; never offer other actions in its place.`;
  }
  if (found.length === 1) {
    const [one] = found;
    return one.matched === 'its code'
      ? `${one.ref}: one action, by its code.`
      : `${code.text}: one action, by its previous code; its code now is ${one.ref}.`;
  }
  const how = found.map((row) => `${row.ref} by ${row.matched}`).join(', ');
  return `${code.text} names ${found.length} different actions (${how}): name each, say which is which, and never pick one.`;
}

/** The note's last line, whatever the codes found. */
export const ACTION_CODES_NOTE_END =
  'Every status was read, Completed and Dismissed included. Name each action by its title, with its code, and say whether the code asked is its code or its previous code.';

/**
 * What the codes found among a brand's actions (each with its numbers and
 * its row): every action a code names, never one picked between two, its
 * code's match first; and the codes that found none.
 */
export function lookUpCodes<T extends { ref: string }>(
  asked: readonly AskedCode[],
  actions: readonly { numbered: Numbered; row: T }[],
): ActionCodeLookup<T> {
  const found: ActionByCode<T>[] = [];
  const notFound: string[] = [];
  const lines: string[] = [];
  for (const code of asked) {
    const named: ActionByCode<T>[] = [];
    for (const { numbered, row } of actions) {
      const matched = code.no === null ? null : codeMatch(numbered, code);
      if (!matched) continue;
      const previous = previousActionCode(numbered);
      named.push({
        asked: code.text,
        matched,
        ...row,
        ...(previous ? { previous_ref: previous } : {}),
      });
    }
    named.sort((a, b) => Number(a.matched !== 'its code') - Number(b.matched !== 'its code'));
    if (named.length === 0 && code.no !== null) notFound.push(code.text);
    found.push(...named);
    lines.push(actionCodeNote(code, named));
  }
  lines.push(ACTION_CODES_NOTE_END);
  return { note: lines.join(' '), actions: found, not_found: notFound };
}
