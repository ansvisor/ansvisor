import * as cheerio from 'cheerio';

/**
 * Readability (Flesch Reading Ease) as the Content Editor's Quality reads an
 * English page, so a page scores the same in Site Audit and in the editor:
 * its prose blocks (headings aside, a list item on its own), its sentences
 * (an abbreviation's dot ends none) and its syllables, and one band.
 * Mirrors web/src/lib/content/readability.ts (readBlocks, sentencesOf,
 * syllablesOf for 'en', FLESCH_BAND): keep the two in step. Both tests read
 * the same page and expect the same score.
 */

/**
 * The rubric's target (rubric.json, readability: 50–70 for general
 * audiences): inside it passes; 30–50 and 70–80 warn; past them, fails.
 */
const FLESCH_BAND = { pass: [50, 70], warn: [30, 80] };

/** Fewer words than this give no score. */
const MIN_WORDS = 30;

/** Words as the editor counts them, a vowel sign or other mark kept inside its word. */
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;
const countWords = (text) => text.match(WORD)?.length ?? 0;

/**
 * Text joined as a reader sees it: a space between blocks and at a line
 * break, a list item's own words without the list nested in it.
 */
function ownText(el) {
  let out = '';
  for (const node of el.children ?? []) {
    if (node.type === 'text') out += node.data;
    else if (node.type === 'tag') {
      const tag = node.name.toLowerCase();
      if (tag === 'ul' || tag === 'ol') continue;
      if (tag === 'br') out += ' ';
      else out += ` ${ownText(node)} `;
    }
  }
  return out;
}

/** Elements whose words stay in the line around them. */
const INLINE = new Set(
  'a abbr b bdi bdo cite code data dfn em i kbd mark q s samp small span strong sub sup time u var wbr'.split(
    ' ',
  ),
);

/** A block's own words, without the blocks inside it: a div's loose text. */
function inlineText(el) {
  let out = '';
  for (const node of el.children ?? []) {
    if (node.type === 'text') out += node.data;
    else if (node.type === 'tag' && INLINE.has(node.name.toLowerCase())) out += inlineText(node);
    else if (node.type === 'tag' && node.name.toLowerCase() === 'br') out += ' ';
  }
  return out;
}

/**
 * The page's headings and prose, in order: a quote once, each list item on
 * its own, a table's cells not at all. Text a page builder leaves loose in
 * a div, a figure's caption or a definition list is a paragraph, as the
 * editor's import makes it one.
 * @param {string} html
 * @returns {{ tag: string, text: string }[]}
 */
export function readingBlocks(html) {
  const $ = cheerio.load(html ?? '');
  $('script, style, noscript, template, svg').remove();
  const blocks = [];
  $('body')
    .find('h1, h2, h3, p, li, blockquote, div, section, article, figcaption, dd, dt')
    .each((_, el) => {
      const tag = el.name.toLowerCase();
      if (['div', 'section', 'article', 'figcaption', 'dd', 'dt'].includes(tag)) {
        // Inside a block read whole, or a table, it is read with it, or not at all.
        if ($(el).parents('p, li, blockquote, td, th').length) return;
        const loose = inlineText(el).replace(/\s+/g, ' ').trim();
        if (loose) blocks.push({ tag: 'p', text: loose });
        return;
      }
      // A paragraph in a list item, a quote or a cell is read with it, or not at all.
      if (tag === 'p' && $(el).closest('li, blockquote, td, th').length) return;
      if (tag === 'li' && $(el).closest('td, th').length) return;
      const text = ownText(el).replace(/\s+/g, ' ').trim();
      if (text) blocks.push({ tag, text });
    });
  return blocks;
}

/** English abbreviations whose dot ends no sentence, and those before a number only ("No. 5"). */
const ABBREVIATIONS = [
  ...['e.g', 'i.e', 'etc', 'vs', 'approx', 'cf', 'et al', 'Dr', 'Mr', 'Mrs', 'Ms', 'Prof'],
  ...['Jr', 'Sr', 'St', 'Inc', 'Ltd', 'Co', 'Corp', 'U.S', 'U.K'],
];
const BEFORE_NUMBER = ['No', 'p', 'pp', 'Fig', 'Vol', 'Ch'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A list as one alternation, each with its upper-case opening and a space allowed after an inner dot. */
function alternation(list) {
  return list
    .flatMap((a) => {
      const upper = a[0].toLocaleUpperCase('en') + a.slice(1);
      return upper !== a && a.replace(/\P{L}/gu, '').length > 1 ? [a, upper] : [a];
    })
    .map((a) => escapeRe(a).replace(/\\\./g, '\\.\\s?').replace(/ /g, '\\s'))
    .join('|');
}

const PROTECTED_DOTS = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:(?:${alternation(ABBREVIATIONS)})\\.(?=\\s)|(?:${alternation(BEFORE_NUMBER)})\\.(?=\\s*\\p{N}))`,
  'gu',
);

/** What may close a sentence after its mark: a quote or a bracket. */
const CLOSE = `["'”’»)\\]」』]`;
/**
 * A sentence ends after . ! ? or … and a space, unless the next word starts
 * in lower case; a closing quote or bracket may come between.
 */
const SENTENCE_END = new RegExp(
  `(?<=[.!?…]${CLOSE}?)\\s+(?![\\s(\\["'“‘«¿¡]*\\p{Ll})|(?<=[。！？।؟]${CLOSE}?)(?!${CLOSE})\\s*`,
  'u',
);

/** A block's sentences, an abbreviation's dot aside. */
export function sentencesOf(text) {
  return text
    .replace(PROTECTED_DOTS, (m) => m.replace(/\./g, '․'))
    .split(SENTENCE_END)
    .map((s) => s.replace(/․/g, '.').trim())
    .filter((s) => countWords(s) > 0);
}

/** An English word's syllables: vowel groups, a silent final e left out. Never under one. */
export function syllablesOf(word) {
  let w = word.toLocaleLowerCase('en').replace(/[^\p{L}]/gu, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  // A silent final e ("make", "makes"); "-ted"/"-ded" keep their syllable ("wanted").
  w = w.replace(/(?:[^laeiouy]es|[^laeiouytd]ed|[^laeiouy]e)$/, (m) => m[0]);
  return Math.max(1, w.match(/[aeiouy]+/g)?.length ?? 0);
}

/**
 * Flesch Reading Ease of the prose blocks' sentences, or null under 30 words.
 * @param {{ tag: string, text: string }[]} blocks
 * @returns {number|null}
 */
export function fleschReadingEase(blocks) {
  const sentences = blocks
    .filter((b) => b.tag !== 'h1' && b.tag !== 'h2' && b.tag !== 'h3')
    .flatMap((b) => sentencesOf(b.text));
  const words = sentences.reduce((sum, s) => sum + countWords(s), 0);
  if (words < MIN_WORDS || sentences.length === 0) return null;
  const syllables = sentences
    .flatMap((s) => s.match(WORD) ?? [])
    .reduce((sum, w) => sum + syllablesOf(w), 0);
  return 206.835 - 1.015 * (words / sentences.length) - 84.6 * (syllables / words);
}

/**
 * A score's place in the band, as it shows (rounded): pass (1), warn (0.5)
 * or fail (0).
 * @param {number} flesch
 */
export function fleschBand(flesch) {
  const shown = Math.round(flesch);
  const [passFrom, passTo] = FLESCH_BAND.pass;
  const [warnFrom, warnTo] = FLESCH_BAND.warn;
  if (shown >= passFrom && shown <= passTo) return { status: 'pass', score: 1 };
  if (shown >= warnFrom && shown <= warnTo) return { status: 'warn', score: 0.5 };
  return { status: 'fail', score: 0 };
}
