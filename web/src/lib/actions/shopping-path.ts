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
