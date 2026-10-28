/**
 * Catalog-fed suggestion candidates (ECOM-003).
 *
 * Shopping questions start from what the brand sells: its catalog's
 * categories (00278), each with how many live products it has and their
 * price band, so the model can ask what a shopper asks an assistant before
 * buying there ("best hiking backpacks under $150"). Everything up to the
 * LLM handoff is deterministic. Any failure returns [] so the base
 * suggestion flow never degrades; brands without a catalog short-circuit on
 * the first (empty) read.
 */

import supabaseAdmin from '../config/supabase.js';
import { readAllRpcRows } from './rpc-pages.js';
import { logger } from './logger.js';

/** Categories offered to the model at most, those with the most products first. */
export const MAX_CANDIDATES = 8;
/** A category with fewer live products than this isn't offered. */
const MIN_PRODUCTS = 2;
/** Prices read for a band: the share of the category's products under its "under" price. */
const UNDER_SHARE = 0.75;

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
 * The categories as candidates: each one's products (live, priced or not)
 * and, when they share a currency, their lowest and highest price and the
 * round price most of them sell under.
 *
 * @param {{ categories: { id: string, name: string }[], links: { product_id: string, category_id: string }[], variants: { product_id: string, price: number|null, sale_price: number|null, currency: string|null }[] }} catalog
 */
export function composeCatalogCandidates({ categories, links, variants }) {
  // Each product's price: its lowest variant's, on sale or not.
  const priceOf = new Map();
  for (const v of variants) {
    const amount = Number(v.sale_price ?? v.price);
    if (!(amount > 0)) continue;
    const kept = priceOf.get(v.product_id);
    if (!kept || amount < kept.amount) {
      priceOf.set(v.product_id, { amount, currency: v.currency ?? null });
    }
  }
  const productsOf = new Map();
  for (const link of links) {
    if (!productsOf.has(link.category_id)) productsOf.set(link.category_id, new Set());
    productsOf.get(link.category_id).add(link.product_id);
  }
  const candidates = [];
  for (const category of categories) {
    const products = [...(productsOf.get(category.id) ?? [])];
    if (products.length < MIN_PRODUCTS) continue;
    const prices = products.map((id) => priceOf.get(id)).filter(Boolean);
    const currencies = new Set(prices.map((p) => p.currency));
    const band =
      prices.length && currencies.size === 1 && [...currencies][0]
        ? (() => {
            const amounts = prices.map((p) => p.amount).sort((a, b) => a - b);
            const at = Math.min(amounts.length - 1, Math.ceil(amounts.length * UNDER_SHARE) - 1);
            return {
              priceLow: amounts[0],
              priceHigh: amounts.at(-1),
              priceUnder: roundPrice(amounts[at]),
              currency: [...currencies][0],
            };
          })()
        : { priceLow: null, priceHigh: null, priceUnder: null, currency: null };
    candidates.push({ category: category.name, products: products.length, ...band });
  }
  return candidates
    .sort((a, b) => b.products - a.products || a.category.localeCompare(b.category))
    .slice(0, MAX_CANDIDATES);
}

async function readAll(what, page) {
  const { data, error } = await readAllRpcRows(what, page);
  if (error) throw new Error(`${what} read: ${error.message}`);
  return data;
}

/**
 * The brand's catalog categories as shopping-question candidates; [] for a
 * brand without a catalog, or when it can't be read.
 */
export async function getCatalogSuggestionCandidates(brandId, { db = supabaseAdmin } = {}) {
  try {
    const { data: categories, error } = await db
      .from('catalog_categories')
      .select('id, name')
      .eq('brand_id', brandId)
      .order('id')
      .limit(1000);
    if (error) throw new Error(error.message);
    if (!categories?.length) return [];
    const [products, links, variants] = await Promise.all([
      readAll('catalog_products', (from, to) =>
        db
          .from('catalog_products')
          .select('id')
          .eq('brand_id', brandId)
          .is('removed_at', null)
          .order('id')
          .range(from, to),
      ),
      readAll('catalog_product_categories', (from, to) =>
        db
          .from('catalog_product_categories')
          .select('product_id, category_id')
          .eq('brand_id', brandId)
          .order('product_id')
          .order('category_id')
          .range(from, to),
      ),
      readAll('catalog_variants', (from, to) =>
        db
          .from('catalog_variants')
          .select('product_id, price, sale_price, currency')
          .eq('brand_id', brandId)
          .is('removed_at', null)
          .order('id')
          .range(from, to),
      ),
    ]);
    // A removed product's links stay; only the live ones count.
    const live = new Set(products.map((p) => p.id));
    return composeCatalogCandidates({
      categories,
      links: links.filter((link) => live.has(link.product_id)),
      variants,
    });
  } catch (err) {
    logger.error({ err, brandId }, '[catalog-suggestions] candidate read failed');
    return [];
  }
}
