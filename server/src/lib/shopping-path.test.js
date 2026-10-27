import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));

import { fakeDb } from './catalog/__fixtures__/fake-db.js';
import {
  NoShoppingPath,
  buildShoppingPath,
  offerOf,
  pickCategories,
  pickProducts,
  topicScore,
  topicWords,
} from './shopping-path.js';

/** A draft's shopping path (shopping path, 00351). */

const BRIEF = {
  goal: 'Help hikers pick a waterproof boot',
  keywords: ['waterproof hiking boots', 'gore-tex'],
  outline: [{ heading: 'How to choose: fit and weight' }],
};

describe('topicWords', () => {
  it("weighs the title's words most, then the keywords, then the goal and headings", () => {
    const topic = topicWords({ title: 'How to choose waterproof hiking boots', brief: BRIEF });
    expect(topic.get('waterproof')).toBe(3);
    expect(topic.get('gore')).toBe(2);
    expect(topic.get('fit')).toBe(1);
    expect(topicScore(topic, 'Waterproof Boot, Gore-Tex')).toBe(3 + 3 + 2 + 2);
  });
});

describe('pickCategories', () => {
  const topic = topicWords({ title: 'How to choose waterproof hiking boots', brief: null });
  const category = (name, inStock, url = `https://s.example/c/${name}`) => ({
    name,
    products: 10,
    inStock,
    page: url ? { url, title: null } : null,
  });

  it('links the best category with a page and stock, and a second only close to it', () => {
    expect(
      pickCategories(
        [
          category('Shoes > Hiking Boots', 18),
          category('Boots', 4),
          category('Rain Jackets', 12),
          category('Hiking Socks', 0),
          category('Hiking Poles', 9, null),
        ],
        topic,
      ),
    ).toEqual([
      {
        name: 'Shoes > Hiking Boots',
        url: 'https://s.example/c/Shoes > Hiking Boots',
        title: null,
      },
      { name: 'Boots', url: 'https://s.example/c/Boots', title: null },
    ]);
    expect(pickCategories([category('Rain Jackets', 12)], topic)).toEqual([]);
  });
});

describe('offerOf', () => {
  const variant = (availability, extra = {}) => ({
    external_id: 'v',
    url: null,
    price: 100,
    sale_price: null,
    currency: 'USD',
    availability,
    issues: [],
    ...extra,
  });
  const product = (variants, url = 'https://s.example/p/boot') => ({
    id: 'p1',
    title: 'Boot',
    url,
    image: null,
    variants,
  });

  it('offers the cheapest variant in stock that Merchant Center accepts, with its issues', () => {
    const { offer } = offerOf(
      product([
        variant('in_stock', { price: 189 }),
        variant('in_stock', {
          price: 149,
          sale_price: 129,
          issues: [{ code: 'missing_gtin', severity: 'demoted', attribute: 'gtin' }],
        }),
        variant('in_stock', {
          price: 99,
          issues: [{ code: 'price_mismatch', severity: 'disapproved', attribute: 'price' }],
        }),
        variant('out_of_stock', { price: 50 }),
      ]),
    );
    expect(offer).toMatchObject({
      price: 149,
      salePrice: 129,
      currency: 'USD',
      issues: [{ code: 'missing_gtin', attribute: 'gtin' }],
    });
  });

  it("says why a product can't be offered", () => {
    expect(offerOf(product([variant('out_of_stock')]))).toEqual({ reason: 'sold_out' });
    expect(
      offerOf(product([variant('in_stock', { issues: [{ code: 'x', severity: 'disapproved' }] })])),
    ).toEqual({ reason: 'refused' });
    expect(offerOf(product([variant('in_stock')], null))).toEqual({ reason: 'no_link' });
  });
});

describe('pickProducts', () => {
  const item = (id, score, reason = null) => ({
    product: { id, title: `Product ${id}` },
    score,
    result: reason ? { reason } : { offer: { id, title: `Product ${id}` } },
  });

  it('takes the best offers up to the page type, and keeps the best left out with why', () => {
    const { products, leftOut } = pickProducts(
      [item('a', 9), item('b', 8, 'sold_out'), item('c', 7), item('d', 6), item('e', 0)],
      { max: 2 },
    );
    expect(products.map((p) => p.id)).toEqual(['a', 'c']);
    expect(leftOut).toEqual([{ id: 'b', title: 'Product b', reason: 'sold_out' }]);
  });

  it("keeps the person's locked and added products, in the page's count, and never a removed one", () => {
    const items = [item('a', 9), item('b', 8), item('c', 0), item('d', 1)];
    const choices = { locked: ['d'], removed: ['a'], added: ['c'] };
    const ids = (max) =>
      pickProducts(items, { max, ...choices })
        .products.map((p) => p.id)
        .sort();
    expect(ids(2)).toEqual(['c', 'd']);
    expect(ids(3)).toEqual(['b', 'c', 'd']);
    // More kept than the page takes: all of them stay.
    expect(ids(1)).toEqual(['c', 'd']);
  });
});

describe('buildShoppingPath', () => {
  function setup({ siteType = 'ecommerce', pageType = 'buying_guide', path = null } = {}) {
    const fake = fakeDb();
    fake.rows('content_drafts').push({
      id: 'd1',
      brand_id: 'b1',
      title: 'How to choose waterproof hiking boots',
      page_type: pageType,
      brief: BRIEF,
      shopping_path: path,
    });
    fake.rows('brands').push({ id: 'b1', site_type: siteType, shopping_mode_enabled: false });
    fake.rows('site_pages').push({
      id: 's1',
      brand_id: 'b1',
      url: 'https://s.example/collections/hiking-boots',
      title: 'Hiking boots',
    });
    fake
      .rows('catalog_categories')
      .push({ id: 'c1', brand_id: 'b1', name: 'Shoes > Hiking Boots' });
    const products = [
      ['p1', 'Summit Waterproof Hiking Boot', 'in_stock', null],
      ['p2', 'Trail Mid Waterproof Boot', 'in_stock', 'demoted'],
      ['p3', 'Canyon Low Waterproof Hiker', 'out_of_stock', null],
      ['p4', 'Ridge Waterproof Hiking Boot', 'in_stock', 'disapproved'],
      ['p5', 'Wool Hiking Sock', 'in_stock', null],
    ];
    for (const [id, title, availability, severity] of products) {
      fake.rows('catalog_products').push({
        id,
        brand_id: 'b1',
        title,
        url: `https://s.example/products/${id}`,
        product_type: id === 'p5' ? 'Socks' : 'Shoes > Hiking Boots',
        description: null,
        removed_at: null,
      });
      if (id !== 'p5') {
        fake
          .rows('catalog_product_categories')
          .push({ brand_id: 'b1', product_id: id, category_id: 'c1' });
      }
      fake.rows('catalog_variants').push({
        id: `v-${id}`,
        product_id: id,
        external_id: `${id}-42`,
        url: null,
        price: 100,
        sale_price: null,
        currency: 'USD',
        availability,
        removed_at: null,
      });
      if (severity) {
        fake.rows('catalog_item_issues').push({
          id: `i-${id}`,
          brand_id: 'b1',
          external_id: `${id}-42`,
          code: severity === 'demoted' ? 'missing_gtin' : 'price_mismatch',
          severity,
          attribute: severity === 'demoted' ? 'gtin' : 'price',
        });
      }
    }
    const rpc = vi.fn(async () => ({
      data: [
        { category: 'Shoes > Hiking Boots', products: 4, in_stock: 3 },
        { category: 'Socks', products: 1, in_stock: 1 },
      ],
      error: null,
    }));
    return { fake, db: { ...fake.db, rpc } };
  }

  it('picks the category page and the products in stock Merchant Center accepts, and saves them', async () => {
    const { fake, db } = setup();
    const path = await buildShoppingPath(
      { draftId: 'd1', brandId: 'b1' },
      { db, now: new Date('2026-10-27T12:00:00Z') },
    );
    expect(path).toMatchObject({
      version: 1,
      builtAt: '2026-10-27T12:00:00.000Z',
      pageType: 'buying_guide',
      categories: [
        {
          name: 'Shoes > Hiking Boots',
          url: 'https://s.example/collections/hiking-boots',
          title: 'Hiking boots',
        },
      ],
      locked: [],
      removed: [],
      added: [],
    });
    expect(path.products.map((p) => p.id)).toEqual(expect.arrayContaining(['p1', 'p2']));
    expect(path.products.map((p) => p.id)).not.toContain('p3');
    expect(path.products.map((p) => p.id)).not.toContain('p4');
    expect(path.products.find((p) => p.id === 'p2').issues).toEqual([
      { code: 'missing_gtin', attribute: 'gtin' },
    ]);
    expect(path.leftOut).toEqual(
      expect.arrayContaining([
        { id: 'p3', title: 'Canyon Low Waterproof Hiker', reason: 'sold_out' },
        { id: 'p4', title: 'Ridge Waterproof Hiking Boot', reason: 'refused' },
      ]),
    );
    expect(fake.rows('content_drafts')[0].shopping_path).toEqual(path);
  });

  it("keeps the person's choices when it builds again", async () => {
    const { db } = setup({ path: { locked: ['p5'], removed: ['p1'], added: [] } });
    const path = await buildShoppingPath({ draftId: 'd1', brandId: 'b1' }, { db });
    const ids = path.products.map((p) => p.id);
    expect(ids).toContain('p5');
    expect(ids).not.toContain('p1');
    expect(path.locked).toEqual(['p5']);
    expect(path.removed).toEqual(['p1']);
  });

  it("has none for a brand that isn't a shop or a page type that takes none", async () => {
    await expect(
      buildShoppingPath({ draftId: 'd1', brandId: 'b1' }, { db: setup({ siteType: 'b2b' }).db }),
    ).rejects.toMatchObject({ reason: 'not_a_shop' });
    await expect(
      buildShoppingPath(
        { draftId: 'd1', brandId: 'b1' },
        { db: setup({ pageType: 'product_page' }).db },
      ),
    ).rejects.toBeInstanceOf(NoShoppingPath);
    await expect(
      buildShoppingPath({ draftId: 'd1', brandId: 'b2' }, { db: setup().db }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
