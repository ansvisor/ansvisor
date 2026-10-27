import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The Products table's read (ECOM-007): the catalog, its cards on the shelves and its AI visits and orders. */

const BRAND = '33333333-3333-3333-3333-333333333333';

let tables: Record<string, Record<string, unknown>[]>;
let catalogCount: number;
let stats: Record<string, unknown>[];
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
const cardFilters: Record<string, unknown>[] = [];

function query(table: string) {
  const state: {
    eq: Record<string, unknown>;
    not: string[];
    head?: boolean;
    range?: [number, number];
  } = {
    eq: {},
    not: [],
  };
  const q = {
    select: (_columns: string, opts?: { head?: boolean }) => ((state.head = opts?.head), q),
    eq: (column: string, value: unknown) => ((state.eq[column] = value), q),
    not: (column: string) => (state.not.push(column), q),
    is: () => q,
    in: () => q,
    gte: () => q,
    lte: () => q,
    or: () => q,
    order: () => q,
    range: (from: number, to: number) => ((state.range = [from, to]), q),
    then: (resolve: (value: unknown) => void) => {
      if (state.head) return resolve({ data: null, count: catalogCount, error: null });
      if (table === 'prompt_result_shopping_cards')
        cardFilters.push({ ...state.eq, not: state.not });
      const [from, to] = state.range ?? [0, 999];
      resolve({ data: (tables[table] ?? []).slice(from, to + 1), error: null });
    },
  };
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: query,
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: stats, error: null };
    },
  })),
}));

const { getShoppingProducts } = await import('./shopping');

beforeEach(() => {
  tables = {};
  stats = [];
  catalogCount = 0;
  rpcCalls.length = 0;
  cardFilters.length = 0;
  vi.useFakeTimers({ now: new Date('2026-10-27T12:00:00Z'), toFake: ['Date'] });
});

describe('getShoppingProducts', () => {
  it('reads no catalog as none', async () => {
    expect(await getShoppingProducts(BRAND, { datePreset: '30d' })).toBeNull();
  });

  it("joins each product's variants, first photo, category, shelves and AI visits and orders", async () => {
    catalogCount = 2;
    tables.catalog_products = [
      {
        id: 'p1',
        title: 'Trail Runner X',
        url: null,
        product_type: 'Shoes',
        product_brand: 'Northwind',
        description: null,
      },
      {
        id: 'p2',
        title: 'Ridge 30L',
        url: null,
        product_type: null,
        product_brand: null,
        description: null,
      },
    ];
    tables.catalog_variants = [
      {
        product_id: 'p1',
        gtin: null,
        price: 149,
        sale_price: 129,
        currency: 'USD',
        availability: 'In Stock',
      },
      {
        product_id: 'p1',
        gtin: '0012345678905',
        price: 99,
        sale_price: null,
        currency: 'USD',
        availability: 'out of stock',
      },
      {
        product_id: 'p2',
        gtin: null,
        price: 119,
        sale_price: null,
        currency: 'USD',
        availability: 'out_of_stock',
      },
    ];
    tables.catalog_images = [
      { product_id: 'p1', url: 'https://cdn.example/b.jpg', position: 2 },
      { product_id: 'p1', url: 'https://cdn.example/a.jpg', position: 0 },
    ];
    tables.catalog_product_categories = [
      { product_id: 'p1', category: { name: 'Shoes > Trail running' } },
      { product_id: 'p1', category: { name: 'Sale' } },
    ];
    tables.prompt_result_shopping_cards = [
      {
        catalog_product_id: 'p1',
        position: 0,
        platform: 'chatgpt-shopping',
        prompt_results: { prompt_id: 'q1' },
      },
      {
        catalog_product_id: 'p1',
        position: 2,
        platform: 'copilot-web',
        prompt_results: { prompt_id: 'q1' },
      },
    ];
    stats = [{ product_id: 'p1', ai_visits: 318, orders: 41, revenue: '5300.00', currency: 'USD' }];

    const read = await getShoppingProducts(BRAND, { datePreset: '30d' });
    expect(read?.total).toBe(2);
    const [p1, p2] = read!.rows;
    // In stock: the in-stock variant's sale price, not the cheaper sold-out one.
    expect(p1.product).toMatchObject({
      image: 'https://cdn.example/a.jpg',
      category: 'Shoes > Trail running',
      price: 129,
      inStock: true,
      hasGtin: true,
    });
    expect(p1).toMatchObject({
      shelves: 2,
      winRate: 0.5,
      avgRank: 2,
      aiVisits: 318,
      orders: 41,
      revenue: 5300,
    });
    expect(p2.product).toMatchObject({ price: 119, inStock: false, image: null, category: null });
    expect(cardFilters[0]).toEqual({
      brand_id: BRAND,
      matched_brand_role: 'own',
      not: ['catalog_product_id'],
    });
    expect(rpcCalls).toEqual([
      {
        name: 'catalog_product_ai_stats',
        args: { p_brand_id: BRAND, p_from: '2026-09-27T12:00:00.000Z' },
      },
    ]);
  });

  it('reads the last 90 days of visits and orders for All time', async () => {
    catalogCount = 1;
    tables.catalog_products = [
      {
        id: 'p1',
        title: 'X',
        url: null,
        product_type: null,
        product_brand: null,
        description: null,
      },
    ];
    await getShoppingProducts(BRAND, { datePreset: 'all' });
    expect(rpcCalls[0].args.p_from).toBe('2026-07-29T12:00:00.000Z');
  });
});
