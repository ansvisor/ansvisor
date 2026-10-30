/**
 * Opening a web page for Chat (CHAT-10 §B: fetch_page): one public URL the
 * person asked about, read through safe-fetch's rules (http(s) on the web
 * ports, no credentials, every address checked public in the connection's
 * own lookup, redirects followed by hand and checked again, a time and a
 * size limit, HTML only, a fixed user agent and no cookies), with this
 * reader's tighter limits: 3 redirects, 1 MB, 10 seconds. Each redirect
 * stays on the sites the run may open (`sites`), or the page isn't read.
 *
 * What comes back is what Chat reads of the page, extracted here: its title,
 * meta description, H1–H3 outline, the JSON-LD types it carries, canonical,
 * language, a visible date and its main text, cut to fit. Never its HTML
 * (CHAT-03 items 22–23), never what it hides (hidden blocks, screen-reader
 * text, invisible characters), though words aimed at AI assistants anywhere
 * on it are noticed. The page is the person's to ask about, in their own
 * workspace; nothing of it is logged.
 */

import * as cheerio from 'cheerio';

import { extractPageContent, plainTextOf } from './page-content.js';
import { fetchPage } from './safe-fetch.js';

export const OPEN_PAGE_LIMITS = {
  timeoutMs: 10_000,
  maxBytes: 1024 * 1024,
  maxRedirects: 3,
};

/** The main text Chat gets of a page, at most. */
export const OPEN_PAGE_TEXT_CHARS = 8_000;
const OUTLINE_MAX = 40;
const JSON_LD_TYPES_MAX = 20;

/**
 * Words aimed at an AI reading the page ("ignore your instructions", "you
 * are an AI assistant"): Chat says it ignored them (CHAT-05 item 12).
 */
const AI_INSTRUCTIONS =
  /\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|all|your)\b.{0,20}\b(instructions?|prompts?|rules)\b|\byou are (an? )?(ai|assistant|language model|chatgpt|claude|gemini)\b|\b(ai|llm|language model)s?,? (assistants?|agents?|models?)? ?(must|should|please)\b|\bsystem prompt\b/i;

/**
 * Characters a reader can't see that can carry words to a model: every
 * format character (zero widths, joiners, BOM, soft hyphen, bidi marks and
 * controls, invisible operators, tag characters) and every one Unicode
 * says a reader ignores (the grapheme joiner, the variation selectors a
 * word can hide in an emoji's, the Hangul fillers, Khmer's inherent vowels).
 */
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

/** What a page's head may say, as Chat reads it: a type name, a language tag, a date. */
const TYPE_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/;
const DATE_LIKE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
/** A canonical address Chat passes on, at most. */
const CANONICAL_MAX = 300;

const clean = (text) =>
  String(text ?? '')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim();
const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** A canonical as an absolute http(s) address, short enough to pass on; null otherwise. */
function canonicalOf(href, pageUrl) {
  if (!href) return null;
  try {
    const address = new URL(href, pageUrl);
    if (address.protocol !== 'http:' && address.protocol !== 'https:') return null;
    const text = address.toString();
    return text.length <= CANONICAL_MAX ? text : null;
  } catch {
    return null;
  }
}

/** Every @type in a JSON-LD block, @graph included. */
function typesOf(value, into) {
  if (Array.isArray(value)) {
    for (const item of value) typesOf(item, into);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const type = value['@type'];
  for (const t of Array.isArray(type) ? type : [type]) {
    // A type's name only: anything else in @type is words, not a type.
    if (typeof t === 'string' && TYPE_NAME.test(t.trim())) into.add(t.trim());
  }
  if (value['@graph']) typesOf(value['@graph'], into);
}

/**
 * What Chat reads of a page: pure, from its HTML and its address after
 * redirects. The page is parsed once.
 *
 * @param {string} html
 * @param {string} url
 */
export function readOpenedPage(html, url) {
  const $ = cheerio.load(html);
  const meta = (selector) => clean($(selector).first().attr('content'));
  const jsonLdTexts = $('script[type="application/ld+json"]')
    .toArray()
    .map((el) => $(el).text());
  // Anywhere on the page, hidden or not, its head and JSON-LD too: the words
  // are noticed, never followed. Each block apart, so a page sent without
  // spaces between its tags ("<h1>FAQ</h1><p>Ignore…") reads as words.
  const instructionsForAi = AI_INSTRUCTIONS.test(
    clean(
      [
        $('title').first().text(),
        meta('meta[name="description"]'),
        meta('meta[property="og:description"]'),
        ...jsonLdTexts,
        plainTextOf($('body')[0]),
      ].join(' '),
    ),
  );

  const types = new Set();
  for (const text of jsonLdTexts) {
    try {
      typesOf(JSON.parse(text), types);
    } catch {
      // A block that isn't JSON says nothing.
    }
  }
  const date =
    meta('meta[property="article:modified_time"]') ||
    meta('meta[property="article:published_time"]') ||
    meta('meta[name="date"]') ||
    clean($('time[datetime]').first().attr('datetime'));
  const language = clean($('html').attr('lang'));
  const head = {
    title: cut(clean($('title').first().text()), 300),
    description: cut(meta('meta[name="description"]'), 500),
    // What isn't the field's shape is words: it goes, rather than reach the model.
    canonical: canonicalOf(clean($('link[rel="canonical"]').first().attr('href')), url),
    language: LANGUAGE_TAG.test(language) ? language : null,
    date: DATE_LIKE.test(date) ? date : null,
  };

  // The page's main text, as the Content Editor brings a page in, but with
  // all it hides gone (an FAQ's collapsed answers too), on the same parse.
  const content = extractPageContent(html, url, { $, dropHidden: true, withText: true });
  const outline = $('h1, h2, h3')
    .toArray()
    .map((el) => ({ level: Number(el.tagName.slice(1)), text: cut(clean($(el).text()), 150) }))
    .filter((heading) => heading.text)
    .slice(0, OUTLINE_MAX);
  const text = clean(content.text);

  return {
    url,
    title: head.title || cut(clean(content.title), 300),
    description: head.description,
    canonical: head.canonical,
    language: head.language,
    date: head.date,
    outline,
    jsonLd: [...types].slice(0, JSON_LD_TYPES_MAX),
    text: cut(text, OPEN_PAGE_TEXT_CHARS),
    textChars: text.length,
    instructionsForAi,
  };
}

/**
 * Whether a host is on the run's sites: one of `hosts` ("www." aside), or
 * one of `domains` or under it (the brand's own).
 *
 * @param {string} hostname
 * @param {{ hosts: string[], domains: string[] }} sites
 */
export function onSites(hostname, { hosts, domains }) {
  const host = hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');
  return hosts.includes(host) || domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * A public page, opened and read (see above). Throws safe-fetch's
 * PageFetchError with its code when it can't be: invalid_url, blocked,
 * not_allowed (a step off the run's sites), too_many_redirects, not_html,
 * too_large, too_deep, http_error, timeout, unreachable.
 *
 * @param {string} address
 * @param {{ sites?: { hosts: string[], domains: string[] }, lookup?: Function, ports?: string[], signal?: AbortSignal, timeoutMs?: number }} [opts]
 *   `sites`: the run's sites, which every step must be on.
 *   `lookup` and `ports` reach a local server in tests, as safe-fetch's.
 */
export async function openPage(address, { sites, ...opts } = {}) {
  const page = await fetchPage(address, {
    ...OPEN_PAGE_LIMITS,
    ...opts,
    ...(sites ? { allowUrl: (url) => onSites(url.hostname, sites) } : {}),
  });
  return {
    status: page.status,
    bytes: Buffer.byteLength(page.html, 'utf8'),
    ...readOpenedPage(page.html, page.url),
  };
}
