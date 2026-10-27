import * as cheerio from 'cheerio';
import { leafName } from './catalog/category-pages.js';
import { linkHref } from './content-links.js';

/**
 * The Content Agent's side of a draft's shopping path (shopping path, part
 * 4): what it's told about the category page and the products the page
 * links (shopping-path.js picked them), and the links themselves.
 *
 * A page written whole is text the agent can't link (content-writer.js
 * renderPage), so the agent is asked to write each name exactly as given,
 * and the names it wrote are linked here: the first time each appears in a
 * paragraph or a list item, never in a heading or inside a link. A page it
 * changes (rewrite, suggestions, fixes) links them itself: they join the
 * pages it may link to (content-links.js), where anything else is
 * unwrapped. Either way, the only facts it's given about a product are the
 * catalog's: its name, price and stock.
 */

/** A path's category pages and products as link targets, each with the name it's linked on. */
export function shoppingTargets(path) {
  const out = [];
  for (const category of path?.categories ?? []) {
    const url = linkHref(category.url);
    const name = leafName(category.name);
    if (url && name) out.push({ url, title: name, kind: 'category' });
  }
  for (const product of path?.products ?? []) {
    const url = linkHref(product.url);
    const name = String(product.title ?? '').trim();
    if (url && name) out.push({ url, title: name, kind: 'product' });
  }
  return out;
}

/** The link targets with the shopping path's: offered first, kept whatever rules are asked for. */
export function withShopping(targets, path) {
  return { ...targets, shopping: shoppingTargets(path) };
}

/** A product's price and stock as the agent is told them: "189.00 USD, in stock". */
function offerLine(product) {
  const amount = product.salePrice ?? product.price;
  const price =
    amount == null
      ? null
      : `${Number(amount).toFixed(2)}${product.currency ? ` ${product.currency}` : ''}`;
  const stock = product.availability === 'limited_availability' ? 'low stock' : 'in stock';
  return [price, stock].filter(Boolean).join(', ');
}

/**
 * The shopping path as a new page's writer reads it; '' when the path has
 * nothing to link.
 */
export function shoppingPrompt(path) {
  const categories = shoppingTargets({ categories: path?.categories ?? [] });
  const products = (path?.products ?? []).filter(
    (p) => linkHref(p.url) && String(p.title ?? '').trim(),
  );
  if (!categories.length && !products.length) return '';
  const lines = [
    "The shopping path: the pages of the brand's shop this page sends readers to. Write each name exactly as given; the editor links it.",
  ];
  if (categories.length) {
    lines.push(
      `Category page: ${categories.map((c) => c.title).join('; ')}. Name it in the opening, and point readers to it again at the end.`,
    );
  }
  if (products.length) {
    lines.push(
      'Products, in this order (recommend or compare them where the page does; one each at most where it fits):',
      ...products.map((p) => `- ${p.title}: ${offerLine(p)}`),
      "About these products, write only what is given here and in your data. Never write a price, size, weight or other spec that isn't; write a placeholder in square brackets instead.",
    );
  }
  return lines.join('\n');
}

/** What the path gives the guards: the names and prices the page may write unmarked. */
export function shoppingGiven(path) {
  return [
    ...(path?.categories ?? []).map((c) => c.name),
    ...(path?.products ?? []).map((p) => `${p.title} ${offerLine(p)}`),
  ].join('\n');
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeHtml = (text) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** The ways a name may be written: as given, and a category's with its last word's plural or singular. */
function spellings(target) {
  const name = target.title;
  if (target.kind !== 'category') return [name];
  const other = /s$/i.test(name) ? name.replace(/s$/i, '') : `${name}s`;
  return [name, other];
}

/**
 * The page's HTML with the path's names linked: each target the first time
 * one of its spellings appears in a paragraph or a list item's text, outside
 * a link and a heading; the products first, the longest names first, so a
 * category's name inside a product's isn't taken. Returns the HTML and how
 * many of each kind it linked.
 */
export function linkShoppingPath(html, path) {
  const targets = shoppingTargets(path).sort(
    (a, b) =>
      (a.kind === 'product' ? 0 : 1) - (b.kind === 'product' ? 0 : 1) ||
      b.title.length - a.title.length,
  );
  const linked = { category: 0, product: 0 };
  if (!targets.length || !html) return { html, linked };
  const $ = cheerio.load(html, null, false);
  const textNodes = () => {
    const out = [];
    $('p, li').each((_, el) => {
      if ($(el).parents('h1, h2, h3, h4, a').length) return;
      $(el)
        .contents()
        .each((__, node) => {
          if (node.type === 'text') out.push(node);
        });
    });
    return out;
  };
  for (const target of targets) {
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}])(${spellings(target).map(escape).join('|')})(?=$|[^\\p{L}\\p{N}])`,
      'iu',
    );
    for (const node of textNodes()) {
      const text = node.data ?? '';
      const m = pattern.exec(text);
      if (!m) continue;
      const start = m.index + m[1].length;
      const end = start + m[2].length;
      $(node).replaceWith(
        `${escapeHtml(text.slice(0, start))}<a href="${escapeHtml(target.url)}">${escapeHtml(text.slice(start, end))}</a>${escapeHtml(text.slice(end))}`,
      );
      linked[target.kind] += 1;
      break;
    }
  }
  return { html: $.html(), linked };
}
