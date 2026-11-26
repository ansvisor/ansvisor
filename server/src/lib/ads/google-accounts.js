import supabaseAdmin from '../../config/supabase.js';
import { assertSignInReach } from '../brand-integration-reach.js';
import { brandConnection, composioTarget } from '../brand-integrations.js';
import { getActiveConnection, isComposioConfigured } from '../composio.js';
import { AdsAccountError, PUBLIC_COLUMNS, publicAccount } from './accounts.js';
import { logAdsActivity } from './activity.js';
import { customerIdOf, customerInfo, listAccessibleCustomers } from './google-ads.js';

/**
 * Google Ads accounts on a brand (Ads Phase 1, G2): the brand's Google Ads
 * sign-in (Settings › Integrations' Composio flow, one integration_accounts
 * row) lists the customers it reaches, and an Admin picks which the brand
 * reads.
 *
 * A customer id comes from the browser, so it only counts when the brand's
 * own sign-in lists it (listAccessibleCustomers), and the sign-in only
 * counts when it is the route's workspace's (CLAUDE.md rule 3): nothing in
 * the database ties integration_accounts to the brand's organization.
 * Manager accounts (MCC) hold no campaigns of their own, so they are listed
 * but not connected. Read-only: nothing here writes to Google Ads.
 */

export const GOOGLE_ADS = 'google-ads';

/** Customers described in one list: one Composio call each. */
export const MAX_CUSTOMERS = 50;
/** Customers connected in one request. */
export const MAX_CONNECT = 20;
/** Composio calls in flight at once. */
const CONCURRENCY = 5;

/** `fn` over `items`, CONCURRENCY at a time, in order. */
async function mapLimited(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

/** The customers the sign-in reaches; Google Ads or Composio failing is 'upstream'. */
async function reachable(target, accessible) {
  try {
    return await accessible(target);
  } catch {
    throw new AdsAccountError('upstream', "Google Ads didn't answer. Try again later.");
  }
}

const notConnected = () =>
  new AdsAccountError('not_connected', 'Sign in to Google Ads for this brand first.');

/**
 * The brand's live Google Ads sign-in: its integration_accounts id and what
 * a Composio call runs as. Throws AdsAccountError('not_configured') when this
 * server has no Google Ads auth config, 'not_connected' when the brand has no
 * live sign-in of the workspace's, and the reach refusal (403) when the
 * person can't reach every brand that uses it.
 */
export async function googleSignIn(
  { orgId, brandId, userId },
  {
    configured = isComposioConfigured,
    connectionOf = brandConnection,
    reach = assertSignInReach,
    active = getActiveConnection,
  } = {},
) {
  if (!configured(GOOGLE_ADS)) {
    throw new AdsAccountError('not_configured', 'Google Ads is not set up on this server.');
  }
  const connection = await connectionOf(brandId, GOOGLE_ADS);
  if (!connection?.connected || !connection.entityId || !connection.accountId) {
    throw notConnected();
  }
  // Another workspace's sign-in is not this brand's, whatever the row says.
  if (connection.organizationId !== orgId) throw notConnected();
  await reach(userId, connection);
  const live = await active(GOOGLE_ADS, connection.entityId, connection.composioAccountId);
  if (!live) throw notConnected();
  return { accountId: connection.accountId, target: composioTarget(connection) };
}

/** The ids of the brand's Google Ads accounts already connected. */
async function connectedIds({ orgId, brandId }, db) {
  const { data, error } = await db
    .from('ads_accounts')
    .select('external_id')
    .eq('organization_id', orgId)
    .eq('brand_id', brandId)
    .eq('platform', 'google');
  if (error) throw new Error(`ads_accounts read: ${error.code ?? 'error'}`);
  return new Set((data ?? []).map((row) => row.external_id));
}

/** A customer described, or one Google Ads wouldn't describe (closed, no access). */
async function describe(target, id, read) {
  try {
    const info = await read(target, id);
    if (info) return { ...info, unavailable: false };
  } catch {
    // Described as unavailable below: the list still shows the others.
  }
  return {
    id,
    name: null,
    currencyCode: null,
    timeZone: null,
    manager: false,
    testAccount: false,
    unavailable: true,
  };
}

/**
 * The customers the brand's sign-in reaches, described, each marked when the
 * brand already reads it: the first MAX_CUSTOMERS, with `more` past them.
 */
export async function listGoogleCustomers(
  { orgId, brandId, userId },
  {
    db = supabaseAdmin,
    signIn = googleSignIn,
    accessible = listAccessibleCustomers,
    info = customerInfo,
  } = {},
) {
  const { target } = await signIn({ orgId, brandId, userId });
  const ids = await reachable(target, accessible);
  const shown = ids.slice(0, MAX_CUSTOMERS);
  const [connected, described] = await Promise.all([
    connectedIds({ orgId, brandId }, db),
    mapLimited(shown, (id) => describe(target, id, info)),
  ]);
  return {
    customers: described.map((c) => ({ ...c, connected: connected.has(c.id) })),
    more: Math.max(0, ids.length - shown.length),
  };
}

/**
 * Connects the customers picked to the brand, read through its sign-in.
 * Every id must be one the sign-in lists now (else 'not_accessible') and a
 * customer with campaigns of its own (a manager is 'manager_account'). An
 * account the brand already reads is refreshed, not duplicated.
 */
export async function connectGoogleAccounts(
  { orgId, brandId, userId, customerIds },
  {
    db = supabaseAdmin,
    signIn = googleSignIn,
    accessible = listAccessibleCustomers,
    info = customerInfo,
    log = logAdsActivity,
  } = {},
) {
  const ids = [...new Set((customerIds ?? []).map(customerIdOf))];
  if (ids.length === 0 || ids.length > MAX_CONNECT || ids.includes(null)) {
    throw new AdsAccountError('not_accessible', 'Pick between 1 and 20 Google Ads accounts.');
  }
  const signedIn = await signIn({ orgId, brandId, userId });
  const reached = new Set(await reachable(signedIn.target, accessible));
  if (ids.some((id) => !reached.has(id))) {
    throw new AdsAccountError('not_accessible', "This Google sign-in doesn't reach that account.");
  }
  const described = await mapLimited(ids, (id) => describe(signedIn.target, id, info));
  if (described.some((c) => c.unavailable)) {
    throw new AdsAccountError('not_accessible', "Google Ads didn't describe that account.");
  }
  if (described.some((c) => c.manager)) {
    throw new AdsAccountError(
      'manager_account',
      'A manager account has no campaigns of its own: pick the accounts under it.',
    );
  }

  const now = new Date().toISOString();
  const { data, error } = await db
    .from('ads_accounts')
    .upsert(
      described.map((c) => ({
        organization_id: orgId,
        brand_id: brandId,
        platform: 'google',
        external_id: c.id,
        name: c.name,
        currency_code: c.currencyCode,
        time_zone: c.timeZone,
        integration_account_id: signedIn.accountId,
        status: 'active',
        last_error: null,
        connected_by: userId,
        updated_at: now,
      })),
      { onConflict: 'brand_id,platform,external_id' },
    )
    .select(PUBLIC_COLUMNS);
  if (error) throw new Error(`ads_accounts write: ${error.code ?? 'error'}`);

  for (const row of data ?? []) {
    await log({
      orgId,
      brandId,
      actor: { userId },
      event: 'connection.connect',
      target: { platform: 'google', account: row.id, external: row.external_id },
    });
  }
  return (data ?? []).map(publicAccount);
}
