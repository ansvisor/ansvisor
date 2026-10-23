import { countWords, readPage, type PageBlock } from './rules';

/**
 * Readability, one of the Quality scores (Content Editor Quality spec §2.3,
 * CE-036): seven checks read from the draft as written, in the browser, with
 * no AI cost. Each gives points up to its weight; a check the draft's
 * language can't be read for is left out and the score rescaled to 100, so
 * no points are made up. An Ansvisor estimate, not a Google score.
 */

export const READABILITY_CHECKS = [
  'avgSentence',
  'longSentences',
  'readingLevel',
  'answerFirst',
  'shortParagraphs',
  'headingSpacing',
  'passiveJargon',
] as const;
export type ReadabilityCheckId = (typeof READABILITY_CHECKS)[number];

/** Each check's weight (spec §2.3): 100 in all. */
export const READABILITY_WEIGHTS: Record<ReadabilityCheckId, number> = {
  avgSentence: 25,
  longSentences: 15,
  readingLevel: 20,
  answerFirst: 15,
  shortParagraphs: 10,
  headingSpacing: 10,
  passiveJargon: 5,
};

/** A sentence longer than this is long (spec: "No sentence over 35 words"). */
export const LONG_SENTENCE_WORDS = 35;
/** The average a sentence aims for. */
export const SENTENCE_WORDS = { min: 15, max: 20 } as const;
/** A paragraph longer than this many sentences is long. */
export const PARAGRAPH_SENTENCES = 4;
/** The most words under one heading before the next one is due. */
export const SECTION_WORDS = 300;
/** A page shorter than this gets no Readability score yet: too little to read. */
export const MIN_WORDS = 50;

export type ReadingFormula = 'flesch' | 'atesman' | 'amstad' | 'kandelMoles' | 'fernandezHuerta';

/** What one check found: its points out of its weight, and what it counted. */
export interface ReadabilityCheck {
  id: ReadabilityCheckId;
  points: number;
  max: number;
  /** What it counted: words, sentences, a formula's score… */
  value: number;
  /** How many of what it looks for fall short (long sentences, long sections…). */
  count: number;
  /** The reading-level formula used, for readingLevel, and the score that reads as easy. */
  formula?: ReadingFormula | null;
  target?: number;
  /** The first block that falls short, to show it in the draft. */
  at?: string | null;
}

export interface Readability {
  /** 0–100 over the checks that could be read; null for a page too short to score. */
  score: number | null;
  checks: ReadabilityCheck[];
  words: number;
}

/** The text blocks a reader reads as prose: paragraphs and list items. */
const isProse = (b: PageBlock) => b.tag === 'p' || b.tag === 'li' || b.tag === 'blockquote';
const isHeading = (b: PageBlock) => b.tag === 'h1' || b.tag === 'h2' || b.tag === 'h3';

/** A block's sentences: split after . ! ? or …, as the Rules tab's sentence rule does. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => countWords(s) > 0);
}

const VOWELS: Record<string, RegExp> = {
  en: /[aeiouy]+/g,
  tr: /[aeıioöuü]/g,
  de: /[aeiouäöüy]+/g,
  fr: /[aeiouyàâäéèêëîïôöùûüœæ]+/g,
  es: /[aeiouáéíóúü]+/g,
};

/**
 * A word's syllables, as each formula counts them: vowel groups (each
 * vowel in Turkish), an English silent final e left out. Never under one.
 */
export function syllablesOf(word: string, language: string): number {
  let w = word.toLocaleLowerCase(language).replace(/[^\p{L}]/gu, '');
  if (!w) return 0;
  if (language === 'en') {
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, (m) => m[0]);
  }
  if (language === 'fr') w = w.replace(/(?:es|e|ent)$/, (m) => (w.length > 3 ? '' : m));
  const groups = w.match(VOWELS[language] ?? VOWELS.en)?.length ?? 0;
  return Math.max(1, groups);
}

/** The formula each language's reading level is read with, and the score that reads as easy. */
const FORMULAS: Record<string, { formula: ReadingFormula; target: number }> = {
  en: { formula: 'flesch', target: 60 },
  // Ateşman's "medium" band starts at 50; Turkish words run longer.
  tr: { formula: 'atesman', target: 50 },
  de: { formula: 'amstad', target: 60 },
  fr: { formula: 'kandelMoles', target: 60 },
  es: { formula: 'fernandezHuerta', target: 60 },
};

/** The language as a two-letter code ("en-US" and "English (US)" read as en); null when unknown. */
export function languageCode(language: string | null | undefined): string | null {
  const value = (language ?? '').trim().toLowerCase();
  if (!value) return 'en';
  const byName: Record<string, string> = {
    english: 'en',
    turkish: 'tr',
    türkçe: 'tr',
    german: 'de',
    deutsch: 'de',
    french: 'fr',
    français: 'fr',
    spanish: 'es',
    español: 'es',
  };
  const word = value.split(/[\s(_-]/)[0];
  if (byName[word]) return byName[word];
  return /^[a-z]{2}$/.test(word) ? word : null;
}

/** A formula's score from the average sentence length and syllables per word. */
function formulaScore(formula: ReadingFormula, asl: number, asw: number): number {
  switch (formula) {
    case 'flesch':
      return 206.835 - 1.015 * asl - 84.6 * asw;
    case 'atesman':
      return 198.825 - 40.175 * asw - 2.61 * asl;
    case 'amstad':
      return 180 - asl - 58.5 * asw;
    case 'kandelMoles':
      return 207 - 1.015 * asl - 73.6 * asw;
    case 'fernandezHuerta':
      // Syllables and sentences per 100 words.
      return 206.84 - 0.6 * (asw * 100) - 1.02 * (100 / asl);
  }
}

/** Points on a line: full at `full`, none `span` away, in between in proportion. */
const toward = (value: number, full: number, span: number, max: number) =>
  Math.max(0, Math.min(1, 1 - (full - value) / span)) * max;

const PASSIVE =
  /\b(?:am|is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?(?:\w+ed|been|born|built|chosen|done|drawn|driven|given|grown|known|made|seen|shown|taken|thought|told|written)\b/i;
/** Words that say little in English business writing. */
const JARGON = [
  'leverage',
  'synergy',
  'synergies',
  'utilize',
  'utilise',
  'paradigm',
  'best-in-class',
  'cutting-edge',
  'world-class',
  'next-generation',
  'game-changing',
  'seamless',
  'seamlessly',
  'holistic',
  'robust',
  'streamline',
  'empower',
  'disruptive',
];

/**
 * The draft's Readability: its checks and the score over the ones that could
 * be read. `characters` is the editor's count (readPage); `language` the
 * brand's (brands.language), English when unset.
 */
export function readability(
  html: string,
  characters: number,
  language: string | null | undefined,
): Readability {
  const page = readPage(html, characters);
  const lang = languageCode(language);
  const prose = page.blocks.filter(isProse);
  const sentences = prose.flatMap((b) => sentencesOf(b.text).map((s) => ({ s, block: b })));
  const sentenceWords = sentences.map(({ s }) => countWords(s));
  const words = sentenceWords.reduce((a, b) => a + b, 0);
  if (words < MIN_WORDS || sentences.length === 0) return { score: null, checks: [], words };

  const checks: ReadabilityCheck[] = [];
  const check = (c: Omit<ReadabilityCheck, 'max'>) =>
    checks.push({ ...c, max: READABILITY_WEIGHTS[c.id] });

  // Average sentence, 15–20 words: full inside, none 10 words outside.
  const asl = words / sentences.length;
  const off =
    asl < SENTENCE_WORDS.min ? SENTENCE_WORDS.min - asl : Math.max(0, asl - SENTENCE_WORDS.max);
  check({
    id: 'avgSentence',
    points: toward(-off, 0, 10, READABILITY_WEIGHTS.avgSentence),
    value: Math.round(asl * 10) / 10,
    count: 0,
  });

  // No sentence over 35 words: 3 points off for each.
  const long = sentences.filter((_, i) => sentenceWords[i] > LONG_SENTENCE_WORDS);
  check({
    id: 'longSentences',
    points: Math.max(0, READABILITY_WEIGHTS.longSentences - 3 * long.length),
    value: Math.max(...sentenceWords),
    count: long.length,
    at: long[0]?.s ?? null,
  });

  // Reading level, by the language's formula; else sentence and word length only.
  const known = lang ? FORMULAS[lang] : undefined;
  if (known && lang) {
    const syllables = sentences
      .flatMap(({ s }) => s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [])
      .reduce((sum, w) => sum + syllablesOf(w, lang), 0);
    const score = formulaScore(known.formula, asl, syllables / words);
    check({
      id: 'readingLevel',
      points: toward(score, known.target, 30, READABILITY_WEIGHTS.readingLevel),
      value: Math.round(score),
      count: 0,
      formula: known.formula,
      target: known.target,
    });
  } else {
    const letters = sentences
      .flatMap(({ s }) => s.match(/\p{L}+/gu) ?? [])
      .reduce((sum, w) => sum + w.length, 0);
    const awl = letters / words;
    const short = (asl <= SENTENCE_WORDS.max ? 0.5 : 0) + (awl <= 6.5 ? 0.5 : 0);
    check({
      id: 'readingLevel',
      points: short * READABILITY_WEIGHTS.readingLevel,
      value: Math.round(awl * 10) / 10,
      count: 0,
      formula: null,
    });
  }

  // Answer first: the first block under the H1 is a short paragraph that
  // names what the H1 asks (a heuristic; Phase 2 reads it with a model).
  const h1 = page.blocks.findIndex((b) => b.tag === 'h1');
  const first = page.blocks[h1 + 1];
  const h1Words = new Set(
    page.blocks[h1]?.text.toLocaleLowerCase(lang ?? 'en').match(/\p{L}{4,}/gu) ?? [],
  );
  const answers =
    !!first &&
    first.tag === 'p' &&
    first.words > 0 &&
    first.words <= 60 &&
    (h1Words.size === 0 ||
      (first.text.toLocaleLowerCase(lang ?? 'en').match(/\p{L}{4,}/gu) ?? []).some((w) =>
        h1Words.has(w),
      ));
  check({
    id: 'answerFirst',
    points: answers ? READABILITY_WEIGHTS.answerFirst : 0,
    value: first?.words ?? 0,
    count: answers ? 0 : 1,
    at: answers ? null : (first?.text ?? page.blocks[h1]?.text ?? null),
  });

  // Short paragraphs: the share with at most 4 sentences.
  const paragraphs = page.blocks.filter((b) => b.tag === 'p' && b.words > 0);
  if (paragraphs.length > 0) {
    const longParagraphs = paragraphs.filter(
      (b) => sentencesOf(b.text).length > PARAGRAPH_SENTENCES,
    );
    check({
      id: 'shortParagraphs',
      points:
        READABILITY_WEIGHTS.shortParagraphs *
        ((paragraphs.length - longParagraphs.length) / paragraphs.length),
      value: paragraphs.length,
      count: longParagraphs.length,
      at: longParagraphs[0]?.text ?? null,
    });
  }

  // A heading every 200–300 words: the share of sections within 300.
  const sections: { words: number; first: string | null }[] = [{ words: 0, first: null }];
  for (const b of page.blocks) {
    if (isHeading(b) && b.tag !== 'h1') sections.push({ words: 0, first: null });
    else if (isProse(b)) {
      const last = sections[sections.length - 1];
      last.words += b.words;
      last.first ??= b.text;
    }
  }
  const filled = sections.filter((s) => s.words > 0);
  const longSections = filled.filter((s) => s.words > SECTION_WORDS);
  check({
    id: 'headingSpacing',
    points:
      READABILITY_WEIGHTS.headingSpacing *
      (filled.length ? (filled.length - longSections.length) / filled.length : 1),
    value: filled.length,
    count: longSections.length,
    at: longSections[0]?.first ?? null,
  });

  // Passive voice and jargon: English only; left out for other languages.
  if (lang === 'en') {
    const passive = sentences.filter(({ s }) => PASSIVE.test(s));
    const text = sentences.map(({ s }) => s.toLowerCase()).join(' ');
    const jargon = JARGON.reduce(
      (n, w) => n + (text.match(new RegExp(`\\b${w}\\b`, 'g'))?.length ?? 0),
      0,
    );
    const passiveOk = passive.length <= sentences.length * 0.1;
    const jargonOk = jargon <= 2;
    check({
      id: 'passiveJargon',
      points: (READABILITY_WEIGHTS.passiveJargon * ((passiveOk ? 1 : 0) + (jargonOk ? 1 : 0))) / 2,
      value: jargon,
      count: passive.length,
      at: passive[0]?.s ?? null,
    });
  }

  const max = checks.reduce((sum, c) => sum + c.max, 0);
  const points = checks.reduce((sum, c) => sum + c.points, 0);
  return { score: Math.round((points / max) * 100), checks, words };
}

/** How much a check would add to the score if it were met, rescaled as the score is. */
export function readabilityGain(result: Readability, id: ReadabilityCheckId): number {
  const c = result.checks.find((x) => x.id === id);
  if (!c) return 0;
  const max = result.checks.reduce((sum, x) => sum + x.max, 0);
  return Math.round(((c.max - c.points) / max) * 100);
}
