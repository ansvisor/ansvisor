import { describe, expect, it } from 'vitest';
import type { OverlapPage } from './drafts';
import { adviseOverlap, pagePath } from './overlap';

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

describe('pagePath', () => {
  it('names a page by its path, the home page by its host', () => {
    expect(pagePath('https://acme.example/guides/espresso/')).toBe('/guides/espresso');
    expect(pagePath('https://acme.example/')).toBe('acme.example');
    expect(pagePath('not a url')).toBe('not a url');
  });
});
