import { describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
vi.mock('../config/supabase.js', () => ({ default: {} }));

import { fakeDb } from './catalog/__fixtures__/fake-db.js';
import {
  MAX_CANDIDATES,
  composeCatalogCandidates,
  getCatalogSuggestionCandidates,
  roundPrice,
} from './catalog-suggestions.js';

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

describe('composeCatalogCandidates', () => {
  const categories = [
    { id: 'packs', name: 'Bags > Hiking backpacks' },
    { id: 'socks', name: 'Socks' },
    { id: 'mixed', name: 'Gift cards' },
    { id: 'one', name: 'Tents' },
  ];
  const links = [
    ...['p1', 'p2', 'p3', 'p4'].map((product_id) => ({ product_id, category_id: 'packs' })),
    ...['s1', 's2'].map((product_id) => ({ product_id, category_id: 'socks' })),
    ...['g1', 'g2'].map((product_id) => ({ product_id, category_id: 'mixed' })),
    { product_id: 't1', category_id: 'one' },
  ];
  const variant = (product_id, price, extra = {}) => ({
    product_id,
    price,
    sale_price: null,
    currency: 'USD',
    ...extra,
  });
  const variants = [
    variant('p1', 60),
    variant('p1', 80),
    variant('p2', 119),
    variant('p3', 140, { sale_price: 129 }),
    variant('p4', 180),
    // Socks without prices; gift cards in two currencies.
    variant('s1', null),
    variant('g1', 25),
    variant('g2', 25, { currency: 'EUR' }),
  ];

  it('offers each category with its products and price band, the biggest first', () => {
    expect(composeCatalogCandidates({ categories, links, variants })).toEqual([
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
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, name: `Cat ${i}` }));
    const manyLinks = many.flatMap((c) =>
      ['a', 'b'].map((p) => ({ product_id: `${c.id}${p}`, category_id: c.id })),
    );
    expect(
      composeCatalogCandidates({ categories: many, links: manyLinks, variants: [] }),
    ).toHaveLength(MAX_CANDIDATES);
  });
});

describe('getCatalogSuggestionCandidates', () => {
  it("reads the brand's live catalog, and nothing for a brand without one", async () => {
    const fake = fakeDb();
    expect(await getCatalogSuggestionCandidates('brand-1', { db: fake.db })).toEqual([]);
    fake.rows('catalog_categories').push({ id: 'c1', brand_id: 'brand-1', name: 'Boots' });
    fake
      .rows('catalog_products')
      .push(
        { id: 'p1', brand_id: 'brand-1', removed_at: null },
        { id: 'p2', brand_id: 'brand-1', removed_at: null },
        { id: 'p3', brand_id: 'brand-1', removed_at: '2026-10-01T00:00:00Z' },
      );
    fake.rows('catalog_product_categories').push(
      ...['p1', 'p2', 'p3'].map((product_id) => ({
        brand_id: 'brand-1',
        product_id,
        category_id: 'c1',
      })),
    );
    fake.rows('catalog_variants').push(
      {
        id: 'v1',
        brand_id: 'brand-1',
        product_id: 'p1',
        price: 99,
        currency: 'USD',
        removed_at: null,
      },
      {
        id: 'v2',
        brand_id: 'brand-1',
        product_id: 'p2',
        price: 129,
        currency: 'USD',
        removed_at: null,
      },
    );
    expect(await getCatalogSuggestionCandidates('brand-1', { db: fake.db })).toEqual([
      {
        category: 'Boots',
        products: 2,
        priceLow: 99,
        priceHigh: 129,
        priceUnder: 150,
        currency: 'USD',
      },
    ]);
  });

  it('returns nothing when the catalog cannot be read', async () => {
    const db = {
      from: () => ({
        select: () => {
          throw new Error('down');
        },
      }),
    };
    expect(await getCatalogSuggestionCandidates('brand-1', { db })).toEqual([]);
  });
});
