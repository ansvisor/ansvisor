import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

/**
 * The category page play (AC plan P-7, spec §6.2): a store's topic action
 * optimizes its topic's live category page, its best sellers in stock
 * locked into the draft's shopping path.
 */

vi.mock('../../config/supabase.js', () => ({ default: {} }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// The topics' categories and the categories' pages, as a test gives them.
const links = vi.hoisted(() => ({ topics: [], pages: [] }));
vi.mock('../catalog/topic-categories.js', () => ({
  topicCategories: async () => ({ topics: links.topics, categories: [] }),
}));
vi.mock('../catalog/category-pages.js', async (importOriginal) => ({
  ...(await importOriginal()),
  categoryPages: async () => links.pages,
}));

const {
  GUIDE_MIN_IN_STOCK,
  categoryBestSellers,
  categoryGuideMissing,
  categoryLeaf,
  categoryPageFor,
  guideCovers,
  guideMissing,
  pickCategoryPage,
} = await import('./category-play.js');
const { CATEGORY_PAGE_PLAY, MAX_SUPPORTING, categoryPagePlay, isPlayId } =
  await import('./playbooks.js');

// Plan › Shopping opportunities reads a draft as covering a category by the
// same cases (web/src/lib/content/shopping-plan.test.ts, coversCategory).
const { cases: GUIDE_COVERING } = JSON.parse(
  readFileSync(
    new URL('../../../../web/src/lib/content/__fixtures__/guide-covering.json', import.meta.url),
    'utf8',
  ),
);

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

/**
 * Tables in memory, with the filters the module uses. A row holds what the
 * read returns, its aliases' columns included; `failing` tables answer with
 * an error.
 */
function fakeDb(tables, stats = [], { failing = [] } = {}) {
  const reads = [];
  return {
    reads,
    rpc: async () => ({ data: stats, error: null }),
    from: (name) => {
      reads.push(name);
      const filters = [];
      const chain = {
        select: () => chain,
        eq: (col, value) => (filters.push((row) => row[col] === value), chain),
        in: (col, values) => (filters.push((row) => values.includes(row[col])), chain),
        is: (col, value) => (filters.push((row) => (row[col] ?? null) === value), chain),
        order: () => chain,
        limit: () => chain,
        then: (resolve) =>
          resolve(
            failing.includes(name)
              ? { data: null, error: { message: 'timeout' } }
              : {
                  data: (tables[name] ?? []).filter((row) => filters.every((f) => f(row))),
                  error: null,
                },
          ),
      };
      return chain;
    },
  };
}

describe('guideCovers (guide-covering.json)', () => {
  it.each(GUIDE_COVERING)(
    '$draft.title / $draft.categories covers $category: $covers',
    ({ category, draft, covers }) => {
      expect(guideCovers(draft, category)).toBe(covers);
    },
  );

  it("reads a category's own name as the Plan does", () => {
    expect(categoryLeaf('Shoes > Hiking Boots')).toBe('Hiking Boots');
    expect(categoryLeaf('Apparel › Jackets / Rain jackets')).toBe('Rain jackets');
    expect(categoryLeaf(' Boots ')).toBe('Boots');
  });
});

describe('guideMissing', () => {
  const coldBrew = { name: 'Coffee > Cold Brew', inStock: 12 };

  it('is missing with enough in stock and no draft covering the category', () => {
    expect(guideMissing({ category: coldBrew, drafts: [] })).toBe(true);
    expect(
      guideMissing({
        category: coldBrew,
        drafts: [{ title: 'Espresso at home', categories: ['Coffee > Espresso'] }],
      }),
    ).toBe(true);
  });

  it('is not when a draft, written or published, covers it', () => {
    expect(
      guideMissing({
        category: coldBrew,
        drafts: [{ title: 'Cold brew: a buying guide', categories: [] }],
      }),
    ).toBe(false);
    expect(
      guideMissing({
        category: coldBrew,
        drafts: [{ title: 'Summer drinks', categories: ['Coffee > Cold Brew'] }],
      }),
    ).toBe(false);
  });

  it(`is not with fewer than ${GUIDE_MIN_IN_STOCK} products in stock, as the Plan asks`, () => {
    expect(
      guideMissing({ category: { ...coldBrew, inStock: GUIDE_MIN_IN_STOCK - 1 }, drafts: [] }),
    ).toBe(false);
    expect(
      guideMissing({ category: { ...coldBrew, inStock: GUIDE_MIN_IN_STOCK }, drafts: [] }),
    ).toBe(true);
  });
});

describe('categoryGuideMissing', () => {
  const category = {
    id: 'c1',
    name: 'Coffee > Cold Brew',
    url: 'https://shop.example/c/cb',
    inStock: 12,
  };
  const draft = (over) => ({
    brand_id: 'b1',
    archived_at: null,
    title: 'Espresso at home',
    shopping_categories: null,
    ...over,
  });

  it("reads the brand's drafts that aren't archived, and their shopping path's categories", async () => {
    const db = fakeDb({
      content_drafts: [
        draft({ title: 'Cold brew, explained', brand_id: 'b2' }),
        draft({ title: 'Cold brew, explained', archived_at: '2026-11-01T00:00:00Z' }),
        draft({ shopping_categories: [{ name: 'Coffee > Espresso', url: null }] }),
        // Unreadable: no categories, as the Plan reads it.
        draft({ shopping_categories: [{ name: 'Coffee > Cold Brew' }, { url: 'x' }] }),
      ],
    });
    expect(await categoryGuideMissing('b1', category, { db })).toBe(true);
  });

  it('is not when a draft holds the category in its shopping path', async () => {
    const db = fakeDb({
      content_drafts: [draft({ shopping_categories: [{ name: 'Coffee > Cold Brew' }] })],
    });
    expect(await categoryGuideMissing('b1', category, { db })).toBe(false);
  });

  it('fails on a failed read', async () => {
    const db = fakeDb({}, [], { failing: ['content_drafts'] });
    await expect(categoryGuideMissing('b1', category, { db })).rejects.toThrow('content_drafts');
  });
});

describe('categoryPageFor', () => {
  const tables = {
    catalog_product_categories: [{ brand_id: 'b1', category_id: 'c1', product_id: 'p1' }],
    catalog_products: [{ id: 'p1', brand_id: 'b1', removed_at: null }],
    catalog_variants: [],
    content_drafts: [],
  };
  const live = () => {
    links.topics = [{ id: 't1', categories: [{ id: 'c1', name: 'Coffee > Cold Brew' }] }];
    links.pages = [
      { name: 'Coffee > Cold Brew', inStock: 12, page: { url: 'https://shop.example/c/cb' } },
    ];
  };

  it('says whether a live category page is missing its buying guide', async () => {
    live();
    expect(await categoryPageFor('b1', ['t1'], { db: fakeDb(tables) })).toEqual({
      category: {
        id: 'c1',
        name: 'Coffee > Cold Brew',
        url: 'https://shop.example/c/cb',
        inStock: 12,
      },
      products: ['p1'],
      guideMissing: true,
    });
    const covered = fakeDb({
      ...tables,
      content_drafts: [{ brand_id: 'b1', archived_at: null, title: 'Best cold brew makers' }],
    });
    expect((await categoryPageFor('b1', ['t1'], { db: covered })).guideMissing).toBe(false);
  });

  it("goes ahead with the page's play when the drafts can't be read", async () => {
    live();
    const db = fakeDb(tables, [], { failing: ['content_drafts'] });
    expect(await categoryPageFor('b1', ['t1'], { db })).toMatchObject({
      category: { url: 'https://shop.example/c/cb' },
      products: ['p1'],
      guideMissing: false,
    });
  });

  it("doesn't look for one without a live page: that play is the buying guide", async () => {
    links.topics = [{ id: 't1', categories: [{ id: 'c1', name: 'Coffee > Cold Brew' }] }];
    links.pages = [{ name: 'Coffee > Cold Brew', inStock: 12, page: null }];
    const db = fakeDb(tables);
    expect(await categoryPageFor('b1', ['t1'], { db })).toMatchObject({
      category: { url: null },
      guideMissing: false,
    });
    expect(db.reads).not.toContain('content_drafts');
  });
});

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

  describe('a buying guide next to a live category page', () => {
    const coffee = { name: 'Coffee', url: 'https://shop.example/c/coffee', inStock: 30 };
    const prompts = [
      { id: 'a', intent: 'best-top', volume: 600 },
      { id: 'b', intent: 'how-to', volume: 300 },
      { id: 'c', intent: 'vs-review', volume: 100 },
    ];
    const guide = {
      id: 'buying_guide',
      assetType: 'buying_guide',
      kind: 'category',
      category: 'Coffee',
      linkTo: 'https://shop.example/c/coffee',
    };

    it('is also worth doing first when the category has no guide, linking the page', () => {
      const play = categoryPagePlay({
        siteType: 'ecommerce',
        category: coffee,
        prompts,
        guideMissing: true,
      });
      // The page is still the play: optimized, as before.
      expect(play).toMatchObject({ id: 'category_page', reasons: [{ page: coffee.url }] });
      expect(play.supporting).toEqual([guide, expect.objectContaining({ id: 'best_of' })]);
      expect(play.supporting).toHaveLength(MAX_SUPPORTING);
    });

    it('is not when a guide covers the category', () => {
      const play = categoryPagePlay({ siteType: 'ecommerce', category: coffee, prompts });
      expect(play.supporting.map((option) => option.id)).toEqual(['best_of', 'guide']);
    });

    it('is not without a live page, where the play itself is the guide (EC-1), so never twice', () => {
      const play = categoryPagePlay({
        siteType: 'ecommerce',
        category: { ...coffee, url: null },
        prompts,
        guideMissing: true,
      });
      expect(play.id).toBe('buying_guide');
      expect(play.supporting.filter((option) => option.id === 'buying_guide')).toEqual([]);
    });
  });
});
