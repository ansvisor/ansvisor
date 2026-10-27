import { describe, expect, it } from 'vitest';
import {
  placementOf,
  shoppingPathFits,
  shoppingPathSchema,
  withAdded,
  withLocked,
  withRemoved,
  type ShoppingPath,
} from './shopping-path';

/** A draft's shopping path as the Brief tab holds it (shopping path, 00351). */

const product = (id: string) => ({
  id,
  title: `Boot ${id}`,
  url: `https://s.example/p/${id}`,
  price: 129,
  salePrice: null,
  currency: 'USD',
  availability: 'in_stock',
  image: null,
  issues: [],
  score: 5,
});

const PATH: ShoppingPath = {
  version: 1,
  builtAt: '2026-10-27T12:00:00.000Z',
  pageType: 'buying_guide',
  categories: [{ name: 'Hiking Boots', url: 'https://s.example/c/hiking-boots', title: null }],
  products: [product('a'), product('b')],
  leftOut: [{ id: 'c', title: 'Boot c', reason: 'sold_out' }],
  locked: ['a'],
  removed: [],
  added: ['b'],
};

describe('shoppingPathFits', () => {
  it('fits the page types that link products, on an online shop only', () => {
    expect(shoppingPathFits('ecommerce', 'buying_guide')).toBe(true);
    expect(shoppingPathFits('ecommerce', 'blog_post')).toBe(true);
    expect(shoppingPathFits('ecommerce', 'product_page')).toBe(false);
    expect(shoppingPathFits('ecommerce', null)).toBe(false);
    expect(shoppingPathFits('b2b', 'buying_guide')).toBe(false);
  });
});

describe('placementOf', () => {
  it("names a product's place by page type", () => {
    expect(placementOf('best_of', 0)).toEqual({ key: 'pick', n: 1 });
    expect(placementOf('comparison', 2)).toEqual({ key: 'compared', n: 3 });
    expect(placementOf('blog_post', 1)).toEqual({ key: 'linked', n: 2 });
  });
});

describe('changes', () => {
  it('removes a product for good, locks and unlocks one, and adds one', () => {
    const removed = withRemoved(PATH, 'a');
    expect(removed.products.map((p) => p.id)).toEqual(['b']);
    expect(removed.locked).toEqual([]);
    expect(removed.removed).toEqual(['a']);

    expect(withLocked(PATH, 'b', true).locked).toEqual(['a', 'b']);
    expect(withLocked(PATH, 'a', false).locked).toEqual([]);

    const added = withAdded(removed, 'a');
    expect(added.added).toEqual(['b', 'a']);
    expect(added.removed).toEqual([]);
  });
});

describe('shoppingPathSchema', () => {
  it("reads the API's path, and refuses another shape", () => {
    expect(shoppingPathSchema.safeParse(PATH).success).toBe(true);
    expect(shoppingPathSchema.safeParse({ ...PATH, version: 2 }).success).toBe(false);
    expect(
      shoppingPathSchema.safeParse({ ...PATH, leftOut: [{ id: 'x', title: 'X', reason: 'gone' }] })
        .success,
    ).toBe(false);
  });
});
