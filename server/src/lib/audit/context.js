/**
 * Build the evaluation context every signal reads from. One fetch of the
 * target page (via Scrape.do) plus the public robots.txt / llms.txt, parsed
 * once into a shared cheerio document and an extracted plain-text body.
 *
 * Signals MUST treat `$` as read-only — text extraction runs on a separate
 * parse so removing <script>/<style> doesn't strip the JSON-LD blocks that
 * structural signals need.
 */

import * as cheerio from 'cheerio';
import { fetchViaScrapeDo, fetchText } from './fetcher.js';

/**
 * Normalize user-supplied input into an absolute http(s) URL.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    throw Object.assign(new Error('A URL is required'), { status: 400 });
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error('bad protocol');
    }
    return u.toString();
  } catch {
    throw Object.assign(new Error(`Invalid URL: ${raw}`), { status: 400 });
  }
}

/**
 * @typedef {Object} AuditContext
 * @property {string} url            normalized, fetched URL
 * @property {string} origin         scheme + host
 * @property {string} protocol       'https' | 'http'
 * @property {number} statusCode     Scrape.do response status
 * @property {string} html           raw page HTML
 * @property {number} htmlBytes      HTML size in bytes
 * @property {import('cheerio').CheerioAPI} $  parsed DOM (read-only)
 * @property {string} text           extracted body text (scripts/styles stripped)
 * @property {number} wordCount      word count of `text`
 * @property {string|null} robotsTxt
 * @property {string|null} llmsTxt
 * @property {string|null} query     optional target buyer query (later phases)
 */

/**
 * @param {string} rawUrl
 * @param {{ query?: string|null }} [opts]
 * @returns {Promise<AuditContext>}
 */
export async function buildAuditContext(rawUrl, { query = null } = {}) {
  const url = normalizeUrl(rawUrl);
  const u = new URL(url);
  const origin = `${u.protocol}//${u.host}`;

  const page = await fetchViaScrapeDo(url, { render: true });
  if (!page.ok || !page.html) {
    throw Object.assign(new Error(`Failed to fetch page (status ${page.status})`), { status: 502 });
  }

  const $ = cheerio.load(page.html);

  // Plain-text extraction on a throwaway parse so the shared `$` keeps its
  // <script type="application/ld+json"> blocks intact for structural signals.
  const $text = cheerio.load(page.html);
  $text('script, style, noscript, template, svg').remove();
  const text = $text('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = text ? text.split(/\s+/).length : 0;

  const [robotsTxt, llmsTxt] = await Promise.all([
    fetchText(`${origin}/robots.txt`),
    fetchText(`${origin}/llms.txt`),
  ]);

  return {
    url,
    origin,
    protocol: u.protocol.replace(':', ''),
    statusCode: page.status,
    html: page.html,
    htmlBytes: Buffer.byteLength(page.html, 'utf8'),
    $,
    text,
    wordCount,
    robotsTxt,
    llmsTxt,
    query,
    now: Date.now(),
  };
}
