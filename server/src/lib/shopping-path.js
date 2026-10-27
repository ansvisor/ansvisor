import supabaseAdmin from '../config/supabase.js';
import { categoryPages, leafName, wordsOf } from './catalog/category-pages.js';
import { siteTypeOf } from './content-page-types.js';

/**
 * A draft's shopping path (shopping path, 00351): on an online shop, the
 * category pages and the catalog products a buying guide, a best-of list or
 * a comparison links, so its readers, and the AI answers that quote it,
 * reach a page that sells.
 *
 * Picked from the brand's catalog for the draft's topic: its title, the
 * brief's keywords, goal and headings. A category is a candidate when it has
 * a page on the site (catalog/category-pages.js) and products in stock; a
 * product when it has a link, a variant in stock, and Google Merchant
 * Center doesn't refuse that variant (catalog_item_issues, 'disapproved').
 * Products of the picked categories come first. The best products the rules
 * leave out are kept with why (sold out, refused, no link), for the Brief
 * tab to say so.
 *
 * A rebuild keeps the person's choices: locked products stay, removed ones
 * never come back, added ones are kept.
 */

/** The page types a shopping path fits, and how many products each links. */
export const PRODUCTS_FOR = {
  best_of: 8,
  buying_guide: 5,
  comparison: 4,
  alternatives: 4,
  guide: 4,
  blog_post: 3,
};
/** Category pages a path links at most. */
export const MAX_CATEGORIES = 2;
/** Products read to score, at most, and scored products read in full. */
export const SCORED_PRODUCTS = 2000;
export const DETAILED_PRODUCTS = 40;
/** Products left out a path keeps, with why. */
export const LEFT_OUT = 3;
/** A query's chunk of ids, for PostgREST's `in`. */
const ID_CHUNK = 200;
/** Words of a product's description scored, as AI shopping reads its opening. */
const DESCRIPTION_WORDS = 40;

const IN_STOCK = new Set(['in_stock', 'limited_availability']);

/**
 * The draft's topic as weighted words: the title's count 3, the brief's
 * keywords 2, its goal and headings 1.
 *
 * @returns {Map<string, number>}
 */
export function topicWords({ title, brief }) {
  const words = new Map();
  const add = (text, weight) => {
    for (const word of wordsOf(text)) words.set(word, Math.max(words.get(word) ?? 0, weight));
  };
  for (const heading of brief?.outline ?? []) add(heading?.heading, 1);
  add(brief?.goal, 1);
  for (const keyword of brief?.keywords ?? []) add(keyword, 2);
  add(title, 3);
  return words;
}

/** How much of the topic a text holds: the weights of its topic words, each once. */
export function topicScore(topic, text) {
  let score = 0;
  for (const word of new Set(wordsOf(text))) score += topic.get(word) ?? 0;
  return score;
}

/**
 * The categories to link: with a page and products in stock, the best for
 * the topic first; a second one only when it scores half the first's.
 */
export function pickCategories(categories, topic, max = MAX_CATEGORIES) {
  const scored = categories
    .filter((c) => c.page && c.inStock > 0)
    .map((c) => ({
      category: c,
      score: topicScore(topic, leafName(c.name)) * 2 + topicScore(topic, c.page.title ?? ''),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || b.category.inStock - a.category.inStock);
  if (!scored.length) return [];
  const top = scored[0].score;
  return scored
    .filter((c, i) => i === 0 || c.score >= top / 2)
    .slice(0, max)
    .map(({ category }) => ({
      name: category.name,
      url: category.page.url,
      title: category.page.title ?? null,
    }));
}

/**
 * A product as the path offers it, or why it can't be: a variant in stock
 * that Merchant Center doesn't refuse, its lowest price, and the issues
 * Merchant Center reports for it that don't refuse it.
 */
export function offerOf(product) {
  const url = product.url ?? product.variants.find((v) => v.url)?.url ?? null;
  const inStock = product.variants.filter((v) => IN_STOCK.has(v.availability));
  const usable = inStock.filter((v) => !v.issues.some((i) => i.severity === 'disapproved'));
  const reason = !url
    ? 'no_link'
    : !inStock.length
      ? 'sold_out'
      : !usable.length
        ? 'refused'
        : null;
  if (reason) return { reason };
  const cheapest = usable
    .filter((v) => v.price != null)
    .sort((a, b) => (a.sale_price ?? a.price) - (b.sale_price ?? b.price))[0];
  const variant = cheapest ?? usable[0];
  const issues = [
    ...new Map(
      variant.issues.map((i) => [
        `${i.code}|${i.attribute ?? ''}`,
        { code: i.code, attribute: i.attribute ?? null },
      ]),
    ).values(),
  ];
  return {
    offer: {
      id: product.id,
      title: product.title,
      url,
      price: variant.price ?? null,
      salePrice: variant.sale_price ?? null,
      currency: variant.currency ?? null,
      availability: variant.availability,
      image: product.image ?? null,
      issues,
    },
  };
}

/** A product's score for the topic: its title twice, its type, its description's opening. */
export function productScore(topic, product) {
  const opening = String(product.description ?? '')
    .split(/\s+/)
    .slice(0, DESCRIPTION_WORDS)
    .join(' ');
  return (
    topicScore(topic, product.title) * 2 +
    topicScore(topic, product.product_type ?? '') +
    topicScore(topic, opening)
  );
}

/**
 * The products to link, the best for the topic first: `max` of them, the
 * person's locked and added ones first and counted in it (all of them
 * when there are more), removed ones never; and the best left out, with
 * why. `scored` items carry the product, its `score` and `offerOf` result.
 */
export function pickProducts(scored, { max, locked = [], removed = [], added = [] }) {
  const keep = new Set([...locked, ...added]);
  const gone = new Set(removed);
  const picks = [];
  const leftOut = [];
  const ordered = scored
    .filter((p) => !gone.has(p.product.id))
    .sort(
      (a, b) =>
        Number(keep.has(b.product.id)) - Number(keep.has(a.product.id)) || b.score - a.score,
    );
  for (const { product, score, result } of ordered) {
    const kept = keep.has(product.id);
    if (!kept && score <= 0) continue;
    if (result.offer && (kept || picks.length < max)) {
      picks.push({ ...result.offer, score });
    } else if (result.reason && leftOut.length < LEFT_OUT) {
      leftOut.push({ id: product.id, title: product.title, reason: result.reason });
    }
  }
  return { products: picks, leftOut };
}

/** Rows of `table` whose `column` is one of `ids`, a chunk at a time. */
async function readIn(db, table, columns, column, ids, more = (q) => q) {
  const rows = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await more(
      db
        .from(table)
        .select(columns)
        .in(column, ids.slice(i, i + ID_CHUNK)),
    );
    if (error) throw new Error(`${table} read: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
}

/** The live products to score: the picked categories' first, else the brand's. */
async function candidateProducts(db, brandId, categories) {
  const fields = 'id, title, url, product_type, description';
  let products = [];
  if (categories.length) {
    const { data: rows, error } = await db
      .from('catalog_categories')
      .select('id, name')
      .eq('brand_id', brandId)
      .in(
        'name',
        categories.map((c) => c.name),
      );
    if (error) throw new Error(`catalog_categories read: ${error.message}`);
    const links = await readIn(
      db,
      'catalog_product_categories',
      'product_id',
      'category_id',
      (rows ?? []).map((r) => r.id),
    );
    const ids = [...new Set(links.map((l) => l.product_id))].slice(0, SCORED_PRODUCTS);
    products = (
      await readIn(db, 'catalog_products', fields, 'id', ids, (q) => q.is('removed_at', null))
    ).map((p) => ({ ...p, inCategory: true }));
  }
  if (products.length < SCORED_PRODUCTS) {
    const { data, error } = await db
      .from('catalog_products')
      .select(fields)
      .eq('brand_id', brandId)
      .is('removed_at', null)
      .limit(SCORED_PRODUCTS);
    if (error) throw new Error(`catalog_products read: ${error.message}`);
    const seen = new Set(products.map((p) => p.id));
    products.push(...(data ?? []).filter((p) => !seen.has(p.id)));
  }
  return products;
}

/** Each product's variants, first image and Merchant Center issues, read for the best ones. */
async function withDetails(db, brandId, products) {
  const ids = products.map((p) => p.id);
  const [variants, images] = await Promise.all([
    readIn(
      db,
      'catalog_variants',
      'product_id, external_id, url, price, sale_price, currency, availability',
      'product_id',
      ids,
      (q) => q.is('removed_at', null),
    ),
    readIn(db, 'catalog_images', 'product_id, url, position', 'product_id', ids),
  ]);
  const issues = await readIn(
    db,
    'catalog_item_issues',
    'external_id, code, severity, attribute',
    'external_id',
    [...new Set(variants.map((v) => v.external_id))],
    (q) => q.eq('brand_id', brandId),
  );
  const issuesOf = new Map();
  for (const issue of issues) {
    issuesOf.set(issue.external_id, [...(issuesOf.get(issue.external_id) ?? []), issue]);
  }
  return products.map((p) => ({
    ...p,
    variants: variants
      .filter((v) => v.product_id === p.id)
      .map((v) => ({ ...v, issues: issuesOf.get(v.external_id) ?? [] })),
    image:
      images
        .filter((i) => i.product_id === p.id)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]?.url ?? null,
  }));
}

/** Why a draft has no shopping path: the brand isn't a shop, the page type doesn't take one, or no catalog. */
export class NoShoppingPath extends Error {
  constructor(reason) {
    super(`No shopping path: ${reason}`);
    this.name = 'NoShoppingPath';
    this.reason = reason;
  }
}

/**
 * Builds the draft's shopping path and saves it on the draft. Throws
 * NoShoppingPath ('not_a_shop', 'page_type', 'no_catalog') when it doesn't
 * fit; a 404 when the draft isn't the brand's.
 */
export async function buildShoppingPath(
  { draftId, brandId },
  { db = supabaseAdmin, now = new Date() } = {},
) {
  const [draftRead, brandRead] = await Promise.all([
    db
      .from('content_drafts')
      .select('id, brand_id, title, page_type, brief, shopping_path')
      .eq('id', draftId)
      .maybeSingle(),
    db
      .from('brands')
      .select('site_type, industry, shopping_mode_enabled')
      .eq('id', brandId)
      .maybeSingle(),
  ]);
  if (draftRead.error) throw new Error(`content_drafts read: ${draftRead.error.message}`);
  if (brandRead.error) throw new Error(`brands read: ${brandRead.error.message}`);
  const draft = draftRead.data;
  if (!draft || draft.brand_id !== brandId) {
    throw Object.assign(new Error('Draft not found'), { status: 404 });
  }
  const brand = brandRead.data ?? {};
  const siteType = siteTypeOf({
    siteType: brand.site_type,
    industry: brand.industry,
    shoppingModeEnabled: brand.shopping_mode_enabled,
  });
  if (siteType !== 'ecommerce') throw new NoShoppingPath('not_a_shop');
  const max = PRODUCTS_FOR[draft.page_type];
  if (!max) throw new NoShoppingPath('page_type');

  const before = draft.shopping_path ?? {};
  const choices = {
    locked: before.locked ?? [],
    removed: before.removed ?? [],
    added: before.added ?? [],
  };
  const topic = topicWords({ title: draft.title, brief: draft.brief });
  const categories = pickCategories(await categoryPages(brandId, { db }), topic);
  const candidates = await candidateProducts(db, brandId, categories);
  if (!candidates.length) throw new NoShoppingPath('no_catalog');

  const keep = new Set([...choices.locked, ...choices.added]);
  const best = candidates
    .map((product) => ({
      product,
      // A product of a picked category is worth one more of the topic's words.
      score: productScore(topic, product) + (product.inCategory && categories.length ? 1 : 0),
    }))
    .filter((s) => s.score > 0 || keep.has(s.product.id))
    .sort((a, b) => b.score - a.score)
    .slice(0, DETAILED_PRODUCTS + keep.size);
  const detailed = await withDetails(
    db,
    brandId,
    best.map((s) => s.product),
  );
  const byId = new Map(detailed.map((p) => [p.id, p]));
  const scored = best.map(({ product, score }) => {
    const full = byId.get(product.id);
    return { product: full, score, result: offerOf(full) };
  });
  const { products, leftOut } = pickProducts(scored, { max, ...choices });

  const path = {
    version: 1,
    builtAt: now.toISOString(),
    pageType: draft.page_type,
    categories,
    products,
    leftOut,
    ...choices,
  };
  const { error } = await db
    .from('content_drafts')
    .update({ shopping_path: path })
    .eq('id', draftId);
  if (error) throw new Error(`content_drafts write: ${error.message}`);
  return path;
}
