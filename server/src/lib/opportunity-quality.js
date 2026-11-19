import supabaseAdmin from '../config/supabase.js';
import { IMPROVE_PLATFORM_LABELS } from './prompt-improve.js';

/**
 * What an opportunity the model wrote must be to be kept (Content test
 * 2026-11-19, items 15 and 16): about engines the brand tracks, not a
 * near-copy of one still open, and with keywords from its own prompts and
 * the searches AI ran for them.
 *
 * - "…analytics setup for Perplexity and Gemini" was open while Perplexity
 *   was paused: an opportunity naming an engine none of the brand's active
 *   prompts runs on isn't kept.
 * - Three open ones on tracking ChatGPT + Gemini + Google AIO, ten "Best AI
 *   SEO Tools" variants: one whose title says what an open one's says, in
 *   other words, isn't kept. The baskets check (opportunity-dedup.js) runs
 *   before the model; this reads what it wrote.
 * - The keyword tool's keywords ("ai search engine, chatbot") for a
 *   "Profound alternatives" page: only the ones its prompts or fan-outs
 *   share words with stay, and its most searched fan-outs fill the rest.
 */

/** Each engine as titles name it, by the platform ids prompts run on. */
const ENGINE_NAMES = {
  'chatgpt-web': /\bchat\s?gpt\b/i,
  'perplexity-web': /\bperplexity\b/i,
  'google-aio': /\b(?:google\s+)?ai\s+overviews?\b|\baio\b/i,
  'google-aimode': /\b(?:google\s+)?ai\s+mode\b/i,
  'gemini-web': /\bgemini\b/i,
  'copilot-web': /\bcopilot\b/i,
  'grok-web': /\bgrok\b/i,
  claude: /\bclaude\b/i,
};

/**
 * The platform ids the brand's active prompts run on; null when it can't be
 * read (nothing is held back then).
 */
export async function trackedPlatforms(brandId) {
  const { data: sets, error } = await supabaseAdmin
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);
  if (error) return null;
  const ids = (sets ?? []).map((s) => s.id);
  if (!ids.length) return null;
  const { data: prompts, error: promptsError } = await supabaseAdmin
    .from('prompts')
    .select('platforms')
    .in('prompt_set_id', ids)
    .eq('is_active', true)
    .limit(1000);
  if (promptsError) return null;
  const platforms = new Set((prompts ?? []).flatMap((p) => p.platforms ?? []));
  return platforms.size ? platforms : null;
}

/** The engines tracked, by name, for the model: "ChatGPT, Gemini". */
export function trackedEngineNames(platforms) {
  return Object.entries(IMPROVE_PLATFORM_LABELS)
    .filter(([id]) => platforms?.has(id))
    .map(([, name]) => name);
}

/** The engines a text names that the brand doesn't track; none when tracking isn't known. */
export function untrackedEngines(text, platforms) {
  if (!platforms?.size) return [];
  const words = String(text ?? '');
  return Object.entries(ENGINE_NAMES)
    .filter(([id, name]) => !platforms.has(id) && name.test(words))
    .map(([id]) => IMPROVE_PLATFORM_LABELS[id] ?? id);
}

/** Words no title is told apart by. */
const STOP_WORDS = new Set(
  `a an and are as at be by can for from how in into is it its of on or the this that to vs with you your our we
  ai best top guide complete ultimate definitive new list 2023 2024 2025 2026 2027 2028`.split(
    /\s+/,
  ),
);

/** A word's light stem: "tools" → "tool", "tracking" → "track". */
function stem(word) {
  for (const end of ['ing', 'es', 's']) {
    if (word.length - end.length >= 3 && word.endsWith(end) && !word.endsWith('ss')) {
      return word.slice(0, -end.length);
    }
  }
  return word;
}

/** A title's telling words, as stems. */
export function titleWords(title) {
  return new Set(
    (
      String(title ?? '')
        .toLowerCase()
        .normalize('NFKD')
        .match(/[\p{L}\p{N}]+/gu) ?? []
    )
      .filter((w) => !STOP_WORDS.has(w) && w.length > 1)
      .map(stem),
  );
}

/**
 * How much two titles say the same, 0–1: the telling words they share over
 * both (Dice), so a narrower need ("open source AI SEO tools") isn't the
 * broader one ("best AI SEO tools") it holds.
 */
export function titleOverlap(a, b) {
  const x = titleWords(a);
  const y = titleWords(b);
  if (x.size < 2 || y.size < 2) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return (2 * shared) / (x.size + y.size);
}

/** From this overlap two titles are the same work in other words. */
export const SAME_TITLE = 0.75;

/** The open title `title` repeats in other words, or null. */
export function sameTitleAs(title, openTitles) {
  return openTitles.find((other) => titleOverlap(title, other) >= SAME_TITLE) ?? null;
}

/** The most keywords an opportunity keeps. */
const MAX_KEYWORDS = 8;
/** A fan-out this long is a sentence, not a keyword. */
const MAX_KEYWORD_WORDS = 6;

/**
 * An opportunity's keywords: the keyword tool's that share telling words
 * with its prompts or the searches AI ran for them, then those searches,
 * most searched first, short enough to be keywords. Duplicates go.
 *
 * @param {{ keywords?: string[], prompts?: string[], queries?: string[] }} input
 */
export function opportunityKeywords({ keywords = [], prompts = [], queries = [] }) {
  const own = new Set([...prompts, ...queries].flatMap((text) => [...titleWords(text)]));
  const fits = (keyword) => {
    const words = [...titleWords(keyword)];
    return words.length > 0 && words.filter((w) => own.has(w)).length * 2 >= words.length;
  };
  const kept = [];
  const seen = new Set();
  const add = (keyword) => {
    const text = String(keyword ?? '')
      .trim()
      .toLowerCase();
    if (!text || seen.has(text) || kept.length >= MAX_KEYWORDS) return;
    seen.add(text);
    kept.push(text);
  };
  for (const keyword of keywords) if (fits(keyword)) add(keyword);
  for (const query of queries) {
    if (String(query ?? '').split(/\s+/).length <= MAX_KEYWORD_WORDS) add(query);
  }
  return kept;
}
