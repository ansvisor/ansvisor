/**
 * Product card and product grid (shopping path, part 5): one to four of the
 * brand's catalog products as an HTML block in the page, each its picture,
 * name and price, linked to its page. Plain HTML with inline styles, so
 * every export and CMS shows it as written; no words of its own, so it
 * reads in any language. The server writes the same markup when the agent
 * puts a grid in (server/src/lib/shopping-blocks.js): keep the two alike.
 */

/** Products a block shows at most. */
export const MAX_BLOCK_PRODUCTS = 4;

/** A product as a block shows it: `price` as it reads ("$189.00"), null without one. */
export interface BlockProduct {
  title: string;
  url: string;
  image: string | null;
  price: string | null;
}

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ENTITIES[c]);

/** An http(s) address as the block may link or show it, or null. */
function httpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** The block's HTML: a card for one product, a grid for more; '' with none to show. */
export function productBlockHtml(products: BlockProduct[]): string {
  const items = products
    .slice(0, MAX_BLOCK_PRODUCTS)
    .map((p) => ({ ...p, url: httpUrl(p.url), image: httpUrl(p.image) }))
    .filter((p) => p.url && p.title.trim());
  if (!items.length) return '';
  const cards = items.map((p) => {
    const image = p.image
      ? `<img src="${escape(p.image)}" alt="${escape(p.title)}" loading="lazy" style="display:block;width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:8px">`
      : '';
    const price = p.price
      ? `<span style="display:block;margin-top:4px">${escape(p.price)}</span>`
      : '';
    return `<a class="ansvisor-product" href="${escape(p.url!)}" style="display:block;border:1px solid #e5e5e5;border-radius:12px;padding:12px;text-decoration:none;color:inherit">${image}<strong style="display:block;margin-top:8px">${escape(p.title.trim())}</strong>${price}</a>`;
  });
  return `<div class="ansvisor-products" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin:16px 0">${cards.join('')}</div>`;
}
