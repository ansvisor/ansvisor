import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));

import {
  htmlBlockElement,
  insertProductGrid,
  priceText,
  productBlockHtml,
} from './shopping-blocks.js';

/** The product grid a new page gets from its shopping path (shopping path, part 5). */

// The editor's product-block.test.ts expects this same markup for the same products.
const SAME_AS_THE_EDITOR =
  '<div class="ansvisor-products" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin:16px 0"><a class="ansvisor-product" href="https://shop.example/products/p1" style="display:block;border:1px solid #e5e5e5;border-radius:12px;padding:12px;text-decoration:none;color:inherit"><img src="https://cdn.example/p1.jpg" alt="Summit &quot;GTX&quot; Boot" loading="lazy" style="display:block;width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:8px"><strong style="display:block;margin-top:8px">Summit &quot;GTX&quot; Boot</strong><span style="display:block;margin-top:4px">$189.00</span></a><a class="ansvisor-product" href="https://shop.example/products/p2" style="display:block;border:1px solid #e5e5e5;border-radius:12px;padding:12px;text-decoration:none;color:inherit"><strong style="display:block;margin-top:8px">Trail Mid</strong></a></div>';

const product = (id, title, extra = {}) => ({
  id,
  title,
  url: `https://shop.example/products/${id}`,
  price: 189,
  salePrice: null,
  currency: 'USD',
  availability: 'in_stock',
  image: null,
  issues: [],
  score: 9,
  ...extra,
});

describe('priceText', () => {
  it('writes a price in its currency, the sale price first', () => {
    expect(priceText({ price: 189, salePrice: null, currency: 'USD' })).toBe('$189.00');
    expect(priceText({ price: 149, salePrice: 129, currency: 'EUR' })).toBe('€129.00');
    expect(priceText({ price: null, salePrice: null, currency: 'USD' })).toBeNull();
  });
});

describe('productBlockHtml', () => {
  it("writes the editor's markup: picture, name and price, linked, escaped", () => {
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
    ).toBe(SAME_AS_THE_EDITOR);
    expect(productBlockHtml([])).toBe('');
  });
});

describe('htmlBlockElement', () => {
  it('stores the code as the editor does: UTF-8 in base64', () => {
    const element = htmlBlockElement('<p>Bot – ü</p>');
    const encoded = /data-html-block="([^"]+)"/.exec(element)[1];
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe('<p>Bot – ü</p>');
  });
});

describe('insertProductGrid', () => {
  const path = {
    pageType: 'buying_guide',
    products: [product('p1', 'Summit GTX Boot'), product('p2', 'Trail Mid')],
  };
  const link = (id) => `<a href="https://shop.example/products/${id}">x</a>`;
  const decoded = (html) =>
    [...html.matchAll(/data-html-block="([^"]+)"/g)].map((m) =>
      Buffer.from(m[1], 'base64').toString('utf8'),
    );

  it('puts the grid at the end of the section that links the products most', () => {
    const html =
      '<h1>T</h1><p>Intro</p><h2>Choose</h2><p>How.</p>' +
      `<h2>Picks</h2><p>${link('p1')}</p><ul><li><p>${link('p2')}</p></li></ul>` +
      `<h2>FAQ</h2><h3>Q?</h3><p>${link('p1')}</p>`;
    const out = insertProductGrid(html, path);
    expect(out.indexOf('data-html-block')).toBeGreaterThan(out.indexOf('</ul>'));
    expect(out.indexOf('data-html-block')).toBeLessThan(out.indexOf('<h2>FAQ</h2>'));
    expect(decoded(out)[0]).toContain('https://shop.example/products/p2');
  });

  it('puts it before the last section when no section links them, or at the end', () => {
    const out = insertProductGrid('<h1>T</h1><h2>A</h2><p>a</p><h2>FAQ</h2><p>q</p>', path);
    expect(out.indexOf('data-html-block')).toBeLessThan(out.indexOf('<h2>FAQ</h2>'));
    expect(insertProductGrid('<h1>T</h1><p>a</p>', path)).toMatch(/<p>a<\/p><div data-html-block=/);
  });

  it('leaves a page type without a grid, or a path with one product, as it is', () => {
    const html = '<h1>T</h1><h2>A</h2><p>a</p>';
    expect(insertProductGrid(html, { ...path, pageType: 'blog_post' })).toBe(html);
    expect(insertProductGrid(html, { ...path, products: [product('p1', 'One')] })).toBe(html);
    expect(insertProductGrid(html, null)).toBe(html);
  });
});
