import { describe, expect, it } from 'vitest';
import { FEED_GAP_EXAMPLES, feedGaps } from './feed-gaps';
import type { CatalogProductRow } from './products';

/**
 * The Shopping Feed Advisor's read: what the feed is missing for AI shopping
 * answers, each readiness check's products counted over the whole catalog
 * and ordered by the readiness the catalog loses on it.
 */

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

const product = (id: string, over: Partial<CatalogProductRow> = {}): CatalogProductRow => ({
  id,
  title: `Boot ${id}`,
  url: `https://acme.example/p/${id}`,
  productType: 'Boots',
  brand: 'Acme',
  description: `Waterproof boots for the trail. ${words(30)}`,
  image: 'https://acme.example/i.jpg',
  category: 'Shoes > Boots',
  price: 120,
  currency: 'USD',
  inStock: true,
  hasGtin: true,
  ...over,
});

describe('feedGaps', () => {
  it('counts each check the products miss, the most readiness lost first', () => {
    const gaps = feedGaps([
      product('a', { hasGtin: false }),
      product('b', { hasGtin: false, brand: null }),
      product('c', { image: null }),
      product('d', { brand: null }),
      product('e', { brand: null }),
      product('f', { brand: null }),
      product('g'),
    ]);
    expect(gaps.products).toBe(7);
    expect(gaps.complete).toBe(1);
    expect(gaps.capped).toBe(false);
    // GTIN: 20 × 2 = 40; brand: 5 × 4 = 20; image: 15 × 1 = 15.
    expect(
      gaps.gaps.map(({ check, points, missing, impact }) => [check, points, missing, impact]),
    ).toEqual([
      ['gtin', 20, 2, 40],
      ['brand', 5, 4, 20],
      ['image', 15, 1, 15],
    ]);
    expect(gaps.gaps[0].share).toBe(0.286);
    expect(gaps.gaps[0].examples).toEqual([
      { id: 'a', title: 'Boot a', url: 'https://acme.example/p/a' },
      { id: 'b', title: 'Boot b', url: 'https://acme.example/p/b' },
    ]);
  });

  it('checks the description: its length, and whether its first words name the type', () => {
    const gaps = feedGaps([
      product('a', { description: null }),
      product('b', { description: `${words(45)} boots` }),
      // No product type or category: the first words can't be checked.
      product('c', { productType: null, category: null }),
    ]);
    expect(gaps.gaps.find((gap) => gap.check === 'description')?.missing).toBe(1);
    expect(gaps.gaps.find((gap) => gap.check === 'typeFirst')?.missing).toBe(2);
    expect(gaps.gaps.find((gap) => gap.check === 'category')?.missing).toBe(1);
    expect(gaps.type_unknown).toBe(1);
    expect(gaps.description_words).toEqual({ median: 35, empty: 1 });
    expect(gaps.first_words).toBe(40);
  });

  it('names at most a few products for each gap, by title', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      product(`p${9 - i}`, { title: `Boot ${9 - i}`, price: null }),
    );
    const [price] = feedGaps(many).gaps;
    expect(price.missing).toBe(9);
    expect(price.examples).toHaveLength(FEED_GAP_EXAMPLES);
    expect(price.examples.map((p) => p.title)).toEqual([
      'Boot 1',
      'Boot 2',
      'Boot 3',
      'Boot 4',
      'Boot 5',
    ]);
  });

  it('answers an empty catalog with nothing to fix', () => {
    expect(feedGaps([], false)).toEqual({
      products: 0,
      capped: false,
      average_readiness: null,
      complete: 0,
      gaps: [],
      type_unknown: 0,
      description_words: { median: null, empty: 0 },
      first_words: 40,
    });
  });

  it('keeps the cap it is told', () => {
    expect(feedGaps([product('a')], true).capped).toBe(true);
  });
});
