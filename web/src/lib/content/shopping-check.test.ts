import { describe, expect, it } from 'vitest';
import {
  listed,
  shoppingLinks,
  type ShoppingCheck,
  type ShoppingLinkState,
} from './shopping-check';

/** A page's shopping links against its path (shopping path, part 6). */

const product = (id: string, state: ShoppingLinkState, inPath = true) => ({
  key: `shop.example/products/${id}`,
  title: id.toUpperCase(),
  state,
  inPath,
});

const CHECK: ShoppingCheck = {
  categories: ['shop.example/collections/boots'],
  products: [
    product('a', 'ok'),
    product('b', 'gone'),
    product('c', 'sold_out'),
    product('d', 'ok'),
    // Removed from the path, and sold out since.
    product('r', 'sold_out', false),
  ],
  site: 'https://www.shop.example/blog/boots',
};

describe('shoppingLinks', () => {
  it('reads the category page and the products linked, each once, and those that no longer sell', () => {
    const read = shoppingLinks(
      [
        'https://www.shop.example/collections/boots/',
        'https://shop.example/products/a?utm_source=feed',
        'https://shop.example/products/a',
        'https://shop.example/products/b',
        '/about',
      ],
      CHECK,
      3,
    );
    expect(read.categoryLinked).toBe(true);
    // Only a product that sells counts as linked: the gone one is to remove.
    expect(read.linked.map((p) => p.title)).toEqual(['A']);
    expect(read.bad).toEqual([product('b', 'gone')]);
    // Two of the path's products sell: the rule's 3 asks for both.
    expect(read).toMatchObject({ products: 2, want: 2, categories: 1 });
  });

  it('counts a link to a product removed from the path that no longer sells', () => {
    const read = shoppingLinks(['https://shop.example/products/r'], CHECK, 3);
    expect(read.bad).toEqual([product('r', 'sold_out', false)]);
    expect(read.linked).toEqual([]);
  });

  it("keeps the path's product when a removed one has the same page", () => {
    const check = { ...CHECK, products: [product('a', 'ok'), product('a', 'gone', false)] };
    const read = shoppingLinks(['https://shop.example/products/a'], check, 3);
    expect(read.linked.map((p) => p.state)).toEqual(['ok']);
    expect(read.bad).toEqual([]);
  });

  it("reads a relative link against the page's address, and none without one", () => {
    const hrefs = [
      '/products/a',
      'products/d',
      '//shop.example/products/c',
      'mailto:x@shop.example',
    ];
    const read = shoppingLinks(hrefs, CHECK, 3);
    expect(read.linked.map((p) => p.title)).toEqual(['A']);
    expect(read.bad.map((p) => p.title)).toEqual(['C']);
    // "products/d" is read beside the page: /blog/products/d, not the product.
    expect(shoppingLinks(['/products/a'], { ...CHECK, site: null }, 3).linked).toEqual([]);
  });

  it('asks for the number given, or all that sell when fewer do; none for 0', () => {
    expect(shoppingLinks([], CHECK, 1).want).toBe(1);
    expect(shoppingLinks([], CHECK, 0).want).toBe(0);
    expect(shoppingLinks([], CHECK, -2).want).toBe(0);
    expect(shoppingLinks([], { ...CHECK, products: [product('c', 'sold_out')] }, 3)).toMatchObject({
      products: 0,
      want: 0,
    });
  });
});

describe('listed', () => {
  it('names the first three, and counts the rest', () => {
    expect(listed([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2, 3], more: 2 });
    expect(listed([1])).toEqual({ shown: [1], more: 0 });
  });
});
