import * as cheerio from 'cheerio';

/**
 * A page as a Webflow CMS item (Send to CMS #1331, phase 2): its rich text
 * as Webflow keeps it, a slug Webflow takes, and the item's fields by the
 * brand's field map (brand_cms_connections.field_map, 00283).
 */

/** What Webflow's rich text keeps; other elements give way to their content. */
const KEEP = new Set([
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'strong',
  'b',
  'em',
  'i',
  'sup',
  'sub',
  'br',
]);
/** The blocks rich text keeps at the top: anything else there goes in a paragraph. */
const BLOCKS = new Set(['h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'ul', 'ol']);
/** What a table cell keeps: its words, links and emphasis. */
const CELL_KEEP = new Set(['a', 'strong', 'b', 'em', 'i']);
/** Media, left out until workspace files (CHAT-06, #1331). */
const MEDIA = 'img, picture, video, audio, svg, canvas, iframe, embed, object';
/** Left out with what they hold: scripts (the JSON-LD has its own field), forms and rules. */
const DROP =
  'script, style, source, track, map, hr, noscript, template, form, button, input, select, textarea';
/** The meta description's fallback: the page's opening words, as long as a search result shows. */
const OPENING_CHARS = 160;
/** Webflow's longest name and plain text it's sent here. */
const NAME_CHARS = 256;

const escape = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const squash = (value) => String(value).replace(/\s+/g, ' ').trim();

/** Attributes go but a link's address and target. */
function bare($, el) {
  const tag = el.tagName?.toLowerCase();
  for (const name of Object.keys(el.attribs ?? {})) {
    if (tag === 'a' && (name === 'href' || name === 'target')) continue;
    $(el).removeAttr(name);
  }
}

/**
 * A table cell as one line: its paragraphs, items and lines a space apart,
 * its links and emphasis kept.
 */
function cellHtml($, cell) {
  const $cell = $(cell).clone();
  $cell.find('br').replaceWith(' ');
  $cell
    .find('p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, blockquote, dt, dd')
    .prepend(' ')
    .append(' ');
  for (const el of $cell.find('*').toArray().reverse()) {
    if (CELL_KEEP.has(el.tagName?.toLowerCase())) bare($, el);
    else $(el).replaceWith($(el).contents());
  }
  return squash($cell.html() ?? '');
}

/** A table's own rows, not those of a table inside one of its cells. */
const ownRows = ($, table) =>
  $(table)
    .find('tr')
    .toArray()
    .filter((row) => $(row).closest('table')[0] === table);

/**
 * A page's publishable HTML as Webflow's rich text keeps it:
 *   - a table becomes a list, a row an item ("Header: cell · …"), a table in
 *     a cell first: rich text has no tables (#1331);
 *   - images and media are left out until workspace files (CHAT-06, #1331),
 *     a figure of one with its caption; scripts (the JSON-LD has its own
 *     field), embeds, forms and rules go too;
 *   - the page's title is the item's name, so a heading 1 left in the body
 *     reads as a heading 2;
 *   - a code block, a definition list, a caption and words outside a block
 *     are paragraphs, an item outside a list too;
 *   - any other element gives way to its content, and attributes go but a
 *     link's address and target.
 * Returns the HTML, and how many tables and images it changed (the send's note).
 */
export function toWebflowRichText(html) {
  const $ = cheerio.load(String(html ?? ''), null, false);
  const changed = {
    tables: $('table').filter((_, t) => !$(t).parents('table').length).length,
    images:
      $('img, video, svg').length + $('picture').filter((_, p) => !$(p).find('img').length).length,
  };
  $(DROP).remove();
  $('*')
    .contents()
    .add($.root().contents())
    .filter((_, node) => node.type === 'comment')
    .remove();

  // Inner tables first: a cell holding one reads it as its list.
  for (const table of $('table').toArray().reverse()) {
    const rows = ownRows($, table);
    const own = (row) =>
      $(row)
        .children('th, td')
        .toArray()
        .map((cell) => cellHtml($, cell));
    const head =
      rows.length && $(rows[0]).children('th').length
        ? $(rows[0])
            .children('th, td')
            .toArray()
            .map((cell) => squash($(cell).text()))
        : null;
    const items = (head ? rows.slice(1) : rows)
      .map((row) =>
        own(row)
          .map((value, i) =>
            value && head?.[i] ? `<strong>${escape(head[i])}</strong>: ${value}` : value,
          )
          .filter(Boolean)
          .join(' · '),
      )
      .filter(Boolean);
    $(table).replaceWith(
      items.length ? `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>` : '',
    );
  }

  // A figure of media goes with its caption; a figure of words (a table's) keeps them.
  $('figure').each((_, figure) => {
    if ($(figure).find(MEDIA).length) $(figure).remove();
  });
  $(MEDIA).remove();
  $('h1').each((_, el) => {
    el.tagName = 'h2';
  });
  $('pre').each((_, el) => {
    $(el).replaceWith(`<p>${escape($(el).text().trim())}</p>`);
  });
  $('dt, dd, figcaption, caption').each((_, el) => {
    $(el).replaceWith(`<p>${$(el).html() ?? ''}</p>`);
  });

  // Inside out, so an element's children are settled before it gives way.
  for (const el of $('*').toArray().reverse()) {
    if (KEEP.has(el.tagName?.toLowerCase())) bare($, el);
    else $(el).replaceWith($(el).contents());
  }
  $('li').each((_, el) => {
    if (!$(el).parent().is('ul, ol')) el.tagName = 'p';
  });

  // Words and inline elements at the top go in paragraphs, a run at a time.
  let run = [];
  const wrap = () => {
    if (run.some((node) => squash($(node).text()))) $(run).wrapAll('<p></p>');
    else $(run).remove();
    run = [];
  };
  for (const node of $.root().contents().toArray()) {
    if (node.type === 'tag' && BLOCKS.has(node.tagName.toLowerCase())) wrap();
    else if (node.type === 'tag' || node.type === 'text') run.push(node);
  }
  wrap();

  // The paragraphs, items and lists a removal left empty.
  $('p, li, h2, h3, h4, h5, h6, blockquote').each((_, el) => {
    if (!squash($(el).text()) && !$(el).find('br').length) $(el).remove();
  });
  $('ul, ol').each((_, el) => {
    if (!$(el).children('li').length) $(el).remove();
  });
  return { html: $.html().trim(), changed };
}

/** Letters Unicode doesn't take apart into a base letter and its mark. */
const LETTERS = { ı: 'i', ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ł: 'l', þ: 'th' };

/**
 * A slug Webflow takes: lowercase letters, digits, '-' and '_', starting
 * with a letter, digit or '_' (marks taken off, "ç" → "c"). Null when
 * nothing of it is left (a slug in another script).
 */
export function webflowSlug(value) {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[ıßæœøđłþ]/g, (c) => LETTERS[c])
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200)
    .replace(/-+$/, '');
  return slug || null;
}

/** The page's opening words, cut at a word: its meta description when it has none. */
function openingWords(html) {
  const text = squash(
    cheerio
      .load(String(html ?? ''), null, false)
      .root()
      .text(),
  );
  if (text.length <= OPENING_CHARS) return text;
  const cut = text.slice(0, OPENING_CHARS - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 80 ? cut.slice(0, space) : cut).trim()}…`;
}

/**
 * The item's fields: its name and slug, and each part of the page in the
 * field the brand's map gives it. The meta title falls back to the title,
 * the meta description to the page's opening words. JSON-LD goes as its
 * JSON (for an embed in the collection's template), empty when the page has
 * none, so an item sent again loses what the page no longer says.
 */
export function fieldDataFor({ page, slug, body, jsonLd }, fieldMap) {
  const data = { name: squash(page.title).slice(0, NAME_CHARS), slug };
  if (fieldMap.body) data[fieldMap.body] = body;
  if (fieldMap.metaTitle) {
    data[fieldMap.metaTitle] = squash(page.metaTitle || page.title).slice(0, NAME_CHARS);
  }
  if (fieldMap.metaDescription) {
    data[fieldMap.metaDescription] = squash(page.metaDescription) || openingWords(body);
  }
  if (fieldMap.jsonLd) {
    // Every "<" escaped: nothing in it can end or open a tag in the embed's script.
    data[fieldMap.jsonLd] = jsonLd?.length
      ? JSON.stringify(jsonLd.length === 1 ? jsonLd[0] : jsonLd).replace(/</g, '\\u003c')
      : '';
  }
  return data;
}
