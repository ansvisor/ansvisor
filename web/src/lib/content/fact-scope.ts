/**
 * Brand facts per destination, operator or route (00539): a fact's `scope`
 * is where it holds ("Bozcaada"), none for the whole brand. A page gets the
 * brand-wide facts and those whose scope its title, H1, first heading or
 * URL slug names, without regard to case or accents, Turkish letters too
 * ("GÖKÇEADA" and "gokceada" are "Gökçeada"). As the API's lib/fact-scope.js.
 */

/** The longest scope kept (brand_facts_scope_check). */
export const MAX_SCOPE_CHARS = 100;

/** Words as compared: accents off, the Turkish ı as i, lower case, letters and digits only. */
const scopeWords = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Whether a text names a scope: all its words, whole and in order. */
export function namesScope(text: string, scope: string): boolean {
  const words = scopeWords(scope);
  return !!words && ` ${scopeWords(text)} `.includes(` ${words} `);
}

/** A heading's words (the first of `tags`), its tags out. */
const headingText = (html: string, tags: string) =>
  (new RegExp(`<(${tags})\\b[^>]*>([\\s\\S]*?)</\\1>`, 'i').exec(html)?.[2] ?? '')
    .replace(/<[^>]*>|&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

/** What a page is named by: its title, H1, first heading and its addresses' paths (a slug too). */
export function pageNames(page: {
  html?: string;
  title?: string | null;
  urls?: readonly (string | null | undefined)[];
}): string[] {
  const html = page.html ?? '';
  const paths = (page.urls ?? []).flatMap((url) => {
    if (!url) return [];
    try {
      return [decodeURIComponent(new URL(url, 'https://page.invalid/').pathname)];
    } catch {
      return [url];
    }
  });
  return [page.title ?? '', headingText(html, 'h1'), headingText(html, 'h[1-6]'), ...paths];
}

/** The facts for a page: the brand-wide ones, and those whose scope it names. */
export const factsForPage = <T extends { scope?: string | null }>(facts: T[], names: string[]) =>
  facts.filter((fact) => !fact.scope || names.some((name) => namesScope(name, fact.scope!)));

/** Facts by where they hold: the whole brand's first, then each place's, A to Z. */
export function byScope<T extends { scope?: string | null }>(facts: T[]) {
  const groups = new Map<string | null, T[]>([[null, []]]);
  for (const fact of facts)
    groups.set(fact.scope || null, [...(groups.get(fact.scope || null) ?? []), fact]);
  return [...groups]
    .filter(([, list]) => list.length)
    .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : a.localeCompare(b)))
    .map(([scope, list]) => ({ scope, facts: list }));
}
