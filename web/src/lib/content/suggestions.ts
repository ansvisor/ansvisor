/**
 * An agent's suggestions on a draft (Content Editor spec v2 §8, CE-018,
 * 00217): changes left for a person to accept or reject, one batch per agent
 * run. The editor shows the latest batch.
 *
 * A replace changes words in a passage (before → after, plain text); an
 * insert adds blocks (HTML) after a passage. Both find their passage by its
 * text, as the agent read it. A page suggestion (00247, Rewrite the page to
 * these rules) is the whole page rewritten, alone in its batch: accepting it
 * puts its page in place of the one the agent read.
 */

import { safeLinkHref } from './editor';

export const SUGGESTION_STATUSES = ['open', 'accepted', 'rejected'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export interface DraftSuggestion {
  id: string;
  batchId: string;
  /** The Action Center action the run came from, with its number ("AC-214"). */
  actionId: string | null;
  actionNo: number | null;
  kind: 'replace' | 'insert' | 'page';
  /** The passage's text when the agent read it. */
  blockText: string;
  /** replace: the words replaced; insert: empty. */
  beforeText: string;
  /** replace: the new words; insert: the blocks added, as HTML; page: the whole page. */
  afterText: string;
  /** page: the page as the agent read it, put back on Undo. */
  beforeHtml?: string | null;
  /** replace: the links on the new words (00240); an insert's are in its HTML. */
  afterLinks?: SuggestionLink[] | null;
  /** Why, as the agent says it: "add a dated data point (rule)". */
  reason: string;
  /** The rules it is meant to fix. */
  ruleKeys: string[];
  status: SuggestionStatus;
  /** When the agent left it: the run's time, for "Last used by Content Agent". */
  createdAt?: string;
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

/** Each question's end: "?" before a space or at the end, or a full-width "？". */
const QUESTION_MARKS = /\?(?=\s|$)|？/g;
const questionsIn = (text: string) => (text.match(QUESTION_MARKS) ?? []).length;

/**
 * Whether changing a heading from `now` to `then` makes it ask more than one
 * question: an FAQ question with a fan-out's question added to it. A new
 * question goes in as its own heading and answer. The same as
 * asksMoreThanOne in server/src/lib/content-agent.js.
 */
export function asksMoreThanOne(now: string, then: string): boolean {
  const questions = questionsIn(then);
  return questions > 1 && questions > questionsIn(now);
}

/** A link on a replace's new words: afterText from start to end, linked to href. */
export interface SuggestionLink {
  start: number;
  end: number;
  href: string;
}

/**
 * A replace's stored links (after_links, 00240) as the editor may put them
 * on: in order, inside the words, not overlapping, each a safe link. Null
 * when there are none.
 */
export function suggestionLinks(raw: unknown, afterText: string): SuggestionLink[] | null {
  if (!Array.isArray(raw)) return null;
  const links: SuggestionLink[] = [];
  for (const item of raw as Partial<SuggestionLink>[]) {
    const { start, end } = item ?? {};
    const href = typeof item?.href === 'string' ? safeLinkHref(item.href) : null;
    if (!href || !Number.isInteger(start) || !Number.isInteger(end)) continue;
    if (start! < (links.at(-1)?.end ?? 0) || end! <= start! || end! > afterText.length) continue;
    links.push({ start: start!, end: end!, href });
  }
  return links.length ? links : null;
}

/** The most suggestions decided at once (00217). */
export const MAX_DECIDE = 200;

/**
 * The most changes one agent run leaves, as the API caps them
 * (content-agent.js MAX_AGENT_SUGGESTIONS): a batch this size may have
 * stopped short, so the editor says to run it again for the rest.
 */
export const AGENT_RUN_MAX = 8;

/** How many are still open, accepted and rejected. */
export function suggestionCounts(suggestions: DraftSuggestion[]) {
  const counts = { open: 0, accepted: 0, rejected: 0 };
  for (const s of suggestions) counts[s.status] += 1;
  return counts;
}
