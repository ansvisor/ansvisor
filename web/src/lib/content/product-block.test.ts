import { describe, expect, it } from 'vitest';
import { MAX_BLOCK_PRODUCTS, productBlockHtml } from './product-block';

/** Product card and product grid (shopping path, part 5). */

// server/src/lib/shopping-blocks.test.js expects this same markup for the same products.
const SAME_AS_THE_SERVER =
  '<div class="ansvisor-products" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin:16px 0"><a class="ansvisor-product" href="https://shop.example/products/p1" style="display:block;border:1px solid #e5e5e5;border-radius:12px;padding:12px;text-decoration:none;color:inherit"><img src="https://cdn.example/p1.jpg" alt="Summit &quot;GTX&quot; Boot" loading="lazy" style="display:block;width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:8px"><strong style="display:block;margin-top:8px">Summit &quot;GTX&quot; Boot</strong><span style="display:block;margin-top:4px">$189.00</span></a><a class="ansvisor-product" href="https://shop.example/products/p2" style="display:block;border:1px solid #e5e5e5;border-radius:12px;padding:12px;text-decoration:none;color:inherit"><strong style="display:block;margin-top:8px">Trail Mid</strong></a></div>';

describe('productBlockHtml', () => {
  it('writes picture, name and price, linked, escaped, and leaves out what has no page', () => {
    expect(
      productBlockHtml([
        {
          title: 'Summit "GTX" Boot',
          url: 'https://shop.example/products/p1',
          image: 'https://cdn.example/p1.jpg',
          price: '$189.00',
        },
        { title: 'Trail Mid', url: 'https://shop.example/products/p2', image: null, price: null },
        { title: 'No page', url: 'javascript:alert(1)', image: null, price: null },
      ]),
    ).toBe(SAME_AS_THE_SERVER);
  });

  it('shows four at most, and nothing with none', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      title: `P${i}`,
      url: `https://s.example/p${i}`,
      image: null,
      price: null,
    }));
    expect(productBlockHtml(many).match(/class="ansvisor-product"/g)).toHaveLength(
      MAX_BLOCK_PRODUCTS,
    );
    expect(productBlockHtml([])).toBe('');
  });
});
