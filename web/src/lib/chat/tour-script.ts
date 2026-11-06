import { createHash } from 'node:crypto';
import { generateText } from 'ai';
import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { autoModels, AUTO_READ_MODEL } from './engine-model';
import type { AnswerLanguage } from './general-settings';
import { LANGUAGES } from './language';
import { TOUR_TOPICS, type TourTopic, type TourVia } from './tour';

/**
 * The product tour's words (owner decision 2026-11-06): scripted, not
 * written by a model, so a tour costs no AI. Each turn is the person's short
 * line (the chip they clicked: "Show me Visibility", "Next: Content") and
 * the page's explanation, written from the approved Help articles
 * (messages/en.json `chatTour.script`).
 *
 * The tour follows the person's answer language (Settings › Chat ›
 * General, chat_user_prefs.answer_language): English as written; another
 * language is translated once, by the small model Chat reads with (Claude
 * Haiku 5.5, on Ansvisor's key), and kept for everyone in
 * chat_tour_translations (00486) by the language and the English texts'
 * hash. The texts name no workspace, so one translation serves all. Any
 * failure, or no key, answers English. Server only.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatTour.script' });

/** The tour's texts by key ('body.visibility', 'endLine'…). */
export type TourTexts = Record<string, string>;

/** Every key of the script, in one order (the hash depends on it). */
export const TOUR_SCRIPT_KEYS: readonly string[] = [
  'everything',
  ...TOUR_TOPICS.map((topic) => `show.${topic}`),
  ...TOUR_TOPICS.slice(1).map((topic) => `next.${topic}`),
  ...TOUR_TOPICS.map((topic) => `body.${topic}`),
  'firstRun.soon',
  'firstRun.minutes',
  'firstRun.hours',
  'endAsk',
  'endLine',
];

/** The script in English, as messages/en.json has it; `{n}` stays for the number. */
export function englishScript(): TourTexts {
  return Object.fromEntries(
    TOUR_SCRIPT_KEYS.map((key) => [key, t(key as Parameters<typeof t>[0], { n: '{n}' })]),
  );
}

/** A text's placeholders (`{n}`), sorted: a translation keeps the same. */
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(',');

/** The English texts' sha-256 (hex): a changed text is a new translation. */
export function scriptHash(texts: TourTexts): string {
  const ordered = TOUR_SCRIPT_KEYS.map((key) => [key, texts[key] ?? '']);
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

/** The longest a translated text may be: a model that rambles is not kept. */
const TEXT_MAX = 4_000;

/**
 * A translation as kept: every key of the English script, each a text of
 * its own with the English one's placeholders; null for anything else (a
 * key missing or added, an empty text, a `{n}` lost).
 */
export function checkedTexts(value: unknown, english: TourTexts): TourTexts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const texts = value as Record<string, unknown>;
  if (Object.keys(texts).length !== Object.keys(english).length) return null;
  const out: TourTexts = {};
  for (const key of Object.keys(english)) {
    const text = texts[key];
    if (typeof text !== 'string' || !text.trim() || text.length > TEXT_MAX) return null;
    if (placeholders(text) !== placeholders(english[key])) return null;
    out[key] = text.trim();
  }
  return out;
}

/** The JSON object in a model's answer, a ```json fence around it or not; null without one. */
export function jsonIn(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** How long a translation may take: the person's first topic waits for it. */
const TRANSLATE_TIMEOUT_MS = 30_000;
/** Its output allowance, its thinking included: the whole script, a few times over. */
const TRANSLATE_MAX_OUTPUT_TOKENS = 16_000;

function instructions(language: AnswerLanguage): string {
  return [
    `Translate every value of the JSON object you are given into ${LANGUAGES[language]}.`,
    'They are the lines of a short product tour in a chat: keep them friendly, plain and as short as the English.',
    'Keep the keys, the Markdown (bold, numbered lists, line breaks), the numbers and every {n} exactly as they are.',
    "The names of the product's pages, tabs, buttons, menus and topics stay in English, bold or not (Visibility, Prompts, Tracked Prompts, Ask Chat, Settings › Integrations…), and so do product and company names.",
    'Answer with the JSON object alone.',
  ].join(' ');
}

/** The translations under way, by language and script hash: one at a time, on this server. */
const inFlight = new Map<string, Promise<TourTexts | null>>();

/** The script translated by the small model; null without Ansvisor's key or on any failure. */
async function translate(language: AnswerLanguage, english: TourTexts): Promise<TourTexts | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const choice = autoModels(apiKey, 'ansvisor').pick('read');
  const { text } = await generateText({
    model: choice.model,
    system: instructions(language),
    prompt: JSON.stringify(english),
    maxOutputTokens: TRANSLATE_MAX_OUTPUT_TOKENS,
    providerOptions: choice.providerOptions,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
  });
  return checkedTexts(jsonIn(text), english);
}

/** The kept translation, else a new one, kept for everyone; null when there is none to give. */
async function readOrTranslate(
  language: AnswerLanguage,
  english: TourTexts,
  hash: string,
): Promise<TourTexts | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_tour_translations')
    .select('texts')
    .eq('lang', language)
    .eq('source_hash', hash)
    .maybeSingle();
  if (error) throw new Error(`Could not read the tour's translation: ${error.message}`);
  const kept = data ? checkedTexts(data.texts, english) : null;
  if (kept) return kept;
  const texts = await translate(language, english);
  if (!texts) return null;
  const { error: saveError } = await supabaseAdmin
    .from('chat_tour_translations')
    .upsert(
      { lang: language, source_hash: hash, texts, model: AUTO_READ_MODEL.catalog },
      { onConflict: 'lang,source_hash', ignoreDuplicates: true },
    );
  if (saveError)
    console.error("[chat/tour] could not keep the tour's translation:", saveError.message);
  return texts;
}

/** The translation, asked once at a time per language and script on this server. */
function translated(language: AnswerLanguage, english: TourTexts): Promise<TourTexts | null> {
  const hash = scriptHash(english);
  const key = `${language}:${hash}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = readOrTranslate(language, english, hash).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

/**
 * The tour's texts in the person's answer language: English for English or
 * "Same as my question" (null), and on any failure. Never throws.
 */
export async function tourTexts(language: AnswerLanguage | null): Promise<TourTexts> {
  const english = englishScript();
  if (!language || language === 'en') return english;
  try {
    return (await translated(language, english)) ?? english;
  } catch (error) {
    console.error('[chat/tour] the tour stays in English:', error);
    return english;
  }
}

/** A topic's turn: the person's line for how they asked, and the page's explanation. */
export function topicTurn(
  texts: TourTexts,
  topic: TourTopic,
  via: TourVia,
): { question: string; answer: string } {
  const question =
    via === 'everything'
      ? texts.everything
      : via === 'next' && texts[`next.${topic}`]
        ? texts[`next.${topic}`]
        : texts[`show.${topic}`];
  return { question, answer: texts[`body.${topic}`] };
}

/** The tour's last turn: End the tour, and where Chat is from now on. */
export function endTurn(texts: TourTexts): { question: string; answer: string } {
  return { question: texts.endAsk, answer: texts.endLine };
}

/** About when the brand's first results are in, for a turn while its first run goes on. */
export interface FirstRunNote {
  /** About how many minutes are left; null when not known yet. */
  minutes: number | null;
}

/**
 * The line a turn ends with while the brand's first run goes on: "Your
 * first results are still coming in (about 15 min); this page fills in as
 * they arrive." From 90 minutes on, in hours.
 */
export function firstRunLine(texts: TourTexts, note: FirstRunNote): string {
  const { minutes } = note;
  if (minutes === null || !Number.isFinite(minutes) || minutes < 1) return texts['firstRun.soon'];
  return minutes >= 90
    ? texts['firstRun.hours'].replace('{n}', String(Math.round(minutes / 60)))
    : texts['firstRun.minutes'].replace('{n}', String(Math.round(minutes)));
}
