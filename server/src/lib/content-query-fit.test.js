import { describe, expect, it } from 'vitest';
import { fitSources, fitsLanguage, onTopic, topicWords } from './content-query-fit.js';
import { namedCompetitors } from './content-page-types.js';

/**
 * The searches a page is written from, kept to it (Content test
 * 2026-11-19, items 3 and 14), and the options a page weighing them covers.
 */

describe('fitsLanguage', () => {
  it('keeps a search in the page’s letters, or in Latin ones (names, products)', () => {
    expect(fitsLanguage('google ai overviews ranking', 'en')).toBe(true);
    expect(fitsLanguage('google ai overviews рейтинг', 'ru')).toBe(true);
    expect(fitsLanguage('chatgpt için seo', 'tr')).toBe(true);
    expect(fitsLanguage('ChatGPT 検索', 'ja')).toBe(true);
  });

  it('drops a search in another language’s letters', () => {
    // The How-to draft of the test wrote this query into an English page.
    expect(fitsLanguage('google ai overviews рейтинг', 'en')).toBe(false);
    expect(fitsLanguage('google ai overviews рейтинг', 'tr')).toBe(false);
    expect(fitsLanguage('seo araçları ücretsiz', 'en')).toBe(false);
    expect(fitsLanguage('métricas de búsqueda ia', 'English')).toBe(false);
  });

  it('keeps every search when the page’s language isn’t known', () => {
    expect(fitsLanguage('google ai overviews рейтинг', null)).toBe(true);
    expect(fitsLanguage('google ai overviews рейтинг', 'Klingon')).toBe(true);
  });
});

describe('onTopic', () => {
  const page = new Set(
    [
      'Top Profound Alternatives for AI Visibility Tracking',
      'What are the best alternatives to Profound for tracking brand mentions in AI answers?',
    ].flatMap(topicWords),
  );

  it('keeps a query most of whose telling words are the page’s', () => {
    expect(onTopic('profound alternatives', page)).toBe(true);
    expect(onTopic('ai visibility tracking tools', page)).toBe(true);
    expect(onTopic('alternative to profound ai', page)).toBe(true);
  });

  it('drops a query about something else, or about nothing in particular', () => {
    // The off-topic H2 of the test: "Which metrics matter for AI search KPIs?".
    expect(onTopic('ai search kpis', page)).toBe(false);
    expect(onTopic('open source seo tools', page)).toBe(false);
    expect(onTopic('best ai tools 2026', page)).toBe(false);
  });
});

describe('fitSources', () => {
  const sources = {
    promptIds: ['p1'],
    fanouts: [
      { query: 'profound alternatives pricing', platforms: ['chatgpt'] },
      { query: 'альтернативы profound', platforms: ['chatgpt'] },
    ],
    pages: [{ url: 'https://example.com/a', kind: 'cited' }],
    queries: ['profound alternatives', 'ai search kpis', 'google ai overviews рейтинг'],
    headings: [],
    length: 3000,
  };

  it('keeps the searches in the page’s language, and the queries about it', () => {
    expect(
      fitSources(sources, { language: 'en', focus: ['Top Profound Alternatives in 2026'] }),
    ).toEqual({
      ...sources,
      fanouts: [{ query: 'profound alternatives pricing', platforms: ['chatgpt'] }],
      queries: ['profound alternatives'],
    });
  });

  it('keeps the queries in its language when nothing else is left to write from', () => {
    const only = { ...sources, promptIds: [], fanouts: [] };
    expect(fitSources(only, { language: 'en', focus: ['Espresso grinders'] }).queries).toEqual([
      'profound alternatives',
      'ai search kpis',
    ]);
  });

  it('leaves no sources as none', () => {
    expect(fitSources(undefined, { language: 'en' })).toBeUndefined();
  });
});

describe('namedCompetitors', () => {
  const competitors = ['Profound', 'Otterly.AI', 'Peec AI', 'Semrush', 'Ahrefs'];

  it('lists the competitors a page weighing options names, as the brand writes them', () => {
    expect(
      namedCompetitors(
        'alternatives',
        competitors,
        ['Top Profound alternatives', 'How do otterly.ai and peec ai compare?'],
        ['semrush'],
      ),
    ).toEqual(['Profound', 'Otterly.AI', 'Peec AI', 'Semrush']);
  });

  it('reads a name as a whole word only', () => {
    expect(namedCompetitors('comparison', ['Peec'], ['Peeckaboo analytics'])).toEqual([]);
  });

  it('names none for a page that weighs no options', () => {
    expect(namedCompetitors('blog_post', competitors, ['Top Profound alternatives'])).toEqual([]);
  });
});
