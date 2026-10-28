'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  catalogSourceKey,
  type CatalogCounts,
  type CatalogFormat,
  type CatalogSource,
  type CatalogSourceKind,
  type CatalogSyncStatus,
} from '@/lib/catalog';
import { assertWritable } from '@/lib/subscription-guard';

/**
 * A brand's catalog sources (#1263, 00279, 00282), read and changed through
 * RLS: members read them; admins and managers add and remove feed URLs. The
 * API reads the feeds and stores, imports uploads, and connects and removes
 * stores (lib/catalog-client.ts).
 */

const FORMATS = ['auto', 'google_xml', 'csv', 'meta_csv'] as const;

/** The brand's sources, oldest first, each with its live products in the catalog. */
export async function listCatalogSources(brandId: string): Promise<CatalogSource[]> {
  if (!z.guid().safeParse(brandId).success) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('catalog_sources')
    .select(
      'id, kind, format, url, account, label, last_synced_at, last_status, last_error, last_counts',
    )
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return Promise.all(
    (data ?? []).map(async (row) => {
      const { count } = await supabase
        .from('catalog_products')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .eq('source', catalogSourceKey(row.id))
        .is('removed_at', null);
      return {
        id: row.id,
        kind: row.kind as CatalogSourceKind,
        format: row.format as CatalogFormat,
        url: row.url,
        account: row.account,
        label: row.label,
        lastSyncedAt: row.last_synced_at,
        lastStatus: row.last_status as CatalogSyncStatus | null,
        lastError: row.last_error,
        lastCounts: row.last_counts as unknown as CatalogCounts | null,
        products: count ?? 0,
      };
    }),
  );
}

export type AddFeedResult =
  | { ok: true; id: string }
  | { ok: false; code: 'invalid' | 'duplicate' | 'too_many' | 'forbidden' | 'failed' };

/** Adds a feed URL to a brand's sources: admins and managers. The API reads it daily. */
export async function addFeedSource(
  brandId: string,
  url: string,
  format: CatalogFormat = 'auto',
): Promise<AddFeedResult> {
  await assertWritable({ brandId });
  const address = typeof url === 'string' ? url.trim() : '';
  if (
    !z.guid().safeParse(brandId).success ||
    !FORMATS.includes(format) ||
    address.length > 2048 ||
    !/^https?:\/\/[^\s/]+/i.test(address) ||
    !URL.canParse(address)
  ) {
    return { ok: false, code: 'invalid' };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: 'forbidden' };
  const { data, error } = await supabase
    .from('catalog_sources')
    .insert({ brand_id: brandId, kind: 'feed_url', format, url: address, created_by: user.id })
    .select('id')
    .single();
  if (error?.code === '23505') return { ok: false, code: 'duplicate' };
  if (error?.code === '23514') return { ok: false, code: 'too_many' };
  if (error?.code === '42501') return { ok: false, code: 'forbidden' };
  if (error || !data) {
    console.error('Failed to add the feed:', error);
    return { ok: false, code: 'failed' };
  }
  return { ok: true, id: data.id };
}

/** Removes a feed or an upload, and with it its products: admins and managers. A store goes through the API. */
export async function removeCatalogSource(id: string): Promise<void> {
  await assertWritable();
  if (!z.guid().safeParse(id).success) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase.from('catalog_sources').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('forbidden');
}
