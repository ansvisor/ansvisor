import { BROWSER_API_BASE_URL } from '@/config/api';
import { apiFailure } from '@/lib/api-failure';
import { createClient } from '@/lib/supabase/client';
import {
  CATALOG_UPLOAD_MAX_BYTES,
  type CatalogCounts,
  type CatalogFormat,
  type CatalogSyncStatus,
} from '@/lib/catalog';

/**
 * A catalog sync from the browser (#1263), through the API's same-origin
 * proxy: a feed read now, or a file uploaded. Not a server action, whose
 * body is limited to 1 MB.
 */

export type CatalogSyncError =
  | 'recent'
  | 'too_large'
  | 'too_many'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'session'
  | 'workspace'
  | 'busy'
  | 'failed';

export type CatalogSyncResult =
  | {
      ok: true;
      /** How the sync went: a feed that can't be read is still an answer. */
      status: CatalogSyncStatus;
      error: string | null;
      counts: CatalogCounts | null;
    }
  | { ok: false; code: CatalogSyncError };

const KNOWN: readonly CatalogSyncError[] = [
  'recent',
  'too_large',
  'too_many',
  'forbidden',
  'not_found',
  'invalid',
];

async function call(path: string, init: RequestInit): Promise<CatalogSyncResult> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false, code: 'session' };
    const res = await fetch(`${BROWSER_API_BASE_URL}/api/catalog${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${session.access_token}` },
    });
    const body = (await res.json().catch(() => ({}))) as {
      code?: string;
      status?: CatalogSyncStatus;
      error?: string | null;
      counts?: CatalogCounts | null;
    };
    if (!res.ok) {
      if (res.status === 413) return { ok: false, code: 'too_large' };
      const known = KNOWN.find((c) => c === body.code);
      if (known) return { ok: false, code: known };
      const general = apiFailure(res.status, body);
      return {
        ok: false,
        code:
          general === 'session' || general === 'workspace' || general === 'busy'
            ? general
            : 'failed',
      };
    }
    return {
      ok: true,
      status: body.status ?? 'failed',
      error: body.error ?? null,
      counts: body.counts ?? null,
    };
  } catch (err) {
    console.error('Failed to sync the catalog:', err);
    return { ok: false, code: 'failed' };
  }
}

/** Reads a feed source now. */
export function syncCatalogSource(id: string): Promise<CatalogSyncResult> {
  return call(`/sources/${encodeURIComponent(id)}/sync`, { method: 'POST' });
}

/** Imports a file as the brand's upload: up to 4 MB, CSV or a Google feed's XML. */
export async function uploadCatalogFile(
  brandId: string,
  file: File,
  format: CatalogFormat = 'auto',
): Promise<CatalogSyncResult> {
  if (file.size > CATALOG_UPLOAD_MAX_BYTES) return { ok: false, code: 'too_large' };
  const text = await file.text();
  const query = new URLSearchParams({ brandId, format });
  return call(`/upload?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: text,
  });
}
