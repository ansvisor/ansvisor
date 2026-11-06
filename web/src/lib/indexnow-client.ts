import { BROWSER_API_BASE_URL } from '@/config/api';
import { apiFailure } from '@/lib/api-failure';
import { createClient } from '@/lib/supabase/client';
import { INTEGRATION_READ_TIMEOUT_MS } from '@/lib/integrations-client';

/**
 * A brand's IndexNow (#2142, part B; 00491), from the browser through the
 * API: its key on the brand's primary domain, whether the key's file was
 * found, and the CMS that keeps it off (Webflow and Wix can't put a file at
 * the site's root). The key isn't a secret: its file is public.
 */

export interface IndexNowState {
  key: string | null;
  host: string | null;
  /** Where the key's file must open: https://<host>/<key>.txt. */
  keyUrl: string | null;
  verifiedAt: string | null;
  blockedBy: 'webflow' | 'wix' | null;
  /** The host it would use: the brand's primary domain. */
  domainHost: string | null;
}

export type IndexNowError =
  | 'not_found'
  | 'mismatch'
  | 'unreachable'
  | 'no_root_files'
  | 'no_domain'
  | 'off'
  | 'forbidden'
  | 'session'
  | 'workspace'
  | 'busy'
  /** A read-only workspace (plan not active): the upgrade dialog, not a message. */
  | 'subscription'
  | 'failed';

const KNOWN: readonly IndexNowError[] = [
  'not_found',
  'mismatch',
  'unreachable',
  'no_root_files',
  'no_domain',
  'off',
  'forbidden',
];

export type IndexNowResult<T> = ({ ok: true } & T) | { ok: false; code: IndexNowError };

async function call<T>(
  brandId: string,
  path = '',
  init: RequestInit = {},
): Promise<IndexNowResult<T>> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false, code: 'session' };
    const res = await fetch(
      `${BROWSER_API_BASE_URL}/api/cms/brands/${encodeURIComponent(brandId)}/indexnow${path}`,
      { ...init, headers: { ...init.headers, Authorization: `Bearer ${session.access_token}` } },
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const known = KNOWN.find((c) => c === body.code);
      if (known) return { ok: false, code: known };
      const general = apiFailure(res.status, body);
      return {
        ok: false,
        code:
          general === 'session' ||
          general === 'workspace' ||
          general === 'busy' ||
          general === 'subscription'
            ? general
            : 'failed',
      };
    }
    return { ok: true, ...(body as T) };
  } catch (err) {
    console.error('IndexNow call failed:', err);
    return { ok: false, code: 'failed' };
  }
}

/** The brand's IndexNow, for every member. */
export function readIndexNow(brandId: string) {
  return call<{ indexnow: IndexNowState }>(brandId, '', {
    signal: AbortSignal.timeout(INTEGRATION_READ_TIMEOUT_MS),
  });
}

/** Turns it on with a new key, not checked yet: admins and managers. */
export function turnOnIndexNow(brandId: string) {
  return call<{ indexnow: IndexNowState }>(brandId, '', { method: 'POST' });
}

/** Reads the key's file at its address: found, IndexNow is on. */
export function checkIndexNow(brandId: string) {
  return call<{ indexnow: IndexNowState }>(brandId, '/check', { method: 'POST' });
}

/** Turns it off: its key goes, and nothing more is announced. */
export function turnOffIndexNow(brandId: string) {
  return call<{ success: boolean }>(brandId, '', { method: 'DELETE' });
}
