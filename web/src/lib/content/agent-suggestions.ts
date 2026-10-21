import sanitizeHtml from 'sanitize-html';
import { passageKey } from './cited-passages';

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
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'template', 'title'],
  }).trim();
}

const textOf = (html: string) =>
  decodeEntities(sanitizeHtml(html ?? '', { allowedTags: [], allowedAttributes: {} }));

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
  | 'too_many';

/**
 * The suggestions the editor can apply: a passage that exists; a replace's
 * words found in it as written, changed, and never on a locked passage; an
 * insert's HTML cleaned and not empty; each change once.
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
    if (s.kind === 'replace') {
      if (lockedKeys.has(passageKey(passage.text))) return drop('locked');
      const before = (s.before ?? '').trim();
      const after = textOf(s.after).trim();
      if (!before || !after) return drop('empty');
      if (before === after || after.length > 2000) return drop('no_change');
      if (!passage.text.includes(before)) return drop('not_in_passage');
      const id = `replace:${passage.text}:${before}`;
      if (seen.has(id)) return drop('duplicate');
      seen.add(id);
      kept.push({
        kind: 'replace',
        block_text: passage.text,
        before_text: before,
        after_text: after,
        reason,
        rule_keys: rules,
      });
      return;
    }
    const html = cleanInsertHtml(s.after);
    if (!textOf(html).trim() || html.length > 20_000) return drop('empty');
    const id = `insert:${passage.text}:${html}`;
    if (seen.has(id)) return drop('duplicate');
    seen.add(id);
    kept.push({
      kind: 'insert',
      block_text: passage.text,
      before_text: '',
      after_text: html,
      reason,
      rule_keys: rules,
    });
  });
  return { kept, dropped };
}
