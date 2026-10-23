import { describe, expect, it } from 'vitest';
import {
  MIN_WORDS,
  READABILITY_WEIGHTS,
  languageCode,
  readability,
  readabilityGain,
  sentencesOf,
  syllablesOf,
} from './readability';

/** Readability (Quality spec §2.3, CE-036): seven checks read from the draft as written. */

const p = (text: string) => `<p>${text}</p>`;
/** A plain sentence of `n` words. */
const sentence = (n: number) =>
  `${Array.from({ length: n }, (_, i) => (i === 0 ? 'Teams' : 'plan')).join(' ')}.`;
const check = (html: string, id: string, language = 'en') =>
  readability(html, html.length, language).checks.find((c) => c.id === id);

const EASY =
  '<h1>How do small teams forecast pipeline?</h1>' +
  p(
    'Small teams forecast pipeline by looking at deals they can close this month. They count each deal once and check it every week.',
  ) +
  '<h2>Start with the deals you trust</h2>' +
  p(
    'Pick the deals with a clear next step. Leave out the ones that went quiet. Write down the date you expect each one to close.',
  ) +
  '<h2>Check the numbers every week</h2>' +
  p(
    'Look at the list on the same day each week. Move a deal out when it slips. Add new deals only when the buyer has agreed to a date.',
  );

describe('readability', () => {
  it('scores a plain page high, over its seven checks', () => {
    const result = readability(EASY, EASY.length, 'en');
    expect(result.checks.map((c) => c.id)).toEqual([
      'avgSentence',
      'longSentences',
      'readingLevel',
      'answerFirst',
      'shortParagraphs',
      'headingSpacing',
      'passiveJargon',
    ]);
    expect(result.checks.find((c) => c.id === 'readingLevel')).toMatchObject({
      formula: 'flesch',
    });
    expect(result.checks.find((c) => c.id === 'longSentences')).toMatchObject({ count: 0 });
    expect(result.checks.find((c) => c.id === 'answerFirst')!.points).toBe(15);
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('counts each sentence over 35 words, and shows the first', () => {
    const html = `<h1>Pipeline</h1>${p(`${sentence(40)} ${sentence(38)} ${sentence(12)}`)}`;
    const long = check(html, 'longSentences')!;
    expect(long.count).toBe(2);
    expect(long.points).toBe(READABILITY_WEIGHTS.longSentences - 6);
    expect(long.at).toBe(sentence(40));
  });

  it('gives no score to a page too short to read', () => {
    const html = p('Pipeline forecasting for small teams, in short.');
    expect(readability(html, html.length, 'en')).toMatchObject({ score: null, checks: [] });
    expect(MIN_WORDS).toBe(50);
  });

  it('reads Turkish with Ateşman’s formula, and leaves out what it can’t read there', () => {
    const tr =
      '<h1>Küçük ekipler satış tahminini nasıl yapar?</h1>' +
      p(
        'Küçük ekipler satış tahminini bu ay kapanabilecek fırsatlara bakarak yapar. Her fırsatı bir kez sayar ve her hafta kontrol eder.',
      ) +
      p(
        'Net bir sonraki adımı olan fırsatları seçin. Sessizleşenleri listeden çıkarın. Her fırsatın kapanmasını beklediğiniz tarihi yazın.',
      ) +
      p('Listeye her hafta aynı gün bakın. Kayan bir fırsatı çıkarın ve yenisini ekleyin.') +
      p(
        'Tahmini ekiple paylaşın ve farkları birlikte konuşun. Böylece herkes aynı rakama bakar ve ay sonunda sürpriz yaşanmaz.',
      );
    const result = readability(tr, tr.length, 'tr');
    expect(result.checks.find((c) => c.id === 'readingLevel')!.formula).toBe('atesman');
    // Passive voice and jargon read English only: left out, the score rescaled.
    expect(result.checks.map((c) => c.id)).not.toContain('passiveJargon');
    const max = result.checks.reduce((sum, c) => sum + c.max, 0);
    expect(max).toBe(95);
    expect(result.score).toBeGreaterThan(0);
  });

  it('falls back to sentence and word length for a language with no formula', () => {
    const html = `<h1>Pipeline</h1>${p(Array.from({ length: 8 }, () => sentence(10)).join(' '))}`;
    const level = check(html, 'readingLevel', 'nl')!;
    expect(level.formula).toBeNull();
    expect(level.points).toBe(READABILITY_WEIGHTS.readingLevel);
  });

  it('asks for a heading at least every 300 words', () => {
    const html = `<h1>Pipeline</h1>${p(Array.from({ length: 32 }, () => sentence(10)).join(' '))}`;
    expect(check(html, 'headingSpacing')).toMatchObject({ count: 1, points: 0 });
  });

  it('wants the first block under the H1 to answer it, briefly', () => {
    const list = `<h1>How do small teams forecast pipeline?</h1><ul><li>${sentence(30)}</li></ul>${p(
      Array.from({ length: 4 }, () => sentence(15)).join(' '),
    )}`;
    expect(check(list, 'answerFirst')).toMatchObject({ points: 0, count: 1 });
  });

  it('counts long paragraphs, passive sentences and jargon', () => {
    const html =
      '<h1>Pipeline</h1>' +
      p(
        `${sentence(12)} ${sentence(12)} ${sentence(12)} ${sentence(12)} ${sentence(12)} The plan was approved by the team.`,
      ) +
      p('We leverage synergy and a robust, seamless, holistic paradigm to empower teams.');
    expect(check(html, 'shortParagraphs')).toMatchObject({ count: 1, points: 5 });
    const style = check(html, 'passiveJargon')!;
    expect(style.count).toBe(1);
    expect(style.value).toBeGreaterThan(2);
    expect(style.points).toBe(0);
  });

  it('says how much a check would add, rescaled as the score is', () => {
    const html = `<h1>Pipeline</h1>${p(`${sentence(40)} ${sentence(38)} ${Array.from({ length: 4 }, () => sentence(14)).join(' ')}`)}`;
    const result = readability(html, html.length, 'en');
    expect(readabilityGain(result, 'longSentences')).toBe(6);
    expect(readabilityGain(result, 'passiveJargon')).toBe(0);
  });
});

describe('the parts', () => {
  it('splits sentences after . ! ? and …', () => {
    expect(sentencesOf('One. Two! Three? Four… five')).toEqual([
      'One.',
      'Two!',
      'Three?',
      'Four…',
      'five',
    ]);
  });

  it('counts syllables by vowel groups, each vowel in Turkish', () => {
    expect(syllablesOf('the', 'en')).toBe(1);
    expect(syllablesOf('readable', 'en')).toBe(3);
    expect(syllablesOf('quickly', 'en')).toBe(2);
    expect(syllablesOf('kitaplık', 'tr')).toBe(3);
    expect(syllablesOf('Haus', 'de')).toBe(1);
  });

  it('reads the brand’s language as a code', () => {
    expect(languageCode(null)).toBe('en');
    expect(languageCode('English (US)')).toBe('en');
    expect(languageCode('tr-TR')).toBe('tr');
    expect(languageCode('Deutsch')).toBe('de');
    expect(languageCode('ja')).toBe('ja');
    expect(languageCode('Klingon')).toBeNull();
  });
});
