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
/** Left out with what they hold: media until workspace files (CHAT-06), scripts, embeds. */
const DROP =
  'script, style, img, picture, figure, video, audio, source, track, iframe, embed, object, svg, canvas, map, hr, noscript, template, form, button, input, select, textarea';
/** The meta description's fallback: the page's opening words, about as long as a search result shows. */
const OPENING_CHARS = 160;
/** Webflow's longest name and plain text it's sent here. */
const NAME_CHARS = 256;

const escape = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const squash = (value) => String(value).replace(/\s+/g, ' ').trim();

/**
 * A page's publishable HTML as Webflow's rich text keeps it:
 *   - a table becomes a list, a row an item ("Header: cell · …"): rich text
 *     has no tables (#1331);
 *   - images, figures and media are left out until workspace files
 *     (CHAT-06, #1331); scripts (the JSON-LD has its own field), embeds,
 *     forms and rules go too;
 *   - the page's title is the item's name, so a heading 1 left in the body
 *     reads as a heading 2;
 *   - a code block is a paragraph of its text, a definition list paragraphs;
 *   - any other element gives way to its content, and attributes go but a
 *     link's address and target.
 * Returns the HTML, and how many tables and images it changed (the send's note).
 */
export function toWebflowRichText(html) {
  const $ = cheerio.load(String(html ?? ''), null, false);
  const changed = { tables: 0, images: $('img, picture, svg, video').length };
  $(DROP).remove();

  $('table').each((_, table) => {
    changed.tables += 1;
    const rows = $(table).find('tr').toArray();
    const cells = (row) =>
      $(row)
        .children('th, td')
        .toArray()
        .map((cell) => squash($(cell).text()));
    const head = rows.length && $(rows[0]).children('th').length ? cells(rows[0]) : null;
    const items = (head ? rows.slice(1) : rows)
      .map((row) =>
        cells(row)
          .map((value, i) =>
            value && head?.[i]
              ? `<strong>${escape(head[i])}</strong>: ${escape(value)}`
              : escape(value),
          )
          .filter(Boolean)
          .join(' · '),
      )
      .filter(Boolean);
    $(table).replaceWith(
      items.length ? `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>` : '',
    );
  });

  $('h1').each((_, el) => {
    el.tagName = 'h2';
  });
  $('pre').each((_, el) => {
    $(el).replaceWith(`<p>${escape($(el).text().trim())}</p>`);
  });
  $('dt, dd').each((_, el) => {
    $(el).replaceWith(`<p>${$(el).html() ?? ''}</p>`);
  });

  // Inside out, so an element's children are settled before it gives way.
  for (const el of $('*').toArray().reverse()) {
    const tag = el.tagName?.toLowerCase();
    if (!KEEP.has(tag)) {
      $(el).replaceWith($(el).contents());
      continue;
    }
    for (const name of Object.keys(el.attribs ?? {})) {
      if (tag === 'a' && (name === 'href' || name === 'target')) continue;
      $(el).removeAttr(name);
    }
  }
  // The paragraphs and items a removal left empty.
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
 * nothing of it is left.
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

/** The page's opening words: its meta description when it has none. */
function openingWords(html) {
  const text = squash(
    cheerio
      .load(String(html ?? ''), null, false)
      .root()
      .text(),
  );
  if (text.length <= OPENING_CHARS) return text;
  const cut = text.slice(0, OPENING_CHARS);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 80 ? cut.lastIndexOf(' ') : OPENING_CHARS).trim()}…`;
}

/**
 * The item's fields: its name and slug, and each part of the page in the
 * field the brand's map gives it. The meta title falls back to the title,
 * the meta description to the page's opening words; JSON-LD goes as its
 * JSON (for an embed in the collection's template), or not at all.
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
  if (fieldMap.jsonLd && jsonLd?.length) {
    // "</" can't close the embed's script.
    data[fieldMap.jsonLd] = JSON.stringify(jsonLd.length === 1 ? jsonLd[0] : jsonLd).replace(
      /<\//g,
      '<\\/',
    );
  }
  return data;
}
