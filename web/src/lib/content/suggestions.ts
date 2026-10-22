/**
 * An agent's suggestions on a draft (Content Editor spec v2 §8, CE-018,
 * 00217): changes left for a person to accept or reject, one batch per agent
 * run. The editor shows the latest batch.
 *
 * A replace changes words in a passage (before → after, plain text); an
 * insert adds blocks (HTML) after a passage. Both find their passage by its
 * text, as the agent read it.
 */

export const SUGGESTION_STATUSES = ['open', 'accepted', 'rejected'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export interface DraftSuggestion {
  id: string;
  batchId: string;
  /** The Action Center action the run came from, with its number ("AC-214"). */
  actionId: string | null;
  actionNo: number | null;
  kind: 'replace' | 'insert';
  /** The passage's text when the agent read it. */
  blockText: string;
  /** replace: the words replaced; insert: empty. */
  beforeText: string;
  /** replace: the new words; insert: the blocks added, as HTML. */
  afterText: string;
  /** Why, as the agent says it: "add a dated data point (rule)". */
  reason: string;
  /** The rules it is meant to fix. */
  ruleKeys: string[];
  status: SuggestionStatus;
}

/**
 * How long an agent's change may make a heading, by level: an H1 around 50–60
 * characters, an H2 8–15 words, as 2026's SEO/AEO guides advise. Longer, it
 * has taken in an answer (the agent glued "What is X? X is …" into H2s). The
 * same as HEADING_LIMITS in server/src/lib/content-agent.js; a person's own
 * headings are never held.
 */
export const HEADING_LIMITS = { h1: 70, other: 90 } as const;

/** The longest an agent may make a heading of this level (1–6). */
export function headingLimit(level: number): number {
  return level === 1 ? HEADING_LIMITS.h1 : HEADING_LIMITS.other;
}

/**
 * Whether changing a heading from `now` to `then` characters grows it past
 * its limit: one already longer may still be shortened.
 */
export function growsPastLimit(level: number, now: number, then: number): boolean {
  return then > headingLimit(level) && then > now;
}

/** The most suggestions decided at once (00217). */
export const MAX_DECIDE = 200;

/** How many are still open, accepted and rejected. */
export function suggestionCounts(suggestions: DraftSuggestion[]) {
  const counts = { open: 0, accepted: 0, rejected: 0 };
  for (const s of suggestions) counts[s.status] += 1;
  return counts;
}
