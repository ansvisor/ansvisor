import { STOP_WORDS, wordsOf } from './sources';

/**
 * Whether a heading or an FAQ question carries a fan-out (fanoutH2, fanoutFaq
 * only): words meet by their light stems ("Measuring", "measure"), an acronym
 * in capitals counts ("AI"), and with three key words or more all but one is
 * enough, or three in four where that asks for fewer.
 */
export function carriesFanout(fanout: string, text: string): boolean {
  const acronyms = new Set([...acronymsOf(fanout), ...acronymsOf(text)]);
  const keyWords = (of: string) =>
    [...new Set(of.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter(
      (w) => acronyms.has(w) || wordsOf(w).length > 0,
    );
  const keys = keyWords(fanout);
  if (!keys.length) return false;
  const have = new Set(keyWords(text).flatMap(forms));
  const hits = keys.filter((w) => forms(w).some((f) => have.has(f))).length;
  const share = Math.ceil(keys.length * 0.75);
  return hits >= (keys.length >= 3 ? Math.min(keys.length - 1, share) : share);
}

/** Two-character words a text writes in capitals ("AI", "UX", "5G"), lowercased; never a stop word. */
function acronymsOf(text: string): string[] {
  return (text.match(/(?<![\p{L}\p{N}])[\p{Lu}\p{N}]{2}(?![\p{L}\p{N}])/gu) ?? [])
    .map((w) => w.toLowerCase())
    .filter((w) => /\p{L}/u.test(w) && !STOP_WORDS.has(w));
}

/**
 * The forms a word may meet another's in: as written, as wordsOf reads it,
 * and with one ending off (-ing, -ed, -es, -s, -ly; "using" and "used" as
 * "use" too), each without a last "e", a doubled last letter or a last "y"
 * as "i" ("measure" and "measuring" both "measur", "strategy" and
 * "strategies" both "strategi", "shopping" "shop"). A number is as it is.
 */
function forms(word: string): string[] {
  if (/\d/.test(word)) return [word];
  const root = (w: string) =>
    w.length > 3
      ? w
          .replace(/([^aeiousl])\1$/, '$1')
          .replace(/e$/, '')
          .replace(/y$/, 'i')
      : w;
  const out = new Set([word, ...wordsOf(word), root(word)]);
  for (const end of ['ing', 'ed', 'es', 's', 'ly']) {
    if (!word.endsWith(end) || word.endsWith('ss')) continue;
    const w = word.slice(0, -end.length);
    if (w.length >= 3) out.add(root(w));
    if (end === 'ing' || end === 'ed') out.add(root(`${w}e`));
  }
  return [...out];
}
