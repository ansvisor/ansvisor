import supabaseAdmin from '../../config/supabase.js';
import { credentialsConfigured, openCredentials, sealCredentials } from '../catalog/credentials.js';
import { logAdsActivity } from './activity.js';
import { cleanKey, fetchAdAccount } from './chatgpt-ads.js';

/**
 * A brand's ad accounts (00560, Ads Phase 1): the ones it reads and the
 * ChatGPT Ads keys it reads them with.
 *
 * Every read and write names the workspace and the brand that the route
 * checked (assertBrandAccess). The tables bypass row-level security, so an
 * account id from a request only counts on a row of that workspace's brand
 * (CLAUDE.md rule 3); anything else reads as not found.
 *
 * A ChatGPT Ads key is sealed with the API's CONNECTOR_CREDENTIALS_KEY and
 * bound to its account's id (catalog/credentials.js), so the database never
 * holds it in the clear. It is never returned, logged or put in an error.
 */

/** What a caller sees of an account: never its key or sign-in. */
const PUBLIC_COLUMNS =
  'id, platform, external_id, name, currency_code, time_zone, status, last_error, last_synced_at, synced_through, created_at';

/** Why an account couldn't be connected or found: the route answers `code`. */
export class AdsAccountError extends Error {
  /** @param {'invalid_key' | 'not_configured' | 'not_found'} code */
  constructor(code, message) {
    super(message);
    this.name = 'AdsAccountError';
    this.code = code;
  }
}

/** A row as the API answers it. */
export function publicAccount(row) {
  return {
    id: row.id,
    platform: row.platform,
    externalId: row.external_id,
    name: row.name ?? null,
    currencyCode: row.currency_code ?? null,
    timeZone: row.time_zone ?? null,
    status: row.status,
    lastError: row.last_error ?? null,
    lastSyncedAt: row.last_synced_at ?? null,
    syncedThrough: row.synced_through ?? null,
    createdAt: row.created_at,
  };
}

/** The brand's ad accounts, oldest first. */
export async function listAccounts({ orgId, brandId }, { db = supabaseAdmin } = {}) {
  const { data, error } = await db
    .from('ads_accounts')
    .select(PUBLIC_COLUMNS)
    .eq('organization_id', orgId)
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`ads_accounts read: ${error.code ?? 'error'}`);
  return (data ?? []).map(publicAccount);
}

/**
 * Connects a ChatGPT Ads account to the brand with the key the person pasted:
 * the key is checked against ChatGPT Ads first (`GET /ad_account`), then the
 * account is kept (or refreshed, when it is already the brand's) and the key
 * sealed for it. Pasting a new key for the same account replaces the old one.
 * Throws AdsAccountError('invalid_key' | 'not_configured'), and
 * ChatGptAdsKeyError / ChatGptAdsUnavailableError from the check.
 */
export async function connectChatGptAccount(
  { orgId, brandId, userId, apiKey },
  { db = supabaseAdmin, fetchImpl, log = logAdsActivity } = {},
) {
  const key = cleanKey(apiKey);
  if (!key) throw new AdsAccountError('invalid_key', 'That is not a ChatGPT Ads API key.');
  if (!credentialsConfigured()) {
    throw new AdsAccountError('not_configured', 'This server cannot keep API keys.');
  }
  const account = await fetchAdAccount(key, fetchImpl ? { fetchImpl } : undefined);

  const { data: row, error } = await db
    .from('ads_accounts')
    .upsert(
      {
        organization_id: orgId,
        brand_id: brandId,
        platform: 'chatgpt',
        external_id: account.externalId,
        name: account.name,
        currency_code: account.currencyCode,
        time_zone: account.timeZone,
        status: 'active',
        last_error: null,
        connected_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'brand_id,platform,external_id' },
    )
    .select(PUBLIC_COLUMNS)
    .single();
  if (error) throw new Error(`ads_accounts write: ${error.code ?? 'error'}`);

  const { error: keyError } = await db.from('ads_account_keys').upsert(
    {
      account_id: row.id,
      secret: sealCredentials(row.id, { apiKey: key }),
      set_at: new Date().toISOString(),
      set_by: userId,
    },
    { onConflict: 'account_id' },
  );
  if (keyError) throw new Error(`ads_account_keys write: ${keyError.code ?? 'error'}`);

  await log({
    orgId,
    brandId,
    actor: { userId },
    event: 'connection.connect',
    target: { platform: 'chatgpt', account: row.id, external: account.externalId },
  });
  return publicAccount(row);
}

/**
 * Removes one of the brand's ad accounts: its key and every metric row go
 * with it (00560's cascade). An id that isn't this brand's, in this
 * workspace, is AdsAccountError('not_found').
 */
export async function disconnectAccount(
  { orgId, brandId, userId, accountId },
  { db = supabaseAdmin, log = logAdsActivity } = {},
) {
  const { data, error } = await db
    .from('ads_accounts')
    .delete()
    .eq('id', accountId)
    .eq('organization_id', orgId)
    .eq('brand_id', brandId)
    .select('id, platform, external_id');
  if (error) throw new Error(`ads_accounts delete: ${error.code ?? 'error'}`);
  const [gone] = data ?? [];
  if (!gone) throw new AdsAccountError('not_found', 'No such ad account on this brand.');
  await log({
    orgId,
    brandId,
    actor: { userId },
    event: 'connection.disconnect',
    target: { platform: gone.platform, account: gone.id, external: gone.external_id },
  });
  return { id: gone.id };
}

/**
 * A ChatGPT Ads account's key, for the sync (C3): null when it has none the
 * API can open. The account must already have been read from its brand's rows.
 */
export async function readChatGptKey(accountId, { db = supabaseAdmin } = {}) {
  const { data, error } = await db
    .from('ads_account_keys')
    .select('secret')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw new Error(`ads_account_keys read: ${error.code ?? 'error'}`);
  const opened = data?.secret ? openCredentials(accountId, data.secret) : null;
  return typeof opened?.apiKey === 'string' ? opened.apiKey : null;
}
