import { describe, expect, it } from 'vitest';
import {
  briefFromOpportunity,
  builtFromCount,
  draftBriefSchema,
  rebuildSources,
  type DraftBrief,
} from './brief';
import type { DraftSourcesData } from './sources';

const data: DraftSourcesData = {
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
      text: 'Manual vs automatic espresso',
      inDraft: false,
      citesPage: true,
      answers: 3,
      mentioned: 0,
    },
  ],
  fanouts: [
    { query: 'best espresso machine under 500', platforms: ['perplexity-web'], searched: 5 },
    { query: 'home espresso grinder', platforms: ['copilot-web'], searched: 2 },
  ],
  citedPages: [
    {
      url: 'https://www.reddit.com/r/espresso/x',
      title: null,
      domain: 'reddit.com',
      citations: 12,
      answers: 9,
    },
  ],
  gscQueries: [{ query: 'espresso machine under 500', clicks: 40, impressions: 900 }],
  brandDomains: ['acme.example'],
  competitorDomains: [],
};

const draft = {
  title: 'The home espresso guide',
  sourceUrl: 'https://acme.example/guides/espresso',
  html: '<h1>The home espresso guide</h1><h2>Choosing a machine</h2><p>x</p><h3>Grinders</h3><h2></h2>',
  pageType: 'product_page',
};

describe('rebuildSources', () => {
  it('sends the sources kept, the page’s H2s and H3s, and the length its type asks for', () => {
    expect(
      rebuildSources(
        data,
        [
          { kind: 'prompt', ref: 'p2', included: false, added: false },
          { kind: 'fanout', ref: 'home espresso grinder', included: false, added: false },
          { kind: 'cited_page', ref: 'https://example.org/study', included: true, added: true },
        ],
        draft,
      ),
    ).toEqual({
      promptIds: ['p1'],
      fanouts: [{ query: 'best espresso machine under 500', platforms: ['perplexity-web'] }],
      pages: [
        { url: 'https://www.reddit.com/r/espresso/x', kind: 'forum' },
        { url: 'https://example.org/study', kind: 'other' },
      ],
      queries: ['espresso machine under 500'],
      headings: ['Choosing a machine', 'Grinders'],
      length: 1200,
    });
  });
});

describe('the brief', () => {
  const brief: DraftBrief = {
    goal: 'Help buyers pick',
    audience: 'Home baristas',
    outline: [
      { heading: 'Machines', keyPoints: ['Price'], fanout: 'espresso', platform: 'copilot-web' },
    ],
    keywords: ['espresso'],
    origin: 'rebuild',
    builtAt: '2026-10-21T10:00:00Z',
    builtFrom: { prompts: 1, fanouts: 2, pages: 1, queries: 1 },
  };

  it('counts the sources it was built from', () => {
    expect(builtFromCount(brief)).toBe(5);
    expect(builtFromCount({ ...brief, builtFrom: null })).toBe(0);
  });

  it('keeps to its limits', () => {
    expect(draftBriefSchema.safeParse(brief).success).toBe(true);
    expect(
      draftBriefSchema.safeParse({ ...brief, outline: [{ ...brief.outline[0], heading: ' ' }] })
        .success,
    ).toBe(false);
    expect(draftBriefSchema.safeParse({ ...brief, origin: 'agent' }).success).toBe(false);
  });

  it('reads an opportunity’s brief until the draft has its own', () => {
    expect(
      briefFromOpportunity({
        suggestedTitle: 'x',
        contentType: 'guide',
        targetWordCount: 1500,
        outline: [{ heading: 'Why', keyPoints: ['a'] }],
        targetKeywords: ['espresso'],
        competitorInsights: '',
        callToAction: 'Start a trial',
      }),
    ).toEqual({
      goal: 'Start a trial',
      audience: '',
      outline: [{ heading: 'Why', keyPoints: ['a'], fanout: null, platform: null }],
      keywords: ['espresso'],
      origin: 'opportunity',
      builtAt: null,
      builtFrom: null,
    });
  });
});
