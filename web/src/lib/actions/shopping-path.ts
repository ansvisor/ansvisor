'use server';

import { z } from 'zod';
import { API_BASE_URL } from '@/config/api';
import { createClient } from '@/lib/supabase/server';
import { jsonbBytes } from '@/lib/content/draft-inputs';
import { feedStock, variantStock } from '@/lib/content/feed-match';
import { linkKey } from '@/lib/content/link-targets';
import { MAX_BLOCK_PRODUCTS } from '@/lib/content/product-block';
import type { ShoppingCheck, ShoppingLinkState } from '@/lib/content/shopping-check';
import {
  NO_PATH_REASONS,
  shoppingChoicesSchema,
  shoppingPathSchema,
  type NoPathReason,
  type ShoppingChoices,
  type ShoppingPath,
} from '@/lib/content/shopping-path';
import type { Json } from '@/types/supabase';

/**
 * A draft's shopping path (shopping path, 00351): read and changed by the
 * member through RLS, like the brief; built by the API from the brand's
 * catalog.
 */

const guid = z.guid();
/** The column's 64 KB (00351). */
const MAX_PATH_BYTES = 65_536;
/** The path a change was made on, by when it was built and last changed. */
const readAt = shoppingPathSchema.pick({ builtAt: true, savedAt: true });

/**
 * The draft's shopping path, null until built; `unreadable` when the one
 * kept isn't a path this tab reads (the API builds over it, as over none).
 * Null for the whole answer when the draft can't be read.
 */
export async function getDraftShoppingPath(
  draftId: string,
): Promise<{ path: ShoppingPath | null; unreadable?: true } | null> {
  if (!guid.safeParse(draftId).success) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .select('shopping_path')
    .eq('id', draftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (data.shopping_path == null) return { path: null };
  const parsed = shoppingPathSchema.safeParse(data.shopping_path);
  if (!parsed.success) {
    console.error('The shopping path can’t be read:', parsed.error.issues.slice(0, 3));
    return { path: null, unreadable: true };
  }
  return { path: parsed.data };
}

/**
 * Saves the person's choices (locks, removals, additions) on the path they
 * were made on, its removed products out of the page; the rest of the path
 * stays as the API wrote it. Written only over the path read (its `builtAt`
 * and `savedAt`), so a build or another change since is never overwritten:
 * returned, not thrown, as 'changed', for the tab to read it again.
 */
export async function saveDraftShoppingPath(
  draftId: string,
  read: { builtAt: string; savedAt?: string | null },
  choices: ShoppingChoices,
): Promise<{ path: ShoppingPath } | { error: 'changed' }> {
  const at = readAt.safeParse(read);
  const chosen = shoppingChoicesSchema.safeParse(choices);
  if (!guid.safeParse(draftId).success || !at.success || !chosen.success) {
    throw new Error('invalid');
  }
  const savedAt = at.data.savedAt ?? null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .select('shopping_path')
    .eq('id', draftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('not_found');
  const stored = shoppingPathSchema.safeParse(data.shopping_path);
  if (
    !stored.success ||
    stored.data.builtAt !== at.data.builtAt ||
    (stored.data.savedAt ?? null) !== savedAt
  ) {
    return { error: 'changed' };
  }
  // The path as kept, not as read: its links and stock as the API wrote them.
  const kept = data.shopping_path as { products: { id: string }[] } & Record<string, Json>;
  const removed = new Set(chosen.data.removed);
  const next = {
    ...kept,
    ...chosen.data,
    products: kept.products.filter((p) => !removed.has(p.id)),
    savedAt: new Date().toISOString(),
  };
  if (jsonbBytes(next) > MAX_PATH_BYTES) throw new Error('too_long');
  let write = supabase
    .from('content_drafts')
    .update({ shopping_path: next as unknown as Json })
    .eq('id', draftId)
    .eq('shopping_path->>builtAt', at.data.builtAt);
  write = savedAt
    ? write.eq('shopping_path->>savedAt', savedAt)
    : write.is('shopping_path->>savedAt', null);
  const { data: written, error: writeError } = await write.select('id');
  if (writeError) throw new Error(writeError.message);
  if (!written?.length) return { error: 'changed' };
  return { path: shoppingPathSchema.parse(next) };
}

/**
 * Why a build gave no path: 'changed' when the path changed while it was
 * built (read it again), 'rate_limited' past the API's bucket, else 'failed'.
 */
export type BuildShoppingPathError = 'failed' | 'changed' | 'rate_limited';

export type BuildShoppingPathResult =
  | { path: ShoppingPath }
  | { path: null; reason: NoPathReason }
  | { error: BuildShoppingPathError };

/** Builds the draft's shopping path again from the catalog, the person's choices kept. */
export async function buildDraftShoppingPath(
  draftId: string,
  brandId: string,
): Promise<BuildShoppingPathResult> {
  if (!guid.safeParse(draftId).success || !guid.safeParse(brandId).success) {
    return { error: 'failed' };
  }
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'failed' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/content-drafts/${draftId}/shopping-path`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ brandId }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 429) return { error: 'rate_limited' };
    if (res.status === 409 && body.code === 'changed') return { error: 'changed' };
    if (!res.ok) return { error: 'failed' };
    if (body.path === null) {
      const known: readonly unknown[] = NO_PATH_REASONS;
      // A reason the API added since is said in general words.
      const reason = known.includes(body.reason) ? (body.reason as NoPathReason) : 'other';
      return { path: null, reason };
    }
    const path = shoppingPathSchema.safeParse(body.path);
    return path.success ? { path: path.data } : { error: 'failed' };
  } catch (err) {
    console.error('Failed to build the shopping path:', err);
    return { error: 'failed' };
  }
}

/** A catalog product as Add product finds it. */
export interface CatalogProductHit {
  id: string;
  title: string;
  url: string | null;
}

/** The brand's live catalog products whose title holds `query`, a few at a time. */
export async function searchCatalogProducts(
  brandId: string,
  query: string,
): Promise<CatalogProductHit[]> {
  const text = query.trim().slice(0, 100);
  if (!guid.safeParse(brandId).success || text.length < 2) return [];
  // The pattern's own characters as text: a search for "50%" isn't a wildcard.
  const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('catalog_products')
    .select('id, title, url')
    .eq('brand_id', brandId)
    .is('removed_at', null)
    .ilike('title', pattern)
    .order('title')
    .limit(8);
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({ id: p.id, title: p.title, url: p.url ?? null }));
}

/** A catalog product as a product card shows it (product-block.ts). */
export interface BlockProductRead {
  id: string;
  title: string;
  url: string | null;
  image: string | null;
  price: number | null;
  salePrice: number | null;
  currency: string | null;
  /** A live variant is in stock (feed-match.ts variantStock): only then does it go in a block. */
  inStock: boolean;
}

type Client = Awaited<ReturnType<typeof createClient>>;
interface VariantRead {
  url: string | null;
  price: number | null;
  sale_price: number | null;
  currency: string | null;
  availability: string | null;
}

/**
 * The variant a card shows, as the API's path picks it (shopping-path.js
 * offerOf): the cheapest in stock, its sale price first; null with none in
 * stock.
 */
function blockVariant(variants: VariantRead[]): VariantRead | null {
  const inStock = variants.filter((v) => variantStock(v.availability) === 'in');
  const sellsAt = (v: VariantRead) => v.sale_price ?? v.price ?? 0;
  return (
    inStock.filter((v) => v.price != null).sort((a, b) => sellsAt(a) - sellsAt(b))[0] ??
    inStock[0] ??
    null
  );
}

/**
 * A product's live variants and, with `image`, its picture, read for it
 * alone, so no product's are cut off by another's: the product's own
 * first picture, else a variant's first.
 */
async function readBlockDetails(supabase: Client, id: string, image: boolean) {
  const [variants, images] = await Promise.all([
    supabase
      .from('catalog_variants')
      .select('url, price, sale_price, currency, availability')
      .eq('product_id', id)
      .is('removed_at', null),
    image
      ? supabase
          .from('catalog_images')
          .select('url')
          .eq('product_id', id)
          .order('variant_id', { ascending: true, nullsFirst: true })
          .order('position', { ascending: true })
          .limit(1)
      : null,
  ]);
  if (variants.error) throw new Error(variants.error.message);
  if (images?.error) throw new Error(images.error.message);
  return { variants: variants.data ?? [], image: images?.data?.[0]?.url ?? null };
}

/** A product as a card shows it, from its row and its details. */
function blockProduct(
  product: { id: string; title: string; url: string | null },
  details: Awaited<ReturnType<typeof readBlockDetails>>,
): BlockProductRead {
  const variant = blockVariant(details.variants);
  return {
    id: product.id,
    title: product.title,
    url: product.url ?? details.variants.find((v) => v.url)?.url ?? null,
    image: details.image,
    price: variant?.price ?? null,
    salePrice: variant?.sale_price ?? null,
    currency: variant?.currency ?? null,
    inStock: variant !== null,
  };
}

/**
 * The brand's catalog products by id, as a product card shows them: the
 * product's page, its picture, and the price of its cheapest variant in
 * stock (none, and `inStock` false, when none is). In the order asked,
 * MAX_BLOCK_PRODUCTS at most; a product gone from the catalog is left out.
 */
export async function getProductsForBlock(
  brandId: string,
  ids: string[],
): Promise<BlockProductRead[]> {
  const wanted = [...new Set(ids)]
    .filter((id) => guid.safeParse(id).success)
    .slice(0, MAX_BLOCK_PRODUCTS);
  if (!guid.safeParse(brandId).success || !wanted.length) return [];
  const supabase = await createClient();
  const [products, details] = await Promise.all([
    supabase
      .from('catalog_products')
      .select('id, title, url')
      .eq('brand_id', brandId)
      .is('removed_at', null)
      .in('id', wanted),
    Promise.all(wanted.map((id) => readBlockDetails(supabase, id, true))),
  ]);
  if (products.error) throw new Error(products.error.message);
  const byId = new Map((products.data ?? []).map((p) => [p.id, p]));
  return wanted.flatMap((id, i) => {
    const product = byId.get(id);
    return product ? [blockProduct(product, details[i])] : [];
  });
}

/**
 * Merchant Center refusals that keep a product out of AI shopping: its free
 * listings, which AI Overviews and AI Mode draw on, or an issue with no
 * destination. A refusal for Shopping ads alone doesn't.
 */
const REFUSING_CONTEXTS = new Set(['FREE_LISTINGS', '']);

/**
 * The draft's shopping path read against the catalog now (shopping path,
 * part 6): each product sold out, refused by Merchant Center, gone, or
 * fine; and the category pages. Null without a path, or when it can't be
 * read.
 */
export async function getShoppingCheck(
  draftId: string,
  brandId: string,
): Promise<ShoppingCheck | null> {
  if (!guid.safeParse(draftId).success || !guid.safeParse(brandId).success) return null;
  const read = await getDraftShoppingPath(draftId).catch(() => null);
  const path = read?.path;
  if (!path) return null;
  const ids = [...new Set(path.products.map((p) => p.id))].filter(
    (id) => guid.safeParse(id).success,
  );
  const supabase = await createClient();
  const [products, variants] = await Promise.all([
    ids.length
      ? supabase
          .from('catalog_products')
          .select('id, removed_at')
          .eq('brand_id', brandId)
          .in('id', ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase
          .from('catalog_variants')
          .select('product_id, external_id, availability')
          .in('product_id', ids)
          .is('removed_at', null)
          .order('id')
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (products.error || variants.error) {
    console.error('Failed to read the shopping path’s products:', products.error ?? variants.error);
    return null;
  }
  const externalIds = [...new Set((variants.data ?? []).map((v) => v.external_id))];
  const issues = externalIds.length
    ? await supabase
        .from('catalog_item_issues')
        .select('external_id, reporting_context')
        .eq('brand_id', brandId)
        .eq('severity', 'disapproved')
        .in('external_id', externalIds.slice(0, 500))
    : { data: [], error: null };
  if (issues.error) {
    console.error('Failed to read the Merchant Center issues:', issues.error);
    return null;
  }
  const refused = new Set(
    (issues.data ?? [])
      .filter((i) => REFUSING_CONTEXTS.has(i.reporting_context ?? ''))
      .map((i) => i.external_id),
  );
  const live = new Map((products.data ?? []).map((p) => [p.id, !p.removed_at]));
  const stateOf = (id: string): ShoppingLinkState => {
    if (!live.get(id)) return 'gone';
    const inStock = (variants.data ?? []).filter(
      (v) =>
        v.product_id === id &&
        feedStock([
          {
            availability: v.availability,
            price: null,
            salePrice: null,
            currency: null,
            gtin: null,
          },
        ]) === 'in',
    );
    if (!inStock.length) return 'sold_out';
    return inStock.every((v) => refused.has(v.external_id)) ? 'refused' : 'ok';
  };
  return {
    // A link the path couldn't keep (not http(s)) is null: nothing to check.
    categories: path.categories
      .map((c) => (c.url ? linkKey(c.url) : null))
      .filter((k): k is string => !!k),
    products: path.products.flatMap((p) => {
      const key = p.url ? linkKey(p.url) : null;
      return key ? [{ key, title: p.title, state: stateOf(p.id) }] : [];
    }),
  };
}

/**
 * + Insert › Products' search: the brand's live catalog products whose
 * title holds `query` (searchCatalogProducts), each with its price and
 * stock as a card shows them; no picture.
 */
export async function searchProductsForBlock(
  brandId: string,
  query: string,
): Promise<BlockProductRead[]> {
  const hits = await searchCatalogProducts(brandId, query);
  if (!hits.length) return [];
  const supabase = await createClient();
  const details = await Promise.all(hits.map((hit) => readBlockDetails(supabase, hit.id, false)));
  return hits.map((hit, i) => blockProduct(hit, details[i]));
}
