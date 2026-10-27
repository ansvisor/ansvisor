import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));

import { linkAllowList, linkTargetsPrompt } from './content-links.js';
import {
  linkShoppingPath,
  shoppingGiven,
  shoppingPrompt,
  shoppingTargets,
  withShopping,
} from './shopping-links.js';

/** The Content Agent's side of a draft's shopping path (shopping path, part 4). */

const product = (id, title, extra = {}) => ({
  id,
  title,
  url: `https://shop.example/products/${id}?utm_source=feed`,
  price: 189,
  salePrice: null,
  currency: 'USD',
  availability: 'in_stock',
  image: null,
  issues: [],
  score: 9,
  ...extra,
});

const PATH = {
  version: 1,
  categories: [
    {
      name: 'Shoes > Hiking Boots',
      url: 'https://shop.example/collections/hiking-boots',
      title: null,
    },
  ],
  products: [
    product('p1', 'Summit GTX Boot'),
    product('p2', 'Trail Mid', {
      price: 149,
      salePrice: 129,
      availability: 'limited_availability',
    }),
  ],
  leftOut: [],
  locked: [],
  removed: [],
  added: [],
};

describe('shoppingTargets', () => {
  it('names the category page by its own name and each product by its title, tracking dropped', () => {
    expect(shoppingTargets(PATH)).toEqual([
      {
        url: 'https://shop.example/collections/hiking-boots',
        title: 'Hiking Boots',
        kind: 'category',
      },
      { url: 'https://shop.example/products/p1', title: 'Summit GTX Boot', kind: 'product' },
      { url: 'https://shop.example/products/p2', title: 'Trail Mid', kind: 'product' },
    ]);
    expect(shoppingTargets(null)).toEqual([]);
  });
});

describe('shoppingPrompt and shoppingGiven', () => {
  it("tells a new page's writer the category and the products with the catalog's price and stock only", () => {
    const prompt = shoppingPrompt(PATH);
    expect(prompt).toContain('Category page: Hiking Boots.');
    expect(prompt).toContain('- Summit GTX Boot: 189.00 USD, in stock');
    expect(prompt).toContain('- Trail Mid: 129.00 USD, low stock');
    expect(prompt).toContain("Never write a price, size, weight or other spec that isn't");
    expect(shoppingPrompt({ categories: [], products: [] })).toBe('');
    expect(shoppingGiven(PATH)).toContain('Summit GTX Boot 189.00 USD, in stock');
  });
});

describe('linkShoppingPath', () => {
  it('links each name the first time a paragraph or a list item names it, never a heading', () => {
    const html =
      '<h1>Hiking boots</h1><p>Good hiking boots keep you dry. More hiking boots below.</p>' +
      '<h2>Summit GTX Boot</h2><ul><li><p>The Summit GTX Boot is light &amp; dry.</p></li></ul>' +
      '<p>See the <a href="https://x.example">Trail Mid</a> and the trail mid again.</p>';
    const { html: out, linked } = linkShoppingPath(html, PATH);
    expect(linked).toEqual({ category: 1, product: 2 });
    expect(out).toContain('<h1>Hiking boots</h1>');
    expect(out).toContain(
      '<p>Good <a href="https://shop.example/collections/hiking-boots">hiking boots</a> keep you dry. More hiking boots below.</p>',
    );
    expect(out).toContain('<h2>Summit GTX Boot</h2>');
    expect(out).toContain(
      'The <a href="https://shop.example/products/p1">Summit GTX Boot</a> is light &amp; dry.',
    );
    // Not inside a link already there: the next time it's named.
    expect(out).toContain(
      '<a href="https://x.example">Trail Mid</a> and the <a href="https://shop.example/products/p2">trail mid</a> again.',
    );
  });

  it("takes a category's singular, and leaves a product's own words to the product", () => {
    const path = {
      ...PATH,
      products: [product('p3', 'Hiking Boots Care Kit')],
    };
    const { html, linked } = linkShoppingPath(
      '<p>The Hiking Boots Care Kit cleans any hiking boot.</p>',
      path,
    );
    expect(linked).toEqual({ category: 1, product: 1 });
    expect(html).toBe(
      '<p>The <a href="https://shop.example/products/p3">Hiking Boots Care Kit</a> cleans any <a href="https://shop.example/collections/hiking-boots">hiking boot</a>.</p>',
    );
  });

  it('leaves a page with no path, or no names, as it is', () => {
    expect(linkShoppingPath('<p>Boots.</p>', null)).toEqual({
      html: '<p>Boots.</p>',
      linked: { category: 0, product: 0 },
    });
    expect(linkShoppingPath('<p>Nothing here.</p>', PATH).linked).toEqual({
      category: 0,
      product: 0,
    });
  });
});

describe('the shopping path as link targets', () => {
  it('comes first in the prompt whatever the rules, and its pages may be linked', () => {
    const targets = withShopping(
      { own: [{ url: 'https://shop.example/about', title: 'About' }], sources: [] },
      PATH,
    );
    const prompt = linkTargetsPrompt(targets, new Set());
    expect(prompt).toContain('The shopping path');
    expect(prompt).toContain('- Summit GTX Boot — https://shop.example/products/p1');
    expect(prompt).not.toContain('About');
    const allow = linkAllowList(targets);
    expect(allow.get('shop.example/products/p1')).toBe('https://shop.example/products/p1');
    expect(allow.get('shop.example/collections/hiking-boots')).toBeDefined();
  });
});
