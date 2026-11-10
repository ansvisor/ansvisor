/**
 * Catalog-fed suggestion candidates (ECOM-003).
 *
 * Shopping questions start from what the brand sells: its catalog's
 * categories (00278), each with how many live products it has and their
 * price band, so the model can ask what a shopper asks an assistant before
 * buying there ("best hiking backpacks under $150"). The categories are
 * counted in the database (catalog_suggestion_categories, 00371), which
 * returns only those offered, however big the catalog. Everything up to the
 * LLM handoff is deterministic. Any failure returns [] so the base
 * suggestion flow never degrades; a brand without a catalog gets no rows.
 *
 * Extended for AC plan P-8 (spec §6.3), still with no call of its own:
 *  - each category keeps its id, so a prompt accepted from it remembers it
 *    (prompts.source_data, 00525);
 *  - the top products, best-selling or most shown on AI shopping cards
 *    (product_page_candidates, 00493, ranked as P-6 ranks them), go to the
 *    same model call for product-level buyer prompts;
 *  - a category with products in stock that no topic covers is suggested as
 *    a topic, on the Topics tab's refresh.
 */

import supabaseAdmin from '../config/supabase.js';
import { chooseProductPages } from './action-center/product-page-groups.js';
import { boundedTopicName } from './brand-setup-input.js';
import { leafName } from './catalog/category-pages.js';
import { topicCategories } from './catalog/topic-categories.js';
import { foldLetters } from './letters.js';
import { logger } from './logger.js';

/** Categories offered to the model at most, those with the most products first. */
export const MAX_CANDIDATES = 8;
/** A category with fewer live products than this isn't offered. */
export const MIN_PRODUCTS = 2;

/** A price rounded up to one a shopper would name: 40, 150, 2,500. */
export function roundPrice(value) {
  if (!(value > 0)) return null;
  const scale = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (step * scale >= value) return Math.round(step * scale * 100) / 100;
  }
  return 10 * scale;
}

/**
 * The database's categories as candidates, in its order: each one's live
 * products and, when its priced products share a currency, their lowest
 * and highest price and the round price most of them sell under (the 75th
 * percentile, rounded up).
 *
 * @param {{ category: string, products: number, price_low: number|string|null, price_high: number|string|null, price_p75: number|string|null, currency: string|null }[]} rows
 */
export function catalogCandidates(rows) {
  return rows.slice(0, MAX_CANDIDATES).map((row) => {
    const under = roundPrice(Number(row.price_p75));
    const band = Boolean(row.currency) && under !== null;
    return {
      category: row.category,
      products: Number(row.products),
      priceLow: band ? Number(row.price_low) : null,
      priceHigh: band ? Number(row.price_high) : null,
      priceUnder: band ? under : null,
      currency: band ? row.currency : null,
    };
  });
}

/**
 * The brand's catalog categories as shopping-question candidates, each with
 * its id (`categoryId`, null when it can't be read); [] for a brand without
 * a catalog, or when it can't be read.
 */
export async function getCatalogSuggestionCandidates(brandId, { db = supabaseAdmin } = {}) {
  try {
    const { data, error } = await db.rpc('catalog_suggestion_categories', {
      p_brand_id: brandId,
      p_limit: MAX_CANDIDATES,
      p_min_products: MIN_PRODUCTS,
    });
    if (error) throw new Error(error.message);
    const candidates = catalogCandidates(data ?? []);
    if (candidates.length === 0) return [];
    // A category's name is its key in the brand's catalog (00278): the ids
    // of the few offered, read by name. Without them the names still serve.
    const ids = await db
      .from('catalog_categories')
      .select('id, name')
      .eq('brand_id', brandId)
      .in(
        'name',
        candidates.map((c) => c.category),
      );
    if (ids.error) logger.warn({ err: ids.error, brandId }, '[catalog-suggestions] category ids');
    const idOf = new Map((ids.data ?? []).map((row) => [row.name, row.id]));
    return candidates.map((c) => ({ ...c, categoryId: idOf.get(c.category) ?? null }));
  } catch (err) {
    logger.error({ err, brandId }, '[catalog-suggestions] candidate read failed');
    return [];
  }
}

// ─── Product-level prompts (P-8) ────────────────────────────────────────────

/** Products offered to the model at most. */
export const MAX_PRODUCTS = 6;
/** Days of shopping cards, AI visits, orders and GA item revenue a product is ranked by, as P-6. */
export const PRODUCT_DAYS = 30;
const DAY_MS = 86_400_000;
/** Tracked prompts read to tell which products already have one. */
const TRACKED_READ = 1000;

/** Letters and digits only, lowercased, spaced: "Atmos AG-65" → " atmos ag 65 ". */
const spaced = (text) =>
  ` ${foldLetters(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;

/** A category's depth: "Bags > Hiking > Packs" → 3. */
const depthOf = (name) =>
  String(name ?? '')
    .split(/[>›/|]/)
    .filter((step) => step.trim()).length;

/**
 * The products to ask about, best first: product_page_candidates' rows
 * ranked as the product page groups rank them (shown on the shopping cards
 * of the brand's prompts, selling, in stock, with a live page), less the
 * ones a tracked prompt already covers: one accepted from a suggestion
 * about it (`trackedIds`), or one naming it (`trackedTexts`).
 *
 * @param {{ candidates: object[], trackedIds?: Set<string>, trackedTexts?: string[] }} input
 * @returns {{ productId: string, product: string, cardPrompts: number, orders: number,
 *   aiVisits: number }[]}
 */
export function catalogProducts({ candidates = [], trackedIds = new Set(), trackedTexts = [] }) {
  const texts = trackedTexts.map(spaced);
  const named = (title) => {
    const words = spaced(title);
    return words.trim().length > 2 && texts.some((text) => text.includes(words));
  };
  return chooseProductPages({ candidates })
    .filter((p) => p.productId && !trackedIds.has(p.productId) && !named(p.title))
    .slice(0, MAX_PRODUCTS)
    .map((p) => ({
      productId: p.productId,
      product: p.title,
      cardPrompts: p.prompts,
      orders: p.orders,
      aiVisits: p.aiVisits,
    }));
}

/**
 * Each product with its type and its most specific category (the deepest,
 * then by name), as the model reads them.
 *
 * @param {ReturnType<typeof catalogProducts>} products
 * @param {{ types?: Map<string, string|null>, links?: { product_id: string,
 *   category_id: string }[], categories?: Map<string, string> }} catalog
 */
export function withCategories(
  products,
  { types = new Map(), links = [], categories = new Map() },
) {
  return products.map((p) => {
    const own = links
      .filter((l) => l.product_id === p.productId && categories.has(l.category_id))
      .map((l) => ({ id: l.category_id, name: categories.get(l.category_id) }))
      .sort((a, b) => depthOf(b.name) - depthOf(a.name) || a.name.localeCompare(b.name));
    return {
      ...p,
      productType: types.get(p.productId) || null,
      category: own[0]?.name ?? null,
      categoryId: own[0]?.id ?? null,
    };
  });
}

/**
 * Products a tracked prompt was accepted for (prompts.source_data, 00525).
 * Empty before that migration, or when it can't be read: the names in the
 * prompts' texts still count.
 */
async function trackedProductIds(db, brandId) {
  const { data, error } = await db
    .from('prompts')
    .select('source_data, prompt_sets!inner(brand_id)')
    .eq('prompt_sets.brand_id', brandId)
    .eq('source_data->>kind', 'catalog_product')
    .limit(TRACKED_READ);
  if (error) {
    logger.warn({ err: error, brandId }, '[catalog-suggestions] tracked products not read');
    return new Set();
  }
  return new Set(
    (data ?? []).flatMap((row) =>
      Array.isArray(row.source_data?.product_ids) ? row.source_data.product_ids : [],
    ),
  );
}

/**
 * The brand's top products as buyer-question candidates (spec §6.3: the
 * top-selling or most-carded), each with its type and category; [] for a
 * brand without a catalog or any sign a product sells or shows, or when it
 * can't be read.
 *
 * @param {string} brandId
 * @param {{ db?: object, now?: Date, trackedTexts?: string[] }} [options]
 */
export async function getCatalogProductCandidates(
  brandId,
  { db = supabaseAdmin, now = new Date(), trackedTexts = [] } = {},
) {
  try {
    const { data, error } = await db.rpc('product_page_candidates', {
      p_brand_id: brandId,
      p_from: new Date(now.getTime() - PRODUCT_DAYS * DAY_MS).toISOString(),
    });
    if (error) throw new Error(error.message);
    if (!data?.length) return [];
    const products = catalogProducts({
      candidates: data,
      trackedIds: await trackedProductIds(db, brandId),
      trackedTexts,
    });
    if (products.length === 0) return [];

    const ids = products.map((p) => p.productId);
    const [types, links] = await Promise.all([
      db.from('catalog_products').select('id, product_type').eq('brand_id', brandId).in('id', ids),
      db
        .from('catalog_product_categories')
        .select('product_id, category_id')
        .eq('brand_id', brandId)
        .in('product_id', ids),
    ]);
    if (types.error) throw new Error(types.error.message);
    if (links.error) throw new Error(links.error.message);
    const categoryIds = [...new Set((links.data ?? []).map((l) => l.category_id))];
    const names = categoryIds.length
      ? await db
          .from('catalog_categories')
          .select('id, name')
          .eq('brand_id', brandId)
          .in('id', categoryIds)
      : { data: [], error: null };
    if (names.error) throw new Error(names.error.message);

    return withCategories(products, {
      types: new Map((types.data ?? []).map((row) => [row.id, row.product_type])),
      links: links.data ?? [],
      categories: new Map((names.data ?? []).map((row) => [row.id, row.name])),
    });
  } catch (err) {
    logger.error({ err, brandId }, '[catalog-suggestions] product read failed');
    return [];
  }
}

// ─── Category → topic (P-8) ─────────────────────────────────────────────────

/** A category with fewer products in stock than this isn't suggested as a topic. */
export const MIN_TOPIC_IN_STOCK = 3;
/** Topics suggested from the catalog per refresh, at most. */
export const MAX_CATALOG_TOPICS = 5;

const nameKey = (name) =>
  String(name ?? '')
    .trim()
    .toLowerCase();

/**
 * Categories to suggest as topics, best first: those with MIN_TOPIC_IN_STOCK
 * products in stock or more that no topic covers (topic-categories.js: a
 * link worked out from the words, or a person's), each named by its own
 * name ("Bags > Hiking backpacks" → "Hiking backpacks"). A name a topic or
 * a decided suggestion already has (`takenNames`, case aside) isn't
 * suggested again; MAX_CATALOG_TOPICS at most.
 *
 * @param {{ counts: { category: string, products: number, in_stock: number }[],
 *   topics: { categories: { id: string }[] }[], categories: { id: string, name: string }[],
 *   takenNames?: string[] }} input
 * @returns {{ name: string, category: string, categoryId: string, products: number,
 *   inStock: number }[]}
 */
export function catalogTopics({ counts = [], topics = [], categories = [], takenNames = [] }) {
  const linked = new Set(topics.flatMap((t) => (t.categories ?? []).map((c) => c.id)));
  const idOf = new Map(categories.map((c) => [c.name, c.id]));
  const taken = new Set(takenNames.map(nameKey));
  const out = [];
  const rows = counts
    .map((r) => ({
      category: r.category,
      products: Number(r.products),
      inStock: Number(r.in_stock),
    }))
    .filter((r) => r.inStock >= MIN_TOPIC_IN_STOCK)
    .sort(
      (a, b) =>
        b.inStock - a.inStock || b.products - a.products || a.category.localeCompare(b.category),
    );
  for (const row of rows) {
    const categoryId = idOf.get(row.category);
    if (!categoryId || linked.has(categoryId)) continue;
    const name = boundedTopicName(leafName(row.category));
    if (!name || taken.has(nameKey(name))) continue;
    taken.add(nameKey(name));
    out.push({ name, categoryId, ...row });
    if (out.length === MAX_CATALOG_TOPICS) break;
  }
  return out;
}

/**
 * The catalog's categories to suggest as topics; [] for a brand without a
 * catalog, one whose categories all have a topic, or when it can't be read.
 * The topics are read only once a category has enough in stock.
 *
 * @param {string} brandId
 * @param {{ db?: object, takenNames?: string[] }} [options]
 */
export async function getCatalogTopicCandidates(
  brandId,
  { db = supabaseAdmin, takenNames = [] } = {},
) {
  try {
    const { data, error } = await db.rpc('catalog_category_counts', { p_brand_id: brandId });
    if (error) throw new Error(error.message);
    const counts = (data ?? []).filter((r) => Number(r.in_stock) >= MIN_TOPIC_IN_STOCK);
    if (counts.length === 0) return [];
    const { topics, categories } = await topicCategories(brandId, { db });
    return catalogTopics({
      counts,
      topics,
      categories,
      takenNames: [...takenNames, ...topics.map((t) => t.name)],
    });
  } catch (err) {
    logger.error({ err, brandId }, '[catalog-suggestions] topic read failed');
    return [];
  }
}
