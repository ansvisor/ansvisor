import supabaseAdmin from '../../config/supabase.js';
import { onBrandDomain } from '../audit/host.js';

/**
 * Where each catalog category lives on the brand's site (shopping path, 00350):
 * the page a buying guide or a comparison links for "hiking boots".
 *
 * A category with no decision is matched, on every read, to one of the
 * brand's own pages (site_pages, 00104) whose address reads as a category
 * page, the same rule the editor's page types use (web/src/lib/content/
 * page-types.ts): /collections/…, /category/…, /c/…, /shop/…, and
 * WooCommerce's /product-category/…; never a product page or a themed
 * collection (gifts, bundles, best sellers). The best match wins:
 *   1. 'address': the page's last path segment is the category's name
 *      ("Shoes > Hiking Boots" → hiking-boots);
 *   2. 'title': the page's title or h1 holds the category's name;
 *   3. 'words': most of the name's words are in the address or the title.
 * Ties go to the page AI cites, then visits, more. A person's decision
 * (catalog_category_pages) replaces the match: a page, or none.
 */

/** Site pages read for a brand at most (site_pages keeps 500). */
const MAX_PAGES = 500;
/** Share of a category's words a page must hold for a 'words' match. */
export const WORDS_SHARE = 0.66;

const PRODUCT_PATH = /\/(products?|p|dp|items?)\/[^/]+/;
const THEMED_PATH =
  /\/collections?\/(?:[^/]*-)?(gifts?|bundles?|kits?|sets?|best-?sellers?|new-arrivals?|picks|edit)(?:-|\/|$)|\/collections?\/(?:[^/]*-)?for-[a-z]/;
const CATEGORY_PATH =
  /\/(collections?|categor(?:y|ies)|product-categor(?:y|ies)|c|shop|catalog|departments?)\/([^/]+)/;

/** The lowercased path with no trailing slash or file extension, or null. */
function pathOf(url) {
  try {
    return new URL(url).pathname
      .toLowerCase()
      .replace(/\.[a-z0-9]{1,5}$/, '')
      .replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** A category page's last path segment ("hiking-boots"), or null when the address isn't one. */
export function categorySlug(url) {
  const path = pathOf(url);
  if (!path || PRODUCT_PATH.test(path) || THEMED_PATH.test(path)) return null;
  if (!CATEGORY_PATH.test(path)) return null;
  const last = path.split('/').filter(Boolean).pop();
  return last ? decodeURIComponent(last) : null;
}

/** A category's own name: the last step of "Shoes > Hiking Boots". */
export function leafName(category) {
  const steps = String(category ?? '')
    .split(/\s*[>›/|]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return steps.length ? steps[steps.length - 1] : '';
}

/** A word's singular, roughly: boots → boot, glasses → glass, boxes → box; dress stays. */
function singular(word) {
  if (word.length > 4 && /(ss|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Lowercase words, a plural's "s" dropped: "Hiking Boots" → ["hiking", "boot"]. */
export function wordsOf(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && w !== 'and' && w !== 'the' && w !== 'for')
    .map(singular);
}

const slugOf = (text) => wordsOf(text).join('-');
const RANK = { address: 3, title: 2, words: 1 };

/** How well a page matches a category, or null: 'address', 'title' or 'words'. */
export function matchOf(category, page) {
  const slug = categorySlug(page.url);
  if (!slug) return null;
  const leaf = leafName(category);
  const name = slugOf(leaf);
  if (!name) return null;
  if (slugOf(slug) === name) return 'address';
  const heading = `${page.title ?? ''} ${page.h1 ?? ''}`;
  if (` ${wordsOf(heading).join(' ')} `.includes(` ${name.replace(/-/g, ' ')} `)) return 'title';
  const want = new Set(wordsOf(leaf));
  const have = new Set([...wordsOf(slug), ...wordsOf(heading)]);
  const common = [...want].filter((w) => have.has(w)).length;
  return want.size && common / want.size >= WORDS_SHARE ? 'words' : null;
}

/**
 * Each category's best page among `pages`, or none: `{ category, page, how }`.
 * Pure: `pages` are site_pages rows (url, title, h1, ai_citations, ga_sessions).
 */
export function matchCategoryPages(categories, pages) {
  return categories.map((category) => {
    let best = null;
    for (const page of pages) {
      const how = matchOf(category, page);
      if (!how) continue;
      const score = [RANK[how], page.ai_citations ?? 0, page.ga_sessions ?? 0];
      if (!best || compare(score, best.score) > 0) best = { page, how, score };
    }
    return {
      category,
      page: best ? { url: best.page.url, title: best.page.title || best.page.h1 || null } : null,
      how: best?.how ?? null,
    };
  });
}

function compare(a, b) {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * The brand's categories, each with its live products, how many are in
 * stock, and its page: a person's decision first ('manual', or none), else
 * the best match. The categories with the most products first.
 *
 * @returns {Promise<{ name: string, products: number, inStock: number,
 *   page: { url: string, title: string|null }|null,
 *   how: 'manual'|'address'|'title'|'words'|null }[]>}
 */
export async function categoryPages(brandId, { db = supabaseAdmin } = {}) {
  const [counts, pages, decisions] = await Promise.all([
    db.rpc('catalog_category_counts', { p_brand_id: brandId }),
    db
      .from('site_pages')
      .select('url, title, h1, ai_citations, ga_sessions')
      .eq('brand_id', brandId)
      .or('fetch_status.is.null,and(fetch_status.gte.200,fetch_status.lt.400)')
      .limit(MAX_PAGES),
    db.from('catalog_category_pages').select('category, url').eq('brand_id', brandId),
  ]);
  for (const [what, read] of [
    ['category counts', counts],
    ['site pages', pages],
    ['category pages', decisions],
  ]) {
    if (read.error) throw new Error(`${what} read: ${read.error.message}`);
  }
  const decided = new Map((decisions.data ?? []).map((d) => [d.category, d.url]));
  const rows = (counts.data ?? [])
    .slice()
    .sort((a, b) => b.products - a.products || a.category.localeCompare(b.category));
  const matched = matchCategoryPages(
    rows.filter((r) => !decided.has(r.category)).map((r) => r.category),
    pages.data ?? [],
  );
  const byName = new Map(matched.map((m) => [m.category, m]));
  return rows.map((r) => {
    const base = { name: r.category, products: r.products, inStock: r.in_stock };
    if (decided.has(r.category)) {
      const url = decided.get(r.category);
      return { ...base, page: url ? { url, title: null } : null, how: url ? 'manual' : null };
    }
    const m = byName.get(r.category);
    return { ...base, page: m?.page ?? null, how: m?.how ?? null };
  });
}

export class CategoryPageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CategoryPageError';
    this.code = code;
  }
}

/**
 * A person's decision for a category: its page (`url`, on the brand's
 * domains), none (`url` null), or back to the automatic match (`url`
 * undefined). The caller has checked the person may.
 */
export async function setCategoryPage(
  { brandId, category, url, userId },
  { db = supabaseAdmin } = {},
) {
  const name = String(category ?? '').trim();
  if (!name || name.length > 750) throw new CategoryPageError('invalid', 'Pick a category.');
  if (url === undefined) {
    const { error } = await db
      .from('catalog_category_pages')
      .delete()
      .eq('brand_id', brandId)
      .eq('category', name);
    if (error) throw new Error(`catalog_category_pages delete: ${error.message}`);
    return;
  }
  let address = null;
  if (url !== null) {
    try {
      const parsed = new URL(String(url).trim());
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password)
        throw new Error();
      address = parsed.href;
    } catch {
      throw new CategoryPageError('invalid', "That isn't a web address. Paste the page's address.");
    }
    if (address.length > 2048) throw new CategoryPageError('invalid', 'That address is too long.');
    const { data, error } = await db.from('brand_domains').select('domain').eq('brand_id', brandId);
    if (error) throw new Error(`brand_domains read: ${error.message}`);
    if (
      !onBrandDomain(
        address,
        (data ?? []).map((d) => d.domain),
      )
    ) {
      throw new CategoryPageError('off_site', "The page must be on the brand's own site.");
    }
  }
  const { error } = await db.from('catalog_category_pages').upsert(
    {
      brand_id: brandId,
      category: name,
      url: address,
      set_by: userId,
      set_at: new Date().toISOString(),
    },
    { onConflict: 'brand_id,category' },
  );
  if (error) throw new Error(`catalog_category_pages write: ${error.message}`);
}
