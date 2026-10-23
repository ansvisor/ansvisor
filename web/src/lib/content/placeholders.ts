/**
 * Placeholders in a page (Content Editor Quality spec §4, §9, CE-044): words
 * in square brackets where a real name, quote or number goes — what the
 * Content Agent leaves when it had none ("[figure, source]", "[name of a
 * real person]") — for the person to fill. Only they can: a to-do in
 * Quality. An export never ships one (CE-057).
 */

/**
 * Words in square brackets with a letter and more than one character in
 * them; not a footnote ("[1]"), a checkbox ("[x]"), "[sic]", or a Markdown
 * link's text ("[docs](https://…)").
 */
export const PLACEHOLDER = /\[(?!sic\])(?=[^[\]\n]*\p{L})[^[\]\n]{2,}\](?!\()/giu;

export interface PagePlaceholders {
  count: number;
}

/**
 * The page's placeholders. The editor keeps every line of text in a
 * paragraph or a heading (in lists, quotes and tables too), so each is read
 * once there.
 */
export function pagePlaceholders(html: string): PagePlaceholders {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let count = 0;
  for (const el of doc.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6')) {
    count += (el.textContent ?? '').match(PLACEHOLDER)?.length ?? 0;
  }
  return { count };
}
