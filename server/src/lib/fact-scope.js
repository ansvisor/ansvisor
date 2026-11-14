import * as cheerio from 'cheerio';

/**
 * Brand facts per destination, operator or route (00539): a fact's `scope`
 * is where it holds ("Bozcaada"), null for the whole brand. A page gets the
 * brand-wide facts and those whose scope its title, H1, first heading or
 * URL slug names, without regard to case or accents, Turkish letters too
 * ("GÖKÇEADA" and "gokceada" are "Gökçeada"). As lib/content/fact-scope.ts.
 */

/** The longest scope kept (brand_facts_scope_check). */
export const MAX_SCOPE_CHARS = 100;

/** Words as compared: accents off, the Turkish ı as i, lower case, letters and digits only. */
export const scopeWords = (text) =>
  String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** A scope as kept: single spaces, a word in it, MAX_SCOPE_CHARS at most; else null. */
export function scopeText(raw) {
  const text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= MAX_SCOPE_CHARS && scopeWords(text) ? text : null;
}

/** Whether a text names a scope: all its words, whole and in order. */
export function namesScope(text, scope) {
  const words = scopeWords(scope);
  return !!words && ` ${scopeWords(text)} `.includes(` ${words} `);
}

/** A scope as the brand's facts already write it ("bozcaada" is their "Bozcaada"). */
export const sameScope = (known, scope) =>
  scope && (known.find((s) => s && scopeWords(s) === scopeWords(scope)) ?? scope);

/** What a page is named by: its title, H1, first heading and its addresses' paths (a slug too). */
export function pageNames({ html = '', title = '', urls = [] } = {}) {
  const $ = cheerio.load(String(html ?? ''));
  const paths = urls.filter(Boolean).map((url) => {
    try {
      return decodeURIComponent(new URL(url, 'https://page.invalid/').pathname);
    } catch {
      return String(url);
    }
  });
  const first = (selector) => $(selector).first().text();
  return [title ?? '', first('h1'), first('h1, h2, h3, h4, h5, h6'), ...paths];
}

/** The facts for a page: the brand-wide ones, and those whose scope it names. */
export const factsForPage = (facts, names) =>
  facts.filter((fact) => !fact.scope || names.some((name) => namesScope(name, fact.scope)));
