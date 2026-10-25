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
 * proxy: a feed or a store read now, or a file uploaded. Not a server
 * action, whose body is limited to 1 MB. Stores are connected here too
 * (00282): their sign-in goes to the API, which alone keeps it.
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

/** Reads a feed or a store now. */
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

/** A field a store's connector asks for, as the API lists it. */
export interface StoreField {
  name: string;
  label: string;
  secret: boolean;
  placeholder: string | null;
  help: string | null;
}

/** A store or marketplace a person can connect (00282): its connector on the API. */
export interface StoreConnector {
  kind: string;
  label: string;
  fields: StoreField[];
}

export type StoreError =
  | 'connect_failed'
  | 'auth_failed'
  | 'unreachable'
  | 'duplicate'
  | 'too_many'
  | 'other_account'
  | 'not_configured'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'session'
  | 'workspace'
  | 'busy'
  | 'failed';

/** `message`: the store's own words for what to fix, when it has them. */
export type StoreResult = { ok: true } | { ok: false; code: StoreError; message: string | null };

const STORE_KNOWN: readonly StoreError[] = [
  'connect_failed',
  'auth_failed',
  'unreachable',
  'duplicate',
  'too_many',
  'other_account',
  'not_configured',
  'forbidden',
  'not_found',
  'invalid',
];

/** A store call: the sign-in the person typed goes to the API only, over its proxy. */
async function storeCall(path: string, init: RequestInit): Promise<StoreResult> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false, code: 'session', message: null };
    const res = await fetch(`${BROWSER_API_BASE_URL}/api/catalog${path}`, {
      ...init,
      headers: {
        ...init.headers,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
    const known = STORE_KNOWN.find((c) => c === body.code);
    if (known) {
      return {
        ok: false,
        code: known,
        message: known === 'connect_failed' ? (body.error ?? null) : null,
      };
    }
    const general = apiFailure(res.status, body);
    return {
      ok: false,
      code:
        general === 'session' || general === 'workspace' || general === 'busy' ? general : 'failed',
      message: null,
    };
  } catch (err) {
    console.error('Failed to reach the catalog API:', err);
    return { ok: false, code: 'failed', message: null };
  }
}

/** The stores a person can connect, and whether the API can keep a sign-in; null when unreadable. */
export async function listStoreConnectors(): Promise<{
  connectors: StoreConnector[];
  ready: boolean;
} | null> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return null;
    const res = await fetch(`${BROWSER_API_BASE_URL}/api/catalog/connectors`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { connectors?: StoreConnector[]; ready?: boolean };
    return { connectors: body.connectors ?? [], ready: !!body.ready };
  } catch (err) {
    console.error('Failed to read the store connectors:', err);
    return null;
  }
}

/** Connects a store to a brand with what the person typed; the API reads it right after. */
export function connectStore(
  brandId: string,
  kind: string,
  input: Record<string, string>,
): Promise<StoreResult> {
  return storeCall('/sources', { method: 'POST', body: JSON.stringify({ brandId, kind, input }) });
}

/** Replaces a store's sign-in, for the same store. */
export function updateStoreSignIn(id: string, input: Record<string, string>): Promise<StoreResult> {
  return storeCall(`/sources/${encodeURIComponent(id)}/credentials`, {
    method: 'PUT',
    body: JSON.stringify({ input }),
  });
}

/** Removes a store, its sign-in and its products. */
export function removeStore(id: string): Promise<StoreResult> {
  return storeCall(`/sources/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
