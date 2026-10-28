import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A product's page read (ECOM-011). */

const BRAND = '33333333-3333-3333-3333-333333333333';
const PRODUCT = '11111111-0000-0000-0000-000000000001';

let tables: Record<string, Record<string, unknown>[]>;
let rpcArgs: Record<string, unknown>[];
// The id lists the catalog reads filtered by, as [table, column, the ids].
let byIds: [string, string, unknown[]][];

function query(table: string) {
  let range: [number, number] | undefined;
  let single = false;
  const q = {
    select: () => q,
    eq: () => q,
    is: () => q,
    in: (column: string, values: unknown[]) => (byIds.push([table, column, values]), q),
    not: () => q,
    gte: () => q,
    lte: () => q,
    or: () => q,
    order: () => q,
    maybeSingle: () => ((single = true), q),
    range: (from: number, to: number) => ((range = [from, to]), q),
    then: (resolve: (value: unknown) => void) => {
      const rows = tables[table] ?? [];
      if (single) return resolve({ data: rows[0] ?? null, error: null });
      const [from, to] = range ?? [0, 999];
      resolve({ data: rows.slice(from, to + 1), error: null });
    },
  };
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: query,
    rpc: async (_name: string, args: Record<string, unknown>) => {
      rpcArgs.push(args);
      return {
        data: [{ product_id: PRODUCT, ai_visits: 4, orders: 0, revenue: null, currency: null }],
        error: null,
      };
    },
  })),
}));

const { getShoppingProductDetail } = await import('./shopping');

beforeEach(() => {
  tables = {};
  rpcArgs = [];
  byIds = [];
});

const card = (over: Record<string, unknown>) => ({
  prompt_result_id: 'r1',
  position: 0,
  created_at: '2026-10-27T08:00:00Z',
  platform: 'chatgpt-shopping',
  product_title: 'Summit Daypack 30 W Hiking Backpack',
  price_amount: 110,
  price_currency: 'USD',
  rating: 4.8,
  review_count: 2140,
  merchant_domain: 'summitgear.example',
  image_url: null,
  matched_brand_role: 'competitor',
  catalog_product_id: null,
  prompt_results: {
    search_queries: [{ query: 'women hiking backpack' }],
    prompt: { id: 'q1', text: 'lightweight 30L hiking backpack for women' },
  },
  ...over,
});

describe('getShoppingProductDetail', () => {
  it("refuses ids that aren't ids, and reads a product not in the catalog as none", async () => {
    await expect(getShoppingProductDetail(BRAND, 'nope', { datePreset: '30d' })).rejects.toThrow(
      'invalid',
    );
    expect(await getShoppingProductDetail(BRAND, PRODUCT, { datePreset: '30d' })).toBeNull();
  });

  it('explains the shelf it misses beside its winner, with its rating as the answers showed it', async () => {
    tables.catalog_products = [
      {
        id: PRODUCT,
        title: 'Ridge 30L Backpack',
        url: null,
        product_type: 'Backpacks',
        product_brand: 'Northwind',
        description: null,
      },
    ];
    tables.catalog_product_categories = [
      { product_id: PRODUCT, category: { name: 'Hiking backpacks' } },
    ];
    tables.brand_domains = [{ domain: 'northwind.example' }];
    tables.prompt_result_shopping_cards = [
      card({}),
      card({
        prompt_result_id: 'r0',
        created_at: '2026-10-20T08:00:00Z',
        product_title: 'Ridge 30L Backpack',
        matched_brand_role: 'own',
        catalog_product_id: PRODUCT,
        rating: 4.5,
        review_count: 86,
      }),
    ];
    const detail = await getShoppingProductDetail(BRAND, PRODUCT, { datePreset: '30d' });
    expect(detail?.focus).toMatchObject({
      promptId: 'q1',
      rank: null,
      winner: { title: 'Summit Daypack 30 W Hiking Backpack' },
    });
    expect(detail?.comparison.find((row) => row.key === 'rating')).toMatchObject({
      you: '4.5 · 86',
      winner: '4.8 · 2,140',
      state: 'weaker',
    });
    expect(detail?.comparison.find((row) => row.key === 'merchant')).toMatchObject({
      you: 'northwind.example',
      winner: 'summitgear.example',
    });
    expect(detail?.ai).toEqual({ visits: 4, orders: 0, revenue: null, currency: null });
    // Only this product: its catalog rows, and its own AI visits and orders.
    expect(byIds.filter(([table]) => table.startsWith('catalog_'))).toEqual([
      ['catalog_products', 'id', [PRODUCT]],
      ['catalog_variants', 'product_id', [PRODUCT]],
      ['catalog_images', 'product_id', [PRODUCT]],
      ['catalog_product_categories', 'product_id', [PRODUCT]],
    ]);
    expect(rpcArgs).toEqual([
      { p_brand_id: BRAND, p_from: expect.any(String), p_product_id: PRODUCT },
    ]);
  });
});
