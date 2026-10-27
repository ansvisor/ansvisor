import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

import { fakeDb } from './__fixtures__/fake-db.js';
import {
  CategoryPageError,
  categoryPages,
  categorySlug,
  leafName,
  matchCategoryPages,
  matchOf,
  setCategoryPage,
  wordsOf,
} from './category-pages.js';

/** Each catalog category's page on the brand's site (shopping path, 00350). */

const page = (url, title = null, extra = {}) => ({ url, title, h1: null, ...extra });

describe('categorySlug', () => {
  it("reads a category page's last segment, as the editor's page types do", () => {
    expect(categorySlug('https://shop.example/collections/hiking-boots')).toBe('hiking-boots');
    expect(categorySlug('https://shop.example/Category/Rain-Jackets/')).toBe('rain-jackets');
    expect(categorySlug('https://shop.example/c/socks.html')).toBe('socks');
    expect(categorySlug('https://shop.example/product-category/boots/')).toBe('boots');
    expect(categorySlug('https://shop.example/shop/outdoor/tents')).toBe('tents');
  });

  it("isn't a product page, a themed collection or any other page", () => {
    expect(categorySlug('https://shop.example/collections/boots/products/summit')).toBeNull();
    expect(categorySlug('https://shop.example/collections/holiday-gifts')).toBeNull();
    expect(categorySlug('https://shop.example/collections/best-sellers')).toBeNull();
    expect(categorySlug('https://shop.example/blog/how-to-choose-boots')).toBeNull();
    expect(categorySlug('https://shop.example/collections')).toBeNull();
    expect(categorySlug('not a url')).toBeNull();
  });
});

describe('names and words', () => {
  it("takes a category's own name and its words, plurals as one", () => {
    expect(leafName('Shoes > Hiking Boots')).toBe('Hiking Boots');
    expect(leafName('Apparel › Jackets / Rain Jackets')).toBe('Rain Jackets');
    expect(wordsOf('Hiking Boots & the Socks')).toEqual(['hiking', 'boot', 'sock']);
    expect(wordsOf('Glasses, Boxes and Dress')).toEqual(['glass', 'box', 'dress']);
  });
});

describe('matchOf', () => {
  it('matches by address first, then title, then most of the words', () => {
    expect(
      matchOf('Shoes > Hiking Boots', page('https://s.example/collections/hiking-boots')),
    ).toBe('address');
    expect(
      matchOf('Hiking Boots', page('https://s.example/collections/hb-01', 'Hiking boots | Acme')),
    ).toBe('title');
    expect(
      matchOf('Waterproof Hiking Boots', page('https://s.example/collections/hiking-boot-range')),
    ).toBe('words');
    expect(matchOf('Rain Jackets', page('https://s.example/collections/hiking-boots'))).toBeNull();
    expect(matchOf('Hiking Boots', page('https://s.example/blog/hiking-boots'))).toBeNull();
  });
});

describe('matchCategoryPages', () => {
  it('picks the best page for each category, the most cited on a tie, or none', () => {
    const pages = [
      page('https://s.example/collections/boots-sale', 'Hiking boots sale', { ai_citations: 1 }),
      page('https://s.example/collections/hiking-boots', 'Boots', { ai_citations: 0 }),
      page('https://s.example/c/socks', 'Wool socks', { ai_citations: 1 }),
      page('https://s.example/shop/socks', 'Socks', { ai_citations: 5 }),
    ];
    expect(matchCategoryPages(['Hiking Boots', 'Socks', 'Tents'], pages)).toEqual([
      {
        category: 'Hiking Boots',
        page: { url: 'https://s.example/collections/hiking-boots', title: 'Boots' },
        how: 'address',
      },
      {
        category: 'Socks',
        page: { url: 'https://s.example/shop/socks', title: 'Socks' },
        how: 'address',
      },
      { category: 'Tents', page: null, how: null },
    ]);
  });
});

describe('categoryPages', () => {
  it("lists the brand's categories with their counts and pages, a person's decision first", async () => {
    const fake = fakeDb();
    fake.rows('site_pages').push(
      {
        id: '1',
        brand_id: 'b1',
        url: 'https://s.example/collections/hiking-boots',
        title: 'Hiking boots',
      },
      {
        id: '2',
        brand_id: 'b1',
        url: 'https://s.example/collections/rain-jackets',
        title: 'Rain',
      },
      { id: '3', brand_id: 'b2', url: 'https://other.example/collections/tents', title: 'Tents' },
    );
    fake
      .rows('catalog_category_pages')
      .push(
        { brand_id: 'b1', category: 'Rain Jackets', url: 'https://s.example/jackets/rain' },
        { brand_id: 'b1', category: 'Socks', url: null },
      );
    const rpc = vi.fn(async () => ({
      data: [
        { category: 'Socks', products: 2, in_stock: 2 },
        { category: 'Shoes > Hiking Boots', products: 24, in_stock: 18 },
        { category: 'Rain Jackets', products: 16, in_stock: 12 },
        { category: 'Tents', products: 16, in_stock: 3 },
      ],
      error: null,
    }));
    const categories = await categoryPages('b1', { db: { ...fake.db, rpc } });
    expect(rpc).toHaveBeenCalledWith('catalog_category_counts', { p_brand_id: 'b1' });
    expect(categories).toEqual([
      {
        name: 'Shoes > Hiking Boots',
        products: 24,
        inStock: 18,
        page: { url: 'https://s.example/collections/hiking-boots', title: 'Hiking boots' },
        how: 'address',
      },
      {
        name: 'Rain Jackets',
        products: 16,
        inStock: 12,
        page: { url: 'https://s.example/jackets/rain', title: null },
        how: 'manual',
      },
      // Another brand's page is never matched.
      { name: 'Tents', products: 16, inStock: 3, page: null, how: null },
      { name: 'Socks', products: 2, inStock: 2, page: null, how: null },
    ]);
  });
});

describe('setCategoryPage', () => {
  const setup = () => {
    const fake = fakeDb();
    fake.rows('brand_domains').push({ id: 'd1', brand_id: 'b1', domain: 'https://www.s.example/' });
    return fake;
  };

  it("keeps a page on the brand's site, none, or goes back to the match", async () => {
    const fake = setup();
    const set = (url) =>
      setCategoryPage({ brandId: 'b1', category: 'Socks', url, userId: 'u1' }, { db: fake.db });
    await set('https://shop.s.example/c/socks');
    expect(fake.rows('catalog_category_pages')).toEqual([
      expect.objectContaining({
        brand_id: 'b1',
        category: 'Socks',
        url: 'https://shop.s.example/c/socks',
        set_by: 'u1',
      }),
    ]);
    await set(null);
    expect(fake.rows('catalog_category_pages')).toEqual([
      expect.objectContaining({ category: 'Socks', url: null }),
    ]);
    await set(undefined);
    expect(fake.rows('catalog_category_pages')).toEqual([]);
  });

  it("refuses a page off the brand's site, or one that isn't an address", async () => {
    const fake = setup();
    const set = (url) =>
      setCategoryPage({ brandId: 'b1', category: 'Socks', url, userId: 'u1' }, { db: fake.db });
    await expect(set('https://elsewhere.example/c/socks')).rejects.toMatchObject({
      code: 'off_site',
    });
    await expect(set('socks')).rejects.toBeInstanceOf(CategoryPageError);
    await expect(set('ftp://s.example/socks')).rejects.toMatchObject({ code: 'invalid' });
    expect(fake.rows('catalog_category_pages')).toEqual([]);
  });
});
