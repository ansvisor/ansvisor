'use server';

import { z } from 'zod';
import { API_BASE_URL } from '@/config/api';
import { createClient } from '@/lib/supabase/server';
import { jsonbBytes } from '@/lib/content/draft-inputs';
import {
  shoppingPathSchema,
  type NoPathReason,
  type ShoppingPath,
} from '@/lib/content/shopping-path';

/**
 * A draft's shopping path (shopping path, 00351): read and changed by the
 * member through RLS, like the brief; built by the API from the brand's
 * catalog.
 */

const guid = z.guid();
/** The column's 64 KB (00351). */
const MAX_PATH_BYTES = 65_536;

/** The draft's shopping path, null until built; null for the whole answer when it can't be read. */
export async function getDraftShoppingPath(
  draftId: string,
): Promise<{ path: ShoppingPath | null } | null> {
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
    return null;
  }
  return { path: parsed.data };
}

/** The path as the person changed it (a lock, a removal). Throws 'not_found' when no row changed. */
export async function saveDraftShoppingPath(
  draftId: string,
  path: ShoppingPath,
): Promise<ShoppingPath> {
  const parsed = shoppingPathSchema.safeParse(path);
  if (!guid.safeParse(draftId).success || !parsed.success) throw new Error('invalid');
  if (jsonbBytes(parsed.data) > MAX_PATH_BYTES) throw new Error('too_long');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .update({ shopping_path: parsed.data })
    .eq('id', draftId)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('not_found');
  return parsed.data;
}

export type BuildShoppingPathResult =
  | { path: ShoppingPath }
  | { path: null; reason: NoPathReason }
  | { error: 'failed' };

const NO_PATH_REASONS: readonly NoPathReason[] = ['not_a_shop', 'page_type', 'no_catalog'];

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
    if (!res.ok) return { error: 'failed' };
    if (body.path === null) {
      const reason = body.reason as NoPathReason;
      return NO_PATH_REASONS.includes(reason) ? { path: null, reason } : { error: 'failed' };
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
}

const IN_STOCK = ['in_stock', 'instock', 'available', 'limited_availability'];

/**
 * The brand's catalog products by id, as a product card shows them: the
 * product's page, its first picture, and the price of its cheapest variant
 * in stock (else of its cheapest). In the order asked; a product gone from
 * the catalog is left out.
 */
export async function getProductsForBlock(
  brandId: string,
  ids: string[],
): Promise<BlockProductRead[]> {
  const wanted = [...new Set(ids)].filter((id) => guid.safeParse(id).success).slice(0, 8);
  if (!guid.safeParse(brandId).success || !wanted.length) return [];
  const supabase = await createClient();
  const [products, variants, images] = await Promise.all([
    supabase
      .from('catalog_products')
      .select('id, title, url')
      .eq('brand_id', brandId)
      .is('removed_at', null)
      .in('id', wanted),
    supabase
      .from('catalog_variants')
      .select('product_id, url, price, sale_price, currency, availability')
      .in('product_id', wanted)
      .is('removed_at', null)
      .order('price', { ascending: true })
      .limit(500),
    supabase
      .from('catalog_images')
      .select('product_id, url, position')
      .in('product_id', wanted)
      .order('position', { ascending: true })
      .limit(200),
  ]);
  for (const read of [products, variants, images]) {
    if (read.error) throw new Error(read.error.message);
  }
  const byId = new Map((products.data ?? []).map((p) => [p.id, p]));
  return wanted.flatMap((id) => {
    const product = byId.get(id);
    if (!product) return [];
    const own = (variants.data ?? []).filter((v) => v.product_id === id);
    const variant = own.find((v) => IN_STOCK.includes(String(v.availability))) ?? own[0];
    return [
      {
        id,
        title: product.title,
        url: product.url ?? variant?.url ?? null,
        image: (images.data ?? []).find((i) => i.product_id === id)?.url ?? null,
        price: variant?.price ?? null,
        salePrice: variant?.sale_price ?? null,
        currency: variant?.currency ?? null,
      },
    ];
  });
}
