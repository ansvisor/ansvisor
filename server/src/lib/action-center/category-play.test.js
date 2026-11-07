import { describe, expect, it, vi } from 'vitest';

/**
 * The category page play (AC plan P-7, spec §6.2): a store's topic action
 * optimizes its topic's live category page, its best sellers in stock
 * locked into the draft's shopping path.
 */

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { categoryBestSellers, pickCategoryPage } = await import('./category-play.js');
const { CATEGORY_PAGE_PLAY, categoryPagePlay, isPlayId } = await import('./playbooks.js');

describe('pickCategoryPage', () => {
  const pages = [
    { name: 'Coffee > Cold Brew', inStock: 0, page: { url: 'https://shop.example/c/cold-brew' } },
    { name: 'Coffee', inStock: 30, page: { url: 'https://shop.example/c/coffee' } },
    { name: 'Gifts', inStock: 4, page: null },
  ];
  const topics = [
    {
      id: 't1',
      categories: [
        { id: 'c-cold', name: 'Coffee > Cold Brew' },
        { id: 'c-coffee', name: 'Coffee' },
      ],
    },
    { id: 't2', categories: [{ id: 'c-gifts', name: 'Gifts' }] },
  ];

  it('takes the first of the topics’ categories with a page and a product in stock', () => {
    expect(pickCategoryPage({ topicIds: ['t2', 't1'], topics, pages })).toEqual({
      id: 'c-coffee',
      name: 'Coffee',
      url: 'https://shop.example/c/coffee',
      inStock: 30,
    });
    expect(pickCategoryPage({ topicIds: [], topics, pages })).toBeNull();
  });

  it('else the first with a product in stock and no page, for a buying guide (EC-1)', () => {
    expect(pickCategoryPage({ topicIds: ['t2'], topics, pages })).toEqual({
      id: 'c-gifts',
      name: 'Gifts',
      url: null,
      inStock: 4,
    });
    // Nothing in stock: none.
    expect(
      pickCategoryPage({
        topicIds: ['t2'],
        topics,
        pages: [{ name: 'Gifts', inStock: 0, page: null }],
      }),
    ).toBeNull();
  });
});

/** Tables in memory, with the filters the module uses. */
function fakeDb(tables, stats = []) {
  return {
    rpc: async () => ({ data: stats, error: null }),
    from: (name) => {
      const filters = [];
      const chain = {
        select: () => chain,
        eq: (col, value) => (filters.push((row) => row[col] === value), chain),
        in: (col, values) => (filters.push((row) => values.includes(row[col])), chain),
        is: (col, value) => (filters.push((row) => (row[col] ?? null) === value), chain),
        limit: () => chain,
        then: (resolve) =>
          resolve({
            data: (tables[name] ?? []).filter((row) => filters.every((f) => f(row))),
            error: null,
          }),
      };
      return chain;
    },
  };
}

describe('categoryBestSellers', () => {
  const member = (id) => ({ brand_id: 'b1', category_id: 'c1', product_id: id });
  const tables = {
    catalog_product_categories: ['p1', 'p2', 'p3', 'p4', 'p5'].map(member),
    catalog_products: [
      { id: 'p1', brand_id: 'b1', removed_at: null },
      { id: 'p2', brand_id: 'b1', removed_at: null },
      { id: 'p3', brand_id: 'b1', removed_at: '2026-11-01T00:00:00Z' },
      { id: 'p4', brand_id: 'b1', removed_at: null },
      { id: 'p5', brand_id: 'b1', removed_at: null },
    ],
    catalog_variants: [
      { product_id: 'p1', brand_id: 'b1', availability: 'in_stock', removed_at: null },
      { product_id: 'p2', brand_id: 'b1', availability: 'out_of_stock', removed_at: null },
      { product_id: 'p4', brand_id: 'b1', availability: null, removed_at: null },
      { product_id: 'p5', brand_id: 'b1', availability: 'in_stock', removed_at: null },
    ],
  };

  it('ranks the category’s products by AI orders, then visits, and keeps the ones in stock', async () => {
    const db = fakeDb(tables, [
      { product_id: 'p5', orders: 3, ai_visits: 10 },
      { product_id: 'p2', orders: 9, ai_visits: 1 },
      { product_id: 'p4', orders: 0, ai_visits: 40 },
    ]);
    // p2 is out of stock, p3 left the catalog; p4 has no stock read: kept.
    expect(await categoryBestSellers('b1', 'c1', { db })).toEqual(['p5', 'p4', 'p1']);
    expect(await categoryBestSellers('b1', 'c1', { db, max: 2 })).toEqual(['p5', 'p4']);
  });

  it('keeps none for a category with no product', async () => {
    expect(await categoryBestSellers('b1', 'c-empty', { db: fakeDb(tables) })).toEqual([]);
  });
});

describe('categoryPagePlay', () => {
  it('names the category and its page, and the plays the prompts qualify for', () => {
    const play = categoryPagePlay({
      siteType: 'ecommerce',
      category: { name: 'Coffee', url: 'https://shop.example/c/coffee', inStock: 30 },
      prompts: [
        { id: 'a', intent: 'best-top', volume: 900 },
        { id: 'b', intent: 'how-to', volume: 100 },
      ],
    });
    expect(play).toMatchObject({
      id: 'category_page',
      assetType: 'category_page',
      siteType: 'ecommerce',
      reasons: [
        {
          kind: 'category',
          category: 'Coffee',
          page: 'https://shop.example/c/coffee',
          inStock: 30,
        },
      ],
      supporting: [{ id: 'best_of', share: 0.9 }],
    });
    expect(isPlayId(CATEGORY_PAGE_PLAY.id)).toBe(true);
  });

  it('writes a buying guide for a category with no page (EC-1)', () => {
    const play = categoryPagePlay({
      siteType: 'ecommerce',
      category: { name: 'Gifts', url: null, inStock: 4 },
    });
    expect(play).toMatchObject({
      id: 'buying_guide',
      assetType: 'buying_guide',
      reasons: [{ kind: 'category', category: 'Gifts', page: null, inStock: 4 }],
      supporting: [],
    });
    expect(isPlayId('buying_guide')).toBe(true);
  });
});
