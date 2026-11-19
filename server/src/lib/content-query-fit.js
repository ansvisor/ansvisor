import { languageCodeOf } from './languages.js';

/**
 * The searches a page is written from, kept to the page (Content test
 * 2026-11-19, items 3 and 14): the brief, the writer and the agent read the
 * draft's fan-outs and Search Console queries as they come, so a Russian
 * query ("google ai overviews рейтинг") went into an English page and a
 * workspace's every query ("ai search kpis") became an off-topic H2.
 *
 * - A search in another language's letters than the page's goes: a page's
 *   language keeps its own script and Latin (names, products), and an
 *   English page a search with accents ("métricas") too.
 * - A Search Console query goes unless most of its telling words are the
 *   page's: its title, the prompts it answers, its brief. Fan-outs are the
 *   searches AI ran for those prompts: on the page's topic already.
 * - When nothing would be left to write from, the queries in the page's
 *   language stay, as before.
 */

/** The scripts a language writes in, besides Latin (always kept: names, products). */
const SCRIPTS = {
  ru: ['Cyrillic'],
  uk: ['Cyrillic'],
  bg: ['Cyrillic'],
  sr: ['Cyrillic'],
  mk: ['Cyrillic'],
  be: ['Cyrillic'],
  kk: ['Cyrillic'],
  el: ['Greek'],
  ar: ['Arabic'],
  fa: ['Arabic'],
  ur: ['Arabic'],
  he: ['Hebrew'],
  zh: ['Han'],
  ja: ['Han', 'Hiragana', 'Katakana'],
  ko: ['Hangul', 'Han'],
  th: ['Thai'],
  hi: ['Devanagari'],
  mr: ['Devanagari'],
  ne: ['Devanagari'],
  bn: ['Bengali'],
};

const SCRIPT_TESTS = Object.fromEntries(
  [...new Set(Object.values(SCRIPTS).flat())].map((script) => [
    script,
    new RegExp(`\\p{Script=${script}}`, 'u'),
  ]),
);
const LETTER = /\p{L}/u;
const LATIN = /\p{Script=Latin}/u;
/** A Latin letter English doesn't write: an accent, a dotless i, an ß. */
const NOT_ENGLISH = /[^\p{ASCII}]/u;

/** Whether a search is written in the page's language's letters (or Latin, or none known). */
export function fitsLanguage(text, language) {
  const code = languageCodeOf(language);
  if (!code) return true;
  const own = (SCRIPTS[code] ?? []).map((script) => SCRIPT_TESTS[script]);
  for (const char of String(text ?? '')) {
    if (!LETTER.test(char)) continue;
    if (LATIN.test(char)) {
      if (code === 'en' && NOT_ENGLISH.test(char)) return false;
      continue;
    }
    if (!own.some((test) => test.test(char))) return false;
  }
  return true;
}

/** Words no topic is told by. */
const STOP_WORDS = new Set(
  `a an and are as at be best by can do does for from get good how i in into is it its me my of on or our should that the their them this to top use vs versus was what when where which who why will with you your
  ai tool tools software platform platforms app apps free online guide guides list review reviews example examples tip tips way ways new 2023 2024 2025 2026 2027 2028`.split(
    /\s+/,
  ),
);

/** A word's light stem: "tracking", "tracked", "tracks" → "track"; "strategies" → "strategi". */
function stem(word) {
  let w = word;
  for (const end of ['ing', 'ed', 'es', 's', 'ly']) {
    if (w.length - end.length >= 3 && w.endsWith(end) && !w.endsWith('ss')) {
      w = w.slice(0, -end.length);
      break;
    }
  }
  return w.length > 3
    ? w
        .replace(/([^aeiousl])\1$/, '$1')
        .replace(/e$/, '')
        .replace(/y$/, 'i')
    : w;
}

/** A text's telling words, as stems. */
export function topicWords(text) {
  return [
    ...new Set(
      (
        String(text ?? '')
          .toLowerCase()
          .match(/[\p{L}\p{N}]+/gu) ?? []
      )
        .filter((w) => !STOP_WORDS.has(w) && (w.length > 1 || /\d/.test(w)))
        .map(stem),
    ),
  ];
}

/** The share of a query's telling words the page's must have. */
const TOPIC_SHARE = 0.6;

/** Whether a query is about the page: most of its telling words are among the page's. */
export function onTopic(query, focus) {
  const words = topicWords(query);
  if (!words.length) return false;
  const hits = words.filter((w) => focus.has(w)).length;
  return hits >= Math.ceil(words.length * TOPIC_SHARE);
}

/**
 * The sources a page is written from, kept to it (see above): `focus` is
 * the page's words (its title, prompts, brief), `language` its language.
 * The rest of the sources are as they came.
 */
export function fitSources(sources, { language = null, focus = [] } = {}) {
  if (!sources) return sources;
  const fanouts = (sources.fanouts ?? []).filter((f) => fitsLanguage(f.query, language));
  const inLanguage = (sources.queries ?? []).filter((q) => fitsLanguage(q, language));
  const pageWords = new Set(focus.flatMap(topicWords));
  const queries = pageWords.size ? inLanguage.filter((q) => onTopic(q, pageWords)) : inLanguage;
  // A page with nothing else to go by keeps its queries in its language.
  const nothingElse = !(sources.promptIds?.length ?? 0) && !fanouts.length && !queries.length;
  return { ...sources, fanouts, queries: nothingElse ? inLanguage : queries };
}
