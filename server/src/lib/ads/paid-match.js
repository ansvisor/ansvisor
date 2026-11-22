/**
 * Which tracked prompt a Google search term belongs to (ADS-01 §3.3, Phase 1
 * P2), so the Overlap view can say what a brand pays for clicks on the
 * questions AI already answers with it.
 *
 * A search term is what someone typed before clicking an ad ("crm for small
 * business"). A prompt is the longer question tracked in AI answers ("What
 * is the best CRM for a small business?"), with the Google keywords its
 * volume was read from (prompt_volumes.keywords). A term matches a prompt
 * when, with small words and plurals set aside:
 *
 *  - it is one of the prompt's keywords (strongest);
 *  - it has at least two words, all in the prompt's text or in one of its
 *    keywords; or a keyword of at least two words is all in it.
 *
 * A one-word term ("crm") matches only a keyword it equals: on its own it
 * could be any question. Each term goes to at most one prompt, the best one,
 * so a term's cost is never counted twice; ties go to the prompt sharing the
 * most words with it, then the prompt id, so a read is the same every time.
 * Pure: no reads.
 */

/** Small words a search adds or drops without changing what it asks. */
const SMALL_WORDS = new Set(
  (
    'a an the of for to in on at by from with without and or is are was be do does ' +
    'i me my we our you your it its this that what which who how why when where ' +
    'can should would could will near'
  ).split(' '),
);

/** A word without a plain English plural ("tools" → "tool"); "glass" stays. */
const singular = (word) =>
  word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;

/** A text's telling words: lower case, letters and digits only, no small words, singular. */
export function termWords(text) {
  return [
    ...new Set(
      String(text ?? '')
        .normalize('NFKC')
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w && !SMALL_WORDS.has(w))
        .map(singular),
    ),
  ];
}

const within = (words, set) => words.every((w) => set.has(w));
const sameWords = (a, b) => a.length === b.length && within(a, new Set(b));

/**
 * How well a term's words fit a prompt: 3 = one of its keywords, 2 = all in
 * it (or one of its keywords all in the term), 0 = no match.
 */
function fit(term, prompt) {
  if (term.length === 0) return 0;
  if (prompt.keywords.some((k) => k.length > 0 && sameWords(term, k))) return 3;
  if (term.length < 2) return 0;
  if (within(term, prompt.words)) return 2;
  const termSet = new Set(term);
  for (const k of prompt.keywords) {
    if (k.length >= 2 && (within(term, new Set(k)) || within(k, termSet))) return 2;
  }
  return 0;
}

/**
 * @param {string[]} terms search terms, as Google reports them
 * @param {Array<{ promptId: string, text: string, keywords?: unknown }>} prompts
 * @returns {Map<string, string>} each matched term → its prompt's id
 */
export function matchSearchTerms(terms, prompts) {
  const ready = prompts.map((p) => ({
    promptId: p.promptId,
    words: new Set(termWords(p.text)),
    keywords: (Array.isArray(p.keywords) ? p.keywords : [])
      .filter((k) => typeof k === 'string')
      .map(termWords),
  }));
  const matched = new Map();
  for (const term of new Set(terms)) {
    const words = termWords(term);
    let best = null;
    for (const prompt of ready) {
      const score = fit(words, prompt);
      if (score === 0) continue;
      const shared = words.filter((w) => prompt.words.has(w)).length;
      if (
        !best ||
        score > best.score ||
        (score === best.score &&
          (shared > best.shared || (shared === best.shared && prompt.promptId < best.promptId)))
      ) {
        best = { score, shared, promptId: prompt.promptId };
      }
    }
    if (best) matched.set(term, best.promptId);
  }
  return matched;
}
