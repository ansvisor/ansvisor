/**
 * Unfilled placeholders in what Chat and its agents save or send: a
 * bracketed stand-in for a fact, such as "[real metric]", "[price]",
 * "[visa fee]", "[departure dates]", "[TBD]" or "[…]". A draft with one
 * isn't saved: the model is told which facts are missing, so it asks for
 * them (missingFactsIssue). A report or an answer loses the lines with one,
 * and a section they leave empty (withoutPlaceholderLines).
 *
 * Not a placeholder: a markdown link's text ("[guide](https://…)",
 * "[guide][1]"), a reference definition ("[1]: https://…"), a citation or
 * footnote ("[1]", "[^1]"), a task box ("[ ]", "[x]"), an attribute
 * selector glued to a word ("a[href]"), or text in a fenced code block.
 * Pure.
 */

const PLACEHOLDER_RE =
  /(?<![\w\]!\\])\[(?:\s*(?:…|\.{3})\s*|\p{L}[\p{L}\p{N} '’/&-]{1,48})\](?![([])/gu;
const REFERENCE_DEFINITION_RE = /^ {0,3}\[[^\]\n]+\]:\s.*$/gm;
const FENCE_RE = /^\s*(```|~~~)/;

/** The placeholders in a text, each once, as written; `keep`'s own (the person's words) aren't. */
export function placeholdersIn(text: string, keep = ''): string[] {
  const found = new Set<string>();
  let fence = false;
  for (const line of text.replace(REFERENCE_DEFINITION_RE, '').split('\n')) {
    if (FENCE_RE.test(line)) fence = !fence;
    else if (!fence) {
      for (const m of line.matchAll(PLACEHOLDER_RE)) if (!keep.includes(m[0])) found.add(m[0]);
    }
  }
  return [...found];
}

const headingLevel = (line: string) => /^ {0,3}(#{1,6})\s/.exec(line)?.[1].length ?? 0;

/** The facts placeholders stand for: "[refund period]" → "refund period"; each once. */
export function factsOf(placeholders: readonly string[]): string[] {
  const named = placeholders.map((p) => p.slice(1, -1).trim()).filter((n) => /\p{L}/u.test(n));
  return [...new Set(named.length > 0 ? named : placeholders)];
}

/** A heading's words, for finding it in the person's message. */
const headingWords = (line: string) =>
  line
    .replace(/^ {0,3}#{1,6}\s+/, '')
    .replace(/[*_`#:]/g, '')
    .trim()
    .toLowerCase();

/**
 * A report or an answer without the lines that hold a placeholder, and
 * without a heading whose section that leaves empty. Blank lines a cut
 * leaves twice are kept once. The text as it is when nothing is cut.
 * `note` says what was left out, naming the missing facts: it stands in for
 * the answer when nothing else would be left, and under an emptied section's
 * heading when the person's message (`keep`) names that section.
 */
export function withoutPlaceholderLines(
  text: string,
  keep = '',
  note?: (facts: string[]) => string,
): string {
  const lines = text.split('\n');
  const dropped = new Map<number, string[]>();
  let fence = false;
  lines.forEach((line, i) => {
    if (FENCE_RE.test(line)) fence = !fence;
    else if (!fence) {
      const found = placeholdersIn(line, keep);
      if (found.length > 0) dropped.set(i, found);
    }
  });
  if (dropped.size === 0) return text;
  const removed = new Set(dropped.keys());
  const noted = new Map<number, string[]>();
  const asked = keep.toLowerCase();
  // Last first, so a sub-section emptied before is gone when its parent is looked at.
  for (let i = lines.length - 1; i >= 0; i--) {
    const level = headingLevel(lines[i]);
    if (level === 0 || removed.has(i)) continue;
    const lost: string[] = [];
    let left = false;
    for (let j = i + 1; j < lines.length; j++) {
      const next = headingLevel(lines[j]);
      if (next > 0 && next <= level) break;
      const found = dropped.get(j);
      if (found) lost.push(...found);
      else if (!removed.has(j) && lines[j].trim()) left = true;
    }
    if (lost.length === 0 || left) continue;
    const words = headingWords(lines[i]);
    if (note && words && asked.includes(words)) noted.set(i, lost);
    else removed.add(i);
  }
  const out: string[] = [];
  let cut = false;
  lines.forEach((line, i) => {
    if (removed.has(i)) {
      cut = true;
      return;
    }
    const blank = !line.trim();
    if (cut && blank && (out.length === 0 || !out[out.length - 1].trim())) return;
    if (!blank) cut = false;
    out.push(line);
    const facts = noted.get(i);
    if (facts && note) out.push(note(factsOf(facts)));
  });
  const kept = out.join('\n').trimEnd();
  if (kept.trim() || !note) return kept;
  return note(factsOf([...dropped.values()].flat()));
}

/**
 * What a draft save tells the model when the page or its title still has
 * placeholders, so it asks for the facts instead of saving; null when none.
 */
export function missingFactsIssue(texts: readonly (string | undefined)[]): string | null {
  const found = [...new Set(texts.flatMap((text) => (text ? placeholdersIn(text) : [])))];
  if (found.length === 0) return null;
  return `Not saved: the page still has placeholders for facts that are missing (${found.slice(0, 10).join(', ')}). Never invent them. Ask the person for these facts in one question that lists them, or leave those parts out and say so; then save the page with no placeholders.`;
}

/**
 * A draft save's input check (create_draft, update_draft): a title or page
 * with a placeholder fails, before any card, and the model gets
 * missingFactsIssue's words as the result.
 */
export function refuseMissingFacts(
  input: { title?: string; body_html?: string },
  ctx: { addIssue: (issue: { code: 'custom'; message: string; path: string[] }) => void },
): void {
  const issue = missingFactsIssue([input.title, input.body_html]);
  if (issue) ctx.addIssue({ code: 'custom', message: issue, path: ['body_html'] });
}
