import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * The catalog over MCP (B6a): its sources and last syncs, and a page of its
 * products as Product Visibility reads them, each with its readiness, its
 * Merchant Center issues and its page's AI visits and orders.
 */

const brandInOrg = vi.hoisted(() => vi.fn());
vi.mock('@/lib/mcp/data', () => ({ brandInOrg }));

const read = vi.hoisted(() => ({
  readCatalogSources: vi.fn(),
  readCatalogProducts: vi.fn(),
}));
vi.mock('@/lib/shopping/catalog-read', () => read);

/** What each table answers, and the filters asked. */
let tables: Record<string, Record<string, unknown>[]>;
let counts: Record<string, number>;
const filters: [string, string, unknown][] = [];
let stats: Record<string, unknown>[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => (filters.push([table, column, value]), chain),
        is: () => chain,
        in: (column: string, values: unknown[]) => (filters.push([table, column, values]), chain),
        ilike: (column: string, value: unknown) => (filters.push([table, column, value]), chain),
        order: () => chain,
        range: async () => ({ data: tables[table] ?? [], count: counts[table] ?? 0, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: tables[table] ?? [], count: counts[table] ?? 0, error: null }),
      };
      return chain;
    },
    rpc: () => ({
      order: () => ({ range: async () => ({ data: stats, error: null }) }),
    }),
  },
}));

const { getCatalogSourcesFor, listCatalogProductsFor } = await import('./catalog');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
};

const product = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Boots ${id}`,
  url: `https://acme.example/p/${id}`,
  productType: 'Boots',
  brand: 'Acme',
  description: `Boots for the trail, waterproof and light. ${'They keep feet dry and warm on long walks. '.repeat(10)}`,
  image: 'https://acme.example/i.jpg',
  category: 'Shoes > Boots',
  price: 120,
  currency: 'USD',
  inStock: true,
  hasGtin: true,
  ...over,
});

beforeEach(() => {
  brandInOrg.mockReset().mockResolvedValue(true);
  read.readCatalogSources.mockReset();
  read.readCatalogProducts.mockReset();
  tables = {};
  counts = {};
  filters.length = 0;
  stats = [];
});

describe('getCatalogSourcesFor', () => {
  it("gives each source and its last sync in the MCP's names", async () => {
    read.readCatalogSources.mockResolvedValue([
      {
        id: 's1',
        kind: 'merchant_center',
        format: 'auto',
        url: null,
        account: '123456',
        label: 'Acme',
        lastSyncedAt: '2026-10-28T03:00:00Z',
        lastStatus: 'ok',
        lastError: null,
        lastCounts: { format: 'merchant_center', items: 40, skipped: 0 },
        products: 38,
      },
    ]);
    expect(await getCatalogSourcesFor(auth, 'brand-1')).toEqual([
      {
        id: 's1',
        kind: 'merchant_center',
        format: 'auto',
        url: null,
        account: '123456',
        label: 'Acme',
        last_synced_at: '2026-10-28T03:00:00Z',
        last_status: 'ok',
        last_error: null,
        last_counts: { format: 'merchant_center', items: 40, skipped: 0 },
        products: 38,
      },
    ]);
  });

  it("answers null for another organization's brand, without reading it", async () => {
    brandInOrg.mockResolvedValue(false);
    expect(await getCatalogSourcesFor(auth, 'brand-2')).toBeNull();
    expect(read.readCatalogSources).not.toHaveBeenCalled();
  });
});

describe('listCatalogProductsFor', () => {
  it('reads a page of products as Product Visibility does, with readiness, issues and AI stats', async () => {
    tables.catalog_products = [{ id: 'p1' }, { id: 'p2' }];
    counts.catalog_products = 5;
    counts.catalog_sources = 1;
    tables.catalog_variants = [
      { product_id: 'p1', external_id: 'offer-1' },
      { product_id: 'p2', external_id: 'offer-2' },
    ];
    tables.catalog_item_issues = [
      { external_id: 'offer-2', severity: 'disapproved' },
      { external_id: 'offer-2', severity: 'demoted' },
    ];
    stats = [{ product_id: 'p1', ai_visits: 12, orders: 2, revenue: 240, currency: 'USD' }];
    // The catalog reads them in its own order; the page keeps the title order.
    read.readCatalogProducts.mockResolvedValue([
      product('p2', { hasGtin: false, inStock: false }),
      product('p1'),
    ]);

    const page = (await listCatalogProductsFor(auth, {
      brandId: 'brand-1',
      search: '50%_off',
      limit: 2,
    }))!;

    expect(read.readCatalogProducts).toHaveBeenCalledWith(expect.anything(), 'brand-1', [
      'p1',
      'p2',
    ]);
    // A search's own % and _ stay themselves.
    expect(filters).toContainEqual(['catalog_products', 'title', '%50\\%\\_off%']);
    expect(page.total).toBe(5);
    expect(page.next_offset).toBe(2);
    expect(page.products.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(page.products[0]).toMatchObject({
      title: 'Boots p1',
      readiness: { score: 100, missing: [] },
      merchant_center_issues: { disapproved: 0, demoted: 0, not_impacted: 0 },
      ai_visits_30d: 12,
      orders_30d: 2,
      revenue_30d: 240,
      revenue_currency: 'USD',
    });
    expect(page.products[1]).toMatchObject({
      in_stock: false,
      has_gtin: false,
      readiness: { missing: ['gtin', 'inStock'] },
      merchant_center_issues: { disapproved: 1, demoted: 1, not_impacted: 0 },
      ai_visits_30d: 0,
      orders_30d: 0,
      revenue_30d: null,
    });
  });

  it('gives no Merchant Center issues to a brand without Merchant Center', async () => {
    tables.catalog_products = [{ id: 'p1' }];
    counts.catalog_products = 1;
    counts.catalog_sources = 0;
    read.readCatalogProducts.mockResolvedValue([product('p1')]);
    const page = (await listCatalogProductsFor(auth, { brandId: 'brand-1' }))!;
    expect(page.products[0].merchant_center_issues).toBeNull();
    expect(page.next_offset).toBeNull();
  });

  it('answers an empty page past the end, and null for another organization', async () => {
    counts.catalog_products = 3;
    expect(await listCatalogProductsFor(auth, { brandId: 'brand-1', offset: 10 })).toEqual({
      total: 3,
      products: [],
      next_offset: null,
    });
    expect(read.readCatalogProducts).not.toHaveBeenCalled();
    brandInOrg.mockResolvedValue(false);
    expect(await listCatalogProductsFor(auth, { brandId: 'brand-2' })).toBeNull();
  });
});
