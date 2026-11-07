import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The product pages family (AC plan P-6, spec §6.1): on an online store
 * only, its candidates read (product_page_candidates, 00493), the products
 * chosen (product-page-groups.js), and one signal written with them.
 */

const db = vi.hoisted(() => ({ rpc: vi.fn(), brand: null, drafts: [], calls: [] }));

vi.mock('../../../config/supabase.js', () => ({
  default: {
    rpc: (...args) => db.rpc(...args),
    from: (table) => {
      const call = { table, filters: [] };
      db.calls.push(call);
      const chain = {
        select: () => chain,
        eq: (col, value) => (call.filters.push(['eq', col, value]), chain),
        in: (col, value) => (call.filters.push(['in', col, value]), chain),
        gte: (col, value) => (call.filters.push(['gte', col, value]), chain),
        not: (col, op, value) => (call.filters.push(['not', col, op, value]), chain),
        order: () => chain,
        maybeSingle: async () => ({ data: db.brand, error: null }),
        range: async () => ({ data: db.drafts, error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('../../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { LIBRARY_FAMILIES } = await import('./detect.js');

const NOW = new Date('2026-11-07T05:00:00Z');
const SHOP = 'https://shop.example';
const family = LIBRARY_FAMILIES.find((f) => f.name === 'productPages');
const run = () =>
  family.run({
    brandId: 'b1',
    now: NOW,
    prompts: async () => [
      { prompt_id: 'q1', volume: 900 },
      { prompt_id: 'q2', volume: null },
    ],
  });

beforeEach(() => {
  db.calls = [];
  db.brand = { site_type: 'ecommerce', industry: null, shopping_mode_enabled: true };
  db.drafts = [{ source_url: `${SHOP}/products/scale` }];
  db.rpc.mockReset().mockResolvedValue({
    data: [
      {
        product_id: 'p-kettle',
        title: 'Gooseneck kettle',
        url: `${SHOP}/products/kettle`,
        availabilities: ['in_stock'],
        prompt_ids: ['q1', 'q2'],
        cards: 4,
        ai_visits: 12,
        orders: 1,
        revenue: 89,
        currency: 'USD',
        item_revenue: 0,
        items_purchased: 0,
      },
      {
        product_id: 'p-scale',
        title: 'Coffee scale',
        url: `${SHOP}/products/scale`,
        availabilities: ['in_stock'],
        prompt_ids: ['q2'],
        cards: 1,
        ai_visits: 0,
        orders: 0,
        revenue: null,
        currency: null,
        item_revenue: 0,
        items_purchased: 0,
      },
    ],
    error: null,
  });
});

describe('the product pages family', () => {
  it('reads the candidates of the last 30 days, and the pages optimized since', async () => {
    await run();
    expect(db.rpc).toHaveBeenCalledWith('product_page_candidates', {
      p_brand_id: 'b1',
      p_from: '2026-10-08T05:00:00.000Z',
    });
    const drafts = db.calls.find((call) => call.table === 'content_drafts');
    expect(drafts.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'method', 'optimize'],
        ['in', 'status', ['ready', 'published']],
        ['gte', 'updated_at', '2026-10-08T05:00:00.000Z'],
      ]),
    );
  });

  it('writes one signal with the products, a page optimized lately left out', async () => {
    const [found, ...rest] = await run();
    expect(rest).toEqual([]);
    expect(found).toMatchObject({
      kind: 'product_pages_to_optimize',
      dedupKey: 'product_pages_to_optimize',
      currentValue: 1,
      payload: {
        entity: 'pages',
        targets: [
          {
            id: `${SHOP}/products/kettle`,
            label: 'Gooseneck kettle',
            productId: 'p-kettle',
            prompts: 2,
            volume: 900,
            aiVisits: 12,
            orders: 1,
            revenue: 89,
            currency: 'USD',
          },
        ],
      },
    });
  });

  it('reads nothing on a site that isn’t a store, and writes nothing without a product', async () => {
    db.brand = { site_type: 'b2b' };
    expect(await run()).toEqual([]);
    expect(db.rpc).not.toHaveBeenCalled();

    db.brand = { site_type: 'ecommerce' };
    db.rpc.mockResolvedValue({ data: [], error: null });
    expect(await run()).toEqual([]);
  });
});
