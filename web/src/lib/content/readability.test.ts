import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '@/config/prompt-options';
import { languageRuleValue } from './rules';
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
  readability(html, language).checks.find((c) => c.id === id);

// Shared with server/src/lib/audit/signals/readability.test.js: Flesch 82 in both.
const FIXTURE = `<h1>How to brew pour-over coffee at home</h1>
<p>Pour-over coffee is simple to make, and it tastes clean and bright. You need a dripper, a paper filter, a kettle and fresh beans. Most people wanted a cup that tasted like the café, so we created this guide.</p>
<h2>What you need</h2>
<ul>
<li>A dripper, e.g. a ceramic cone or a flat-bottom brewer.</li>
<li>Twenty grams of medium-fine coffee for one large mug.</li>
<li>Water just off the boil, around ninety-four degrees.</li>
</ul>
<h2>Step by step</h2>
<p>Rinse the filter with hot water first. This removes the papery taste and warms the dripper. Then add the coffee and shake it level.</p>
<p>Start with a short pour, just enough to wet the grounds. Wait thirty seconds while the coffee blooms. Fresh coffee releases gas, and the bloom lets it escape before the main pour.</p>
<p>Pour slowly in small circles, keeping the water level steady. The whole brew should take about three minutes. If it runs faster, grind finer; if it stalls, grind coarser.</p>
<blockquote><p>"Taste is the only rule that matters," says our head roaster. "Adjust one thing at a time."</p></blockquote>
<h2>Common mistakes</h2>
<p>Many beginners pour too fast, which makes a weak and sour cup. Others use water that is far too hot, which makes the coffee bitter. A beautiful, quiet morning ritual needs a little patience. Measure your coffee, watch the clock and keep notes on each cup.</p>`;

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
  it('reads a plain page over its seven checks', () => {
    const result = readability(EASY, 'en');
    expect(result.checks.map((c) => c.id)).toEqual([
      'avgSentence',
      'longSentences',
      'readingLevel',
      'answerFirst',
      'shortParagraphs',
      'headingSpacing',
      'passiveJargon',
    ]);
    // Flesch 101: simpler than the band Site Audit passes (50–70), so no reading-level points.
    expect(result.checks.find((c) => c.id === 'readingLevel')).toMatchObject({
      formula: 'flesch',
      value: 101,
      count: 1,
      points: 0,
    });
    expect(result.checks.find((c) => c.id === 'longSentences')).toMatchObject({ count: 0 });
    expect(result.checks.find((c) => c.id === 'answerFirst')!.points).toBe(15);
    expect(result.score).toBe(67);
  });

  it('scores the page Site Audit’s test reads, as Site Audit does', () => {
    // Shared with server/src/lib/audit/signals/readability.test.js: Flesch 82 in both.
    expect(check(FIXTURE, 'readingLevel')).toMatchObject({
      formula: 'flesch',
      value: 82,
      count: 1,
      points: 0,
      band: { min: 50, max: 70 },
    });
  });

  it('reads English by Site Audit’s band: full 50–70, half 30–50 and 70–80, none past', () => {
    const level = (n: number, times: number) =>
      check(p(Array.from({ length: times }, () => sentence(n)).join(' ')), 'readingLevel')!;
    const full = READABILITY_WEIGHTS.readingLevel;
    // One-syllable words: the sentence's length sets the score.
    expect(level(55, 1)).toMatchObject({ value: 66, points: full, count: 0 });
    expect(level(45, 2)).toMatchObject({ value: 77, points: full / 2, count: 1 });
    expect(level(20, 3)).toMatchObject({ value: 102, points: 0, count: 1 });
    expect(level(75, 1)).toMatchObject({ value: 46, points: full / 2, count: -1 });
    expect(level(110, 1)).toMatchObject({ value: 11, points: 0, count: -1 });
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
    expect(readability(html, 'en')).toMatchObject({
      score: null,
      unscored: 'tooShort',
      checks: [],
    });
    expect(MIN_WORDS).toBe(50);
  });

  it('gives no score in a language written without spaces between words', () => {
    // Each Japanese clause reads as one word: six paragraphs once scored 66.
    const ja =
      '<h1>小さなチームの売上予測</h1>' +
      Array.from({ length: 6 }, () =>
        p(
          '小さなチームは、今月、成約できる商談を見て、売上を予測します。毎週、同じ曜日に、リストを確認します。止まった商談は、すぐに、外します。',
        ),
      ).join('');
    // Read as a spaced language, it would get a made-up score.
    expect(readability(ja, 'en').score).not.toBeNull();
    for (const language of ['ja', 'Japanese', 'zh-CN', 'Chinese', 'Thai']) {
      expect(readability(ja, language)).toMatchObject({
        score: null,
        unscored: 'language',
        checks: [],
      });
    }
  });

  it('scores Hindi by its own sentences and words', () => {
    // Ten words, each with its vowel signs, ending in a danda.
    const line = 'छोटी टीमें हर हफ्ते अपनी बिक्री की सूची देखती हैं।';
    const html = `<h1>बिक्री का अनुमान</h1>${p(Array.from({ length: 6 }, () => line).join(' '))}`;
    const result = readability(html, 'Hindi');
    expect(result.words).toBe(60);
    expect(result.score).not.toBeNull();
    expect(result.checks.find((c) => c.id === 'avgSentence')!.value).toBe(10);
    expect(result.checks.find((c) => c.id === 'longSentences')!.count).toBe(0);
    expect(result.checks.find((c) => c.id === 'readingLevel')!.formula).toBeNull();
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
    const result = readability(tr, 'tr');
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
    const result = readability(html, 'en');
    expect(readabilityGain(result, 'longSentences')).toBe(6);
    expect(readabilityGain(result, 'passiveJargon')).toBe(0);
  });
});

describe('reading the page as written', () => {
  it('reads a quote’s and a list item’s paragraphs apart, and a nested list once', () => {
    const quote = `<h1>Pipeline</h1><blockquote><p>${sentence(20)}</p><p>${sentence(20)}</p></blockquote>${p(Array.from({ length: 3 }, () => sentence(15)).join(' '))}`;
    expect(check(quote, 'longSentences')!.count).toBe(0);
    const nested =
      '<h1>Pipeline</h1><ul><li><p>Plan deals weekly.</p><ul><li><p>Check each one.</p></li></ul></li></ul>' +
      p(Array.from({ length: 4 }, () => sentence(15)).join(' '));
    expect(readability(nested, 'en').words).toBe(3 + 3 + 60);
  });

  it('measures sentence length on running text, not a list’s points', () => {
    const html =
      '<h1>How small teams forecast</h1>' +
      p(`Small teams forecast pipeline every week. ${sentence(17)} ${sentence(17)}`) +
      `<ul>${Array.from({ length: 12 }, () => '<li><p>Check deals weekly</p></li>').join('')}</ul>`;
    const avg = check(html, 'avgSentence')!;
    expect(avg.value).toBeGreaterThan(12);
    expect(avg.count).toBeLessThanOrEqual(0);
  });

  it('reads Spanish, German and French higher for shorter sentences', () => {
    const page = (n: number, word: string) =>
      `<h1>${word}</h1>${p(Array.from({ length: Math.ceil(120 / n) }, () => `${Array.from({ length: n }, () => word).join(' ')}.`).join(' '))}`;
    // Each sentence opens in upper case: after a dot, a lower-case word carries the sentence on.
    for (const [lang, word] of [
      ['es', 'Casa'],
      ['de', 'Haus'],
      ['fr', 'Maison'],
    ]) {
      const short = check(page(10, word), 'readingLevel', lang)!.value;
      const long = check(page(30, word), 'readingLevel', lang)!.value;
      expect(short).toBeGreaterThan(long);
    }
  });

  it('wants a short first paragraph under an H1 that names its subject', () => {
    const body = p(Array.from({ length: 4 }, () => sentence(15)).join(' '));
    // An empty line after the H1 is no block.
    const empty = `<h1>Pipeline forecasting for small teams</h1><p></p>${p('Pipeline forecasting is how a small team guesses what will close.')}${body}`;
    expect(check(empty, 'answerFirst')!.points).toBe(15);
    // Too long, or about something else.
    const long = `<h1>Pipeline forecasting</h1>${p(`Pipeline ${sentence(70)}`)}${body}`;
    expect(check(long, 'answerFirst')!.points).toBe(0);
    const other = `<h1>Pipeline forecasting</h1>${p('Teams like a calm Monday.')}${body}`;
    expect(check(other, 'answerFirst')!.points).toBe(0);
    // No H1: nothing to answer.
    expect(check(body, 'answerFirst')!.points).toBe(0);
    // A short H1 is read by all its words.
    const short = `<h1>What is AI?</h1>${p('AI is software that answers questions.')}${body}`;
    expect(check(short, 'answerFirst')!.points).toBe(15);
    // A byline or a date under the H1 is read past: the answer is the paragraph after it.
    const bylined = `<h1>Pipeline forecasting</h1>${p('By Jane Doe · October 2026')}${p('Pipeline forecasting is how a team guesses what will close.')}${body}`;
    expect(check(bylined, 'answerFirst')!.points).toBe(15);
    // A dated byline's numbers aren't words, as the API counts them.
    const dated = `<h1>Pipeline forecasting</h1>${p('By Jane Doe · Updated Oct 25, 2026 · 6 min read')}${p('Pipeline forecasting is how a team guesses what will close.')}${body}`;
    expect(check(dated, 'answerFirst')!.points).toBe(15);
  });

  it('takes the model’s verdict on the first paragraph in phase 2, while it is still first (CE-050)', () => {
    const body = p(Array.from({ length: 4 }, () => sentence(15)).join(' '));
    const first = 'Pipeline forecasting is how a small team guesses what will close.';
    const html = `<h1>Pipeline forecasting for small teams</h1>${p(first)}${body}`;
    const read = (aiAnswer: { answers: boolean; block: string; held?: boolean } | null) =>
      readability(html, 'en', aiAnswer).checks.find((c) => c.id === 'answerFirst')!;
    // The rule passes it; the model says it doesn't answer.
    expect(read(null)).toMatchObject({ points: 15 });
    expect(read(null).ai).toBeUndefined();
    expect(read({ answers: false, block: first })).toMatchObject({
      points: 0,
      ai: true,
      at: first,
    });
    // A verdict on another paragraph (the page changed since): the rule reads it.
    expect(read({ answers: false, block: 'Teams like a calm Monday.' })).toMatchObject({
      points: 15,
    });
    // Held while the edited page is read again: the verdict stays (review, #1479).
    expect(
      read({ answers: false, block: 'Pipeline forecasting is how teams guess.', held: true }),
    ).toMatchObject({ points: 0, ai: true });
    // It answers, but it's still a short paragraph to pass.
    const long = `Pipeline ${sentence(70)}`;
    expect(
      readability(`<h1>Pipeline forecasting</h1>${p(long)}${body}`, 'en', {
        answers: true,
        block: long,
      }).checks.find((c) => c.id === 'answerFirst'),
    ).toMatchObject({ points: 0, ai: true });
  });

  it('keeps an abbreviation inside its sentence, and reads passive voice and jargon closely', () => {
    expect(sentencesOf('Use a ratio, e.g. 1:16. Then brew.')).toEqual([
      'Use a ratio, e.g. 1:16.',
      'Then brew.',
    ]);
    const html =
      '<h1>Pipeline</h1>' +
      p(Array.from({ length: 4 }, () => sentence(15)).join(' ')) +
      p(
        'It is indeed simple. We are leveraging tools and utilized synergies with empowering, streamlined plans.',
      );
    const style = check(html, 'passiveJargon')!;
    expect(style.count).toBe(0);
    expect(style.value).toBe(5);
    // Only the jargon falls short: Show goes there.
    expect(style.at).toContain('leveraging');
  });

  it('reads irregular participles as passive', () => {
    const participles = [
      ...['sent', 'found', 'held', 'kept', 'paid', 'put', 'set', 'left', 'lost', 'sold', 'said'],
      ...['heard', 'brought', 'bought', 'caught', 'taught', 'spent', 'meant', 'led', 'won'],
      ...['broken', 'spoken', 'hidden'],
    ];
    const html =
      '<h1>Pipeline</h1>' +
      p(Array.from({ length: 4 }, () => sentence(15)).join(' ')) +
      p(participles.map((w) => `The deal was ${w} today.`).join(' '));
    const style = check(html, 'passiveJargon')!;
    expect(style.count).toBe(participles.length);
    expect(style.at).toBe('The deal was sent today.');
  });

  it('reads a passive sentence that says not or never', () => {
    const html =
      '<h1>Pipeline</h1>' +
      p(Array.from({ length: 5 }, () => sentence(15)).join(' ')) +
      p("Stages are not defined. Deals weren't closed. Notes were never checked.");
    const style = check(html, 'passiveJargon')!;
    expect(style.count).toBe(3);
    expect(style.at).toBe('Stages are not defined.');
  });
});

describe('the parts', () => {
  it('splits sentences after . ! ? and …', () => {
    expect(sentencesOf('One. Two! Three? Four… Five')).toEqual([
      'One.',
      'Two!',
      'Three?',
      'Four…',
      'Five',
    ]);
  });

  it('splits after 。！？ with no space, and after । and ؟', () => {
    expect(sentencesOf('一つです。二つです！三つですか？', 'ja')).toEqual([
      '一つです。',
      '二つです！',
      '三つですか？',
    ]);
    expect(sentencesOf('यह पहला वाक्य है। यह दूसरा है।', 'hi')).toEqual([
      'यह पहला वाक्य है।',
      'यह दूसरा है।',
    ]);
    expect(sentencesOf('ما هذا؟ هذا كتاب.', 'ar')).toEqual(['ما هذا؟', 'هذا كتاب.']);
  });

  it('keeps a sentence whole when the next word starts in lower case', () => {
    expect(sentencesOf('Prices rose 3 pct. in May. Then they fell… and rose.')).toEqual([
      'Prices rose 3 pct. in May.',
      'Then they fell… and rose.',
    ]);
  });

  it('reads a number and a dot before a word as an ordinal in German and Turkish', () => {
    expect(sentencesOf('Wir starten am 3. Oktober mit der Liste. Dann prüfen wir.', 'de')).toEqual([
      'Wir starten am 3. Oktober mit der Liste.',
      'Dann prüfen wir.',
    ]);
    expect(sentencesOf('Toplantı 2. Kat salonunda. Herkes gelir.', 'tr')).toEqual([
      'Toplantı 2. Kat salonunda.',
      'Herkes gelir.',
    ]);
    // Not in English, where it ends a sentence.
    expect(sentencesOf('Read chapter 3. Then stop.', 'en')).toEqual([
      'Read chapter 3.',
      'Then stop.',
    ]);
  });

  it('keeps each language’s common abbreviations inside their sentence', () => {
    expect(sentencesOf('Nutzen Sie z. B. Listen. Vgl. Kapitel Zwei. Dann weiter.', 'de')).toEqual([
      'Nutzen Sie z. B. Listen.',
      'Vgl. Kapitel Zwei.',
      'Dann weiter.',
    ]);
    expect(sentencesOf('Örn. Ankara gibi bir şehir seçin. Dr. Ayşe onaylar.', 'tr')).toEqual([
      'Örn. Ankara gibi bir şehir seçin.',
      'Dr. Ayşe onaylar.',
    ]);
    expect(sentencesOf('Une ville, p. ex. Paris. Appelez M. Dupont. Puis partez.', 'fr')).toEqual([
      'Une ville, p. ex. Paris.',
      'Appelez M. Dupont.',
      'Puis partez.',
    ]);
    expect(
      sentencesOf('Una ciudad, p. ej. Madrid. Llame a la Sra. García. Luego vaya.', 'es'),
    ).toEqual(['Una ciudad, p. ej. Madrid.', 'Llame a la Sra. García.', 'Luego vaya.']);
    // One before a number counts only there: "no." still ends a sentence.
    expect(sentencesOf('Say no. Then see No. 5 below.')).toEqual([
      'Say no.',
      'Then see No. 5 below.',
    ]);
  });

  it('ends a sentence after a closing quote or bracket', () => {
    expect(sentencesOf('He said "stop." Then he left. (It was late.) Nobody spoke.')).toEqual([
      'He said "stop."',
      'Then he left.',
      '(It was late.)',
      'Nobody spoke.',
    ]);
  });

  it('counts syllables by vowel groups, each vowel in Turkish', () => {
    expect(syllablesOf('the', 'en')).toBe(1);
    expect(syllablesOf('readable', 'en')).toBe(3);
    expect(syllablesOf('quickly', 'en')).toBe(2);
    expect(syllablesOf('kitaplık', 'tr')).toBe(3);
    expect(syllablesOf('wanted', 'en')).toBe(2);
    expect(syllablesOf('moment', 'fr')).toBe(2);
    expect(syllablesOf('kâr', 'tr')).toBe(1);
    expect(syllablesOf('Haus', 'de')).toBe(1);
  });

  it('reads the brand’s language or the Language rule as a code', () => {
    expect(languageCode(null)).toBe('en');
    expect(languageCode('English (US)')).toBe('en');
    expect(languageCode('tr-TR')).toBe('tr');
    expect(languageCode('Deutsch')).toBe('de');
    expect(languageCode('ja')).toBe('ja');
    expect(languageCode('Brazilian Portuguese')).toBe('pt');
    expect(languageCode('Klingon')).toBeNull();
    // Each brand language, as its Language rule says it.
    for (const { code } of LANGUAGES) expect(languageCode(languageRuleValue(code))).toBe(code);
  });
});
