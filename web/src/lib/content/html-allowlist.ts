import { safeLinkHref } from './editor';

/**
 * What a draft's HTML may hold (Content Editor CE-005 and CE-020, spec §9 and
 * §12). The browser cleans a paste and the HTML view with it (clean-html.ts),
 * and the server checks every save against it again (sanitize-draft-html.ts):
 * headings, paragraphs, bold, italic, lists, links, tables, quotes, images
 * and schema JSON-LD. Fonts, colors, classes, inline styles, scripts and
 * iframes go.
 */

export const ALLOWED_TAGS = [
  'h1',
  'h2',
  'h3',
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'a',
  'ul',
  'ol',
  'li',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'img',
];

/** Attributes kept, per tag; every other one (style, class, id, on*…) goes. */
export const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ['href'],
  img: ['src', 'alt', 'title'],
  th: ['colspan', 'rowspan'],
  td: ['colspan', 'rowspan'],
};

/** Headings below H3 become H3: the editor has three levels. */
export const DEMOTED_HEADINGS = ['h4', 'h5', 'h6'];

/** Elements whose removal a toast counts as "unsafe". */
export const UNSAFE_TAGS = [
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'base',
];

const TRACKING_PARAM = /^(utm_.+|gclid|fbclid)$/i;

/**
 * A link as a draft keeps it: one the toolbar would accept (safeLinkHref),
 * without utm_*, gclid or fbclid, which only say where someone once clicked.
 * Null when it isn't a link.
 */
export function cleanHref(href: string): string | null {
  const safe = safeLinkHref(href);
  if (!safe || safe.startsWith('mailto:')) return safe;
  const relative = safe.startsWith('/');
  const url = new URL(safe, 'https://relative.invalid');
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  return relative ? `${url.pathname}${url.search}${url.hash}` : url.href;
}

/** The largest schema block a draft keeps, in characters. */
const MAX_JSON_LD_LENGTH = 50_000;

/**
 * A JSON-LD block as a draft stores it: parsed and written again, so only
 * JSON goes into the script element, with <, > and & escaped so it can never
 * close the element or start another. Null when it isn't a JSON object or
 * list, or is too large.
 */
export function normalizeJsonLd(text: string): string | null {
  if (text.length > MAX_JSON_LD_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/** The schema type a JSON-LD block describes ("Product", "FAQPage"), for its label. */
export function jsonLdType(json: string): string | null {
  try {
    const value = JSON.parse(json) as Record<string, unknown> | Record<string, unknown>[];
    const first = Array.isArray(value) ? value[0] : value;
    const type = first?.['@type'];
    return typeof type === 'string' ? type : Array.isArray(type) ? String(type[0]) : null;
  } catch {
    return null;
  }
}

/** A script tag's attributes that say it holds schema JSON-LD. */
const JSON_LD_TYPE = /\btype\s*=\s*["']?application\/ld\+json/;

/**
 * The schema JSON-LD scripts in the HTML: where each starts and ends, and
 * its text. Found by a scan, not a regex: a pattern over a script tag's
 * attributes backtracks on input with many unclosed tags (cubic time), and
 * the server runs this on every save. Each step moves past what it read, so
 * the time grows with the length only.
 */
export function jsonLdScripts(html: string): { start: number; end: number; text: string }[] {
  // ASCII letters only: lower-casing all of it changes the length ('İ'
  // becomes two units), and the positions found must fit the HTML.
  const lower = html.replace(/[A-Z]+/g, (s) => s.toLowerCase());
  const found: { start: number; end: number; text: string }[] = [];
  let from = 0;
  for (;;) {
    const open = lower.indexOf('<script', from);
    if (open === -1) break;
    // "<scripts>" or "<script-x>" is another tag.
    if (/[^\s>/]/.test(lower.charAt(open + 7))) {
      from = open + 7;
      continue;
    }
    const tagEnd = lower.indexOf('>', open);
    if (tagEnd === -1) break;
    // A script's text isn't markup: the next tag is its end tag.
    const close = lower.indexOf('</script', tagEnd + 1);
    if (close === -1) break;
    const closeEnd = lower.indexOf('>', close);
    if (closeEnd === -1) break;
    if (JSON_LD_TYPE.test(lower.slice(open, tagEnd))) {
      found.push({ start: open, end: closeEnd + 1, text: html.slice(tagEnd + 1, close) });
    }
    from = closeEnd + 1;
  }
  return found;
}

/** Where a kept JSON-LD block waits while the rest of the HTML is cleaned. */
export const JSON_LD_SLOT = 'jsonld-slot';
const SLOT_PATTERN = new RegExp(`<${JSON_LD_SLOT} data-i="(\\d+)"></${JSON_LD_SLOT}>`, 'g');

/**
 * Takes the schema JSON-LD blocks out of the HTML before it is cleaned, as
 * slots, so the cleaner, which removes every script, keeps them. A block
 * that isn't valid JSON is dropped with its script.
 */
export function extractJsonLd(html: string): { html: string; blocks: string[] } {
  const blocks: string[] = [];
  let out = '';
  let last = 0;
  for (const script of jsonLdScripts(html)) {
    out += html.slice(last, script.start);
    const json = normalizeJsonLd(script.text.trim());
    if (json) {
      blocks.push(json);
      out += `<${JSON_LD_SLOT} data-i="${blocks.length - 1}"></${JSON_LD_SLOT}>`;
    }
    last = script.end;
  }
  return { html: out + html.slice(last), blocks };
}

/** Puts the kept blocks back as script elements of our own, with only their JSON. */
export function restoreJsonLd(html: string, blocks: string[]): string {
  return html.replace(SLOT_PATTERN, (_, i: string) => {
    const json = blocks[Number(i)];
    return json ? `<script type="application/ld+json">${json}</script>` : '';
  });
}
