import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
vi.mock('../config/supabase.js', () => ({ default: {} }));

// The brand's topics and the categories they cover (P-7), set per test.
const topicCategories = vi.hoisted(() => vi.fn());
vi.mock('./catalog/topic-categories.js', () => ({ topicCategories }));

import {
  MAX_CANDIDATES,
  MAX_CATALOG_TOPICS,
  MAX_PRODUCTS,
  MIN_PRODUCTS,
  MIN_TOPIC_IN_STOCK,
  PRODUCT_DAYS,
  catalogCandidates,
  catalogProducts,
  catalogTopics,
  getCatalogProductCandidates,
  getCatalogSuggestionCandidates,
  getCatalogTopicCandidates,
  roundPrice,
  withCategories,
} from './catalog-suggestions.js';

/**
 * A database stub: `rpc` answers by function, `from(table)` by table, each a
 * list of rows or an error; every read is recorded with its filters.
 */
function fakeDb({ rpcs = {}, tables = {} } = {}) {
  const reads = [];
  return {
    reads,
    rpc: vi.fn(async (fn) => {
      const answer = rpcs[fn] ?? [];
      return answer instanceof Error
        ? { data: null, error: { message: answer.message } }
        : { data: answer, error: null };
    }),
    from: vi.fn((table) => {
      const read = { table, filters: [] };
      reads.push(read);
      const chain = {
        select: (columns) => {
          read.columns = columns;
          return chain;
        },
        eq: (...args) => {
          read.filters.push(['eq', ...args]);
          return chain;
        },
        in: (...args) => {
          read.filters.push(['in', ...args]);
          return chain;
        },
        limit: () => chain,
        then: (resolve, reject) => {
          const answer = tables[table] ?? [];
          return Promise.resolve(
            answer instanceof Error
              ? { data: null, error: { code: '42703', message: answer.message } }
              : { data: answer, error: null },
          ).then(resolve, reject);
        },
      };
      return chain;
    }),
  };
}

/** Shopping questions from the brand's catalog (ECOM-003). */

describe('roundPrice', () => {
  it('rounds a price up to one a shopper would name', () => {
    expect([8, 38, 119, 140, 151, 1240, 9000].map(roundPrice)).toEqual([
      10, 40, 150, 150, 200, 1500, 10000,
    ]);
    expect(roundPrice(0)).toBeNull();
    expect(roundPrice(null)).toBeNull();
  });
});

describe('catalogCandidates', () => {
  it("offers the database's categories in its order, with a band where they share a currency", () => {
    expect(
      catalogCandidates([
        {
          category: 'Bags > Hiking backpacks',
          products: 4,
          // PostgREST sends numeric as a number, or as a string when told to.
          price_low: '60.00',
          price_high: 180,
          price_p75: 140,
          currency: 'USD',
        },
        // Two currencies, or none priced: no band.
        {
          category: 'Gift cards',
          products: 2,
          price_low: null,
          price_high: null,
          price_p75: null,
          currency: null,
        },
        {
          category: 'Socks',
          products: 2,
          price_low: null,
          price_high: null,
          price_p75: null,
          currency: 'USD',
        },
      ]),
    ).toEqual([
      {
        category: 'Bags > Hiking backpacks',
        products: 4,
        priceLow: 60,
        priceHigh: 180,
        priceUnder: 150,
        currency: 'USD',
      },
      {
        category: 'Gift cards',
        products: 2,
        priceLow: null,
        priceHigh: null,
        priceUnder: null,
        currency: null,
      },
      {
        category: 'Socks',
        products: 2,
        priceLow: null,
        priceHigh: null,
        priceUnder: null,
        currency: null,
      },
    ]);
  });

  it(`offers ${MAX_CANDIDATES} categories at most`, () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      category: `Cat ${i}`,
      products: 2,
      price_low: null,
      price_high: null,
      price_p75: null,
      currency: null,
    }));
    expect(catalogCandidates(rows)).toHaveLength(MAX_CANDIDATES);
  });
});

describe('getCatalogSuggestionCandidates', () => {
  const boots = {
    category: 'Boots',
    products: 2,
    price_low: 99,
    price_high: 129,
    price_p75: 129,
    currency: 'USD',
  };

  it('asks the database for the categories offered only, then their ids by name', async () => {
    const db = fakeDb({
      rpcs: { catalog_suggestion_categories: [boots] },
      tables: { catalog_categories: [{ id: 'cat-boots', name: 'Boots' }] },
    });
    expect(await getCatalogSuggestionCandidates('brand-1', { db })).toEqual([
      {
        category: 'Boots',
        categoryId: 'cat-boots',
        products: 2,
        priceLow: 99,
        priceHigh: 129,
        priceUnder: 150,
        currency: 'USD',
      },
    ]);
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith('catalog_suggestion_categories', {
      p_brand_id: 'brand-1',
      p_limit: MAX_CANDIDATES,
      p_min_products: MIN_PRODUCTS,
    });
    // Only the offered categories' ids, not the whole catalog.
    expect(db.reads).toEqual([
      expect.objectContaining({
        table: 'catalog_categories',
        filters: [
          ['eq', 'brand_id', 'brand-1'],
          ['in', 'name', ['Boots']],
        ],
      }),
    ]);
  });

  it('keeps the categories when their ids cannot be read', async () => {
    const db = fakeDb({
      rpcs: { catalog_suggestion_categories: [boots] },
      tables: { catalog_categories: new Error('down') },
    });
    expect(await getCatalogSuggestionCandidates('brand-1', { db })).toEqual([
      expect.objectContaining({ category: 'Boots', categoryId: null }),
    ]);
  });

  it('returns nothing for a brand without a catalog, or when it cannot be read', async () => {
    const empty = { rpc: async () => ({ data: [], error: null }) };
    expect(await getCatalogSuggestionCandidates('brand-1', { db: empty })).toEqual([]);
    const missing = {
      rpc: async () => ({ data: null, error: { message: 'Could not find the function' } }),
    };
    expect(await getCatalogSuggestionCandidates('brand-1', { db: missing })).toEqual([]);
    const down = {
      rpc: () => {
        throw new Error('down');
      },
    };
    expect(await getCatalogSuggestionCandidates('brand-1', { db: down })).toEqual([]);
  });
});

describe('catalog_suggestion_categories (00371)', () => {
  const sql = readFileSync(
    new URL(
      '../../../supabase/migrations/00371_catalog_suggestion_categories.sql',
      import.meta.url,
    ),
    'utf8',
  );

  it('prices a live product by its lowest live variant, sale price first, for the service role', () => {
    // The brand's live products, as catalog_products_brand_live_idx (00278) reads them.
    expect(sql).toMatch(
      /join public\.catalog_products p\s+on p\.id = pc\.product_id and p\.brand_id = p_brand_id and p\.removed_at is null/,
    );
    // Its live variants, as catalog_variants_brand_live_idx (00281) reads them.
    expect(sql).toMatch(/where v\.brand_id = p_brand_id\s+and v\.removed_at is null/);
    expect(sql).toMatch(/order by v\.product_id, coalesce\(v\.sale_price, v\.price\), v\.id/);
    // The "under" price: three quarters of the products at or under it.
    expect(sql).toMatch(/percentile_disc\(0\.75\) within group \(order by pr\.amount\)/);
    expect(sql).toMatch(
      /revoke all on function public\.catalog_suggestion_categories\(uuid, integer, integer\)\s+from public, anon, authenticated;/,
    );
  });
});

// ─── Product-level prompts (AC plan P-8) ────────────────────────────────────

/** A product_page_candidates row (00493). */
const productRow = (id, extra = {}) => ({
  product_id: id,
  title: `Product ${id}`,
  url: `https://shop.example/products/${id}`,
  availabilities: ['in stock'],
  prompt_ids: [],
  cards: 0,
  ai_visits: 0,
  orders: 0,
  revenue: null,
  currency: null,
  item_revenue: 0,
  items_purchased: 0,
  ...extra,
});

describe('catalogProducts', () => {
  it('ranks the top-selling and most-carded products in stock, as the product page groups do', () => {
    const products = catalogProducts({
      candidates: [
        productRow('p-sells', { orders: 12 }),
        productRow('p-shown', { prompt_ids: ['q1', 'q2', 'q3'] }),
        productRow('p-gone', { orders: 40, availabilities: ['out of stock'] }),
        productRow('p-quiet'),
      ],
    });
    expect(products).toEqual([
      { productId: 'p-sells', product: 'Product p-sells', cardPrompts: 0, orders: 12, aiVisits: 0 },
      { productId: 'p-shown', product: 'Product p-shown', cardPrompts: 3, orders: 0, aiVisits: 0 },
    ]);
  });

  it('leaves out a product a tracked prompt is about or names', () => {
    const products = catalogProducts({
      candidates: [
        productRow('p-1', { title: 'Atmos AG 65', orders: 9 }),
        productRow('p-2', { title: 'Exos 48', orders: 8 }),
        productRow('p-3', { title: 'Talon 22', orders: 7 }),
      ],
      trackedIds: new Set(['p-2']),
      trackedTexts: ['Is the ATMOS AG-65 good for long hikes?'],
    });
    expect(products.map((p) => p.productId)).toEqual(['p-3']);
  });

  it(`offers ${MAX_PRODUCTS} products at most`, () => {
    const candidates = Array.from({ length: 9 }, (_, i) => productRow(`p-${i}`, { orders: 9 - i }));
    expect(catalogProducts({ candidates })).toHaveLength(MAX_PRODUCTS);
  });
});

describe('withCategories', () => {
  it('gives each product its type and its most specific category', () => {
    const [product] = withCategories(
      [{ productId: 'p-1', product: 'Atmos AG 65', cardPrompts: 2, orders: 1, aiVisits: 0 }],
      {
        types: new Map([['p-1', 'Backpack']]),
        links: [
          { product_id: 'p-1', category_id: 'c-bags' },
          { product_id: 'p-1', category_id: 'c-hiking' },
        ],
        categories: new Map([
          ['c-bags', 'Bags'],
          ['c-hiking', 'Bags > Hiking backpacks'],
        ]),
      },
    );
    expect(product).toMatchObject({
      productType: 'Backpack',
      category: 'Bags > Hiking backpacks',
      categoryId: 'c-hiking',
    });
    expect(withCategories([{ productId: 'p-2' }], {})[0]).toMatchObject({
      productType: null,
      category: null,
      categoryId: null,
    });
  });
});

describe('getCatalogProductCandidates', () => {
  const now = new Date('2026-11-09T12:00:00Z');

  it('reads the products of the last 30 days and the ones the brand already tracks', async () => {
    const db = fakeDb({
      rpcs: {
        product_page_candidates: [
          productRow('p-1', { title: 'Atmos AG 65', orders: 9 }),
          productRow('p-2', { title: 'Exos 48', orders: 8 }),
        ],
      },
      tables: {
        prompts: [{ source_data: { kind: 'catalog_product', product_ids: ['p-2'] } }],
        catalog_products: [{ id: 'p-1', product_type: 'Backpack' }],
        catalog_product_categories: [{ product_id: 'p-1', category_id: 'c-hiking' }],
        catalog_categories: [{ id: 'c-hiking', name: 'Bags > Hiking backpacks' }],
      },
    });
    expect(await getCatalogProductCandidates('brand-1', { db, now })).toEqual([
      {
        productId: 'p-1',
        product: 'Atmos AG 65',
        productType: 'Backpack',
        category: 'Bags > Hiking backpacks',
        categoryId: 'c-hiking',
        cardPrompts: 0,
        orders: 9,
        aiVisits: 0,
      },
    ]);
    expect(db.rpc).toHaveBeenCalledWith('product_page_candidates', {
      p_brand_id: 'brand-1',
      p_from: new Date(now.getTime() - PRODUCT_DAYS * 86_400_000).toISOString(),
    });
    // The products a prompt was accepted for (prompts.source_data, 00496).
    expect(db.reads[0]).toMatchObject({
      table: 'prompts',
      filters: [
        ['eq', 'prompt_sets.brand_id', 'brand-1'],
        ['eq', 'source_data->>kind', 'catalog_product'],
      ],
    });
  });

  it('still offers products on a database without prompts.source_data', async () => {
    const db = fakeDb({
      rpcs: { product_page_candidates: [productRow('p-1', { orders: 3 })] },
      tables: { prompts: new Error('column prompts.source_data does not exist') },
    });
    expect(
      (await getCatalogProductCandidates('brand-1', { db, now })).map((p) => p.productId),
    ).toEqual(['p-1']);
  });

  it('returns nothing for a brand without a catalog or any sign a product sells, or when it cannot be read', async () => {
    const empty = fakeDb();
    expect(await getCatalogProductCandidates('brand-1', { db: empty, now })).toEqual([]);
    expect(empty.from).not.toHaveBeenCalled();
    const down = fakeDb({ rpcs: { product_page_candidates: new Error('down') } });
    expect(await getCatalogProductCandidates('brand-1', { db: down, now })).toEqual([]);
  });
});

// ─── Category → topic (AC plan P-8) ─────────────────────────────────────────

describe('catalogTopics', () => {
  const categories = [
    { id: 'c-packs', name: 'Bags > Hiking backpacks' },
    { id: 'c-tents', name: 'Camping > Tents' },
    { id: 'c-socks', name: 'Clothing > Socks' },
    { id: 'c-stoves', name: 'Camping > Stoves' },
  ];
  const counts = [
    { category: 'Bags > Hiking backpacks', products: 20, in_stock: 12 },
    { category: 'Camping > Tents', products: 9, in_stock: 7 },
    { category: 'Clothing > Socks', products: 4, in_stock: MIN_TOPIC_IN_STOCK - 1 },
    { category: 'Camping > Stoves', products: 6, in_stock: 5 },
  ];

  it('suggests a category with products in stock that no topic covers, by its own name', () => {
    expect(
      catalogTopics({
        counts,
        categories,
        // "Hiking backpacks" already has a topic linked to it.
        topics: [{ id: 't-packs', name: 'Hiking packs', categories: [{ id: 'c-packs' }] }],
      }),
    ).toEqual([
      {
        name: 'Tents',
        category: 'Camping > Tents',
        categoryId: 'c-tents',
        products: 9,
        inStock: 7,
      },
      {
        name: 'Stoves',
        category: 'Camping > Stoves',
        categoryId: 'c-stoves',
        products: 6,
        inStock: 5,
      },
    ]);
  });

  it('never suggests a name a topic or a decided suggestion already has', () => {
    const names = catalogTopics({
      counts,
      categories,
      topics: [],
      takenNames: [' tents', 'STOVES'],
    });
    expect(names.map((t) => t.name)).toEqual(['Hiking backpacks']);
  });

  it(`suggests ${MAX_CATALOG_TOPICS} at most, the most in stock first`, () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `c-${i}`, name: `Shop > Kind ${i}` }));
    const topics = catalogTopics({
      counts: many.map((c, i) => ({ category: c.name, products: 10, in_stock: 3 + i })),
      categories: many,
      topics: [],
    });
    expect(topics.map((t) => t.name)).toEqual(['Kind 7', 'Kind 6', 'Kind 5', 'Kind 4', 'Kind 3']);
  });
});

describe('getCatalogTopicCandidates', () => {
  beforeEach(() => topicCategories.mockReset());

  it('reads the topics only once a category has enough in stock', async () => {
    const db = fakeDb({
      rpcs: { catalog_category_counts: [{ category: 'Socks', products: 4, in_stock: 1 }] },
    });
    expect(await getCatalogTopicCandidates('brand-1', { db })).toEqual([]);
    expect(topicCategories).not.toHaveBeenCalled();
  });

  it("suggests the categories none of the brand's topics covers", async () => {
    topicCategories.mockResolvedValueOnce({
      topics: [{ id: 't-1', name: 'Tents', categories: [] }],
      categories: [
        { id: 'c-tents', name: 'Camping > Tents' },
        { id: 'c-stoves', name: 'Camping > Stoves' },
      ],
    });
    const db = fakeDb({
      rpcs: {
        catalog_category_counts: [
          { category: 'Camping > Tents', products: 9, in_stock: 7 },
          { category: 'Camping > Stoves', products: 6, in_stock: 5 },
        ],
      },
    });
    // A topic named "Tents" exists (its link aside): only Stoves.
    expect((await getCatalogTopicCandidates('brand-1', { db })).map((t) => t.name)).toEqual([
      'Stoves',
    ]);
    expect(topicCategories).toHaveBeenCalledWith('brand-1', { db });
  });

  it('returns nothing for a brand without a catalog, or when it cannot be read', async () => {
    expect(await getCatalogTopicCandidates('brand-1', { db: fakeDb() })).toEqual([]);
    const down = fakeDb({ rpcs: { catalog_category_counts: new Error('down') } });
    expect(await getCatalogTopicCandidates('brand-1', { db: down })).toEqual([]);
  });
});

describe('prompts.source_data (00496)', () => {
  const sql = readFileSync(
    new URL('../../../supabase/migrations/00496_prompt_source_data.sql', import.meta.url),
    'utf8',
  );

  it('is an object of one of the two catalog kinds, a few kilobytes at most', () => {
    expect(sql).toMatch(
      /alter table public\.prompts\s+add column if not exists source_data jsonb;/,
    );
    expect(sql).toMatch(/jsonb_typeof\(source_data\) = 'object'/);
    expect(sql).toMatch(/octet_length\(source_data::text\) <= 4096/);
    // A check passes on null: a missing kind or product list must read as no.
    expect(sql).toMatch(
      /coalesce\(source_data->>'kind', ''\) in \('catalog_category', 'catalog_product'\)/,
    );
    expect(sql).toMatch(/coalesce\(jsonb_typeof\(source_data->'product_ids'\), ''\) = 'array'/);
  });

  it("checks a topic suggestion's category the same way, and adds no policy", () => {
    expect(sql).toMatch(
      /alter table public\.topic_suggestions\s+add column if not exists source_data jsonb;/,
    );
    expect(sql).toMatch(/topic_suggestions_source_data_check/);
    // The prompts' and topic suggestions' own rules (00001, 00382) stay as they are.
    expect(sql).not.toMatch(/create policy|grant /i);
  });
});
