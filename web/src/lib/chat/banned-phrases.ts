/**
 * A brand's banned phrases (Content rules) in what Chat and its agents save:
 * a draft with one isn't saved, and the model is told which, so it rewrites
 * those sentences. A phrase matches as a whole word or a whole phrase, in any
 * case ("cheap" isn't in "cheaper"; "best price" matches across a line break
 * or a tag). A report or an answer is never checked: the instruction is
 * enough there. Pure.
 */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

/** The banned phrases found in the texts (html is fine), each once, as the brand wrote it. */
export function bannedPhrasesIn(
  texts: readonly (string | undefined)[],
  phrases: readonly string[],
): string[] {
  const text = texts
    .filter(Boolean)
    .map((t) => textOf(t as string))
    .join('\n');
  const found: string[] = [];
  for (const phrase of phrases) {
    const words = phrase.trim().split(/\s+/).filter(Boolean).map(escape);
    if (words.length === 0 || found.includes(phrase)) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${words.join('\\s+')}(?![\\p{L}\\p{N}])`, 'iu');
    if (re.test(text)) found.push(phrase);
  }
  return found;
}

/** What a draft save tells the model when the page or its title has banned phrases; null when none. */
export function bannedPhrasesIssue(
  texts: readonly (string | undefined)[],
  phrases: readonly string[],
): string | null {
  const found = bannedPhrasesIn(texts, phrases);
  if (found.length === 0) return null;
  return `Not saved: the brand never uses these phrases (${found
    .slice(0, 10)
    .map((p) => `"${p}"`)
    .join(', ')}). Rewrite the sentences that have them in other words, then save the page again.`;
}
