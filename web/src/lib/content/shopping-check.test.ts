import { describe, expect, it } from 'vitest';
import { draftShopping, draftsByShopping, shoppingLinks } from './shopping-check';

/** A page's shopping links against its path (shopping path, part 6). */

describe('shoppingLinks', () => {
  it('reads the category page and the products linked, each once, and those that no longer sell', () => {
    const read = shoppingLinks(
      [
        'https://www.shop.example/collections/boots/',
        'https://shop.example/products/a?utm_source=feed',
        'https://shop.example/products/a',
        'https://shop.example/products/b',
        '/about',
      ],
      {
        categories: ['shop.example/collections/boots'],
        products: [
          { key: 'shop.example/products/a', title: 'A', state: 'ok' },
          { key: 'shop.example/products/b', title: 'B', state: 'gone' },
          { key: 'shop.example/products/c', title: 'C', state: 'sold_out' },
        ],
      },
    );
    expect(read.categoryLinked).toBe(true);
    expect(read.linked.map((p) => p.title)).toEqual(['A', 'B']);
    expect(read.bad).toEqual([{ key: 'shop.example/products/b', title: 'B', state: 'gone' }]);
    expect(read).toMatchObject({ products: 3, categories: 1 });
  });
});

describe('draftShopping (00352)', () => {
  const check = {
    read_from: 'draft',
    checked_at: '2026-10-27T03:00:00Z',
    categories: 2,
    categories_linked: 1,
    products: 4,
    products_linked: 3,
    bad: [] as unknown[],
  };

  it('is none without a path, and not checked until a check came back', () => {
    expect(draftShopping(null, check)).toEqual({ state: 'none' });
    expect(draftShopping('2026-10-26T09:00:00Z', null)).toEqual({ state: 'unchecked' });
    expect(draftShopping('2026-10-26T09:00:00Z', [])).toEqual({ state: 'unchecked' });
  });

  it('needs attention when a linked product no longer sells, and reads one embedded as a list', () => {
    const bad = [{ id: 'p1', title: 'A', state: 'refused' }];
    expect(draftShopping('x', { ...check, bad })).toMatchObject({ state: 'attention', bad });
    expect(draftShopping('x', [check])).toMatchObject({
      state: 'ok',
      readFrom: 'draft',
      categoriesLinked: 1,
      productsLinked: 3,
    });
  });

  it("reads a list of bad links it can't read as none", () => {
    expect(draftShopping('x', { ...check, bad: [{ id: 1 }] })).toMatchObject({
      state: 'ok',
      bad: [],
    });
  });
});

describe('draftsByShopping', () => {
  const drafts = [
    { id: 'a', shopping: { state: 'none' as const } },
    { id: 'b', shopping: { state: 'unchecked' as const } },
    {
      id: 'c',
      shopping: draftShopping('x', {
        read_from: 'page',
        checked_at: 'y',
        categories: 0,
        categories_linked: 0,
        products: 1,
        products_linked: 1,
        bad: [{ id: 'p', title: 'P', state: 'sold_out' }],
      }),
    },
    { id: 'd' },
  ];

  it('lists each state, a path not checked yet only under All', () => {
    expect(draftsByShopping(drafts, 'all').map((d) => d.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(draftsByShopping(drafts, 'attention').map((d) => d.id)).toEqual(['c']);
    expect(draftsByShopping(drafts, 'ok').map((d) => d.id)).toEqual([]);
    expect(draftsByShopping(drafts, 'none').map((d) => d.id)).toEqual(['a', 'd']);
  });
});
