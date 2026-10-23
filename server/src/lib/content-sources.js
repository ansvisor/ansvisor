import * as cheerio from 'cheerio';
import { z } from 'zod';

/**
 * The person's data the Content Agent writes from, and what it says it used
 * (Content Editor v1.1 §3b, CE-033): the sources the Sources tab keeps —
 * prompts, fan-outs, cited pages, Search Console queries — numbered for the
 * model (S1, S2…). Each suggestion names the sources behind it and marks the
 * words each one supports, so the editor shows "Based on" chips and ¹ ² marks.
 *
 * And no number without a source. The model reads a source by its words
 * (a question, a search, an address), never its content, so a mark alone
 * proves nothing: a number the agent adds must be in the page, the brand's
 * or the brief's words, the rules, today's date, or a source's own words —
 * and then it is marked to that source. A suggestion with any other number
 * is not kept; a page the agent writes whole gets a placeholder in its place.
 */

/** The most sources one suggestion names (content_draft_suggestions.sources, 00248). */
export const MAX_SUGGESTION_SOURCES = 8;
/** The most marks one suggestion keeps (source_marks, 00248). */
export const MAX_SOURCE_MARKS = 12;
/** What stands where a number had no source. */
export const NUMBER_PLACEHOLDER = '[figure, source]';

/** What a suggestion says it used, and the words each source supports. */
export const sourcesField = z
  .array(z.string())
  .describe('The numbers (S1, S2…) of your data this change uses; [] when it uses none.');
export const marksField = z
  .array(
    z.object({
      words: z.string().describe('The words in "after" the source supports, copied exactly.'),
      source: z.string().describe('Its number, e.g. S2.'),
    }),
  )
  .describe('Each fact the change takes from your data, with its source.');

/** The rule every prompt that uses the list gives the model. */
export const SOURCES_RULE = `- Your data is numbered (S1, S2…) and listed by its words only: you don't see what a cited page says. Put the numbers of the ones a change uses in "sources", and mark the exact words each supports in "marks"; never write "S1" in the page's words. Add a number only when the page, the brand, the rules or your data's own words have it; otherwise write a placeholder in square brackets.`;

/** A query as the Sources tab keys it: trimmed, spaces collapsed, lowercased (sources.ts normalizeQuery). */
export function normalizeQuery(query) {
  return String(query ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * The sources numbered: [{ id: 'S1', kind, ref, label, detail }], refs as the
 * Sources tab keys its rows (a prompt's id, a normalized query, a page's
 * address), so the editor finds each one there.
 */
export function numberSources({ prompts = [], fanouts = [], pages = [], queries = [] }) {
  const list = [
    ...prompts.map((p) => ({ kind: 'prompt', ref: p.id, label: p.text })),
    ...fanouts.map((f) => ({
      kind: 'fanout',
      ref: normalizeQuery(f.query),
      label: f.query,
      detail: f.platforms?.length ? f.platforms.join(', ') : '',
    })),
    ...pages.map((p) => ({ kind: 'cited_page', ref: p.url, label: p.url, detail: p.kind })),
    ...queries.map((q) => ({ kind: 'gsc_query', ref: normalizeQuery(q), label: q })),
  ].filter((s) => s.ref && s.label);
  return list.map((s, i) => ({ id: `S${i + 1}`, ...s }));
}

const KIND_NAMES = {
  prompt: 'Prompt (a question tracked in AI answers)',
  fanout: 'Fan-out (a search AI ran while answering)',
  cited_page: 'Cited page (AI answers cite it today; answer better, never copy)',
  gsc_query: 'Search Console query (a Google search people use)',
};

/** The numbered list as the model reads it, or '' with none. */
export function sourcesPrompt(numbered) {
  if (!numbered.length) return '';
  const lines = numbered.map(
    (s) =>
      `${s.id} ${KIND_NAMES[s.kind]}: ${s.kind === 'cited_page' ? s.label : `"${s.label}"`}${s.detail ? ` (${s.detail})` : ''}`,
  );
  return `Your data, numbered (cite by number):\n${lines.join('\n')}`;
}

/** A source number written into the words in brackets ("(S2)", "[S1, S3]"): never the page's. */
const SOURCE_ID = /\s?[([]S\d{1,3}(?:\s*[,;]\s*S\d{1,3})*[)\]]/g;

/** Words with the source numbers the model wrote into them taken out. */
export function stripSourceIds(text) {
  return String(text ?? '').replace(SOURCE_ID, '');
}

/** A number as the guard reads it: digits with their separators. */
const NUMBER = /\d+(?:[.,]\d+)*/g;
const CURRENCY = /[$€£¥₺]/;
/** What makes a lone digit a claim: a percent, a times, a scale. */
const UNIT_AFTER =
  /^\s?(?:%|×|[xX]\b|[kKMB]\b|bn\b|mn\b|[Mm]illions?\b|[Bb]illions?\b|[Tt]housands?\b|[Tt]rillions?\b)/;
/** A placeholder the agent leaves ("[figure, source, 2025]"): it holds no claim. */
const BRACKETS = /\[[^\]]*\]/g;

/** A number's value as compared: thousands separators dropped ("1,299" is 1299). */
const valueOf = (token) => token.replace(/[.,](?=\d{3}(?!\d))/g, '');

/** The numbers a text holds, each with where it is. */
export function numbersIn(text) {
  const found = [];
  for (const m of String(text ?? '').matchAll(NUMBER)) {
    found.push({ value: valueOf(m[0]), start: m.index, end: m.index + m[0].length });
  }
  return found;
}

/** The values of every number in these texts. */
export function knownNumbers(...texts) {
  return new Set(texts.flatMap((text) => numbersIn(text).map((n) => n.value)));
}

/** Today as the agent may write it: its year, month and day. */
export function todayText(now = new Date()) {
  return `${now.getUTCFullYear()} ${now.getUTCMonth() + 1} ${now.getUTCDate()}`;
}

/** Tags whose text is never a page's words. */
const NOT_WORDS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'textarea']);

/** All of a page's words, tables and HTML blocks too, each piece apart: where its numbers are read. */
export function htmlText(html) {
  const $ = cheerio.load(html || '', null, false);
  const pieces = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'text') pieces.push(node.data);
      else if (node.type === 'tag' && !NOT_WORDS.has(node.name)) walk(node.children ?? []);
    }
  };
  walk($.root().contents().get());
  return pieces.join(' ');
}

/**
 * HTML's text nodes, each with where it starts in the HTML read as text (as
 * cheerio's .text() and a browser's textContent join them, with nothing
 * between blocks): numbers are read node by node, so "Option 1" and "2
 * seats" in two items never read as 12.
 */
export function textPieces(html) {
  const $ = cheerio.load(html || '', null, false);
  const pieces = [];
  let at = 0;
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        pieces.push({ text: node.data, start: at });
        at += node.data.length;
      } else if (node.type === 'tag') walk(node.children ?? []);
    }
  };
  walk($.root().contents().get());
  return pieces;
}

/**
 * The numbers a text adds: not known, outside a placeholder, and not a lone
 * digit used as a count ("3 ways", "Step 2") — one with a %, a ×, a scale
 * or a currency sign is a claim and counts.
 */
export function addedNumbers(text, known) {
  const s = String(text ?? '').replace(BRACKETS, (m) => ' '.repeat(m.length));
  return numbersIn(s).filter((n) => {
    if (known.has(n.value)) return false;
    const claim = UNIT_AFTER.test(s.slice(n.end)) || CURRENCY.test(s[n.start - 1] ?? '');
    return claim || n.value.length > 1;
  });
}

/**
 * A suggestion's sources and marks, as kept — or null when it adds a number
 * none of them has. `pieces` are its words (one piece for a replace's, an
 * insert's text nodes); `known` the numbers it may write unmarked (the
 * page's, the brand's, the brief's, the rules', today's).
 *
 * Sources: the ones its marks name, then the ones it names, each once and
 * at most MAX_SUGGESTION_SOURCES, as [{ kind, ref, label }]. Marks: each
 * mark's words found in the text, { start, end, source } (an index into the
 * sources), in order and apart; then a mark on each number it adds from a
 * source's own words, to that source. Ids the list doesn't have are dropped.
 */
export function sourceSuggestion({ named, marks, pieces, numbered, known }) {
  const text = pieces.map((p) => p.text).join('');
  const byId = new Map(numbered.map((s) => [s.id.toUpperCase(), s]));
  const sources = [];
  const indexOf = (source) => {
    if (!source) return -1;
    let i = sources.findIndex((s) => s.kind === source.kind && s.ref === source.ref);
    if (i === -1 && sources.length < MAX_SUGGESTION_SOURCES) {
      sources.push({ kind: source.kind, ref: source.ref, label: source.label });
      i = sources.length - 1;
    }
    return i;
  };
  const sourceOf = (id) =>
    byId.get(
      String(id ?? '')
        .trim()
        .toUpperCase(),
    );
  // A marked source first: the cap never drops one a mark needs.
  for (const mark of marks ?? []) indexOf(sourceOf(mark.source));
  for (const id of named ?? []) indexOf(sourceOf(id));

  const kept = [];
  const free = (start, end) => kept.every((k) => end <= k.start || start >= k.end);
  for (const mark of marks ?? []) {
    if (kept.length >= MAX_SOURCE_MARKS) break;
    // The words as text: tags and entities a model copies in don't count.
    const words = cheerio
      .load(String(mark.words ?? ''), null, false)
      .root()
      .text()
      .trim();
    const source = indexOf(sourceOf(mark.source));
    if (!words || source === -1) continue;
    let at = text.indexOf(words);
    while (at !== -1 && !free(at, at + words.length)) at = text.indexOf(words, at + 1);
    if (at !== -1) kept.push({ start: at, end: at + words.length, source });
  }

  // Each number it adds: the page's own, or one of its sources' words'.
  const own = numbered.map((s) => knownNumbers(s.label, s.detail ?? ''));
  for (const piece of pieces) {
    for (const n of addedNumbers(piece.text, known)) {
      const start = piece.start + n.start;
      const end = piece.start + n.end;
      const from = numbered.findIndex((_, i) => own[i].has(n.value));
      if (from === -1) return null;
      const source = indexOf(numbered[from]);
      if (source === -1) return null;
      const marked = kept.some(
        (k) => k.start <= start && end <= k.end && sources[k.source].ref === numbered[from].ref,
      );
      if (!marked && free(start, end) && kept.length < MAX_SOURCE_MARKS) {
        kept.push({ start, end, source });
      }
    }
  }
  kept.sort((a, b) => a.start - b.start);
  return { sources, marks: kept };
}

/** A text with each number it adds put as a placeholder: for a page written whole, with no marks. */
export function placeholderNumbers(text, known) {
  const added = addedNumbers(text, known);
  let out = String(text ?? '');
  for (const n of added.reverse()) {
    // The sign and unit go with it: "$40" and "40%" become the placeholder.
    let start = n.start;
    let end = n.end;
    if (CURRENCY.test(out[start - 1] ?? '')) start -= 1;
    const unit = out.slice(end).match(UNIT_AFTER);
    if (unit) end += unit[0].length;
    out = `${out.slice(0, start)}${NUMBER_PLACEHOLDER}${out.slice(end)}`;
  }
  return out;
}

/** Tags whose text a page's placeholders never touch: code and what isn't words. */
const KEPT_AS_IS = new Set([...NOT_WORDS, 'code', 'pre']);

/** An HTML page with each number it adds put as a placeholder, in its words only. */
export function placeholderNumbersInHtml(html, known) {
  const $ = cheerio.load(html || '', null, false);
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'text') node.data = placeholderNumbers(stripSourceIds(node.data), known);
      // Attributes are left alone.
      else if (node.type === 'tag' && !KEPT_AS_IS.has(node.name)) walk(node.children ?? []);
    }
  };
  walk($.root().contents().get());
  return $.html();
}
