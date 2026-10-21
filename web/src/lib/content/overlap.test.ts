import { describe, expect, it } from 'vitest';
import type { OverlapPage } from './drafts';
import { adviseOverlap, overlapOptions, pagePath, samePage } from './overlap';

const page = (over: Partial<OverlapPage> = {}): OverlapPage => ({
  url: 'https://acme.example/guides/espresso',
  title: 'Espresso guide',
  promptsInCommon: 3,
  citations: 4,
  gscPosition: 3.5,
  ...over,
});

describe('adviseOverlap', () => {
  it('finds nothing to weigh with no page, or no prompts to check', () => {
    expect(adviseOverlap({ totalPrompts: 4, pages: [] })).toEqual({ verdict: 'none', options: [] });
    expect(adviseOverlap({ totalPrompts: 0, pages: [page()] }).verdict).toBe('none');
  });

  it('recommends optimizing a page that already answers half the prompts or more', () => {
    const top = page({ promptsInCommon: 2 });
    expect(
      adviseOverlap({ totalPrompts: 4, pages: [top, page({ url: 'https://acme.example/b' })] }),
    ).toEqual({
      verdict: 'covered',
      options: [
        { key: 'optimizeInstead', choice: { kind: 'optimize', page: top }, recommended: true },
        { key: 'createAnyway', choice: { kind: 'create' }, recommended: false },
      ],
    });
  });

  it('recommends a new page when the pages answer fewer, with a section as the smaller change', () => {
    const top = page({ promptsInCommon: 1 });
    expect(adviseOverlap({ totalPrompts: 3, pages: [top] })).toEqual({
      verdict: 'partial',
      options: [
        { key: 'createLinked', choice: { kind: 'create' }, recommended: true },
        { key: 'addSection', choice: { kind: 'optimize', page: top }, recommended: false },
      ],
    });
  });
});

describe('overlapOptions', () => {
  const top = page({ promptsInCommon: 1 });
  const advice = adviseOverlap({ totalPrompts: 3, pages: [top] });

  it('offers the advice alone without a page from the plan, or when it offers that page', () => {
    expect(overlapOptions(advice, null)).toBe(advice.options);
    expect(overlapOptions(advice, page({ url: 'https://www.acme.example/Guides/espresso/' }))).toBe(
      advice.options,
    );
  });

  it('offers the plan’s page and a new page when nothing overlaps', () => {
    const given = page({ url: 'https://acme.example/pricing', promptsInCommon: 0 });
    const none = adviseOverlap({ totalPrompts: 2, pages: [] });
    expect(overlapOptions(none, given)).toEqual([
      { key: 'optimizeGiven', choice: { kind: 'optimize', page: given }, recommended: false },
      { key: 'createNew', choice: { kind: 'create' }, recommended: false },
    ]);
    // With no page from the plan, nothing to choose.
    expect(overlapOptions(none, null)).toEqual([]);
  });

  it('offers the page the plan named first when the advice offers another', () => {
    const given = page({ url: 'https://acme.example/pricing', promptsInCommon: 0 });
    expect(overlapOptions(advice, given)).toEqual([
      { key: 'optimizeGiven', choice: { kind: 'optimize', page: given }, recommended: false },
      ...advice.options,
    ]);
  });
});

describe('samePage', () => {
  it('compares addresses as pages, and anything else as text', () => {
    expect(samePage('https://acme.example/a/', 'http://www.acme.example/A')).toBe(true);
    expect(samePage('https://acme.example/a', 'https://acme.example/b')).toBe(false);
    expect(samePage('not a url', 'not a url')).toBe(true);
    expect(samePage('not a url', 'https://acme.example/a')).toBe(false);
  });
});

describe('pagePath', () => {
  it('names a page by its path, the home page by its host', () => {
    expect(pagePath('https://acme.example/guides/espresso/')).toBe('/guides/espresso');
    expect(pagePath('https://acme.example/')).toBe('acme.example');
    expect(pagePath('not a url')).toBe('not a url');
  });
});
