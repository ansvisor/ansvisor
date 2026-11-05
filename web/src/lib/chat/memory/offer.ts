import { memoryTextProblem, normalizeMemoryText, MAX_MEMORY_LINE } from './rules';

/**
 * "Remember this?" (CHAT-14 item 9; Chat Wave 4 W4-33): when the person
 * states a lasting preference without asking Chat to remember it ("from
 * now on…", "always…", "bundan sonra…"), one line under the answer offers
 * to, at most once a conversation. Its click sends "Remember this: …", which
 * opens the Remember card (W3-12a): nothing is saved without that card's
 * Save.
 *
 * The writing model flags the preference in the call it already makes for
 * its next moves (`remember`): no other model call. A pattern list over the
 * person's own message stands in when the model gives none. Pure.
 */

/** What the writing model is told, beside its next moves (prompt rules). */
export const REMEMBER_RULE = `When the person's message states a lasting preference about how to work ("from now on…", "always…", "never…", "bundan sonra…") and they didn't ask you to remember or forget it, also pass remember with your next moves: the preference as one short line in their words, under ${MAX_MEMORY_LINE} characters. Never a secret, a personal detail, a figure or a one-off request; leave it out otherwise.`;

/** A message that asks to remember or forget by itself: the model's save_memory or forget_memory answer it. */
const EXPLICIT =
  /(?<![\p{L}])(?:remember|forget|memorize|hatırla|hatirla|unut|merke dir|vergiss)(?![\p{L}])/iu;

/**
 * A sentence that sets how to work from now on, in the languages Chat
 * answers in: a fallback when the model flags none. Never a question.
 */
const LASTING = [
  /\b(?:from now on|going forward|in (?:all )?future (?:answers|reports|drafts|posts))\b/i,
  /\b(?:please )?always (?:use|write|keep|send|include|add|start|end|answer|reply|format|call|show|cite|spell)\b/i,
  /\b(?:please )?never (?:use|write|say|include|add|mention|call|start|end|send)\b/i,
  /(?<![\p{L}])(?:bundan sonra|bundan böyle|her zaman|hiçbir zaman|artık)(?![\p{L}])/iu,
  /\b(?:ab jetzt|ab sofort|in zukunft)\b/i,
];

/** The sentence of the message that holds a lasting preference, or null. */
export function lastingPreference(message: string): string | null {
  if (EXPLICIT.test(message)) return null;
  const sentences = message
    .split(/(?<=[.!?\n])\s+/)
    .map((sentence) => normalizeMemoryText(sentence))
    .filter(Boolean);
  for (const sentence of sentences) {
    if (sentence.includes('?')) continue;
    if (!LASTING.some((re) => re.test(sentence))) continue;
    const line = sentence.replace(/[.!]+$/, '');
    if (line.length <= MAX_MEMORY_LINE && !memoryTextProblem(line)) return line;
  }
  return null;
}

/** What decides an offer, as the run ended. */
export interface RememberFacts {
  /** The person's message. */
  question: string;
  /** The writing model's line (next moves' `remember`), if it gave one. */
  flagged: string | null;
  /** Both memory switches are on, and the workspace isn't read-only. */
  canSave: boolean;
  /** Someone is watching: not an agent's or a scheduled job's run. */
  attended: boolean;
  /** The run saved or removed a note itself, or read text that tried to instruct. */
  handled: boolean;
  /** This conversation offered once already. */
  offeredBefore: boolean;
  /** The person's lines now (Me, the brand's, the workspace's). */
  existing: readonly string[];
}

/**
 * The line to offer, or null: the model's, else the message's own lasting
 * preference; one memory may keep (item 12), not a note already saved, and
 * only once a conversation, for a person watching who can save it.
 */
export function rememberOffer(facts: RememberFacts): string | null {
  if (!facts.canSave || !facts.attended || facts.handled || facts.offeredBefore) return null;
  if (EXPLICIT.test(facts.question)) return null;
  const flagged = facts.flagged ? normalizeMemoryText(facts.flagged) : '';
  const line =
    flagged && flagged.length <= MAX_MEMORY_LINE && !memoryTextProblem(flagged)
      ? flagged
      : lastingPreference(facts.question);
  if (!line) return null;
  const known = new Set(facts.existing.map((text) => normalizeMemoryText(text).toLowerCase()));
  return known.has(line.toLowerCase()) ? null : line;
}
