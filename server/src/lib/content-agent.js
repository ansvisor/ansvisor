import { randomUUID } from 'crypto';
import { NoObjectGeneratedError, generateObject } from 'ai';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { resolveModel } from './ai-provider.js';
import { contentBriefModelId } from './content-brief.js';
import { linkAllowList, linkKey, linkTargetsPrompt, readLinkTargets } from './content-links.js';
import { pageTypeFormat } from './content-page-types.js';
import { getLanguageName } from './languages.js';
import { reserveAiBudget } from './plan-guard.js';

/**
 * Fix open rules with agent (Content Editor CE-018, spec §8): the Content
 * Agent reads the draft as saved and the rules it doesn't meet yet, and
 * leaves suggestions for a person to review (content_draft_suggestions,
 * 00217) — never changes to the page itself. A suggestion replaces words in
 * one passage, or adds blocks after one, and names the rules it fixes. The
 * passages AI answers quote today (locked, CE-018) are never changed. It is
 * metered from the organization's AI usage, as the brief is.
 */

/** The most suggestions one run leaves. */
export const MAX_AGENT_SUGGESTIONS = 8;

/** How long the model may take: the editor waits for it. */
const CALL_TIMEOUT_MS = 60_000;

/** The most links one replace keeps (after_links, 00240). */
const MAX_LINKS = 20;

/** The longest passage the agent may change: keepSuggestions skips longer ones. */
const MAX_PASSAGE_CHARS = 5_000;

/**
 * How long an agent may make a heading, by level: an H1 around 50–60
 * characters, an H2 8–15 words, as 2026's SEO/AEO guides advise. Longer, it
 * has taken in an answer. The same as HEADING_LIMITS in
 * web/src/lib/content/suggestions.ts; a person's own headings are never held.
 */
export const HEADING_LIMITS = { h1: 70, other: 90 };

/** The longest an agent may make a heading of this tag. */
export const headingLimit = (tag) => (tag === 'h1' ? HEADING_LIMITS.h1 : HEADING_LIMITS.other);

/** The headings rule both agent prompts give the model (fix rules, Start Agent). */
export const HEADING_RULE = `- A heading stays a heading: one short line, an H1 up to ${HEADING_LIMITS.h1} characters and other headings up to ${HEADING_LIMITS.other}. Never write an answer, a sentence or a FAQ into a heading's replace; to answer under a heading, insert a paragraph after it.`;

/** The fan-outs rule both agent prompts give the model: the ones named, in their words. */
export const FANOUT_RULE = `- Fan-outs are the searches AI engines run for the page's questions. For each fan-out a rule names, in its words ("aeo tracker" → "What is an AEO tracker?"), not questions of your own: fanoutH2 wants an H2, fanoutFaq a question ending in "?" under the FAQ heading. Add it as its own question: after the paragraph that ends an existing answer, insert a heading at the level of the FAQ's other questions (an H3 under an H2 FAQ) and a paragraph that answers it. Reword an existing question into a fan-out's words only when its answer still answers it, replacing that question alone. One question per heading: never add a question to a heading. Call a change a fan-out answer only when it uses a fan-out listed.`;

/** The links rule both agent prompts give the model: only the URLs listed, never invented. */
export const LINK_RULE = `- Links: link only to a URL listed under the pages or sources you may link to, copied exactly, as <a href="URL">the words it explains</a>, in a replace's "after" or in an insert. Cite a source by linking the words it supports. Never invent a URL, never link a heading, and when no listed page fits, add no link.`;

/** The shortest answer a heading's replace may carry for it to go under the heading. */
const MIN_ANSWER_CHARS = 40;

/**
 * How much of the page the model reads, in characters: a very long page is
 * sent up to here, so one run can't spend far past the AI usage budget.
 */
export const MAX_PROMPT_PASSAGE_CHARS = 60_000;

/** How many of a draft's newest suggestions are read to find its latest batch. */
const LATEST_BATCH_ROWS = 50;

/** What the editor sends: the rules still open, and the passages it keeps locked. */
export const fixRulesInput = z.object({
  rules: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(60),
        name: z.string().trim().min(1).max(200),
        /** What the rule asks and how the page reads now: "aim 3,000 characters · 2,610". */
        detail: z.string().trim().max(500).default(''),
      }),
    )
    .min(1)
    .max(40),
  /** Rules in the person's own words, to follow as well. */
  textRules: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
  /** The locked passages, by passageKey. */
  locked: z.array(z.string().max(5000)).max(500).default([]),
});

export const suggestionsSchema = z.object({
  suggestions: z
    .array(
      z.object({
        kind: z.enum(['replace', 'insert']),
        passage: z
          .number()
          .int()
          .describe('The number of the passage it changes, or the one it adds blocks after.'),
        before: z
          .string()
          .describe(
            'replace: the words of that passage to change, copied exactly as written; insert: an empty string.',
          ),
        after: z
          .string()
          .describe(
            `replace: the new words, as plain text with links only as <a href> to the URLs listed (a heading stays one line: an H1 up to ${HEADING_LIMITS.h1} characters, others up to ${HEADING_LIMITS.other}); insert: the blocks to add, as simple HTML (h2, h3, p, ul, ol, li, strong, em, a).`,
          ),
        reason: z.string().describe('What the change does, in a few words.'),
        rules: z.array(z.string()).describe('The keys of the rules it fixes.'),
      }),
    )
    .max(MAX_AGENT_SUGGESTIONS),
});

const SYSTEM_PROMPT = `You are the Content Agent for Answer Engine Optimization (AEO). You improve one web page so it meets its writing rules, by suggesting small changes that a person reviews.

Rules for your suggestions:
- Fix only the rules listed. Each suggestion fixes one or more of them; put their keys in "rules".
- A replace changes words inside one passage: copy "before" exactly as that passage has it (a phrase or a sentence), and write "after" as plain text that fits in its place, with links only as the links rule below says.
- An insert adds new blocks after a passage, as simple HTML (h2, h3, p, ul, ol, li, strong, em, and a for links).
${HEADING_RULE}
${LINK_RULE}
${FANOUT_RULE}
- Never change a passage marked LOCKED: AI assistants quote its wording today. You may insert after it.
- Use only facts from the page and the brand. Never invent numbers, prices, dates, names, sources or quotes. When a rule needs a fact you don't have, write a placeholder in square brackets, e.g. [figure, source, year].
- Keep the page's voice and change as little as each rule needs. At most ${MAX_AGENT_SUGGESTIONS} suggestions.
- "reason" says in a few words what the change does and why, e.g. "add a dated data point (rule)".
- Write in the language asked for.`;

/**
 * A text's words as the editor compares passages, one space apart: the same
 * as passageKey in web/src/lib/content/cited-passages.ts.
 */
export function passageKey(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[’']/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(' ');
}

/** The page's passages as the editor reads them: headings and paragraphs, in order. */
export function draftPassages(html) {
  const $ = cheerio.load(html || '', null, false);
  const passages = [];
  $('h1, h2, h3, h4, h5, h6, p').each((_, el) => {
    const text = $(el).text();
    if (text.trim()) passages.push({ tag: el.tagName.toLowerCase(), text });
  });
  return passages;
}

const INSERT_TAGS = new Set([
  'h2',
  'h3',
  'h4',
  'p',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'b',
  'i',
  'br',
]);

/**
 * An insert's HTML kept to the blocks the editor takes from an agent, with
 * no attributes; anything else is unwrapped to its text. A link stays only
 * to a URL in `links` (linkAllowList), with that URL, and never in a heading.
 * The editor checks it again where it is inserted, and every save checks the
 * page.
 */
export function cleanInsertHtml(html, links = null) {
  const $ = cheerio.load(html || '', null, false);
  $('script, style, iframe, object, embed, noscript, template, head, title').remove();
  // The page has its H1, its title: an agent's heading is an H2 at most.
  $('h1').each((_, el) => {
    el.name = 'h2';
  });
  for (const el of $('*').get().reverse()) {
    const tag = el.tagName?.toLowerCase();
    const href = tag === 'a' && links ? links.get(linkKey(el.attribs?.href)) : undefined;
    const inHeading = $(el).parents('h1, h2, h3, h4, h5, h6').length > 0;
    if (href && !inHeading && $(el).text().trim()) {
      for (const name of Object.keys(el.attribs ?? {})) $(el).removeAttr(name);
      $(el).attr('href', href);
      continue;
    }
    if (!INSERT_TAGS.has(tag)) {
      $(el).replaceWith($(el).contents());
      continue;
    }
    for (const name of Object.keys(el.attribs ?? {})) $(el).removeAttr(name);
  }
  return $.html().trim();
}

/**
 * Inline HTML's words and the links on them, { text, links: [{ start, end,
 * href }] } with offsets into the text: runs of spaces and line breaks
 * collapsed to one space (a non-breaking space stays), trimmed.
 */
export function inlineText(html) {
  const $ = cheerio.load(html || '', null, false);
  let text = '';
  const links = [];
  const add = (data) => {
    const piece = data.replace(/[ \t\r\n\f]+/g, ' ');
    text += text === '' || text.endsWith(' ') ? piece.replace(/^ /, '') : piece;
  };
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'text') add(node.data);
      if (node.type !== 'tag') continue;
      if (node.name === 'br') {
        add(' ');
        continue;
      }
      const start = text.length;
      walk(node.children ?? []);
      if (node.name !== 'a' || !node.attribs?.href) continue;
      let from = start;
      let to = text.length;
      while (from < to && text[from] === ' ') from++;
      while (to > from && text[to - 1] === ' ') to--;
      if (to > from) links.push({ start: from, end: to, href: node.attribs.href });
    }
  };
  walk($.root().contents().get());
  const trimmed = text.replace(/ +$/, '');
  return { text: trimmed, links: links.filter((link) => link.end <= trimmed.length) };
}

const textOf = (html) =>
  cheerio
    .load(html || '', null, false)
    .root()
    .text();

const isHeading = (tag) => /^h[1-6]$/.test(tag);

/** A question, then what follows it: "?" before a space, or a full-width "？". */
const QUESTION_AND_ANSWER = /^([\s\S]+?(?:\?(?=\s)|？))\s*(\S[\s\S]*)$/;
/** How an answer ends: a sentence. */
const ANSWER_END = /[.!。！]$/;
/** What follows a heading's question may open with another question, not an answer. */
const OPENS_WITH_QUESTION = /^[^.!?。！？]*(?:\?(?=\s|$)|？)/;
/** Each question's end: "?" before a space or at the end, or a full-width "？". */
const QUESTION_MARKS = /\?(?=\s|$)|？/g;
const questionsIn = (text) => (text.match(QUESTION_MARKS) ?? []).length;

/** Where the first block of a cleaned HTML starts. */
const BLOCK_START = /<(?:h[2-4]|p|ul|ol|li)>/;

/** Whether a replace grows a heading past its limit: one already longer may still be shortened. */
export function growsPastLimit(passage, before, words) {
  if (!isHeading(passage.tag)) return false;
  const now = passage.text.trim().length;
  const then = passage.text.replace(before, () => words).trim().length;
  return then > headingLimit(passage.tag) && then > now;
}

/**
 * Whether a replace makes a heading ask more than one question: an FAQ
 * question with a fan-out's question added to it ("What is X? What is an
 * AEO tracker?"). A new question goes in as its own heading and answer.
 */
export function asksMoreThanOne(passage, before, words) {
  if (!isHeading(passage.tag)) return false;
  const then = questionsIn(passage.text.replace(before, () => words));
  return then > 1 && then > questionsIn(passage.text);
}

/** A paragraph holding `text`, escaped. */
function paragraph(text) {
  const $ = cheerio.load('<p></p>', null, false);
  $('p').text(text);
  return $.html();
}

/**
 * A replace's "after" split into the words that go in its passage and the
 * blocks that go after it. Asked to answer under a heading, models write the
 * heading and its answer (or a whole FAQ) as the replace, which would glue
 * them onto the heading's line. The words are its leading text, or its first
 * block when that is of the passage's kind; the rest is an insert. On a
 * heading, words that answer its question ("What is X? X is …", the answer
 * a sentence of MIN_ANSWER_CHARS or more) keep the question, and the answer
 * becomes the first paragraph under it. The words' links (to a URL in
 * `links`) come with their offsets; a heading's words keep none.
 */
export function splitReplace(after, tag, links = null) {
  const html = cleanInsertHtml(after, links);
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
  const read = inlineText(words);
  words = read.text;
  const wordLinks = isHeading(tag) ? [] : read.links;
  if (isHeading(tag)) {
    // A question and its answer ("What is X? X is …"): the answer goes under
    // the heading first, before any blocks that came with it. A subtitle that
    // fits ("What is AEO? The Complete Guide") isn't one: an answer ends a
    // sentence. Past the heading's limit, the rest is never the heading's,
    // unless it opens with a second question: that one isn't an answer, and
    // the heading asking both is dropped (asksMoreThanOne).
    const answered = words.match(QUESTION_AND_ANSWER);
    if (
      answered &&
      !OPENS_WITH_QUESTION.test(answered[2]) &&
      (words.length > headingLimit(tag) ||
        (ANSWER_END.test(answered[2]) && answered[2].length >= MIN_ANSWER_CHARS))
    ) {
      words = answered[1];
      blocks = paragraph(answered[2]) + blocks;
    }
  }
  return { words, links: wordLinks, blocks: blocks.trim() };
}

/**
 * The model's suggestions the editor can apply: on a passage that exists,
 * a replace's words found in it and never on a locked passage, an insert's
 * HTML cleaned and not empty; the rules named kept to the ones sent, and
 * each change once. A replace that carries blocks, or an answer on a
 * heading, is split into a replace and an insert after it (splitReplace);
 * one that would still grow a heading past its headingLimit (a long heading
 * may still be shortened), or make it ask a second question, is dropped.
 * Links stay only to the URLs in `links` (linkAllowList): a replace's go in
 * after_links, by offset into its words, an insert's in its HTML.
 */
export function keepSuggestions(raw, passages, lockedKeys, ruleKeys, links = null) {
  const kept = [];
  const seen = new Set();
  for (const s of raw) {
    if (kept.length >= MAX_AGENT_SUGGESTIONS) break;
    const passage = passages[s.passage - 1];
    const reason = s.reason.trim().slice(0, 300);
    if (!passage || !reason || passage.text.length > MAX_PASSAGE_CHARS) continue;
    const rules = [...new Set(s.rules.filter((key) => ruleKeys.has(key)))];
    const insertOf = (html) =>
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
    let changes;
    if (s.kind !== 'replace') {
      changes = [insertOf(cleanInsertHtml(s.after, links))];
    } else {
      if (lockedKeys.has(passageKey(passage.text))) continue;
      const before = s.before.trim();
      if (!before || !passage.text.includes(before)) continue;
      const split = splitReplace(s.after, passage.tag, links);
      const { words, blocks } = split;
      // As many as a suggestion may keep (00240).
      const wordLinks = split.links.slice(0, MAX_LINKS);
      // Linking words the passage already has is a change too.
      const changed = words && (words !== before || wordLinks.length > 0);
      if (
        changed &&
        (words.length > 2000 ||
          growsPastLimit(passage, before, words) ||
          asksMoreThanOne(passage, before, words))
      )
        continue;
      changes = [
        changed && {
          id: `replace:${passage.text}:${before}`,
          row: {
            kind: 'replace',
            block_text: passage.text,
            before_text: before,
            after_text: words,
            ...(wordLinks.length ? { after_links: wordLinks } : {}),
            reason,
            rule_keys: rules,
          },
        },
        blocks && insertOf(blocks),
      ];
    }
    changes = changes.filter(Boolean);
    if (!changes.length || changes.some((c) => seen.has(c.id))) continue;
    if (kept.length + changes.length > MAX_AGENT_SUGGESTIONS) continue;
    for (const c of changes) {
      seen.add(c.id);
      kept.push(c.row);
    }
  }
  return kept;
}

/**
 * The passages the model reads: the ones it may change (up to
 * MAX_PASSAGE_CHARS each), in order, until MAX_PROMPT_PASSAGE_CHARS.
 * `more` says the page goes on past them.
 */
export function promptPassages(passages) {
  const sent = [];
  let chars = 0;
  for (const passage of passages) {
    if (passage.text.length > MAX_PASSAGE_CHARS) continue;
    if (chars + passage.text.length > MAX_PROMPT_PASSAGE_CHARS) {
      return { passages: sent, more: true };
    }
    chars += passage.text.length;
    sent.push(passage);
  }
  return { passages: sent, more: false };
}

/** What the model is told: the brand, the page's passages, and the rules to fix. */
export function buildFixPrompt({
  brand,
  draft,
  passages,
  more = false,
  lockedKeys,
  input,
  linkTargets = '',
}) {
  const lines = passages.map((p, i) => {
    const locked = lockedKeys.has(passageKey(p.text)) ? ', LOCKED' : '';
    return `[${i + 1}] (${p.tag}${locked}) ${p.text}`;
  });
  if (more) lines.push('(The page goes on; suggest changes only to the passages above.)');
  const rules = input.rules.map((r) => `- ${r.key}: ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  const own = input.textRules.map((text) => `- ${text}`);
  return `Brand: ${brand?.name || 'Unknown'}
Industry: ${brand?.industry || 'Not specified'}
Description: ${brand?.description || 'N/A'}

Page: ${draft.title || 'Untitled'}
Page type: ${pageTypeFormat(draft.page_type)}

Rules the page doesn't meet yet (key: rule — what it asks and how the page reads now):
${rules.join('\n')}
${own.length ? `\nThe writer's own rules, to follow in every change:\n${own.join('\n')}\n` : ''}${linkTargets ? `\n${linkTargets}\n` : ''}
The page, passage by passage:
${lines.join('\n')}

Write in ${getLanguageName(brand?.language)}.`;
}

/**
 * Whether the draft's latest batch still has suggestions nobody decided:
 * the editor shows only that batch, so a new one would hide them (and Undo
 * on the ones accepted).
 */
export async function hasOpenSuggestions(draftId) {
  const { data, error } = await supabaseAdmin
    .from('content_draft_suggestions')
    .select('batch_id, status')
    .eq('draft_id', draftId)
    .order('created_at', { ascending: false })
    .limit(LATEST_BATCH_ROWS);
  if (error) throw error;
  const latest = data?.[0]?.batch_id;
  return (data ?? []).some((row) => row.batch_id === latest && row.status === 'open');
}

/**
 * Runs the agent on a draft: reads it and its brand, charges the AI usage
 * budget, asks the model, and keeps the suggestions the editor can apply as
 * one new batch, linked to the draft's Action Center action if it has one.
 * Throws with `.status` 404 for a draft outside the brand, 409 for a
 * published draft or one whose suggestions are still open, 422 for an empty
 * page, PlanLimitError once the budget is spent — all before charging.
 */
export async function fixDraftRules({ draftId, brandId, input }) {
  const { data: draft, error: draftError } = await supabaseAdmin
    .from('content_drafts')
    .select('id, brand_id, title, body_html, page_type, action_id, status, source_url')
    .eq('id', draftId)
    .maybeSingle();
  if (draftError) throw draftError;
  if (!draft || draft.brand_id !== brandId) {
    throw Object.assign(new Error('Draft not found'), { status: 404 });
  }
  if (draft.status === 'published') {
    throw Object.assign(new Error('The draft is published'), { status: 409, code: 'published' });
  }
  const { passages, more } = promptPassages(draftPassages(draft.body_html));
  if (!passages.length) {
    throw Object.assign(new Error('The page has no text to fix'), { status: 422, code: 'empty' });
  }
  if (await hasOpenSuggestions(draftId)) {
    throw Object.assign(new Error('Decide the open suggestions first'), {
      status: 409,
      code: 'open_suggestions',
    });
  }

  const { data: brand, error: brandError } = await supabaseAdmin
    .from('brands')
    .select('name, industry, description, organization_id, language')
    .eq('id', brandId)
    .single();
  if (brandError) throw brandError;

  const modelId = contentBriefModelId();
  const lockedKeys = new Set(input.locked.map(passageKey));
  const ruleKeys = new Set(input.rules.map((r) => r.key));
  // Where it may link: the brand's pages and the draft's sources (A).
  const targets = await readLinkTargets({
    brandId,
    draftId,
    sourceUrl: draft.source_url,
    ruleKeys,
  });
  // Held on the budget before the call, so calls at once can't pass it.
  const budget = await reserveAiBudget(brand.organization_id, {
    feature: 'content',
    modelId,
    draftId,
  });
  let object;
  try {
    const generated = await generateObject({
      model: resolveModel(modelId),
      schema: suggestionsSchema,
      system: SYSTEM_PROMPT,
      prompt: buildFixPrompt({
        brand,
        draft,
        passages,
        more,
        lockedKeys,
        input,
        linkTargets: linkTargetsPrompt(targets, ruleKeys),
      }),
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    await budget.charge(generated.usage);
    object = generated.object;
  } catch (err) {
    // An answer the provider billed but that missed the schema is charged,
    // as Improve's is: else it, and each retry after it, would run free.
    if (NoObjectGeneratedError.isInstance(err) && err.usage) await budget.charge(err.usage);
    throw err;
  } finally {
    // Nothing charged (a timeout, a refusal): the hold goes.
    await budget.release();
  }

  const rows = keepSuggestions(
    object.suggestions,
    passages,
    lockedKeys,
    ruleKeys,
    linkAllowList(targets),
  );
  if (!rows.length) return { count: 0, batchId: null };

  const batchId = randomUUID();
  const { error: insertError } = await supabaseAdmin.from('content_draft_suggestions').insert(
    rows.map((row, position) => ({
      ...row,
      draft_id: draftId,
      batch_id: batchId,
      action_id: draft.action_id ?? null,
      position,
    })),
  );
  if (insertError) throw insertError;
  return { count: rows.length, batchId };
}
