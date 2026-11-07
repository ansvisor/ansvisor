import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROUP_SIZE,
  MAX_GROUP_PRODUCTS,
  chooseProductPages,
  productInStock,
} from './product-page-groups.js';
import productPages from './definitions/g21-optimize-product-pages.js';

/**
 * Product pages to optimize (AC plan P-6, spec §6.1): an online store's
 * products, best first, by the prompts whose shopping cards show them and
 * their demand, by sales and AI visits; in stock, with a page, not
 * optimized lately.
 */

const SHOP = 'https://shop.example';
const candidate = (slug, over = {}) => ({
  product_id: `p-${slug}`,
  title: `Product ${slug}`,
  url: `${SHOP}/products/${slug}`,
  availabilities: ['in_stock'],
  prompt_ids: [],
  cards: 0,
  ai_visits: 0,
  orders: 0,
  revenue: null,
  currency: null,
  item_revenue: 0,
  items_purchased: 0,
  ...over,
});

describe('productInStock', () => {
  it('reads a product as in stock when a variant is, or when no stock is read', () => {
    expect(productInStock(['out_of_stock', 'in_stock'])).toBe(true);
    expect(productInStock(['out_of_stock'])).toBe(false);
    expect(productInStock([])).toBe(true);
    expect(productInStock([null, ' '])).toBe(true);
  });
});

describe('chooseProductPages', () => {
  it('puts the products AI shows for the most asked prompts first, then the ones that sell', () => {
    const products = chooseProductPages({
      candidates: [
        candidate('grinder', { orders: 2, revenue: '180.50', currency: 'USD' }),
        candidate('kettle', { prompt_ids: ['q1', 'q2'], cards: 6 }),
        candidate('scale', { prompt_ids: ['q3'], cards: 2, item_revenue: 40, items_purchased: 1 }),
      ],
      volumes: new Map([
        ['q1', 1000],
        ['q2', null],
        ['q3', 50],
      ]),
    });
    expect(products.map((p) => p.productId)).toEqual(['p-kettle', 'p-scale', 'p-grinder']);
    expect(products[0]).toMatchObject({
      title: 'Product kettle',
      url: `${SHOP}/products/kettle`,
      prompts: 2,
      volume: 1000,
      orders: 0,
      revenue: null,
    });
    expect(products[2]).toMatchObject({ orders: 2, revenue: 180.5, currency: 'USD' });
    expect(products[1]).toMatchObject({ orders: 1, itemRevenue: 40 });
  });

  it('leaves out a product out of stock, without a page, optimized lately, or with nothing for it', () => {
    const products = chooseProductPages({
      candidates: [
        candidate('sold-out', { prompt_ids: ['q1'], availabilities: ['out_of_stock'] }),
        candidate('no-page', { prompt_ids: ['q1'], url: null }),
        candidate('done', { prompt_ids: ['q1'], url: `https://www.shop.example/products/done/` }),
        candidate('quiet'),
        candidate('kept', { ai_visits: 3 }),
        // The same page twice (two products on one page): once.
        candidate('kept', { product_id: 'p-twin', ai_visits: 3 }),
      ],
      optimized: new Set(['shop.example/products/done']),
    });
    expect(products.map((p) => p.productId)).toEqual(['p-kept']);
  });

  it('keeps ten products at most', () => {
    const candidates = Array.from({ length: 14 }, (_, i) =>
      candidate(`p${i}`, { ai_visits: i + 1 }),
    );
    const products = chooseProductPages({ candidates });
    expect(products).toHaveLength(MAX_GROUP_PRODUCTS);
    expect(products[0].productId).toBe('p-p13');
  });
});

describe('the product pages definition (G21)', () => {
  const signal = {
    kind: 'product_pages_to_optimize',
    payload: {
      entity: 'pages',
      targets: Array.from({ length: 7 }, (_, i) => ({
        id: `${SHOP}/products/p${i}`,
        label: `Product ${i}`,
        productId: `p-${i}`,
        prompts: 7 - i,
        volume: 100,
        aiVisits: 2,
        orders: 0,
        revenue: null,
        currency: null,
        itemRevenue: 0,
      })),
    },
  };

  it('keeps every product, and works on the first five', () => {
    const payload = productPages.payload(new Map([['product_pages_to_optimize', [signal]]]));
    expect(payload).toMatchObject({
      targetEntity: 'pages',
      targetCount: DEFAULT_GROUP_SIZE,
      groupSize: DEFAULT_GROUP_SIZE,
    });
    expect(payload.pages).toEqual(Array.from({ length: 5 }, (_, i) => `${SHOP}/products/p${i}`));
    expect(payload.targets[0]).toEqual({ id: `${SHOP}/products/p0`, label: 'Product 0' });
    expect(payload.products).toHaveLength(7);
    expect(payload.products[6]).toEqual({
      url: `${SHOP}/products/p6`,
      title: 'Product 6',
      productId: 'p-6',
      prompts: 1,
      volume: 100,
      aiVisits: 2,
      orders: 0,
      revenue: null,
      currency: null,
      itemRevenue: 0,
    });
  });

  it('optimizes the pages in the Content Editor, publishes them and measures them', () => {
    expect(productPages).toMatchObject({
      id: 'product_pages_optimize',
      code: 'G21',
      category: 'growth',
      requires: ['tracking'],
    });
    expect(productPages.tasks[0]).toBe('optimize_content');
  });
});
