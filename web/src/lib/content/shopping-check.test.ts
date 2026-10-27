import { describe, expect, it } from 'vitest';
import { shoppingLinks } from './shopping-check';

/** A page's shopping links against its path (shopping path, part 6). */

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
      {
        categories: ['shop.example/collections/boots'],
        products: [
          { key: 'shop.example/products/a', title: 'A', state: 'ok' },
          { key: 'shop.example/products/b', title: 'B', state: 'gone' },
          { key: 'shop.example/products/c', title: 'C', state: 'sold_out' },
        ],
      },
    );
    expect(read.categoryLinked).toBe(true);
    expect(read.linked.map((p) => p.title)).toEqual(['A', 'B']);
    expect(read.bad).toEqual([{ key: 'shop.example/products/b', title: 'B', state: 'gone' }]);
    expect(read).toMatchObject({ products: 3, categories: 1 });
  });
});
