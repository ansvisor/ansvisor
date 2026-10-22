import sanitizeHtml from 'sanitize-html';
import { passageKey } from './cited-passages';
import { growsPastLimit, headingLimit } from './suggestions';

/**
 * An agent's suggestions through the editor API (CE-022): the same contract
 * the Content Agent keeps on the server (server/src/lib/content-agent.js):
 * an agent reads the draft as numbered passages, then suggests a replace
 * (words in one passage) or an insert (blocks after one). Only what the
 * editor can apply is kept, and never a change to a locked passage.
 */

/** The most suggestions one call leaves. */
export const MAX_API_SUGGESTIONS = 20;

/** A passage of a draft, as the editor reads it: a heading or a paragraph. */
export interface DraftPassage {
  tag: string;
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  // Written as an escape: the editor keeps a non-breaking space as one
  // (U+00A0), and so must a passage's text, or a replace across it never
  // matches there.
  nbsp: '\u00a0',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*|#39);/gi, (match, code: string) => {
    const lower = code.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower];
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(Number(lower.slice(1)));
    return match;
  });
}

/**
 * A draft's passages in order, with each one's text as the editor has it:
 * the saved HTML is the editor's own, so headings and paragraphs (in lists
 * and cells too) are plain elements, never nested.
 */
export function draftPassages(html: string): DraftPassage[] {
  const passages: DraftPassage[] = [];
  for (const match of (html ?? '').matchAll(/<(h[1-6]|p)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    const text = decodeEntities(match[2].replace(/<[^>]*>/g, ''));
    if (text.trim()) passages.push({ tag: match[1].toLowerCase(), text });
  }
  return passages;
}

/** An insert's HTML, kept to the blocks the editor takes from an agent, with no attributes. */
export function cleanInsertHtml(html: string): string {
  return sanitizeHtml(html ?? '', {
    allowedTags: ['h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'br'],
    allowedAttributes: {},
    // The page has its H1, its title: an agent's heading is an H2 at most.
    transformTags: { h1: 'h2' },
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'template', 'title'],
  }).trim();
}

const textOf = (html: string) =>
  decodeEntities(sanitizeHtml(html ?? '', { allowedTags: [], allowedAttributes: {} }));

const isHeading = (tag: string) => /^h[1-6]$/.test(tag);

/** A heading tag's level: h2 → 2. */
const levelOf = (tag: string) => Number(tag.slice(1));

/** The shortest answer a heading's replace may carry for it to go under the heading. */
const MIN_ANSWER_CHARS = 40;

/** A question, then what follows it: "?" before a space, or a full-width "？". */
const QUESTION_AND_ANSWER = /^([\s\S]+?(?:\?(?=\s)|？))\s*(\S[\s\S]*)$/;
/** How an answer ends: a sentence. */
const ANSWER_END = /[.!。！]$/;

/** Where the first block of a cleaned HTML starts. */
const BLOCK_START = /<(?:h[2-4]|p|ul|ol|li)>/;

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A replace's "after" split into the words that go in its passage and the
 * blocks that go after it, as the Content Agent splits it on the server
 * (splitReplace in server/src/lib/content-agent.js). Agents asked to answer
 * under a heading write the heading and its answer (or a whole FAQ) as the
 * replace, which would glue them onto the heading's line. The words are its
 * leading text, or its first block when that is of the passage's kind; the
 * rest is an insert. On a heading, words that answer its question ("What
 * is X? X is …", the answer a sentence of MIN_ANSWER_CHARS or more) keep the
 * question, and the answer becomes the first paragraph under it.
 */
export function splitReplace(after: string, tag: string): { words: string; blocks: string } {
  const html = cleanInsertHtml(after);
  const start = html.search(BLOCK_START);
  let words = start === -1 ? html : html.slice(0, start);
  let blocks = start === -1 ? '' : html.slice(start);
  if (!textOf(words).trim()) {
    const own = blocks.match(
      isHeading(tag) ? /^<(h[2-4])>([\s\S]*?)<\/\1>/ : /^<(p)>([\s\S]*?)<\/p>/,
    );
    if (own) {
      words = own[2];
      blocks = blocks.slice(own[0].length);
    }
  }
  // Line breaks and runs of spaces, not a non-breaking space the passage may keep.
  words = textOf(words)
    .replace(/[ \t\r\n\f]+/g, ' ')
    .trim();
  if (isHeading(tag)) {
    // A question and its answer ("What is X? X is …"): the answer goes under
    // the heading first, before any blocks that came with it. A subtitle that
    // fits ("What is AEO? The Complete Guide") isn't one: an answer ends a
    // sentence. Past the heading's limit, the rest is never the heading's.
    const answered = words.match(QUESTION_AND_ANSWER);
    if (
      answered &&
      (words.length > headingLimit(levelOf(tag)) ||
        (ANSWER_END.test(answered[2]) && answered[2].length >= MIN_ANSWER_CHARS))
    ) {
      words = answered[1];
      blocks = `<p>${escapeHtml(answered[2])}</p>${blocks}`;
    }
  }
  return { words, blocks: blocks.trim() };
}

/** What an agent sends: passage numbers are 1-based, as get_content_draft lists them. */
export interface AgentSuggestionInput {
  kind: 'replace' | 'insert';
  passage: number;
  before?: string;
  after: string;
  reason: string;
  rules?: string[];
}

export interface KeptSuggestion {
  kind: 'replace' | 'insert';
  block_text: string;
  before_text: string;
  after_text: string;
  reason: string;
  rule_keys: string[];
}

/** Why a suggestion wasn't kept, for the agent to correct it. */
export type DroppedReason =
  | 'no_passage'
  | 'locked'
  | 'not_in_passage'
  | 'no_change'
  | 'empty'
  | 'duplicate'
  | 'too_many'
  | 'heading_too_long';

/**
 * The suggestions the editor can apply: a passage that exists; a replace's
 * words found in it as written, changed, and never on a locked passage; an
 * insert's HTML cleaned and not empty; each change once. A replace that
 * carries blocks, or an answer on a heading, is split into a replace and an
 * insert after it (splitReplace); one that would still grow a heading past
 * its limit (growsPastLimit) is dropped.
 */
export function keepAgentSuggestions(
  raw: AgentSuggestionInput[],
  passages: DraftPassage[],
  lockedKeys: Set<string>,
): { kept: KeptSuggestion[]; dropped: { index: number; reason: DroppedReason }[] } {
  const kept: KeptSuggestion[] = [];
  const dropped: { index: number; reason: DroppedReason }[] = [];
  const seen = new Set<string>();
  raw.forEach((s, index) => {
    const drop = (reason: DroppedReason) => dropped.push({ index, reason });
    if (kept.length >= MAX_API_SUGGESTIONS) return drop('too_many');
    const passage = passages[s.passage - 1];
    if (!passage || passage.text.length > 5000) return drop('no_passage');
    const reason = s.reason.trim().slice(0, 300);
    if (!reason) return drop('empty');
    const rules = [...new Set((s.rules ?? []).map((r) => r.trim()).filter(Boolean))].slice(0, 20);
    const insertOf = (html: string): { id: string; row: KeptSuggestion } | null =>
      textOf(html).trim() && html.length <= 20_000
        ? {
            id: `insert:${passage.text}:${html}`,
            row: {
              kind: 'insert',
              block_text: passage.text,
              before_text: '',
              after_text: html,
              reason,
              rule_keys: rules,
            },
          }
        : null;
    // One suggestion's changes are kept together, or not at all: a split
    // replace never leaves a question without its answer.
    const changes: { id: string; row: KeptSuggestion }[] = [];
    if (s.kind !== 'replace') {
      const insert = insertOf(cleanInsertHtml(s.after));
      if (!insert) return drop('empty');
      changes.push(insert);
    } else {
      if (lockedKeys.has(passageKey(passage.text))) return drop('locked');
      const before = (s.before ?? '').trim();
      const { words, blocks } = splitReplace(s.after, passage.tag);
      if (!before || (!words && !blocks)) return drop('empty');
      const changed = !!words && words !== before;
      if (!changed && !blocks) return drop('no_change');
      if (changed && words.length > 2000) return drop('no_change');
      if (!passage.text.includes(before)) return drop('not_in_passage');
      if (
        changed &&
        isHeading(passage.tag) &&
        growsPastLimit(
          levelOf(passage.tag),
          passage.text.trim().length,
          passage.text.replace(before, () => words).trim().length,
        )
      ) {
        return drop('heading_too_long');
      }
      if (changed) {
        changes.push({
          id: `replace:${passage.text}:${before}`,
          row: {
            kind: 'replace',
            block_text: passage.text,
            before_text: before,
            after_text: words,
            reason,
            rule_keys: rules,
          },
        });
      }
      const insert = blocks ? insertOf(blocks) : null;
      if (insert) changes.push(insert);
      if (!changes.length) return drop('empty');
    }
    if (changes.some((c) => seen.has(c.id))) return drop('duplicate');
    if (kept.length + changes.length > MAX_API_SUGGESTIONS) return drop('too_many');
    for (const c of changes) {
      seen.add(c.id);
      kept.push(c.row);
    }
  });
  return { kept, dropped };
}
