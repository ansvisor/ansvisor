import { describe, expect, it } from 'vitest';
import {
  MAX_COPY_CHARS,
  buildKnownFacts,
  cutAtWord,
  cutToLength,
  guardFacts,
  needsShortening,
  replaceUnknownNames,
  replaceUnknownValues,
  sentencesOf,
} from './recommendation-guard.js';

// The pricing page from the spec's bug report, cut down.
const PRICING_PAGE =
  'Ansvisor pricing. Starter $49 per month: 100 site audits, 50 prompts. ' +
  'Growth $249 per month: 500 site audits. Track ChatGPT, Perplexity and Google AI Overviews. ' +
  'Last updated October 2026.';

const known = buildKnownFacts({
  pageText: PRICING_PAGE,
  extras: ['Ansvisor pricing: plans for every team'],
  brand: { name: 'Ansvisor', description: 'AI visibility platform', domains: ['ansvisor.com'] },
});

const rec = (over = {}) => ({
  signalKey: 'case-study-evidence',
  priority: 'medium',
  recommendation: 'Add one real customer result next to the plans.',
  draft: null,
  code: null,
  ...over,
});

describe('guardFacts', () => {
  it("replaces the spec's invented customer and percentage with placeholders", () => {
    const { rec: out, hits } = guardFacts(
      rec({
        draft:
          "Join brands like TechFlow, which saw a 34% increase in 'Recommended' citations with Growth.",
      }),
      known,
    );
    expect(out.draft).toBe(
      "Join brands like [customer name], which saw a [real metric] increase in 'Recommended' citations with Growth.",
    );
    expect(hits).toBe(2);
  });

  it('replaces a price the page does not show and keeps the ones it does', () => {
    const { rec: out } = guardFacts(
      rec({ draft: 'Starter is $49 per month, Growth $249, and Pro costs $799 per month.' }),
      known,
    );
    expect(out.draft).toBe(
      'Starter is $49 per month, Growth $249, and Pro costs [price] per month.',
    );
  });

  it('keeps the brand, the AI platforms and known names, and replaces an unknown CamelCase name', () => {
    const { rec: out } = guardFacts(
      rec({
        recommendation: 'Say Ansvisor tracks ChatGPT and Perplexity answers, as HubSpot does.',
      }),
      known,
    );
    expect(out.recommendation).toBe(
      'Say Ansvisor tracks ChatGPT and Perplexity answers, as [customer name] does.',
    );
  });

  it('turns a list of unknown customers into one placeholder', () => {
    const { rec: out, hits } = guardFacts(
      rec({ draft: 'Trusted by Acme Corp, Zenith and Bolt Labs to track AI answers.' }),
      known,
    );
    expect(out.draft).toBe('Trusted by [customer name] to track AI answers.');
    expect(hits).toBe(3);
  });

  it('keeps writing-instruction numbers in the explanation only', () => {
    const { rec: out } = guardFacts(
      rec({
        recommendation: 'Write a 120–150 character meta description and add 3–5 FAQ questions.',
        draft: 'Answer 7 common questions about plans.',
      }),
      known,
    );
    expect(out.recommendation).toBe(
      'Write a 120–150 character meta description and add 3–5 FAQ questions.',
    );
    expect(out.draft).toBe('Answer [real metric] common questions about plans.');
  });

  it('keeps list numbering and the numbers the page has', () => {
    const { rec: out } = guardFacts(
      rec({ draft: '1. Pick a plan with 500 site audits.\nStep 2: connect 50 prompts.' }),
      known,
    );
    expect(out.draft).toBe('1. Pick a plan with 500 site audits.\nStep 2: connect 50 prompts.');
  });

  it("keeps known dates and the page's month, and replaces an invented date or year", () => {
    const { rec: out } = guardFacts(
      rec({
        draft: 'Updated October 2026. Launched in March 2021 and rated best tool of 2023.',
      }),
      known,
    );
    expect(out.draft).toBe(
      'Updated October 2026. Launched in [date] and rated best tool of [date].',
    );
  });

  it('keeps the names of AI crawlers and Open Graph', () => {
    const { rec: out, hits } = guardFacts(
      rec({
        recommendation: 'Add OpenGraph tags and let PerplexityBot, ClaudeBot and OAI-SearchBot in.',
      }),
      known,
    );
    expect(hits).toBe(0);
    expect(out.recommendation).toContain('OpenGraph');
  });

  it('leaves URLs, domains and existing placeholders alone', () => {
    const draft =
      'Cite developers.google.com/search/docs/2024 and https://example.org/report-2025?id=7 for [real metric].';
    const { rec: out, hits } = guardFacts(rec({ draft }), known);
    expect(out.draft).toBe(draft);
    expect(hits).toBe(0);
  });

  it('keeps the JSON-LD valid: an unknown price becomes a quoted placeholder', () => {
    const code = JSON.stringify(
      {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Ansvisor Growth',
        offers: { '@type': 'Offer', price: 799, priceCurrency: 'USD' },
        aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.8', reviewCount: 312 },
        datePublished: '2024-01-15',
        itemListElement: [{ '@type': 'ListItem', position: 1 }],
      },
      null,
      2,
    );
    const { rec: out } = guardFacts(rec({ code }), known);
    const parsed = JSON.parse(out.code);
    expect(parsed.offers.price).toBe('[price]');
    expect(parsed.aggregateRating.ratingValue).toBe('[real metric]');
    expect(parsed.aggregateRating.reviewCount).toBe('[real metric]');
    expect(parsed.datePublished).toBe('[date]');
    expect(parsed.itemListElement[0].position).toBe(1);
    expect(parsed['@context']).toBe('https://schema.org');
  });

  it('keeps a known plan price in JSON-LD', () => {
    const { rec: out } = guardFacts(
      rec({ code: '{"price": "249.00", "priceCurrency": "USD"}' }),
      known,
    );
    expect(out.code).toBe('{"price": "249.00", "priceCurrency": "USD"}');
  });

  it('checks nothing from the brand data when none was given', () => {
    const pageOnly = buildKnownFacts({ pageText: 'A coffee roaster in Leeds.' });
    expect(replaceUnknownNames('Teams at Ansvisor, like ExampleCo.', pageOnly).text).toBe(
      'Teams at [customer name], like [customer name].',
    );
  });
});

describe('replaceUnknownValues', () => {
  it('replaces an invented ISO datetime whole, and keeps one whose day the page has', () => {
    const page = buildKnownFacts({ pageText: 'Updated 2026-10-01.' });
    expect(
      replaceUnknownValues('{"dateModified": "2024-05-01T10:00:00Z"}', page, { field: 'code' })
        .text,
    ).toBe('{"dateModified": "[date]"}');
    expect(
      replaceUnknownValues('{"dateModified": "2026-10-01T08:30:00+03:00"}', page, { field: 'code' })
        .text,
    ).toBe('{"dateModified": "2026-10-01T08:30:00+03:00"}');
  });

  it('reads a year-shaped count as a count', () => {
    const page = buildKnownFacts({ pageText: 'A short guide.' });
    expect(
      replaceUnknownValues('Expand the guide to about 2000 words.', page, {
        field: 'recommendation',
      }).text,
    ).toBe('Expand the guide to about 2000 words.');
    expect(
      replaceUnknownValues('A 2000 word guide, updated since 2019.', page, { field: 'draft' }).text,
    ).toBe('A [real metric] word guide, updated since [date].');
  });

  it('needs a percentage or price to be one on the page, not just the same number', () => {
    const page = buildKnownFacts({
      pageText: 'Free shipping over $30. Ships in 48 hours. 20% off.',
    });
    expect(
      replaceUnknownValues('48% reorder, 30% save and 20% off; from $48, over $30.', page, {
        field: 'draft',
      }).text,
    ).toBe('[real metric] reorder, [real metric] save and 20% off; from [price], over $30.');
  });

  it('keeps score targets in the explanation', () => {
    const page = buildKnownFacts({ pageText: 'Long paragraphs.' });
    expect(
      replaceUnknownValues('Aim for a Flesch reading ease of 60 or a score above 70.', page, {
        field: 'recommendation',
      }).text,
    ).toBe('Aim for a Flesch reading ease of 60 or a score above 70.');
  });

  const page = buildKnownFacts({ pageText: 'Over 1,200 roasters use it.' });

  it('matches numbers written with or without thousands separators', () => {
    expect(replaceUnknownValues('Join 1200 roasters.', page, { field: 'draft' }).text).toBe(
      'Join 1200 roasters.',
    );
    expect(replaceUnknownValues('Join 5,000+ roasters.', page, { field: 'draft' }).text).toBe(
      'Join [real metric] roasters.',
    );
  });

  it('treats a percentage, a multiple and "k" amounts as metrics', () => {
    const { text, hits } = replaceUnknownValues('Grew 3x to 40k visits, up 25 percent.', page, {
      field: 'draft',
    });
    expect(text).toBe('Grew [real metric] to [real metric] visits, up [real metric].');
    expect(hits).toBe(3);
  });

  it('ignores digits that are part of a word, such as H2 or v3', () => {
    expect(
      replaceUnknownValues('Use an H2 per question in v3.', page, { field: 'draft' }).text,
    ).toBe('Use an H2 per question in v3.');
  });
});

describe('length', () => {
  const long = `${'Explain how each plan maps to team size, '.repeat(4)}and which audits are included.`;

  it('flags an explanation or a draft sentence over 150 characters', () => {
    expect(long.length).toBeGreaterThan(MAX_COPY_CHARS);
    expect(needsShortening(rec({ recommendation: long }))).toBe(true);
    expect(needsShortening(rec({ draft: `Short one. ${long}` }))).toBe(true);
    expect(needsShortening(rec({ draft: 'Short one.\nAnother short one.' }))).toBe(false);
  });

  it('never counts the code', () => {
    expect(needsShortening(rec({ code: `{"text": "${long}${long}"}` }))).toBe(false);
  });

  it('cuts at a word boundary, ending in an ellipsis, within the limit', () => {
    const cut = cutAtWord(long);
    expect(cut.length).toBeLessThanOrEqual(MAX_COPY_CHARS);
    expect(cut.endsWith('…')).toBe(true);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    expect(long[cut.length - 1]).toBe(' ');
  });

  it('leaves a link out whole rather than cutting through it', () => {
    const text = `${'Cite the guide on structured data for answers, '.repeat(2)}see https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data for details.`;
    const cut = cutAtWord(text);
    expect(cut.length).toBeLessThanOrEqual(MAX_COPY_CHARS);
    expect(cut).not.toContain('https://');
    expect(cut.endsWith('see…')).toBe(true);
  });

  it("keeps the explanation's first sentence when that fits", () => {
    const { rec: out, cuts } = cutToLength(
      rec({ recommendation: `Add a customer result next to the plans. ${long}` }),
    );
    expect(out.recommendation).toBe('Add a customer result next to the plans.');
    expect(cuts).toBe(1);
  });

  it('cuts only the long sentences of a draft and keeps its lines', () => {
    const { rec: out, cuts } = cutToLength(rec({ draft: `Plans for every team.\nShort. ${long}` }));
    const lines = out.draft.split('\n');
    expect(lines[0]).toBe('Plans for every team.');
    expect(lines[1].startsWith('Short. ')).toBe(true);
    expect(sentencesOf(out.draft).every((s) => s.length <= MAX_COPY_CHARS)).toBe(true);
    expect(cuts).toBe(1);
  });
});
