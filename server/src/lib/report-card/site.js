import * as cheerio from 'cheerio';

/**
 * What a report card reads of a site's home page to find what it sells
 * (owner decision 2026-11-04: questions from the brand's main products):
 * its title, description and headings, and the links of its menus and
 * pages on the site itself, with their text. A product's link on the card
 * is one of these links, never one a model made up.
 */

/** How much of the outline the question writer reads. */
const OUTLINE_CHARS = 5000;
/** Links kept: menus first, as the page lists them. */
const MAX_LINKS = 80;

const squash = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/** A link's address on the site, without its query or hash, or null for another site's. */
function ownLink(href, site) {
  let url;
  try {
    url = new URL(String(href ?? ''), `https://${site}/`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== site && !host.endsWith(`.${site}`)) return null;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return null;
  return `https://${url.hostname.toLowerCase()}${path}`;
}

/**
 * @param {string|null} html
 * @param {string} site the host measured: "acme.com"
 * @returns {{ text: string, links: { text: string, url: string }[] } | null}
 */
export function siteOutline(html, site) {
  if (!html) return null;
  const $ = cheerio.load(String(html));
  $('script, style, noscript, svg, template').remove();
  const headings = [];
  $('h1, h2, h3').each((_, el) => {
    const text = squash($(el).text());
    if (text && text.length <= 120 && !headings.includes(text)) headings.push(text);
  });
  const links = [];
  const seen = new Set();
  const add = (el) => {
    const url = ownLink($(el).attr('href'), site);
    const text = squash($(el).text() || $(el).attr('title') || $(el).attr('aria-label'));
    if (!url || !text || text.length > 80 || seen.has(url)) return;
    seen.add(url);
    links.push({ text, url });
  };
  $('nav a, header a').each((_, el) => add(el));
  $('a').each((_, el) => add(el));
  const kept = links.slice(0, MAX_LINKS);
  const text = [
    squash($('title').first().text()),
    squash($('meta[name="description"]').attr('content')),
    headings.length ? `Headings: ${headings.slice(0, 40).join(' | ')}` : '',
    kept.length ? `Links: ${kept.map((l) => l.text).join(' | ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, OUTLINE_CHARS);
  return { text, links: kept };
}

/** Text as compared: lower case, Turkish ı and İ as i, without accents or punctuation. */
export function plainText(text) {
  return String(text ?? '')
    .replace(/İ/g, 'i')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Whether `quote` is on the page: in its excerpt or its outline. */
export function onPage(quote, page) {
  const needle = plainText(quote);
  return needle.length >= 3 && plainText(page).includes(needle);
}
