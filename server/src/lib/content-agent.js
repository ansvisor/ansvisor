import { randomUUID } from 'crypto';
import { generateObject } from 'ai';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { resolveModel } from './ai-provider.js';
import { contentBriefModelId, recordUsage } from './content-brief.js';
import { getLanguageName } from './languages.js';
import { enforceImproveQuota } from './plan-guard.js';

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

/** The longest passage the agent may change: keepSuggestions skips longer ones. */
const MAX_PASSAGE_CHARS = 5_000;

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
            'replace: the new words, as plain text; insert: the blocks to add, as simple HTML (h2, h3, p, ul, ol, li, strong, em).',
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
- A replace changes words inside one passage: copy "before" exactly as that passage has it (a phrase or a sentence), and write "after" as plain text that fits in its place.
- An insert adds new blocks after a passage, as simple HTML (h2, h3, p, ul, ol, li, strong, em).
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
 * no attributes; anything else is unwrapped to its text. The editor checks
 * it again where it is inserted, and every save checks the page.
 */
export function cleanInsertHtml(html) {
  const $ = cheerio.load(html || '', null, false);
  $('script, style, iframe, object, embed, noscript, template, head, title').remove();
  for (const el of $('*').get().reverse()) {
    if (!INSERT_TAGS.has(el.tagName?.toLowerCase())) {
      $(el).replaceWith($(el).contents());
      continue;
    }
    for (const name of Object.keys(el.attribs ?? {})) $(el).removeAttr(name);
  }
  return $.html().trim();
}

const textOf = (html) =>
  cheerio
    .load(html || '', null, false)
    .root()
    .text();

/**
 * The model's suggestions the editor can apply: on a passage that exists,
 * a replace's words found in it and never on a locked passage, an insert's
 * HTML cleaned and not empty; the rules named kept to the ones sent, and
 * each change once.
 */
export function keepSuggestions(raw, passages, lockedKeys, ruleKeys) {
  const kept = [];
  const seen = new Set();
  for (const s of raw) {
    if (kept.length >= MAX_AGENT_SUGGESTIONS) break;
    const passage = passages[s.passage - 1];
    const reason = s.reason.trim().slice(0, 300);
    if (!passage || !reason || passage.text.length > MAX_PASSAGE_CHARS) continue;
    const rules = [...new Set(s.rules.filter((key) => ruleKeys.has(key)))];
    if (s.kind === 'replace') {
      if (lockedKeys.has(passageKey(passage.text))) continue;
      const before = s.before.trim();
      const after = textOf(s.after).trim();
      if (!before || !after || before === after || after.length > 2000) continue;
      if (!passage.text.includes(before)) continue;
      const id = `replace:${passage.text}:${before}`;
      if (seen.has(id)) continue;
      seen.add(id);
      kept.push({
        kind: 'replace',
        block_text: passage.text,
        before_text: before,
        after_text: after,
        reason,
        rule_keys: rules,
      });
    } else {
      const html = cleanInsertHtml(s.after);
      if (!textOf(html).trim() || html.length > 20_000) continue;
      const id = `insert:${passage.text}:${html}`;
      if (seen.has(id)) continue;
      seen.add(id);
      kept.push({
        kind: 'insert',
        block_text: passage.text,
        before_text: '',
        after_text: html,
        reason,
        rule_keys: rules,
      });
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
export function buildFixPrompt({ brand, draft, passages, more = false, lockedKeys, input }) {
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
Page type: ${draft.page_type || 'not set'}

Rules the page doesn't meet yet (key: rule — what it asks and how the page reads now):
${rules.join('\n')}
${own.length ? `\nThe writer's own rules, to follow in every change:\n${own.join('\n')}\n` : ''}
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
    .select('id, brand_id, title, body_html, page_type, action_id, status')
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
  await enforceImproveQuota(brand.organization_id, modelId);

  const lockedKeys = new Set(input.locked.map(passageKey));
  const { object, usage } = await generateObject({
    model: resolveModel(modelId),
    schema: suggestionsSchema,
    system: SYSTEM_PROMPT,
    prompt: buildFixPrompt({ brand, draft, passages, more, lockedKeys, input }),
    abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  await recordUsage({ organizationId: brand.organization_id, draftId, modelId, usage });

  const rows = keepSuggestions(
    object.suggestions,
    passages,
    lockedKeys,
    new Set(input.rules.map((r) => r.key)),
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
