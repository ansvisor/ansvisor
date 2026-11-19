/**
 * What the page says about its author, read from the whole page for the
 * AI-judged author signals (author-credentials, byline-depth). Those read
 * the page text's first characters, and an author box sits at the end of
 * an article or in a tab: ansvisor.com's blog had a name, a role, years of
 * experience, a LinkedIn link and Person JSON-LD, and still failed both
 * (2026-11-19). Read here: Person JSON-LD (an Article's author too), author
 * boxes and bylines, and profile links (LinkedIn and the like).
 */

import { jsonLd, typesOf } from './signals/helpers.js';

/** Characters of author facts the model reads. */
export const AUTHOR_FACTS_CHARS = 1500;

/** Elements that hold an author's box or byline. */
const AUTHOR_BOXES = [
  '[class*="author" i]',
  '[id*="author" i]',
  '[itemprop="author"]',
  '[rel~="author"]',
  '[class*="byline" i]',
].join(', ');

/** Hosts of an author's profile elsewhere. */
const PROFILE_HOSTS =
  /(^|\.)(linkedin\.com|twitter\.com|x\.com|github\.com|scholar\.google\.com|orcid\.org|medium\.com|substack\.com)$/i;

const clean = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** A Person node's facts, as lines. */
function personLines(node) {
  const lines = [];
  const name = clean(node.name);
  if (name) lines.push(`Person: ${name}`);
  if (clean(node.jobTitle)) lines.push(`jobTitle: ${clean(node.jobTitle)}`);
  if (clean(node.description)) lines.push(`description: ${clean(node.description)}`);
  const sameAs = list(node.sameAs).map(clean).filter(Boolean);
  if (sameAs.length) lines.push(`sameAs: ${sameAs.join(', ')}`);
  const url = clean(typeof node.url === 'string' ? node.url : '');
  if (url) lines.push(`url: ${url}`);
  return lines;
}

/** The host of an address, or null. */
function hostOf(href) {
  try {
    return new URL(href).hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

/**
 * @param {{ $: import('cheerio').CheerioAPI }} ctx
 * @returns {string|null} the facts, one per line, at most AUTHOR_FACTS_CHARS; null when the page names none
 */
export function authorFacts(ctx) {
  if (!ctx?.$) return null;
  const lines = [];
  const seen = new Set();
  const add = (line) => {
    if (line && !seen.has(line)) {
      seen.add(line);
      lines.push(line);
    }
  };

  // Person JSON-LD: a Person node, or an article's author.
  for (const node of jsonLd(ctx).nodes) {
    if (typesOf(node).includes('person')) personLines(node).forEach(add);
    for (const author of list(node.author)) {
      if (author && typeof author === 'object') personLines(author).forEach(add);
      else if (clean(author)) add(`Person: ${clean(author)}`);
    }
  }

  // Author boxes and bylines, anywhere on the page (the outermost of nested ones).
  const $ = ctx.$;
  const boxes = $(AUTHOR_BOXES).filter(
    (_, el) => $(el).parents(AUTHOR_BOXES).length === 0 && el.tagName !== 'meta',
  );
  const profiles = new Set();
  boxes.each((_, el) => {
    const text = clean($(el).text());
    if (text) add(`Author box: ${text.slice(0, 600)}`);
    $(el)
      .find('a[href]')
      .each((__, a) => {
        const href = $(a).attr('href');
        if (PROFILE_HOSTS.test(hostOf(href) ?? '')) profiles.add(href);
      });
  });
  // Profile links the page marks as its author's, wherever they are.
  $('a[rel~="author"][href], a[rel~="me"][href], link[rel~="author"][href]').each((_, a) => {
    const href = $(a).attr('href');
    if (href) profiles.add(href);
  });
  if (profiles.size) add(`Profile links: ${[...profiles].join(', ')}`);

  if (lines.length === 0) return null;
  return lines.join('\n').slice(0, AUTHOR_FACTS_CHARS);
}
