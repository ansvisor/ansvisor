/**
 * A page's own content, for the Content Editor to optimize (CE-003: Optimize
 * content › Page URL): its main text without the site's frame, its title,
 * and its schema JSON-LD. The editor cleans it again, as it does a paste;
 * this only picks what belongs to the page.
 */

import * as cheerio from 'cheerio';

/** The most HTML a page brings into a draft, as the editor's body limit. */
export const MAX_CONTENT_LENGTH = 500_000;

/** The most JSON-LD kept, and the most characters each. */
const MAX_JSON_LD = 5;
const MAX_JSON_LD_LENGTH = 50_000;

/** Where a page's own content usually is, the most telling first. */
const MAIN_SELECTORS = ['main', 'article', '[role="main"]', '#content', '#main'];

/** The site's frame and what can't be content. */
const FRAME =
  'script, style, noscript, template, iframe, object, embed, form, button, input, select, textarea, svg, canvas, nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"]';

function clean(text) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} html the page as fetched
 * @param {string} pageUrl the page's address after redirects, for its links
 * @returns {{ title: string, html: string }} html: the content, then its JSON-LD scripts
 */
export function extractPageContent(html, pageUrl) {
  const $ = cheerio.load(html);

  const jsonLd = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((text) => text && text.length <= MAX_JSON_LD_LENGTH)
    .slice(0, MAX_JSON_LD);

  const h1 = clean($('h1').first().text());
  const title =
    h1 || clean($('meta[property="og:title"]').attr('content')) || clean($('title').first().text());

  const main = MAIN_SELECTORS.map((selector) => $(selector).first()).find((el) => el.length);
  const root = main ?? $('body');
  root.find(FRAME).remove();

  // Links and images keep working outside the page: relative addresses
  // become absolute; anything else the editor's cleaning decides on.
  root.find('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    try {
      $(el).attr('href', new URL(href, pageUrl).toString());
    } catch {
      $(el).removeAttr('href');
    }
  });
  root.find('img[src]').each((_, el) => {
    try {
      $(el).attr('src', new URL($(el).attr('src'), pageUrl).toString());
    } catch {
      $(el).remove();
    }
  });

  let content = (root.html() ?? '').trim();
  // A title above the content (a hero outside <main>) heads it, as the
  // draft's title is its first heading.
  if (title && root.find('h1').length === 0) {
    content = `<h1>${$('<i>').text(title).html()}</h1>${content}`;
  }
  const schema = jsonLd
    .map((text) => `<script type="application/ld+json">${text.replace(/</g, '\\u003c')}</script>`)
    .join('');
  return { title, html: `${content}${schema}` };
}
