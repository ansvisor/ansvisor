import * as cheerio from 'cheerio';
import { z } from 'zod';
import { HEADING_RULE, passageKey } from './content-agent.js';
import { linkHref, linkKey } from './content-links.js';

/**
 * Rewrite the page to these rules (Content Editor): the Content Agent
 * rewrites a whole page in one call, left as ONE suggestion (kind 'page',
 * 00247) for a person to compare and accept or reject. Small edits stay with
 * Fix open rules (content-agent.js); this one is for a page far from its
 * Length, or with many rules open.
 *
 * What the page keeps word for word never reaches the model as text: each
 * passage AI answers quote today (locked), table, image, HTML block, quote
 * and JSON-LD script goes as a [[KEEP n]] line, and is put back as it was
 * after the model answers. A rewrite that drops one is refused.
 */

/** The most text a page sent whole may hold, its kept blocks left out. */
export const MAX_REWRITE_CHARS = 60_000;

/** The longest rewritten page kept (00247's check). */
export const MAX_PAGE_HTML = 500_000;

/** Blocks kept as they are, never rewritten. */
const KEPT_BLOCKS = new Set(['table', 'img', 'figure', 'blockquote', 'script', 'pre', 'hr']);

const TOKEN = (n) => `[[KEEP ${n}]]`;
const TOKEN_ONLY = /^\s*\[\[KEEP (\d+)\]\]\s*$/;
const ANY_TOKEN = /\[\[KEEP \d+\]\]/g;

/** The tags a rewritten page may hold; anything else is unwrapped to its text. */
const PAGE_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'p',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'b',
  'i',
  'br',
  'a',
]);

export const rewriteSchema = z.object({
  html: z.string().describe('The whole page rewritten, as HTML.'),
  reason: z.string().describe('One short sentence on what changed.'),
});

export const REWRITE_SYSTEM_PROMPT = `You are the Content Agent for Answer Engine Optimization (AEO). You rewrite one existing web page, whole, so it meets the rules listed and AI assistants (ChatGPT, Perplexity, Gemini, Copilot, Google's AI Overviews) understand it, trust it and cite it. A person compares your page with theirs and accepts or rejects it.

How to rewrite:
- Meet every rule listed, and the writer's own rules. Aim at the Length given: the page's text, not its markup, within 20% of it. When the page is too long, cut repetition, filler and the least useful parts first, and keep its answers, facts and data.
- Keep the page's facts, voice and language. Use only facts from the page, the brand and the brief. Never invent numbers, prices, dates, names, customers, sources or quotes; when the page needs a fact you don't have, write a placeholder in square brackets, e.g. [figure, source, year].
- One H1, the page's title, first. Sections are H2s; questions and sub-sections are H3s.
- Answer first: under each heading, a short paragraph that answers it, then the detail.
- Each [[KEEP n]] line is a block kept word for word: a passage AI assistants quote today, a table, an image, an HTML block or a quote. Keep every one, once, as its own line where it fits; never change, split, merge or drop one.
- Keep the page's links on the words they explain. Link only to a URL the page already links to or one listed for you to link to, copied exactly, as <a href="URL">the words</a>. Never invent a URL, and never link a heading.
${HEADING_RULE}
- HTML only: h1, h2, h3, p, ul, ol, li, strong, em and a. No classes, styles or other tags.
- "reason" says in one short sentence what you changed, e.g. "cut to about 8,000 characters and answered each heading first".
- Write in the language asked for.`;

/**
 * The page's text length as the Rules tab counts it (pageTextLength in
 * web/src/lib/content/rules.ts): a space between blocks, an entity as one
 * character, runs of spaces as one.
 */
export function textLength(html) {
  return String(html ?? '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(p|h[1-6]|li|td|th|blockquote|br|div)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[#a-z0-9]+;/gi, 'x')
    .replace(/\s+/g, ' ')
    .trim().length;
}

/**
 * The page as the model gets it: each top-level block kept as it is (a
 * locked passage, or a table, image, quote, HTML block or script, or a list
 * holding a locked passage) stands as a [[KEEP n]] line. `kept` maps each
 * number to the block's HTML, `locked` the numbers of the ones AI quotes;
 * `h1` is the page's own H1 when it isn't kept, `h1Kept` whether it is.
 */
export function keepBlocks(html, lockedKeys) {
  const $ = cheerio.load(html || '', null, false);
  const kept = new Map();
  const locked = new Set();
  const firstH1 = $('h1').first();
  const h1 = firstH1.length ? $.html(firstH1) : null;
  let h1Kept = false;
  for (const el of $.root().children().get()) {
    const tag = el.tagName?.toLowerCase();
    const $el = $(el);
    const passages = $el.is('h1, h2, h3, h4, h5, h6, p')
      ? [$el]
      : $el
          .find('h1, h2, h3, h4, h5, h6, p')
          .get()
          .map((p) => $(p));
    const quoted = passages.some((p) => lockedKeys.has(passageKey(p.text())));
    const block =
      KEPT_BLOCKS.has(tag) || $el.is('[data-html-block]') || $el.find('img, table').length > 0;
    if (!quoted && !block) continue;
    const n = kept.size + 1;
    kept.set(n, $.html(el));
    if (quoted) locked.add(n);
    if (tag === 'h1' || $el.find('h1').length) h1Kept = true;
    $el.replaceWith(`<p>${TOKEN(n)}</p>`);
  }
  return { html: $.html().trim(), kept, locked, h1Kept, h1: h1Kept ? null : h1 };
}

/** A page's own link that isn't http(s): a path on its site, an anchor, mail or phone. */
const LOCAL_HREF = /^(\/(?!\/)|#|mailto:|tel:)/i;

/** Where a link's address is looked up in the links a rewrite may keep. */
const hrefKey = (href) => {
  const raw = String(href ?? '').trim();
  return linkKey(raw) ?? (LOCAL_HREF.test(raw) ? `local:${raw}` : null);
};

/**
 * The links a rewrite may keep, by hrefKey: the brand's pages and the
 * draft's sources offered to link to (linkAllowList), and every link the
 * page has, its paths on the site included.
 */
export function rewriteLinks(pageHtml, offered) {
  const links = new Map(offered ?? []);
  const $ = cheerio.load(pageHtml || '', null, false);
  $('a[href]').each((_, el) => {
    const raw = String($(el).attr('href') ?? '').trim();
    const href = linkHref(raw) ?? (LOCAL_HREF.test(raw) ? raw : null);
    if (href) links.set(hrefKey(href), href);
  });
  return links;
}

/**
 * The model's page kept to what the editor takes: the tags above, no
 * attributes, links only to a URL in `links` (never in a heading), H4–H6 as
 * H3, and one H1, first: a later H1 becomes an H2, and none at all takes the
 * page's own back. With `h1Kept` the H1 is a kept block, so every H1 the
 * model wrote becomes an H2.
 */
export function cleanPageHtml(html, links, { h1Kept = false, originalH1 = null } = {}) {
  const $ = cheerio.load(html || '', null, false);
  $('script, style, iframe, object, embed, noscript, template, head, title').remove();
  $('h4, h5, h6').each((_, el) => {
    el.name = 'h3';
  });
  $('h1').each((i, el) => {
    if (h1Kept || i > 0) el.name = 'h2';
  });
  for (const el of $('*').get().reverse()) {
    const tag = el.tagName?.toLowerCase();
    if (tag === 'a') {
      const key = hrefKey(el.attribs?.href);
      const href = key ? links.get(key) : undefined;
      const inHeading = $(el).parents('h1, h2, h3').length > 0;
      if (href && !inHeading && $(el).text().trim()) {
        for (const name of Object.keys(el.attribs ?? {})) $(el).removeAttr(name);
        $(el).attr('href', href);
      } else {
        $(el).replaceWith($(el).contents());
      }
      continue;
    }
    if (!PAGE_TAGS.has(tag)) {
      $(el).replaceWith($(el).contents());
      continue;
    }
    for (const name of Object.keys(el.attribs ?? {})) $(el).removeAttr(name);
  }
  if (!h1Kept && !$('h1').length && originalH1) $.root().prepend(originalH1);
  return $.html().trim();
}

/**
 * The kept blocks put back where the model left their [[KEEP n]] lines,
 * each once. Answers the page and the numbers it left out; a number left
 * inside other text is taken out of it, and counts as left out.
 */
export function restoreKept(html, kept) {
  const $ = cheerio.load(html || '', null, false);
  const placed = new Set();
  $('p, li, h1, h2, h3').each((_, el) => {
    const match = $(el).text().match(TOKEN_ONLY);
    if (!match) return;
    const n = Number(match[1]);
    // A list item holding only the line: the whole list stands for it.
    const target =
      el.tagName === 'li' && $(el).parent().children().length === 1 ? $(el).parent() : $(el);
    if (!kept.has(n) || placed.has(n)) {
      target.remove();
      return;
    }
    placed.add(n);
    target.replaceWith(kept.get(n));
  });
  // Lines the model ran into other text, and empty blocks left behind.
  $('*').each((_, el) => {
    for (const node of el.children ?? []) {
      if (node.type === 'text' && ANY_TOKEN.test(node.data))
        node.data = node.data.replace(ANY_TOKEN, '');
    }
  });
  $('p, li, h1, h2, h3').each((_, el) => {
    if (!$(el).text().trim() && !$(el).find('img, br').length) $(el).remove();
  });
  const missing = [...kept.keys()].filter((n) => !placed.has(n));
  return { html: $.html().trim(), missing };
}
