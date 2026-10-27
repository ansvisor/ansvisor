import * as cheerio from 'cheerio';
import supabaseAdmin from '../config/supabase.js';
import { isInStock } from './catalog/stock.js';
import { selectInChunks } from './chunked-in.js';
import { linkKey } from './content-links.js';
import { logger } from './logger.js';
import { readAllRpcRows } from './rpc-pages.js';
import { fetchPage } from './safe-fetch.js';
import { readIn, readShoppingPath, refuses } from './shopping-path.js';

/**
 * Whether a page's shopping links still sell (shopping path, part 7, 00352).
 *
 * After each catalog sync, every draft of the brand with a shopping path is
 * read again: the live page where it is published, else the draft. Its links
 * are matched to the path's category pages and products (by link-targets'
 * key, as the editor's Rules and Before you publish match them), and each
 * linked product is read as the catalog has it now: sold out (no variant in
 * stock), refused (Merchant Center refuses every variant in stock in its free
 * listings) or gone from the catalog. What it finds is kept per draft in
 * content_shopping_checks, for the Content Library's Shopping path column.
 *
 * Only the path's products are checked: a product linked by hand from
 * outside the path isn't known to be one.
 */

/** Drafts read a request: their HTML comes with them. */
export const DRAFT_BATCH = 50;
/** The most drafts with a path a brand's check reads, in id order. */
export const MAX_DRAFTS = 1000;
/** Live pages one check reads at most, one at a time; the rest are read from their draft. */
export const MAX_LIVE_PAGES = 50;
/** A live page's read: its links are in its first megabyte. */
const PAGE_TIMEOUT_MS = 10_000;
const PAGE_BYTES = 1024 * 1024;
/** A check stops reading live pages after this, and reads the rest from their drafts. */
export const LIVE_PAGES_DEADLINE_MS = 3 * 60 * 1000;

const TITLE_CHARS = 200;
const MAX_BAD = 40;

/**
 * Every link's address in a page's HTML, and in the HTML blocks the editor
 * keeps base64-encoded (`div[data-html-block]`, a product grid among them).
 * A relative address is read against `base`, the live page's own; without
 * one it is dropped, as a draft's links are full addresses.
 */
export function pageHrefs(html, base = null) {
  const hrefs = [];
  const read = (markup, nested) => {
    const $ = cheerio.load(markup);
    $('a[href]').each((_, a) => {
      const href = String($(a).attr('href') ?? '').trim();
      if (!href) return;
      try {
        hrefs.push(base ? new URL(href, base).toString() : new URL(href).toString());
      } catch {
        // Not an address: a broken href, or a relative one without a base.
      }
    });
    if (nested) return;
    $('[data-html-block]').each((_, el) => {
      const code = Buffer.from(String($(el).attr('data-html-block') ?? ''), 'base64').toString(
        'utf8',
      );
      if (code) read(code, true);
    });
  };
  read(String(html ?? ''), false);
  return hrefs;
}

/**
 * Each product's state as the catalog has it now, by id: 'gone' (not in the
 * brand's catalog, or removed from it), 'sold_out' (no variant in stock),
 * 'refused' (Merchant Center refuses every variant in stock) or 'ok'; and
 * its page in the catalog (its link, else a variant's), for a product the
 * path keeps no link for.
 *
 * @returns {Promise<{ states: Map<string, string>, pages: Map<string, string> }>}
 */
export async function productStates(db, brandId, ids) {
  const unique = [...new Set(ids)];
  const states = new Map(unique.map((id) => [id, 'gone']));
  const pages = new Map();
  if (!unique.length) return { states, pages };
  const products = await readIn(db, 'catalog_products', 'id, url, removed_at', 'id', unique, {
    order: 'id',
    more: (q) => q.eq('brand_id', brandId),
  });
  const live = products.filter((p) => !p.removed_at).map((p) => p.id);
  const variants = await readIn(
    db,
    'catalog_variants',
    'id, product_id, external_id, url, availability',
    'product_id',
    live,
    { order: 'id', more: (q) => q.eq('brand_id', brandId).is('removed_at', null) },
  );
  for (const product of products) {
    const url = product.url ?? variants.find((v) => v.product_id === product.id && v.url)?.url;
    if (url) pages.set(product.id, url);
  }
  const inStock = variants.filter((v) => isInStock(v.availability));
  const issues = await readIn(
    db,
    'catalog_item_issues',
    'id, external_id, severity, reporting_context',
    'external_id',
    [...new Set(inStock.map((v) => v.external_id))],
    { order: 'id', more: (q) => q.eq('brand_id', brandId).eq('severity', 'disapproved') },
  );
  const refused = new Set(issues.filter(refuses).map((i) => i.external_id));
  for (const id of live) {
    const offered = inStock.filter((v) => v.product_id === id);
    states.set(
      id,
      !offered.length
        ? 'sold_out'
        : offered.every((v) => refused.has(v.external_id))
          ? 'refused'
          : 'ok',
    );
  }
  return { states, pages };
}

/** A path's products and the ones the person removed or it left out: every id to read. */
export function pathProductIds(path) {
  return [
    ...new Set([
      ...path.products.map((p) => p.id),
      ...path.removed,
      ...path.leftOut.map((p) => p.id),
    ]),
  ];
}

/**
 * What a page's links do with its path, as the editor's Rules read them
 * (web lib/content/shopping-check.ts): how many of its category pages and
 * of its products that sell it links, and the products it links that no
 * longer sell. A product the person removed or the path left out counts
 * only when it no longer sells: the page may still link it.
 *
 * @param {{ states: Map<string, string>, pages: Map<string, string> }} catalog
 */
export function linkCheck(hrefs, path, { states, pages }) {
  const keys = new Set(hrefs.map((href) => linkKey(href)).filter(Boolean));
  const categories = [...new Set(path.categories.map((c) => linkKey(c.url)).filter(Boolean))];
  const inPath = new Set(path.products.map((p) => p.id));
  const leftOutTitles = new Map(path.leftOut.map((p) => [p.id, p.title]));
  const checked = [
    ...path.products.map((p) => ({ id: p.id, title: p.title, url: p.url, inPath: true })),
    ...[...new Set([...path.removed, ...path.leftOut.map((p) => p.id)])]
      .filter((id) => !inPath.has(id))
      .map((id) => ({
        id,
        title: leftOutTitles.get(id) ?? null,
        url: pages.get(id),
        inPath: false,
      })),
  ];
  const linked = [];
  const seenPages = new Set();
  for (const product of checked) {
    const key = product.url ? linkKey(product.url) : null;
    // One per page: the path's first, before a removed one with the same page.
    if (!key || !keys.has(key) || seenPages.has(key)) continue;
    seenPages.add(key);
    const state = states.get(product.id) ?? 'gone';
    if (!product.inPath && state === 'ok') continue;
    linked.push({
      id: product.id,
      title: String(product.title ?? '').slice(0, TITLE_CHARS),
      state,
      inPath: product.inPath,
    });
  }
  const selling = path.products.filter((p) => (states.get(p.id) ?? 'gone') === 'ok').length;
  return {
    categories: categories.length,
    categoriesLinked: categories.filter((key) => keys.has(key)).length,
    products: selling,
    productsLinked: linked.filter((p) => p.inPath && p.state === 'ok').length,
    bad: linked
      .filter((p) => p.state !== 'ok')
      .map(({ inPath: _inPath, ...p }) => p)
      .slice(0, MAX_BAD),
  };
}

/** Where a draft is live: its CMS's address, or an optimized page's own, once published. */
export function livePage(draft) {
  if (draft.status !== 'published') return null;
  const url = draft.published_url ?? (draft.method === 'optimize' ? draft.source_url : null);
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
}

/** A live page's links, or null when it can't be read (the draft's are read instead). */
async function liveHrefs(url, readPage) {
  try {
    const page = await readPage(url, {
      timeoutMs: PAGE_TIMEOUT_MS,
      maxBytes: PAGE_BYTES,
      truncate: true,
    });
    if (page.status >= 400) return null;
    return pageHrefs(page.html, page.url);
  } catch {
    return null;
  }
}

/** The brand's primary site, as a base for a draft's relative links; null when none. */
async function primarySite(db, brandId) {
  const { data, error } = await db
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', brandId)
    .eq('is_primary', true)
    .maybeSingle();
  if (error || !data?.domain) return null;
  return /^https?:\/\//i.test(data.domain) ? data.domain : `https://${data.domain}`;
}

/** The brand's drafts with a shopping path, a batch at a time, in id order. */
async function draftBatch(db, brandId, from) {
  const { data, error } = await db
    .from('content_drafts')
    .select('id, status, method, source_url, published_url, body_html, shopping_path')
    .eq('brand_id', brandId)
    .is('archived_at', null)
    .not('shopping_path', 'is', null)
    .order('id')
    .range(from, from + DRAFT_BATCH - 1);
  if (error) throw new Error(`content_drafts read: ${error.message}`);
  return data ?? [];
}

/** Rows of drafts that lost their path or were archived since: not in `kept`. */
async function dropStale(db, brandId, kept) {
  const { data, error } = await readAllRpcRows('content_shopping_checks', (from, to) =>
    db
      .from('content_shopping_checks')
      .select('draft_id')
      .eq('brand_id', brandId)
      .order('draft_id')
      .range(from, to),
  );
  if (error) throw new Error(`content_shopping_checks read: ${error.message}`);
  const stale = data.map((r) => r.draft_id).filter((id) => !kept.has(id));
  const { error: dropErr } = await selectInChunks(stale, (chunk) =>
    db.from('content_shopping_checks').delete().eq('brand_id', brandId).in('draft_id', chunk),
  );
  if (dropErr) throw new Error(`content_shopping_checks delete: ${dropErr.message}`);
  return stale.length;
}

/**
 * Checks a brand's pages' shopping links and keeps what it finds.
 *
 * @param {string} brandId
 * @param {{ db?: object, now?: Date, readPage?: Function, livePages?: number }} [opts]
 *   `readPage` reads a live page (safe-fetch's fetchPage); tests pass their own.
 * @returns {Promise<{ drafts: number, live: number, attention: number, dropped: number }>}
 */
export async function checkShoppingLinks(
  brandId,
  { db = supabaseAdmin, now = new Date(), readPage = fetchPage, livePages = MAX_LIVE_PAGES } = {},
) {
  const started = Date.now();
  const site = await primarySite(db, brandId);
  const kept = new Set();
  let live = 0;
  let attention = 0;
  // Whether every draft with a path was read: only then is a row no draft
  // was read for a stale one.
  let complete = false;
  for (let from = 0; from < MAX_DRAFTS; from += DRAFT_BATCH) {
    const drafts = await draftBatch(db, brandId, from);
    const paths = drafts
      .map((d) => ({ draft: d, path: readShoppingPath(d.shopping_path, { draftId: d.id }) }))
      .filter((d) => d.path);
    const catalog = await productStates(
      db,
      brandId,
      paths.flatMap((d) => pathProductIds(d.path)),
    );
    const rows = [];
    for (const { draft, path } of paths) {
      const url = livePage(draft);
      const canRead = url && live < livePages && Date.now() - started < LIVE_PAGES_DEADLINE_MS;
      const fromPage = canRead ? await liveHrefs(url, readPage) : null;
      if (canRead) live += 1;
      // A draft's relative link ("/products/x") is read against its page, else the brand's site.
      const base = url ?? draft.source_url ?? site;
      const check = linkCheck(fromPage ?? pageHrefs(draft.body_html, base), path, catalog);
      if (check.bad.length) attention += 1;
      kept.add(draft.id);
      rows.push({
        draft_id: draft.id,
        brand_id: brandId,
        read_from: fromPage ? 'page' : 'draft',
        page_url: fromPage ? url : null,
        categories: check.categories,
        categories_linked: check.categoriesLinked,
        products: check.products,
        products_linked: check.productsLinked,
        bad: check.bad,
        checked_at: now.toISOString(),
      });
    }
    if (rows.length) {
      const { error } = await db
        .from('content_shopping_checks')
        .upsert(rows, { onConflict: 'draft_id' });
      if (error) throw new Error(`content_shopping_checks write: ${error.message}`);
    }
    if (drafts.length < DRAFT_BATCH) {
      complete = true;
      break;
    }
  }
  const dropped = complete ? await dropStale(db, brandId, kept) : 0;
  return { drafts: kept.size, live, attention, dropped };
}

/** Brands waiting for their check, with the check's options. */
const queued = new Map();
let draining = null;

/**
 * Checks a brand's pages after a catalog sync, behind the API's other work:
 * one brand at a time, and a brand synced again while it waits is checked
 * once. A failure is logged; the next sync checks again.
 */
export function queueShoppingCheck(brandId, opts = {}) {
  queued.set(brandId, opts);
  if (!draining) {
    draining = (async () => {
      while (queued.size) {
        const [[next, options]] = queued;
        queued.delete(next);
        try {
          const result = await checkShoppingLinks(next, options);
          if (result.drafts || result.dropped) {
            logger.info({ brandId: next, ...result }, '[shopping-check] pages checked');
          }
        } catch (err) {
          logger.error(
            { err: { name: err?.name, message: err?.message }, brandId: next },
            '[shopping-check] check failed',
          );
        }
      }
    })().finally(() => {
      draining = null;
    });
  }
  return draining;
}
