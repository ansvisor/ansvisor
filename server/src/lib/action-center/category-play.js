import { z } from 'zod';
import supabaseAdmin from '../../config/supabase.js';
import { categoryPages } from '../catalog/category-pages.js';
import { isInStock, stockKey } from '../catalog/stock.js';
import { topicCategories } from '../catalog/topic-categories.js';
import { logger } from '../logger.js';
import { PRODUCTS_FOR } from '../shopping-path.js';

/**
 * The category page play (AC plan P-7, spec §6.2): on an online store, a
 * topic action (G16) whose topic is about a category of the catalog with a
 * live page optimizes that page, rather than writing a new one. The topic's
 * prompts and questions feed the draft as for any action; its shopping
 * path starts with the category's best sellers in stock, locked
 * (actionShoppingSeed: payload.products).
 *
 * A topic's categories are topic-categories.js's (worked out, or a
 * person's); a category's page is category-pages.js's (matched, or a
 * person's). The first of the topics' categories with a page and a product
 * in stock is the one.
 *
 * A topic whose categories have products in stock but no live page writes
 * a buying guide for it instead (EC-1, spec §6.2): a new page, its shopping
 * path starting with the category's best sellers. One whose category page
 * is live but has no buying guide yet (`guideMissing`) is told to write one
 * next to that page, linking it, beside the page's own work.
 */

/** The page type a category page is written as (content-page-types.js). */
export const CATEGORY_PAGE_TYPE = 'category_page';
/** The page a topic writes when its category has no page (EC-1). */
export const BUYING_GUIDE_TYPE = 'buying_guide';
/** Best sellers read at most, to keep the ones in stock. */
const CANDIDATES = 40;
/** Days of AI visits and orders the best sellers are ranked by. */
const SALES_DAYS = 30;
const DAY_MS = 86_400_000;
/**
 * A category needs this many products in stock for a buying guide, as Plan ›
 * Shopping opportunities asks (web/src/lib/content/shopping-plan.ts, MIN_IN_STOCK).
 */
export const GUIDE_MIN_IN_STOCK = 3;
/** The newest drafts read, as the Plan reads them (lib/actions/shopping-plan.ts, DRAFT_LIMIT). */
const DRAFTS_READ = 1000;

/** The words the Plan leaves out of a text's (web/src/lib/content/sources.ts, STOP_WORDS). */
const STOP_WORDS = new Set(
  (
    'the and for with what which how are is was were you your our from that this does do did can ' +
    'vs not but has have had who why when where will would should could into about than then there ' +
    'their they them its it as at by of on in to or be an a'
  ).split(' '),
);

/**
 * A text's words as the Plan matches them (sources.ts, wordsOf), not as
 * catalog/category-pages.js does: lowercased, three letters or more,
 * plurals as singulars.
 */
function planWordsOf(text) {
  const words = String(text ?? '')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu);
  return (words ?? [])
    .filter((w) => (w.length >= 3 || /^\d+$/.test(w)) && !STOP_WORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

/** A category's own name: "Hiking Boots" of "Shoes > Hiking Boots". */
export function categoryLeaf(name) {
  const text = String(name ?? '');
  const steps = text
    .split(/\s*[>›/|]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return steps.at(-1) ?? text.trim();
}

/**
 * Whether a draft covers a category, so it needs no buying guide: the draft's
 * shopping path holds it (by its full name), or every word of its own name
 * is in the draft's title. Plan › Shopping opportunities' rule (web/src/lib/
 * content/shopping-plan.ts, coversCategory), kept in step with it: both
 * sides test the cases in web/src/lib/content/__fixtures__/guide-covering.json.
 *
 * @param {{ title: string, categories: string[] }} draft
 * @param {string} category the category's full name
 */
export function guideCovers(draft, category) {
  if ((draft.categories ?? []).includes(category)) return true;
  const leafWords = [...new Set(planWordsOf(categoryLeaf(category)))];
  const titleWords = new Set(planWordsOf(draft.title));
  return leafWords.length > 0 && leafWords.every((w) => titleWords.has(w));
}

/**
 * Whether a category is missing its buying guide: enough products in stock
 * for one, and no draft of the brand, written or published, covers it (the
 * Plan's guide row with no draft to open).
 *
 * @param {{ category: { name: string, inStock: number },
 *   drafts: { title: string, categories: string[] }[] }} input
 */
export function guideMissing({ category, drafts = [] }) {
  if (!(category.inStock >= GUIDE_MIN_IN_STOCK)) return false;
  return !drafts.some((draft) => guideCovers(draft, category.name));
}

/** A draft's shopping path's categories, by name, as the Plan reads them; none when unreadable. */
const pathCategories = z
  .array(z.object({ name: z.string() }).passthrough())
  .catch([])
  .transform((list) => list.map((c) => c.name));

/**
 * Whether the brand's category is missing its buying guide (above), read
 * from its drafts as the Plan reads them: not archived, the newest first.
 */
export async function categoryGuideMissing(brandId, category, { db = supabaseAdmin } = {}) {
  const { data, error } = await db
    .from('content_drafts')
    .select('title, shopping_categories:shopping_path->categories')
    .eq('brand_id', brandId)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(DRAFTS_READ);
  if (error) throw new Error(`content_drafts read: ${error.message}`);
  const drafts = (data ?? []).map((row) => ({
    title: row.title ?? '',
    categories: pathCategories.parse(row.shopping_categories),
  }));
  return guideMissing({ category, drafts });
}

/**
 * The category whose page the action optimizes: the first, in the topics'
 * order then each topic's own, with a page and a product in stock. Else the
 * first with a product in stock and no page (`url` null), for a buying
 * guide. Null for none.
 *
 * @param {{ topicIds: string[], topics: { id: string, categories: { id: string,
 *   name: string }[] }[], pages: { name: string, inStock: number,
 *   page: { url: string } | null }[] }} input
 */
export function pickCategoryPage({ topicIds = [], topics = [], pages = [] }) {
  const byName = new Map(pages.map((p) => [p.name, p]));
  const linked = topicIds.flatMap(
    (topicId) => topics.find((t) => t.id === topicId)?.categories ?? [],
  );
  const stocked = linked
    .map((category) => ({ category, row: byName.get(category.name) }))
    .filter(({ row }) => row && row.inStock > 0);
  const live = stocked.find(({ row }) => row.page?.url);
  const pick = live ?? stocked[0];
  if (!pick) return null;
  return {
    id: pick.category.id,
    name: pick.category.name,
    url: pick.row.page?.url ?? null,
    inStock: pick.row.inStock,
  };
}

/**
 * A category's best sellers in stock, as many as a category page's path
 * links: orders from AI visits first, then AI visits (00361, the last 30
 * days), then the rest of the category.
 */
export async function categoryBestSellers(
  brandId,
  categoryId,
  { db = supabaseAdmin, now = new Date(), max = PRODUCTS_FOR[CATEGORY_PAGE_TYPE] } = {},
) {
  const [members, stats] = await Promise.all([
    db
      .from('catalog_product_categories')
      .select('product_id')
      .eq('brand_id', brandId)
      .eq('category_id', categoryId)
      .limit(1000),
    db.rpc('catalog_product_ai_stats', {
      p_brand_id: brandId,
      p_from: new Date(now.getTime() - SALES_DAYS * DAY_MS).toISOString(),
    }),
  ]);
  if (members.error) throw new Error(`catalog_product_categories read: ${members.error.message}`);
  if (stats.error) throw new Error(`catalog_product_ai_stats read: ${stats.error.message}`);
  const statsOf = new Map((stats.data ?? []).map((row) => [row.product_id, row]));
  const value = (id) => statsOf.get(id) ?? { orders: 0, ai_visits: 0 };
  const ids = [...new Set((members.data ?? []).map((m) => m.product_id))]
    .sort(
      (a, b) =>
        Number(value(b).orders) - Number(value(a).orders) ||
        Number(value(b).ai_visits) - Number(value(a).ai_visits) ||
        (a < b ? -1 : 1),
    )
    .slice(0, CANDIDATES);
  if (!ids.length) return [];

  const [live, variants] = await Promise.all([
    db
      .from('catalog_products')
      .select('id')
      .eq('brand_id', brandId)
      .in('id', ids)
      .is('removed_at', null),
    db
      .from('catalog_variants')
      .select('product_id, availability')
      .eq('brand_id', brandId)
      .in('product_id', ids)
      .is('removed_at', null),
  ]);
  if (live.error) throw new Error(`catalog_products read: ${live.error.message}`);
  if (variants.error) throw new Error(`catalog_variants read: ${variants.error.message}`);
  const liveIds = new Set((live.data ?? []).map((p) => p.id));
  const stock = new Map();
  for (const v of variants.data ?? []) {
    const read = typeof v.availability === 'string' && v.availability.trim();
    const entry = stock.get(v.product_id) ?? { read: false, inStock: false };
    if (read) entry.read = true;
    if (read && isInStock(stockKey(v.availability))) entry.inStock = true;
    stock.set(v.product_id, entry);
  }
  // In stock: a variant is, or no stock is read for it.
  const buyable = (id) => !stock.get(id)?.read || stock.get(id).inStock;
  return ids.filter((id) => liveIds.has(id) && buyable(id)).slice(0, max);
}

/**
 * The category for a store's topic action, and its best sellers, as many
 * as its page links (a category page's, or a buying guide's when it has
 * no page): null when none of its topics' categories has a product in stock.
 * With a live page, whether the category is missing its buying guide too
 * (`guideMissing`); best effort: a failed read says it isn't, and the page's
 * play goes ahead.
 */
export async function categoryPageFor(
  brandId,
  topicIds,
  { db = supabaseAdmin, now = new Date() } = {},
) {
  if (!topicIds.length) return null;
  const [links, pages] = await Promise.all([
    topicCategories(brandId, { db }),
    categoryPages(brandId, { db }),
  ]);
  const category = pickCategoryPage({ topicIds, topics: links.topics, pages });
  if (!category) return null;
  const [products, missing] = await Promise.all([
    categoryBestSellers(brandId, category.id, {
      db,
      now,
      max: PRODUCTS_FOR[category.url ? CATEGORY_PAGE_TYPE : BUYING_GUIDE_TYPE],
    }),
    category.url
      ? categoryGuideMissing(brandId, category, { db }).catch((err) => {
          logger.warn(
            { brandId, err: err.message },
            "[actions] category's buying guide not looked for",
          );
          return false;
        })
      : false,
  ]);
  return { category, products, guideMissing: missing };
}
