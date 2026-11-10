import { BROWSER_API_BASE_URL } from '@/config/api';
import { apiFailure } from '@/lib/api-failure';
import { createClient } from '@/lib/supabase/client';
import { INTEGRATION_READ_TIMEOUT_MS } from '@/lib/integrations-client';

/**
 * A brand's HubSpot connection (#2140), from the browser through the API's
 * same-origin proxy (server/src/routes/hubspot.js). HubSpot signs in with
 * OAuth in a popup; Composio keeps the token, so nothing secret passes here.
 * Nothing is written to HubSpot without the consent the person gives when
 * connecting.
 */

/** What Ansvisor may write in HubSpot: mark contacts, and draft pages. */
export interface HubspotConsent {
  contacts: boolean;
  pages: boolean;
}

export interface HubspotConnection {
  /** The sign-in (integration_accounts.id). */
  accountId: string | null;
  /** What the account is called: its Hub ID. */
  label: string | null;
  status: string;
  /** False once HubSpot refused the sign-in: the card asks to connect again. */
  connected: boolean;
  portal: { id: number; currency: string | null; uiDomain: string | null } | null;
  /** The other brands (that the person can see) on the same HubSpot account. */
  sharedWith: string[];
  /** What was allowed, by whom (their name) and when. */
  consent: HubspotConsent & { by: string | null; at: string | null };
  /** The "Ansvisor" property group and its properties in HubSpot. */
  properties: { ready: boolean; at: string | null; error: string | null };
  /** The AI-sourced pipeline's last read of HubSpot (00520), or none yet. */
  sync: {
    at: string | null;
    contacts: number | null;
    deals: number | null;
    error: string | null;
  } | null;
  /** A Sync now is running. */
  syncing: boolean;
}

/** A HubSpot account other brands use, which this brand could use too. */
export interface HubspotAccount {
  accountId: string;
  label: string | null;
  brandIds: string[];
}

export interface HubspotRead {
  brandId: string;
  /** Whether this server can connect HubSpot (its Composio keys). */
  configured: boolean;
  /** Whether the plan has HubSpot (Growth and above); a kept connection is paused without. */
  allowed: boolean;
  connection: HubspotConnection | null;
  usable: HubspotAccount[];
}

export type HubspotError =
  | 'consent_required'
  | 'not_configured'
  | 'forbidden'
  | 'not_connected'
  | 'unknown_account'
  | 'session'
  | 'workspace'
  | 'busy'
  /** The plan has no HubSpot: the locked card says so. */
  | 'plan'
  /** A read-only workspace, or the demo brand: the upgrade dialog, not a message. */
  | 'subscription'
  | 'failed';

const KNOWN: readonly HubspotError[] = [
  'busy',
  'consent_required',
  'not_configured',
  'forbidden',
  'not_connected',
  'unknown_account',
];

export type HubspotResult<T> = ({ ok: true } & T) | { ok: false; code: HubspotError };

async function call<T>(
  brandId: string,
  path: string,
  init: RequestInit = {},
): Promise<HubspotResult<T>> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false, code: 'session' };
    const res = await fetch(
      `${BROWSER_API_BASE_URL}/api/hubspot/brands/${encodeURIComponent(brandId)}${path}`,
      {
        ...init,
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
          Authorization: `Bearer ${session.access_token}`,
        },
      },
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
          general === 'plan' ||
          general === 'subscription'
            ? general
            : 'failed',
      };
    }
    return { ok: true, ...(body as T) };
  } catch (err) {
    console.error('HubSpot call failed:', err);
    return { ok: false, code: 'failed' };
  }
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

/** The brand's HubSpot: whether it's offered, its connection and the accounts it could use. */
export function readHubspot(brandId: string) {
  return call<HubspotRead>(brandId, '', {
    signal: AbortSignal.timeout(INTEGRATION_READ_TIMEOUT_MS),
  });
}

/** Starts HubSpot's sign-in: the address to open, and the sign-in to activate after. */
export function startHubspotConnect(
  brandId: string,
  { callbackUrl, consent }: { callbackUrl: string; consent: HubspotConsent },
) {
  return call<{ redirectUrl: string; accountId: string }>(
    brandId,
    '/connect',
    json('POST', { callbackUrl, consent }),
  );
}

/** Whether the sign-in is done: 'connected' once HubSpot is set up for the brand. */
export function activateHubspot(
  brandId: string,
  { accountId, consent }: { accountId: string; consent: HubspotConsent },
) {
  return call<{ status: 'connected' | 'pending' }>(
    brandId,
    '/activate',
    json('POST', { accountId, consent }),
  );
}

/** Uses the HubSpot account another brand uses. */
export function chooseHubspotAccount(
  brandId: string,
  { accountId, consent }: { accountId: string; consent: HubspotConsent },
) {
  return call<HubspotRead>(brandId, '/use', json('POST', { accountId, consent }));
}

/** Changes what Ansvisor may write in HubSpot. */
export function saveHubspotConsent(brandId: string, consent: HubspotConsent) {
  return call<HubspotRead>(brandId, '/settings', json('PUT', { consent }));
}

/** Tries the setup again: the account and the Ansvisor properties. */
export function retryHubspotSetup(brandId: string) {
  return call<HubspotRead>(brandId, '/setup', json('POST'));
}

/** Sync now: reads the AI-sourced pipeline from HubSpot again, in the background. */
export function syncHubspot(brandId: string) {
  return call<{ started: boolean }>(brandId, '/sync', json('POST'));
}

/** Disconnects: nothing is read from or written to HubSpot for the brand any more. */
export function disconnectHubspot(brandId: string) {
  return call<{ success: boolean }>(brandId, '', json('DELETE'));
}

/**
 * A sign-in started in this tab when the popup was blocked: the page went to
 * HubSpot itself, and the card finishes it when the person comes back.
 */
export interface PendingHubspot {
  brandId: string;
  accountId: string;
  consent: HubspotConsent;
  at: number;
}

const PENDING_KEY = 'aeo:hubspot-pending';
/** A sign-in left longer than this isn't finished on return. */
const PENDING_MAX_MS = 30 * 60 * 1000;

export function rememberPending(pending: PendingHubspot) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Storage blocked: the person connects again on return.
  }
}

/** The pending sign-in for the brand, taken (read once), or null. */
export function takePending(brandId: string, now = Date.now()): PendingHubspot | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw) as PendingHubspot;
    if (pending?.brandId !== brandId) return null;
    sessionStorage.removeItem(PENDING_KEY);
    if (!pending.accountId || !(now - pending.at < PENDING_MAX_MS)) return null;
    return pending;
  } catch {
    return null;
  }
}
