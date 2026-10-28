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
  merchantCenter: false,
};

describe('shoppingLinks, with the page’s product cards (#1610)', () => {
  const priced: ShoppingCheck = {
    ...CHECK,
    products: [
      { ...product('a', 'ok'), price: '$189.00' },
      { ...product('d', 'ok'), price: null },
      { ...product('c', 'sold_out'), price: null },
      // Its price not read: never compared.
      product('e', 'ok'),
    ],
  };
  const card = (id: string, price: string | null) => ({
    href: `https://shop.example/products/${id}`,
    price,
  });

  it('lists each product once whose card shows a price the catalog no longer has', () => {
    const read = shoppingLinks([], priced, 0, [
      card('a', '$199.00'),
      // A second card of it: listed once, by the first.
      card('a', '$179.00'),
      // No price in the catalog now.
      card('d', '$50.00'),
      // No longer sells: listed to remove, not for its price.
      card('c', '$20.00'),
      card('e', '$1.00'),
      // Not one the path checks.
      card('x', '$5.00'),
    ]);
    expect(read.prices).toEqual([
      { title: 'A', page: '$199.00', now: '$189.00' },
      { title: 'D', page: '$50.00', now: null },
    ]);
  });

  it("leaves a card with today's price, or with none, alone", () => {
    expect(shoppingLinks([], priced, 0, [card('a', '$189.00'), card('d', null)]).prices).toEqual(
      [],
    );
    expect(shoppingLinks([], priced).prices).toEqual([]);
  });
});

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

  it("passes on whether the brand has a Merchant Center account, for what's said", () => {
    expect(shoppingLinks([], CHECK).merchantCenter).toBe(false);
    expect(shoppingLinks([], { ...CHECK, merchantCenter: true }).merchantCenter).toBe(true);
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
