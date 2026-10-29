import { beforeEach, describe, expect, it, vi } from 'vitest';

// The admin client exits at import time if the test has no Supabase environment.
vi.mock('../../config/supabase.js', () => ({ default: {} }));

import { fakeDb } from './__fixtures__/fake-db.js';
import { syncCatalogOrders } from './orders.js';

const BRAND = 'brand-1';
const SOURCE = 'src_00112233445566778899aabbccddeeff';
const ORDER = {
  external_id: '9001',
  placed_at: '2026-10-20T10:00:00.000Z',
  modified_at: '2026-10-22T09:00:00.000Z',
  status: 'completed',
  channel: 'checkout',
  currency: 'USD',
  total: '250.00',
  refunded_total: 25,
  billing: { first_name: 'PRIVATE BUYER', email: 'private@example.invalid' },
  shipping: { address_1: 'PRIVATE ADDRESS' },
  customer_id: 991,
  items: [
    {
      external_line_id: '11',
      external_product_id: '101',
      external_variation_id: '201',
      quantity: 2,
      revenue: '225.00',
      buyer_note: 'private line data',
    },
  ],
};

let fake;
beforeEach(() => {
  fake = fakeDb();
});

describe('syncCatalogOrders', () => {
  it('stores only allowlisted order and line-item fields, including refunds', async () => {
    const counts = await syncCatalogOrders(BRAND, SOURCE, [ORDER], { db: fake.db });

    expect(counts).toEqual({
      added: 1,
      changed: 0,
      unchanged: 0,
      skipped: 0,
      items: 1,
    });
    expect(fake.rows('catalog_orders')).toHaveLength(1);
    expect(fake.rows('catalog_orders')[0]).toMatchObject({
      brand_id: BRAND,
      source: SOURCE,
      external_id: '9001',
      status: 'completed',
      channel: 'checkout',
      currency: 'USD',
      total: 250,
      refunded_total: 25,
    });
    expect(fake.rows('catalog_orders')[0]).not.toHaveProperty('billing');
    expect(fake.rows('catalog_orders')[0]).not.toHaveProperty('shipping');
    expect(fake.rows('catalog_orders')[0]).not.toHaveProperty('customer_id');
    expect(fake.rows('catalog_order_items')).toHaveLength(1);
    expect(fake.rows('catalog_order_items')[0]).toMatchObject({
      external_line_id: '11',
      external_product_id: '101',
      external_variation_id: '201',
      quantity: 2,
      revenue: 225,
    });
    expect(fake.rows('catalog_order_items')[0]).not.toHaveProperty('buyer_note');
    const stored = JSON.stringify([
      ...fake.rows('catalog_orders'),
      ...fake.rows('catalog_order_items'),
    ]);
    for (const privateValue of [
      'PRIVATE BUYER',
      'private@example.invalid',
      'PRIVATE ADDRESS',
      'private line data',
    ]) {
      expect(stored).not.toContain(privateValue);
    }
  });

  it('is idempotent for unchanged orders and replaces line items when an order changes', async () => {
    await syncCatalogOrders(BRAND, SOURCE, [ORDER], { db: fake.db });
    fake.writes.length = 0;

    const unchanged = await syncCatalogOrders(BRAND, SOURCE, [ORDER], { db: fake.db });
    expect(unchanged).toMatchObject({ added: 0, changed: 0, unchanged: 1 });
    expect(fake.writes).toEqual([]);

    const changed = await syncCatalogOrders(
      BRAND,
      SOURCE,
      [
        {
          ...ORDER,
          total: '275.00',
          refunded_total: '0.00',
          items: [{ ...ORDER.items[0], revenue: '250.00', quantity: 1 }],
        },
      ],
      { db: fake.db },
    );
    expect(changed).toMatchObject({ added: 0, changed: 1, unchanged: 0, items: 1 });
    expect(fake.rows('catalog_orders')).toHaveLength(1);
    expect(fake.rows('catalog_orders')[0].total).toBe(275);
    expect(fake.rows('catalog_order_items')).toHaveLength(1);
    expect(fake.rows('catalog_order_items')[0]).toMatchObject({ quantity: 1, revenue: 250 });
  });

  it('skips orders without a valid id/date and drops malformed line items', async () => {
    const counts = await syncCatalogOrders(
      BRAND,
      SOURCE,
      [
        { ...ORDER, external_id: '', placed_at: '2026-10-20T10:00:00Z' },
        { ...ORDER, external_id: '9002', placed_at: 'not-a-date' },
        {
          ...ORDER,
          external_id: '9003',
          items: [{ external_line_id: '', external_product_id: 'p', quantity: 1, revenue: 1 }],
        },
      ],
      { db: fake.db },
    );
    expect(counts).toMatchObject({ added: 1, skipped: 2, items: 0 });
    expect(fake.rows('catalog_orders')).toHaveLength(1);
    expect(fake.rows('catalog_order_items')).toEqual([]);
  });
});
