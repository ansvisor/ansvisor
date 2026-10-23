/**
 * A page's own content, for the Content Editor to optimize (CE-003: Optimize
 * content › Page URL): its main text without the site's frame, its title,
 * and its schema JSON-LD. The editor cleans it again, as it does a paste;
 * this only picks what belongs to the page.
 *
 * Many pages have no <main> or <article> (Webflow, page builders), and the
 * ones that do often keep an author box, share buttons or related posts in
 * it. So the text is found where the page's paragraphs are, the root is the
 * part of the page holding it and its H1, and the furniture around the text
 * is taken out: blocks named for it (author, share, related…), blocks that
 * are mostly links (breadcrumbs, a table of contents, icon rows, post
 * lists), bylines ("8 min read"), and avatars, logos, icons and cover
 * images.
 */

import * as cheerio from 'cheerio';

/** The most HTML a page brings into a draft, as the editor's body limit. */
export const MAX_CONTENT_LENGTH = 500_000;

/** The most JSON-LD kept, and the most characters each. */
const MAX_JSON_LD = 5;
const MAX_JSON_LD_LENGTH = 50_000;

/** Where a page's own content usually is, the most telling first. */
const MAIN_SELECTORS = ['main', 'article', '[role="main"]', '#content', '#main'];

/** The site's frame, and what can't be content. */
const FRAME =
  'script, style, noscript, template, iframe, object, embed, form, button, input, select, textarea, svg, canvas, nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"], .w-condition-invisible';

/**
 * What the page hides, taken out around the text only: a collapsed FAQ
 * answer ships hidden, and it is just the text an AEO page needs. A block
 * hidden until found (the browser's search opens it) is never taken out.
 */
const HIDDEN =
  '[hidden]:not([hidden="until-found"]), [style*="display:none"], [style*="display: none"]';

/**
 * A question an accordion's hidden answer follows: an FAQ beside the text
 * (after the post, in the page's main block) keeps its answers too.
 */
const QUESTION = 'h2, h3, h4, h5, h6';

/**
 * Words in a block's class or id that name furniture: anywhere, even in the
 * text (an author box or share buttons in the article)…
 */
const FURNITURE_WORDS = new Set([
  'ad',
  'ads',
  'advert',
  'author',
  'authors',
  'avatar',
  'bio',
  'breadcrumb',
  'breadcrumbs',
  'byline',
  'comment',
  'comments',
  'consent',
  'cookie',
  'modal',
  'newsletter',
  'popup',
  'recommended',
  'related',
  'share',
  'sharing',
  'social',
  'sponsor',
  'sponsored',
  'subscribe',
  'toc',
]);

/** …and outside the text only, as the article's own call to action is its text. */
const PAGE_FURNITURE_WORDS = new Set([
  ...FURNITURE_WORDS,
  'announcement',
  'cta',
  'footer',
  'header',
  'menu',
  'meta',
  'nav',
  'navbar',
  'pager',
  'pagination',
  'promo',
  'sidebar',
  'signup',
  'tag',
  'tags',
  'widget',
]);

/**
 * Words in an image's (or its block's) class or id that mark it as no part
 * of the text: anywhere…
 */
const IMAGE_FURNITURE_WORDS = new Set([
  'author',
  'avatar',
  'badge',
  'emoji',
  'gravatar',
  'icon',
  'logo',
  'profile',
  'sprite',
]);

/**
 * …and outside the text, the post's cover. ("cover" itself is no sign:
 * Tailwind's object-cover is on any picture.)
 */
const PAGE_IMAGE_FURNITURE_WORDS = new Set([
  ...IMAGE_FURNITURE_WORDS,
  'featured',
  'hero',
  'thumb',
  'thumbnail',
]);

/** A line about the post rather than of it. */
const BYLINE =
  /\b\d+\s*(?:min|mins|minute|minutes)\s+read\b|\breading time\b|\blast updated\b|\bupdated on\b|\bpublished (?:on|by)\b|\bposted (?:on|by)\b|\bwritten by\b/i;

/** Paragraphs shorter than this don't say where the text is. */
const MIN_PARAGRAPH = 25;
/** The text area holds at least this share of the page's paragraph text. */
const TEXT_AREA_SHARE = 0.6;
/** A furniture block is never this big a share of the root's text. */
const MAX_FURNITURE_SHARE = 0.5;
/**
 * Outside the text, a block with at most this much text besides its links
 * is furniture (breadcrumbs, icon rows, a few related posts), as is a
 * table of contents (links within the page) …
 */
const MAX_LINK_LIST_TEXT = 50;
/**
 * … but a list going to this many pages, or a long block mostly of links,
 * is the page's own (a category's products) and is kept whole.
 */
const MIN_LIST_TARGETS = 8;
const MAX_LINK_LIST = 600;
const LIST_LINK_SHARE = 0.3;
/** A byline is a short line. */
const MAX_BYLINE = 200;
/** Images this small (width or height, in pixels) are icons. */
const MAX_ICON_SIZE = 64;

function clean(text) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** A block's class and id, as lower-case words: "authorBox ans-trk__i" → author, box, ans, trk, i. */
function wordsOf($el) {
  const names = `${$el.attr('class') ?? ''} ${$el.attr('id') ?? ''}`;
  return names
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function named($el, words) {
  return wordsOf($el).some((word) => words.has(word));
}

/** An element's text, with a space where its blocks meet ("Ada" "8 min read" → "Ada 8 min read"). */
function textOf($, el) {
  return clean(
    $(el)
      .find('*')
      .addBack()
      .contents()
      .filter((_, node) => node.type === 'text')
      .map((_, node) => node.data)
      .get()
      .join(' '),
  );
}

/**
 * Where the page's text is: paragraphs score their block and, half, the one
 * above it (as reader modes do), and the text area is the best block,
 * widened until it holds most of the page's paragraph text. Null when the
 * page has no paragraphs to go by.
 */
function findTextArea($, body) {
  const scores = new Map();
  let total = 0;
  // An author's bio or a comment is no sign of where the text is, nor is
  // what the page hides: the text is where its visible paragraphs are, and
  // a hidden answer inside it stays (HIDDEN).
  const paragraphs = body
    .find('p, pre, blockquote, li')
    .toArray()
    .filter(
      (el) =>
        clean($(el).text()).length >= MIN_PARAGRAPH &&
        $(el).closest(HIDDEN).length === 0 &&
        !$(el)
          .parents()
          .toArray()
          .some((block) => named($(block), PAGE_FURNITURE_WORDS)),
    );
  const counted = new Set(paragraphs);
  paragraphs.forEach((el) => {
    const length = clean($(el).text()).length;
    total += length;
    const score =
      1 + (clean($(el).text()).match(/,/g)?.length ?? 0) + Math.min(3, Math.floor(length / 100));
    const parent = el.parent;
    if (!parent || parent.type !== 'tag') return;
    scores.set(parent, (scores.get(parent) ?? 0) + score);
    const grandparent = parent.parent;
    if (grandparent && grandparent.type === 'tag') {
      scores.set(grandparent, (scores.get(grandparent) ?? 0) + score / 2);
    }
  });
  let best = null;
  for (const [el, score] of scores) {
    if (!best || score > best.score) best = { el, score };
  }
  if (!best) return null;

  const paragraphText = (el) =>
    $(el)
      .find('p, pre, blockquote, li')
      .toArray()
      .reduce((sum, p) => (counted.has(p) ? sum + clean($(p).text()).length : sum), 0);
  let area = best.el;
  while (
    paragraphText(area) < total * TEXT_AREA_SHARE &&
    area.parent &&
    area.parent.type === 'tag' &&
    area.parent !== body[0]
  ) {
    area = area.parent;
  }
  return area;
}

/** The closest block holding both elements. */
function commonAncestor($, a, b) {
  const above = new Set([a, ...$(a).parents().toArray()]);
  let el = b;
  while (el && !above.has(el)) el = el.parent;
  return el;
}

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

  // The H1s with words, and the page's order, before the frame goes: an
  // article's title often sits in its own <header>.
  const order = new Map(
    $('*')
      .toArray()
      .map((el, i) => [el, i]),
  );
  const worded = $('h1')
    .toArray()
    .filter((el) => clean($(el).text()));

  const body = $('body');
  body.find(FRAME).remove();

  // The root: the page's main block when it holds the text; else the part
  // of the page holding the text and its H1; else the text area alone.
  const textArea = findTextArea($, body);
  // What the page hides goes, outside the text. An answer right after its
  // question waits for the root: in it, it's an FAQ's (QUESTION).
  const answers = [];
  body
    .find(HIDDEN)
    .filter(
      (_, el) =>
        !textArea || ($(el).closest(textArea).length === 0 && !$(el).find(textArea).length),
    )
    .each((_, el) => {
      if ($(el).prev().is(QUESTION)) answers.push(el);
      else $(el).remove();
    });
  // The title's H1, picked once: the last one with words before the text's
  // first paragraph (not a logo's or a site name's above it), else the first.
  // A byline, date or breadcrumb line above the title is no paragraph of it.
  const lead = textArea
    ? $(textArea)
        .find('p, li, pre, blockquote')
        .toArray()
        .find(
          (el) =>
            clean($(el).text()).length >= MIN_PARAGRAPH &&
            ![el, ...$(el).parentsUntil(textArea).toArray()].some((block) =>
              named($(block), PAGE_FURNITURE_WORDS),
            ),
        )
    : null;
  const titleH1 =
    (lead && worded.filter((el) => order.get(el) < order.get(lead)).at(-1)) || worded[0] || null;
  const title =
    clean(titleH1 ? $(titleH1).text() : '') ||
    clean($('meta[property="og:title"]').attr('content')) ||
    clean($('title').first().text());
  // Still on the page (not in a header that went with the frame).
  const heading = titleH1 && $(titleH1).closest('body').length > 0 ? titleH1 : null;
  const main = MAIN_SELECTORS.map((selector) => $(selector).toArray())
    .flat()
    .find((el) => !textArea || el === textArea || $(el).find(textArea).length > 0);
  const root = main
    ? $(main)
    : textArea
      ? $(heading ? commonAncestor($, heading, textArea) : textArea)
      : body;
  for (const el of answers) {
    if ($(el).closest(root[0]).length === 0) $(el).remove();
  }

  // What stays whatever its name: the text area, the blocks around it and
  // the H1's.
  const kept = new Set();
  for (const el of [textArea, heading]) {
    if (!el) continue;
    kept.add(el);
    for (const parent of $(el).parents().toArray()) kept.add(parent);
  }
  const rootLength = clean(root.text()).length;

  // 'remove' for furniture; 'list' for a long list of links outside the
  // text (a category's products), kept and read as the text is.
  const judge = (el, inContent) => {
    const $el = $(el);
    const text = textOf($, el);
    const toc = `${$el.attr('class') ?? ''} ${$el.attr('id') ?? ''}`
      .toLowerCase()
      .includes('table-of-contents');
    if (
      (named($el, inContent ? FURNITURE_WORDS : PAGE_FURNITURE_WORDS) || toc) &&
      text.length < rootLength * MAX_FURNITURE_SHARE
    ) {
      return 'remove';
    }
    // In the text, lists of links and short lines are its own; a page with
    // no paragraphs to go by keeps them too.
    if (!textArea || inContent) return null;
    const links = ($el.is('a') ? $el : $el.find('a')).toArray();
    if (links.length >= 2) {
      const linkText = links.reduce((sum, a) => sum + textOf($, a).length, 0);
      const hrefs = links.map((a) => $(a).attr('href') ?? '');
      // A table of contents: links within the page.
      if (hrefs.filter((href) => href.startsWith('#')).length * 2 > links.length) return 'remove';
      if (
        new Set(hrefs).size >= MIN_LIST_TARGETS ||
        (text.length > MAX_LINK_LIST && linkText >= text.length * LIST_LINK_SHARE)
      ) {
        return 'list';
      }
      if (text.length - linkText <= MAX_LINK_LIST_TEXT) return 'remove';
    }
    return text.length <= MAX_BYLINE && BYLINE.test(text) ? 'remove' : null;
  };
  const lists = new Set();
  const strip = (parent, inContent) => {
    $(parent)
      .children()
      .each((_, el) => {
        const content = inContent || el === textArea;
        if (kept.has(el)) {
          strip(el, content);
          return;
        }
        const verdict = judge(el, content);
        if (verdict === 'remove') {
          $(el).remove();
        } else if (verdict === 'list') {
          lists.add(el);
          strip(el, true);
        } else {
          strip(el, content);
        }
      });
  };
  strip(root[0], root[0] === textArea);

  // Avatars, logos, icons and cover images aren't the text's; a list's
  // pictures (its products) are its own.
  root.find('img').each((_, el) => {
    const $el = $(el);
    const small = ['width', 'height'].some((side) => {
      const size = Number($el.attr(side));
      return Number.isFinite(size) && size > 0 && size <= MAX_ICON_SIZE;
    });
    const above = $el.parentsUntil(root).toArray();
    // In the text when the root is the text area itself, as strip has it.
    const words =
      textArea && (root[0] === textArea || above.includes(textArea))
        ? IMAGE_FURNITURE_WORDS
        : PAGE_IMAGE_FURNITURE_WORDS;
    // Its own name or its block's, not the text's or the H1's wrappers.
    const marked =
      !above.some((node) => lists.has(node)) &&
      [el, ...above].some((node) => !kept.has(node) && named($(node), words));
    if (small || marked) $el.remove();
  });

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

  // One H1 per page, its title: any other becomes an H2, and one without
  // words (a logo) is no heading.
  for (const el of root.find('h1').toArray()) {
    if (el === heading) continue;
    if (!clean($(el).text())) $(el).replaceWith($(el).contents());
    else el.name = 'h2';
  }
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
