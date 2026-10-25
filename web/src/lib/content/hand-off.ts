/**
 * Hand it off to Content Agent (Quality spec §5, CE-051): what of Quality's
 * suggestions the agent fixes in one run. Every suggestion is fixable; the
 * to-dos (what only the person can give: their input, an author, proof, a
 * placeholder) stay the person's. The server says what each asks
 * (content-handoff.js, HANDOFF_CHECKS); the editor sends what each names on
 * the page.
 */

/** The fixable checks, by Quality's suggestion key, as the API takes them. */
export const HANDOFF_KEYS: ReadonlySet<string> = new Set([
  'readability:avgSentence',
  'readability:longSentences',
  'readability:readingLevel',
  'readability:answerFirst',
  'readability:shortParagraphs',
  'readability:headingSpacing',
  'readability:passiveJargon',
  'trust:claimsSourced',
  'trust:brandFacts',
  'trust:freshSources',
  'trust:noWeakSources',
  'trust:primarySources',
  'trust:disclosure',
  'trust:balanced',
  'trust:noBrokenLinks',
]);

/** What the API takes of a check's detail. */
const MAX_DETAIL = 500;

/**
 * The checks to hand off: the suggestions with a gain, each once, with its
 * line, its detail and the passage it shows. The disclosure goes only with
 * the line to add, in the page's language (disclosureText): the agent writes
 * it as given, never one of its own.
 */
export function handOffItems(
  suggestions: readonly {
    key: string;
    gain: number;
    line: string;
    detail: string;
    show: string | null;
  }[],
  { disclosureLine = null }: { disclosureLine?: string | null } = {},
): { key: string; detail: string }[] {
  const seen = new Set<string>();
  return suggestions.flatMap((s) => {
    if (s.gain <= 0 || !HANDOFF_KEYS.has(s.key) || seen.has(s.key)) return [];
    if (s.key === 'trust:disclosure' && !disclosureLine) return [];
    seen.add(s.key);
    const detail = [
      s.line,
      s.detail,
      s.show ? `Where: "${s.show}"` : null,
      s.key === 'trust:disclosure' ? `The line: "${disclosureLine}"` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return [{ key: s.key, detail: detail.slice(0, MAX_DETAIL) }];
  });
}
