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

/**
 * The forms the server's guards write in a page (the number guard's
 * "[figure, source]", content-people.js's name and quote): in a title or a
 * heading, only these are placeholders. Brackets a person writes there
 * ("Best CRM tools [2026 Update]", "[PDF]") are part of the title. The
 * writer's prompts let the model write others too ("[price]"); in a heading
 * they read as written.
 */
export const AGENT_PLACEHOLDER =
  /\[(?:figure, source[^[\]\n]*|name of a real person|quote from a real person[^[\]\n]*)\](?!\()/giu;

/** The placeholders a line is read for: a heading's (and a title's) are the agent's forms only. */
export const placeholderIn = (heading: boolean) => (heading ? AGENT_PLACEHOLDER : PLACEHOLDER);

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
    count += (el.textContent ?? '').match(placeholderIn(el.tagName !== 'P'))?.length ?? 0;
  }
  return { count };
}
