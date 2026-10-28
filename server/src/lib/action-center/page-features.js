/**
 * What Site Audit's checks find on one page read, and what competitor pages
 * have that the brand's doesn't (learning C1): the part of
 * competitor-pages.js that reads no database, so the brief (C2), Improve
 * (C2) and their tests load it without the supabase client, whose config
 * exits when the SUPABASE_* env is absent (as in CI).
 */

import * as cheerio from 'cheerio';
import { resolve } from '../../config/action-engine.js';
import { signalRegistry } from '../audit/signals/index.js';
import { describeSignal } from '../audit/rubric.js';

const { competitorPages: C } = resolve();

/**
 * Less text than this, and what was read is a wall (a consent or sign-in
 * page, a page drawn by script), not the page: as content-cited-length.js's
 * CITED_MIN_CHARACTERS.
 */
export const MIN_PAGE_CHARACTERS = 500;

/**
 * The checks compared: Site Audit's that read the page alone, never its
 * site's robots.txt or llms.txt, and that the page's author can act on.
 */
export const FEATURE_CHECKS = Object.freeze([
  'length',
  'structural-depth',
  'h2-coverage',
  'lists',
  'tables',
  'faq-schema',
  'json-ld-presence',
  'statistic-density',
  'quotations',
  'citation-density',
  'outbound-authority-links',
  'author-byline',
  'date-markup',
  'freshness',
  'readability',
]);

/** What Site Audit's checks read, built from a page fetched here. */
export function pageContext(url, html, now = Date.now()) {
  const $ = cheerio.load(html);
  // Text from a second parse, so the first keeps its JSON-LD blocks (audit/context.js).
  const $text = cheerio.load(html);
  $text('script, style, noscript, template, svg').remove();
  const text = $text('body').text().replace(/\s+/g, ' ').trim();
  const u = new URL(url);
  return {
    url,
    origin: `${u.protocol}//${u.host}`,
    protocol: u.protocol.replace(':', ''),
    statusCode: 200,
    html,
    htmlBytes: Buffer.byteLength(html, 'utf8'),
    $,
    text,
    wordCount: text ? text.split(/\s+/).length : 0,
    robotsTxt: null,
    llmsTxt: null,
    query: null,
    now,
  };
}

/**
 * A page's features: its words and each compared check's status; null when
 * what was read is a wall rather than the page (MIN_PAGE_CHARACTERS).
 */
export async function pageFeatures(url, html, now = Date.now()) {
  const ctx = pageContext(url, html, now);
  if (ctx.text.length < MIN_PAGE_CHARACTERS) return null;
  const checks = {};
  for (const signal of signalRegistry) {
    if (!FEATURE_CHECKS.includes(signal.key)) continue;
    try {
      checks[signal.key] = (await signal.evaluate(ctx)).status;
    } catch {
      checks[signal.key] = 'na';
    }
  }
  return { words: ctx.wordCount, checks };
}

/**
 * The checks at least half of the competitor pages pass that the brand's
 * page doesn't, the most passed first; every such check when no page of the
 * brand's was read. None from fewer than `minPages` pages: one page isn't
 * what "their pages" have.
 */
export function featureGaps(competitorPages, yourPage, { minPages = C.minPages } = {}) {
  const read = competitorPages.filter((page) => page.checks);
  if (read.length < Math.max(1, minPages)) return [];
  const needed = Math.ceil(read.length / 2);
  return FEATURE_CHECKS.map((key) => ({
    key,
    label: describeSignal(key)?.label ?? key,
    competitors: read.filter((page) => page.checks[key] === 'pass').length,
    of: read.length,
  }))
    .filter((gap) => gap.competitors >= needed && yourPage?.checks?.[gap.key] !== 'pass')
    .sort((a, b) => b.competitors - a.competitors);
}
