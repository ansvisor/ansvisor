/**
 * G21 — Optimize product pages AI asks about (AC plan P-6, spec §6.1).
 *
 * Signal: an online store's product pages worth optimizing, best first
 * (product-page-groups.js): shown on the AI shopping cards of its prompts,
 * weighted by their demand, by sales and AI visits; in stock, with a page.
 *
 * One action keeps up to ten products (`products`) and works on the first
 * 5 of them (`groupSize`): its pages, targets and count. The person picks
 * 3, 5 or 10 on the action (set_product_group_size, 00493). Start now opens
 * each page as an optimize draft, as Product Visibility's Optimize page
 * does (from-products.js); a page optimized lately is left to the next.
 */

import { DEFAULT_GROUP_SIZE, MAX_GROUP_PRODUCTS } from '../product-page-groups.js';
import { first } from './_helpers.js';

export const PRODUCT_PAGES_KIND = 'product_pages_optimize';

const address = (value) => typeof value === 'string' && /^https?:\/\//i.test(value);
const count = (value) => Number(value) || 0;

export default {
  id: PRODUCT_PAGES_KIND,
  code: 'G21',
  version: 1,
  category: 'growth',
  name: 'Optimize product pages AI asks about',
  signalKinds: ['product_pages_to_optimize'],
  requires: ['tracking'],
  optional: [],
  enabled: true,
  tasks: [
    'optimize_content',
    'publish_content',
    'validate_ai_visibility',
    'measure_action_outcome',
  ],

  payload(byKind) {
    const signal = first(byKind, 'product_pages_to_optimize');
    const products = (signal?.payload?.targets ?? [])
      .filter((target) => address(target?.id))
      .slice(0, MAX_GROUP_PRODUCTS)
      .map((target) => ({
        url: target.id,
        title: String(target.label ?? ''),
        productId: target.productId ?? null,
        prompts: count(target.prompts),
        volume: count(target.volume),
        aiVisits: count(target.aiVisits),
        orders: count(target.orders),
        revenue: target.revenue ?? null,
        currency: target.currency ?? null,
        itemRevenue: count(target.itemRevenue),
      }));
    const group = products.slice(0, DEFAULT_GROUP_SIZE);
    return {
      targetEntity: 'pages',
      targetCount: group.length,
      targets: group.map((product) => ({ id: product.url, label: product.title })),
      pages: group.map((product) => product.url),
      products,
      groupSize: DEFAULT_GROUP_SIZE,
    };
  },
};
