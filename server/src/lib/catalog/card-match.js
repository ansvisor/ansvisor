import supabaseAdmin from '../../config/supabase.js';
import { linkKey } from '../content-links.js';
import { logger } from '../logger.js';
import { readAllRpcRows } from '../rpc-pages.js';

/**
 * The catalog product behind an AI shopping card (product visibility, part 2;
 * ECOM-005, 00360). Product Visibility counts a brand's products on the AI
 * "shelf", so each product card the brand's own (matched_brand_role 'own')
 * is matched to one product of the brand's catalog (00278), first by what
 * names it exactly, then by its title:
 *
 *   1. the marketplace listing it links (an ASIN, an eBay item id), to a
 *      variant's marketplace_item_id;
 *   2. a GTIN the card carries, to a variant's;
 *   3. its link, to a product's or a variant's page (with or without its
 *      query);
 *   4. its title, when most of its words are one product's (TITLE_MATCH)
 *      and clearly not another's (TITLE_MARGIN). The brand's own name and
 *      filler words don't count.
 *
 * A key two products share names neither. Cards are matched as they're
 * written (cloro-result-handler.js), against a catalog read at most every
 * INDEX_TTL_MS, and all of a brand's recent cards again after its catalog
 * syncs (sweepShoppingCardMatches).
 */

/** The share of two titles' words in common (Dice) a title match needs… */
export const TITLE_MATCH = 0.6;
/** …and by how much it must beat the next product, so two lookalikes match neither. */
export const TITLE_MARGIN = 0.1;
/** How far back a brand's cards are matched again after a catalog sync. */
export const REMATCH_DAYS = 90;
/** Matches written a call. */
const WRITE_BATCH = 500;
/** How long a brand's catalog is kept for matching new cards. */
const INDEX_TTL_MS = 10 * 60 * 1000;
/** Brands' catalogs kept at most; the oldest goes first. */
const MAX_INDEXES = 50;

const AMBIGUOUS = Symbol('ambiguous');

/** Words that say nothing about which product it is. */
const FILLER = new Set([
  'a',
  'an',
  'and',
  'by',
  'for',
  'in',
  'of',
  'on',
  'the',
  'to',
  'with',
  'new',
]);

const FOLD = { ı: 'i', ß: 'ss', ø: 'o', æ: 'ae', œ: 'oe', ł: 'l', đ: 'd', þ: 'th' };

/** A text's words: lowercased, accents and the letters Unicode keeps whole folded, split at the rest. */
export function titleWords(text, skip = FILLER) {
  const folded = String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[ıßøæœłđþ]/g, (c) => FOLD[c]);
  return new Set(folded.split(/[^\p{L}\p{N}]+/u).filter((word) => word && !skip.has(word)));
}

/** A GTIN as digits, without the zeros GTIN-12, -13 and -14 pad it with. */
export function gtinKey(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.replace(/^0+/, '') : null;
}

/** A page's host and path, without its query: a product page linked with its variant or tracking. */
export function pathKey(url) {
  try {
    const parsed = new URL(String(url ?? '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.hostname.toLowerCase().replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return null;
  }
}

/** The GTIN a card's provider gave, if any. */
function cardGtin(card) {
  if (card.gtin) return card.gtin;
  const raw = card.raw && typeof card.raw === 'object' ? card.raw : {};
  for (const key of ['gtin', 'gtin13', 'gtin12', 'gtin14', 'ean', 'upc']) {
    if (typeof raw[key] === 'string' || typeof raw[key] === 'number') return String(raw[key]);
  }
  return null;
}

function setOnce(map, key, productId) {
  if (!key) return;
  const had = map.get(key);
  if (had === undefined) map.set(key, productId);
  else if (had !== productId) map.set(key, AMBIGUOUS);
}

function pick(map, key) {
  if (!key) return null;
  const id = map.get(key);
  return id && id !== AMBIGUOUS ? id : null;
}

/**
 * A brand's catalog as the matcher reads it: its live products' titles and
 * pages, and their variants' listings, GTINs and pages.
 *
 * @param {{ products: { id: string, title: string|null, url: string|null }[], variants: { product_id: string, url: string|null, gtin: string|null, marketplace_item_id: string|null }[] }} catalog
 * @param {{ brandName?: string|null }} [opts] the brand's name: its words don't tell its products apart
 */
export function catalogIndex({ products, variants }, { brandName } = {}) {
  const skip = new Set([...FILLER, ...titleWords(brandName)]);
  const index = {
    skip,
    byListing: new Map(),
    byGtin: new Map(),
    byUrl: new Map(),
    byPath: new Map(),
    titles: [],
    postings: new Map(),
  };
  const addPage = (url, productId) => {
    setOnce(index.byUrl, linkKey(url), productId);
    setOnce(index.byPath, pathKey(url), productId);
  };
  const live = new Set();
  for (const product of products) {
    live.add(product.id);
    if (product.url) addPage(product.url, product.id);
    const words = titleWords(product.title, skip);
    if (!words.size) continue;
    const at = index.titles.length;
    index.titles.push({ id: product.id, words });
    for (const word of words) {
      if (!index.postings.has(word)) index.postings.set(word, []);
      index.postings.get(word).push(at);
    }
  }
  for (const variant of variants) {
    if (!live.has(variant.product_id)) continue;
    setOnce(
      index.byListing,
      variant.marketplace_item_id?.trim().toUpperCase() || null,
      variant.product_id,
    );
    setOnce(index.byGtin, gtinKey(variant.gtin), variant.product_id);
    if (variant.url) addPage(variant.url, variant.product_id);
  }
  return index;
}

/**
 * The catalog product a card shows, and how it was found, or null.
 *
 * @param {{ product_title?: string|null, merchant_url?: string|null, listing_id?: string|null, gtin?: string|null, raw?: object|null }} card
 * @returns {{ productId: string, match: 'listing'|'gtin'|'url'|'title' } | null}
 */
export function matchCard(card, index) {
  const listing = pick(index.byListing, card.listing_id?.trim().toUpperCase() || null);
  if (listing) return { productId: listing, match: 'listing' };
  const gtin = pick(index.byGtin, gtinKey(cardGtin(card)));
  if (gtin) return { productId: gtin, match: 'gtin' };
  if (card.merchant_url) {
    const page =
      pick(index.byUrl, linkKey(card.merchant_url)) ??
      pick(index.byPath, pathKey(card.merchant_url));
    if (page) return { productId: page, match: 'url' };
  }
  const words = titleWords(card.product_title, index.skip);
  if (!words.size) return null;
  const shared = new Map();
  for (const word of words) {
    for (const at of index.postings.get(word) ?? []) shared.set(at, (shared.get(at) ?? 0) + 1);
  }
  let best = null;
  let bestScore = 0;
  let second = 0;
  for (const [at, common] of shared) {
    const score = (2 * common) / (words.size + index.titles[at].words.size);
    if (score > bestScore) {
      second = bestScore;
      bestScore = score;
      best = index.titles[at].id;
    } else if (score > second) {
      second = score;
    }
  }
  return best && bestScore >= TITLE_MATCH && bestScore - second >= TITLE_MARGIN
    ? { productId: best, match: 'title' }
    : null;
}

async function readAll(what, page) {
  const { data, error } = await readAllRpcRows(what, page);
  if (error) throw new Error(`${what} read: ${error.message}`);
  return data;
}

/** A brand's live catalog, read for matching. */
export async function loadCatalogIndex(brandId, { db = supabaseAdmin, brandName = null } = {}) {
  const [products, variants] = await Promise.all([
    readAll('catalog_products', (from, to) =>
      db
        .from('catalog_products')
        .select('id, title, url')
        .eq('brand_id', brandId)
        .is('removed_at', null)
        .order('id')
        .range(from, to),
    ),
    readAll('catalog_variants', (from, to) =>
      db
        .from('catalog_variants')
        .select('id, product_id, url, gtin, marketplace_item_id')
        .eq('brand_id', brandId)
        .is('removed_at', null)
        .order('id')
        .range(from, to),
    ),
  ]);
  return catalogIndex({ products, variants }, { brandName });
}

const indexes = new Map();

/**
 * A brand's catalog for matching the cards being written, read again after
 * INDEX_TTL_MS, or when a sweep has matched the brand's cards since.
 */
export function catalogIndexFor(brandId, opts = {}) {
  const kept = indexes.get(brandId);
  if (kept && Date.now() - kept.at < INDEX_TTL_MS) return kept.index;
  const index = loadCatalogIndex(brandId, opts).catch((err) => {
    indexes.delete(brandId);
    throw err;
  });
  indexes.delete(brandId);
  indexes.set(brandId, { at: Date.now(), index });
  // The oldest read goes first: a Map keeps its keys in insertion order.
  while (indexes.size > MAX_INDEXES) indexes.delete(indexes.keys().next().value);
  return index;
}

/**
 * Matches a brand's own cards of the last REMATCH_DAYS to its catalog as it
 * is now, and writes the matches that changed.
 *
 * @returns {Promise<{ cards: number, matched: number, changed: number }>}
 */
export async function matchBrandShoppingCards(
  brandId,
  { db = supabaseAdmin, now = new Date() } = {},
) {
  const { data: brand, error: brandErr } = await db
    .from('brands')
    .select('name')
    .eq('id', brandId)
    .maybeSingle();
  if (brandErr) throw new Error(`brands read: ${brandErr.message}`);
  const index = await loadCatalogIndex(brandId, { db, brandName: brand?.name ?? null });
  indexes.delete(brandId);
  const since = new Date(now.getTime() - REMATCH_DAYS * 86_400_000).toISOString();
  const cards = await readAll('prompt_result_shopping_cards', (from, to) =>
    db
      .from('prompt_result_shopping_cards')
      .select(
        'id, product_title, merchant_url, listing_id, gtin:raw->>gtin, catalog_product_id, catalog_match',
      )
      .eq('brand_id', brandId)
      .eq('matched_brand_role', 'own')
      .gte('created_at', since)
      .order('id')
      .range(from, to),
  );
  let matched = 0;
  const changes = [];
  for (const card of cards) {
    const found = matchCard(card, index);
    if (found) matched += 1;
    const productId = found?.productId ?? null;
    const match = found?.match ?? null;
    if (productId !== (card.catalog_product_id ?? null) || match !== (card.catalog_match ?? null)) {
      changes.push({ id: card.id, product_id: productId, match });
    }
  }
  let changed = 0;
  for (let at = 0; at < changes.length; at += WRITE_BATCH) {
    const { data, error } = await db.rpc('set_shopping_card_matches', {
      p_brand_id: brandId,
      p_matches: changes.slice(at, at + WRITE_BATCH),
    });
    if (error) throw new Error(`set_shopping_card_matches: ${error.message}`);
    changed += Number(data ?? 0);
  }
  return { cards: cards.length, matched, changed };
}

/** Catalogs read again within this long are matched again by the daily sweep. */
const SWEEP_SYNCED_WITHIN_MS = 26 * 60 * 60 * 1000;

/**
 * The daily run, after the catalog sweep: each brand whose catalog synced
 * in the last day has its recent cards matched again, one brand at a time.
 * A brand's failure is logged and the others go on.
 */
export async function sweepShoppingCardMatches({ db = supabaseAdmin, now = new Date() } = {}) {
  const since = new Date(now.getTime() - SWEEP_SYNCED_WITHIN_MS).toISOString();
  const { data, error } = await db
    .from('catalog_sources')
    .select('brand_id')
    .eq('last_status', 'ok')
    .gte('last_synced_at', since);
  if (error) throw new Error(`catalog_sources read: ${error.message}`);
  const brands = [...new Set((data ?? []).map((row) => row.brand_id))];
  let changed = 0;
  for (const brandId of brands) {
    try {
      changed += (await matchBrandShoppingCards(brandId, { db, now })).changed;
    } catch (err) {
      logger.error(
        { err: { name: err?.name, message: err?.message }, brandId },
        '[card-match] brand failed',
      );
    }
  }
  return { brands: brands.length, changed };
}
