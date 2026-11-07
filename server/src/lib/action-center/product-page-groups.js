/**
 * Product pages to optimize (AC plan P-6, spec §6.1): an online store's
 * products whose pages are worth the work, best first, for a group of 3, 5
 * or 10 (G21, the person picks; 5 to start).
 *
 * Pure: the nightly detector (signals/library/detect.js, productPages) reads
 * the candidates (product_page_candidates, 00493) and hands them here.
 *
 * Which products, by weight:
 *  - shown on the AI shopping cards of the brand's prompts (the prompts it
 *    is asked in), weighted by their demand (the prompts' volume);
 *  - selling: orders from AI visits (00361), GA item revenue through the
 *    catalog's matches (00493), and AI visits;
 *  - in stock (one variant at least, or none read), with a live page;
 *  - not optimized lately (a draft of its page marked ready or published).
 */

import { isInStock, stockKey } from '../catalog/stock.js';
import { pageKey } from '../audit/history.js';

export const GROUP_SIZES = [3, 5, 10];
export const DEFAULT_GROUP_SIZE = 5;
/** Products an action keeps, for the largest group. */
export const MAX_GROUP_PRODUCTS = 10;

const number = (value) => Number(value) || 0;
const log = (value) => Math.log10(1 + Math.max(0, value));

/** Whether a product can be bought: a variant in stock, or no stock read at all. */
export function productInStock(availabilities) {
  const read = (availabilities ?? []).filter((a) => typeof a === 'string' && a.trim());
  return read.length === 0 || read.some((a) => isInStock(stockKey(a)));
}

/**
 * The products to optimize, best first, MAX_GROUP_PRODUCTS at most.
 *
 * @param {{ candidates: object[], volumes?: Map<string, number|null>,
 *   optimized?: Set<string> }} input - `candidates`: product_page_candidates'
 *   rows; `volumes`: each prompt's monthly volume, by its id; `optimized`:
 *   the page keys (audit/history.js pageKey) of pages optimized lately
 * @returns {object[]} each { productId, title, url, prompts, volume,
 *   aiVisits, orders, revenue, currency, itemRevenue, score }
 */
export function chooseProductPages({
  candidates = [],
  volumes = new Map(),
  optimized = new Set(),
}) {
  const seen = new Set();
  const products = [];
  for (const row of candidates) {
    const url = typeof row.url === 'string' && /^https?:\/\//i.test(row.url) ? row.url : null;
    if (!url || !productInStock(row.availabilities)) continue;
    const key = pageKey(url)?.key ?? url;
    if (optimized.has(key) || seen.has(key)) continue;
    seen.add(key);
    const promptIds = [...new Set((row.prompt_ids ?? []).filter(Boolean))];
    const volume = promptIds.reduce((sum, id) => sum + number(volumes.get(id)), 0);
    const orders = number(row.orders) + number(row.items_purchased);
    const revenue = number(row.revenue);
    const itemRevenue = number(row.item_revenue);
    const aiVisits = number(row.ai_visits);
    const score =
      promptIds.length * 10 +
      log(volume) * 10 +
      orders * 5 +
      log(revenue + itemRevenue) * 5 +
      log(aiVisits) * 3;
    if (score <= 0) continue;
    products.push({
      productId: row.product_id,
      title: String(row.title ?? '').slice(0, 300),
      url,
      prompts: promptIds.length,
      volume,
      aiVisits,
      orders,
      revenue: row.revenue === null || row.revenue === undefined ? null : revenue,
      currency: typeof row.currency === 'string' ? row.currency : null,
      itemRevenue,
      score: Math.round(score * 10) / 10,
    });
  }
  return products
    .sort((a, b) => b.score - a.score || (a.url < b.url ? -1 : 1))
    .slice(0, MAX_GROUP_PRODUCTS);
}
