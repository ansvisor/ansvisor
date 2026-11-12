import { describe, expect, it } from 'vitest';
import { BY_LANGUAGE, REPORT_LANGUAGES, cardCopy, en } from './copy';
import { tr } from './copy-tr';
import { SAMPLE_REPORT_CARD } from './sample';

/** The card's words: the language the form chose, else its country's; every copy complete. */

const turkish = { country: { code: 'TR' } };

describe('cardCopy', () => {
  it('keeps the country’s rule when no language was chosen: Turkish for Türkiye, else English', () => {
    expect(cardCopy(turkish)).toBe(tr);
    expect(cardCopy(turkish, null)).toBe(tr);
    expect(cardCopy(SAMPLE_REPORT_CARD)).toBe(en);
    expect(cardCopy({ country: { code: 'FR' } })).toBe(en);
    expect(cardCopy()).toBe(en);
  });

  it('writes in the language the request chose, whatever the country', () => {
    for (const language of REPORT_LANGUAGES) {
      expect(cardCopy(SAMPLE_REPORT_CARD, language)).toBe(BY_LANGUAGE[language]);
      expect(cardCopy(turkish, language)).toBe(BY_LANGUAGE[language]);
    }
    expect(cardCopy(turkish, 'en')).toBe(en);
    expect(cardCopy(SAMPLE_REPORT_CARD, 'tr')).toBe(tr);
  });
});

describe('every language’s copy', () => {
  it('has one copy for each language, each with its own locale', () => {
    expect(Object.keys(BY_LANGUAGE).sort()).toEqual([...REPORT_LANGUAGES].sort());
    const locales = REPORT_LANGUAGES.map((language) => BY_LANGUAGE[language].locale);
    expect(new Set(locales).size).toBe(REPORT_LANGUAGES.length);
    for (const language of REPORT_LANGUAGES) {
      expect(BY_LANGUAGE[language].locale.startsWith(language)).toBe(true);
    }
  });

  it.each(REPORT_LANGUAGES)('%s: prints five search ranges, Low and both buttons', (language) => {
    const t = BY_LANGUAGE[language];
    expect(t.questions.ranges).toHaveLength(5);
    for (const label of [
      ...t.questions.ranges,
      t.questions.low,
      t.questions.colSearches,
      t.status.trial,
      t.value.button,
    ]) {
      expect(label.trim()).not.toBe('');
    }
    expect(new Set(t.questions.ranges).size).toBe(5);
  });

  it.each(REPORT_LANGUAGES.filter((l) => l !== 'en'))(
    '%s: names the country and the questions’ language in its own words',
    (language) => {
      const t = BY_LANGUAGE[language];
      const us = { code: 'US', name: 'United States' };
      expect(t.countryName(us)).not.toBe('United States');
      expect(t.country(us)).not.toBe('United States');
      expect(t.language('English')).not.toBe('English');
      // A language the runtime doesn't know stays as the card names it.
      expect(t.language('Klingonese')).toBe('Klingonese');
    },
  );

  it.each(REPORT_LANGUAGES)('%s: keeps Ansvisor’s feature names in English', (language) => {
    const t = BY_LANGUAGE[language];
    expect(t.plan.feature).toEqual(en.plan.feature);
    expect(t.value.work.map((item) => item.title)).toEqual(['Chat', 'Agents', 'MCP']);
    expect(t.value.growthAgents).toMatch(/^Full auto/);
    expect(t.value.siteAudits(100)).toMatch(/^Site Audit/);
  });

  it('writes shares the language’s way', () => {
    const shares = Object.fromEntries(
      REPORT_LANGUAGES.map((language) => [language, BY_LANGUAGE[language].value.share(5)]),
    );
    expect(shares.en).toBe('5% of those searches');
    expect(shares.tr).toBe('bu aramaların %5 kadarı');
    expect(shares.fr).toBe('5\u00a0% de ces recherches');
    expect(shares.de).toBe('5\u00a0% dieser Suchen');
    expect(shares.es).toBe('el 5\u00a0% de esas búsquedas');
    expect(shares.pt).toBe('5% dessas buscas');
    expect(shares.it).toBe('il 5% di quelle ricerche');
    expect(shares.nl).toBe('5% van die zoekopdrachten');
  });

  it('agrees a count with its word: one answer, two answers', () => {
    const counts = Object.fromEntries(
      REPORT_LANGUAGES.map((language) => {
        const t = BY_LANGUAGE[language];
        return [language, [t.status.answersCount(1), t.status.answersCount(2)]];
      }),
    );
    expect(counts).toEqual({
      en: ['1 answer', '2 answers'],
      tr: ['1 yanıt', '2 yanıt'],
      fr: ['1 réponse', '2 réponses'],
      es: ['1 respuesta', '2 respuestas'],
      de: ['1 Antwort', '2 Antworten'],
      pt: ['1 resposta', '2 respostas'],
      it: ['1 risposta', '2 risposte'],
      nl: ['1 antwoord', '2 antwoorden'],
    });
  });
});

describe('Spanish lists', () => {
  it('joins with "e" before an "i" sound, else "y"', () => {
    const t = BY_LANGUAGE.es;
    expect(t.list(['ChatGPT', 'Google Gemini'])).toBe('ChatGPT y Google Gemini');
    expect(t.list(['Acme', 'Iberia'])).toBe('Acme e Iberia');
    expect(t.list(['Acme', 'Hierro Sur'])).toBe('Acme y Hierro Sur');
  });
});
