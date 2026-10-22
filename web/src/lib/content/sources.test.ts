import { describe, expect, it } from 'vitest';
import {
  buildSourceGroups,
  includedCounts,
  normalizeQuery,
  pageKey,
  readDraftDoc,
  relatedQueries,
  usedIn,
  wordsOf,
  type DraftSourceRow,
  type DraftSourcesData,
} from './sources';

const data = (over: Partial<DraftSourcesData> = {}): DraftSourcesData => ({
  prompts: [
    {
      id: 'p1',
      text: 'Best espresso machines under $500?',
      inDraft: true,
      citesPage: false,
      answers: 21,
      mentioned: 4,
    },
    {
      id: 'p2',
      text: 'Manual vs automatic espresso machine',
      inDraft: false,
      citesPage: true,
      answers: 3,
      mentioned: 0,
    },
  ],
  fanouts: [
    {
      query: 'Best espresso machine under 500',
      platforms: ['perplexity-web', 'copilot-web'],
      searched: 5,
    },
    { query: 'home espresso grinder', platforms: ['copilot-web'], searched: 2 },
  ],
  citedPages: [
    {
      url: 'https://www.reddit.com/r/espresso/x',
      title: 'Thread',
      domain: 'reddit.com',
      citations: 12,
      answers: 9,
    },
    {
      url: 'https://crema.example.com/guide',
      title: 'Guide',
      domain: 'crema.example.com',
      citations: 4,
      answers: 4,
    },
    {
      url: 'https://acme-coffee.example.com/guides/espresso/',
      title: 'Ours',
      domain: 'acme-coffee.example.com',
      citations: 2,
      answers: 2,
    },
  ],
  gscQueries: [
    { query: 'espresso machine under 500', clicks: 40, impressions: 900 },
    { query: 'coffee subscription', clicks: 12, impressions: 300 },
    { query: 'acme coffee login', clicks: 8, impressions: 50 },
  ],
  brandDomains: ['acme-coffee.example.com'],
  competitorDomains: ['crema.example.com'],
  ...over,
});

const draft = {
  title: 'The home espresso guide',
  sourceUrl: 'https://acme-coffee.example.com/guides/espresso',
};

describe('words and keys', () => {
  it('reads a text’s words for matching', () => {
    expect(wordsOf('Best espresso machines under $500? The guide')).toEqual([
      'best',
      'espresso',
      'machine',
      'under',
      '500',
      'guide',
    ]);
    expect(normalizeQuery('  Best   Espresso ')).toBe('best espresso');
  });

  it('keys a page by host and path', () => {
    expect(pageKey('https://www.Acme.com/Guides/Espresso/?utm_source=x#top')).toBe(
      'acme.com/guides/espresso',
    );
    expect(pageKey('/relative')).toBeNull();
    expect(pageKey('mailto:hi@acme.com')).toBeNull();
  });
});

describe('relatedQueries', () => {
  it('keeps the brand’s queries sharing half their words with the draft', () => {
    expect(
      relatedQueries(data().gscQueries, ['espresso machine guide']).map((q) => q.query),
    ).toEqual(['espresso machine under 500']);
    expect(relatedQueries(data().gscQueries, ['espresso machine under'], 0)).toEqual([]);
  });
});

describe('buildSourceGroups', () => {
  it('lists the prompts, fan-outs, cited pages and related queries, each kind of page named', () => {
    const groups = buildSourceGroups(data(), [], draft);
    expect(groups.map((g) => [g.kind, g.rows.map((r) => r.name)])).toEqual([
      ['prompt', ['Best espresso machines under $500?', 'Manual vs automatic espresso machine']],
      ['fanout', ['Best espresso machine under 500', 'home espresso grinder']],
      [
        'cited_page',
        [
          'https://www.reddit.com/r/espresso/x',
          'https://crema.example.com/guide',
          'https://acme-coffee.example.com/guides/espresso/',
        ],
      ],
      ['gsc_query', ['espresso machine under 500']],
    ]);
    const pages = groups[2].rows as Extract<DraftSourceRow, { kind: 'cited_page' }>[];
    expect(pages.map((p) => p.category)).toEqual(['forum', 'competitor', 'you']);
    const prompts = groups[0].rows as Extract<DraftSourceRow, { kind: 'prompt' }>[];
    expect(prompts.map((p) => p.citesPage)).toEqual([false, true]);
  });

  it('keeps a source left out unchecked, and adds the pages and queries added by hand', () => {
    const groups = buildSourceGroups(
      data(),
      [
        { kind: 'fanout', ref: 'home espresso grinder', included: false, added: false },
        { kind: 'cited_page', ref: 'https://example.org/study', included: true, added: true },
        { kind: 'gsc_query', ref: 'coffee subscription', included: true, added: true },
        { kind: 'gsc_query', ref: 'gone query', included: false, added: true },
      ],
      draft,
    );
    expect(groups[1].rows.map((r) => [r.name, r.included])).toEqual([
      ['Best espresso machine under 500', true],
      ['home espresso grinder', false],
    ]);
    expect(groups[2].rows.at(-1)).toMatchObject({
      name: 'https://example.org/study',
      added: true,
      citations: null,
      category: 'other',
    });
    expect(groups[3].rows.map((r) => [r.name, r.included, r.added])).toEqual([
      ['espresso machine under 500', true, false],
      ['coffee subscription', true, true],
      ['gone query', false, true],
    ]);
    expect(includedCounts(groups)).toEqual({ prompt: 2, fanout: 1, cited_page: 4, gsc_query: 2 });
  });
});

describe('usedIn', () => {
  const doc = readDraftDoc(
    '<h1>The home espresso guide</h1>' +
      '<p>Pick a grinder before the machine.</p>' +
      '<h2>Best espresso machines under $500</h2>' +
      '<p>A home espresso grinder matters: see <a href="https://www.reddit.com/r/espresso/x?ref=1">this thread</a> ' +
      'and <a href="/guides/milk">our milk guide</a>.</p>',
  );
  const rows = Object.fromEntries(
    buildSourceGroups(data(), [], draft).flatMap((g) => g.rows.map((r) => [r.name, r])),
  );
  const ctx = { sourceUrl: draft.sourceUrl };

  it('finds a prompt or fan-out in a heading first, then a paragraph', () => {
    expect(usedIn(rows['Best espresso machines under $500?'], doc, ctx)).toEqual({
      kind: 'heading',
      level: 2,
      text: 'Best espresso machines under $500',
    });
    expect(usedIn(rows['home espresso grinder'], doc, ctx)).toEqual({
      kind: 'paragraph',
      index: 2,
    });
    expect(usedIn(rows['Manual vs automatic espresso machine'], doc, ctx)).toBeNull();
  });

  it('finds a page where the draft links to it, or the page itself', () => {
    expect(usedIn(rows['https://www.reddit.com/r/espresso/x'], doc, ctx)).toEqual({
      kind: 'outboundLink',
    });
    expect(usedIn(rows['https://crema.example.com/guide'], doc, ctx)).toBeNull();
    expect(usedIn(rows['https://acme-coffee.example.com/guides/espresso/'], doc, ctx)).toEqual({
      kind: 'thisPage',
    });
  });

  it('calls a link to the brand’s own page internal', () => {
    const own = readDraftDoc(
      '<p><a href="https://acme-coffee.example.com/blog/beans">beans</a></p>',
    );
    const row = buildSourceGroups(
      data({
        citedPages: [
          {
            url: 'https://acme-coffee.example.com/blog/beans',
            title: null,
            domain: 'acme-coffee.example.com',
            citations: 1,
            answers: 1,
          },
        ],
      }),
      [],
      draft,
    )[2].rows[0];
    expect(usedIn(row, own, ctx)).toEqual({ kind: 'internalLink' });
  });
});
