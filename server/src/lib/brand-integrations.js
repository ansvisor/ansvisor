/**
 * A brand's integrations (BRAND-ACCESS PR 14, 00470): which of the Account's
 * sign-ins (integration_accounts) a brand uses for a provider
 * (brand_integrations). The one place the server answers "what does this
 * brand connect to Google (or its CMS) with?": the Search Console and
 * Analytics syncs, the property lists, the Action Center's Analytics tool and
 * its sources ask here, never the Account's row or entity themselves. The
 * web's lib/brand-integrations.ts reads the same tables.
 *
 * A connection names the Composio entity and the connected account it calls
 * with: several sign-ins may share one entity (composio.js toolTarget).
 * Every brand uses the Account's Google connection until the Brand settings
 * cards (PR 15) let one use another, so nothing changes yet.
 *
 * Before 00470 is applied there is no pool: a brand's connection is its
 * Account's row (integration_connections), as before, said once.
 */

import supabaseAdmin from '../config/supabase.js';
import { selectInChunks } from './chunked-in.js';
import { logger } from './logger.js';
import { readAllRpcRows } from './rpc-pages.js';

/** A sign-in's columns as a connection reads them. */
const ACCOUNT_COLUMNS =
  'id, organization_id, composio_entity_id, composio_account_id, label, status';

/** Postgres' code for a missing table, PostgREST's for one (or a relationship) not in its cache. */
const NOT_MIGRATED = new Set(['42P01', 'PGRST205', 'PGRST200']);
let warnedNotMigrated = false;

function warnNotMigrated(error) {
  if (warnedNotMigrated) return;
  warnedNotMigrated = true;
  logger.warn(
    { code: error.code, migration: '00470' },
    "[brand-integrations] brand_integrations is missing: each brand uses its Account's connection until 00470 is applied",
  );
}

/**
 * @typedef {object} BrandConnection
 * @property {string} brandId
 * @property {string} provider
 * @property {string|null} accountId the sign-in (integration_accounts.id); null before 00470
 * @property {string} organizationId
 * @property {string|null} entityId the Composio entity
 * @property {string|null} composioAccountId the Composio connected account
 * @property {string|null} label
 * @property {string} status
 * @property {boolean} connected
 */

/** @returns {BrandConnection} */
function connectionOf(brandId, provider, account) {
  return {
    brandId,
    provider,
    accountId: account.id ?? null,
    organizationId: account.organization_id,
    entityId: account.composio_entity_id ?? null,
    composioAccountId: account.composio_account_id ?? null,
    label: account.label ?? null,
    status: account.status,
    connected: account.status === 'connected',
  };
}

/** What a Composio call on this connection runs as (composio.js toolTarget). */
export function composioTarget(connection) {
  return { entityId: connection.entityId, accountId: connection.composioAccountId };
}

/** Before 00470: the brand's Account's row for the provider, as every brand used it. */
async function accountRowConnection(brandId, provider) {
  const { data: brand, error } = await supabaseAdmin
    .from('brands')
    .select('organization_id')
    .eq('id', brandId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!brand?.organization_id) return null;
  const { data: row, error: rowError } = await supabaseAdmin
    .from('integration_connections')
    .select('organization_id, composio_entity_id, composio_account_id, status')
    .eq('organization_id', brand.organization_id)
    .eq('provider', provider)
    .maybeSingle();
  if (rowError) throw new Error(rowError.message);
  return row ? connectionOf(brandId, provider, { ...row, id: null, label: null }) : null;
}

/**
 * The brand's connection for `provider`, whatever its status, or null when
 * the brand uses none. The caller checks the brand's access first.
 * @param {string} brandId
 * @param {string} provider
 * @returns {Promise<BrandConnection|null>}
 */
export async function brandConnection(brandId, provider) {
  const { data, error } = await supabaseAdmin
    .from('brand_integrations')
    .select(
      `brand_id, provider, account:integration_accounts!brand_integrations_account_id_fkey(${ACCOUNT_COLUMNS})`,
    )
    .eq('brand_id', brandId)
    .eq('provider', provider)
    .maybeSingle();
  if (error && NOT_MIGRATED.has(error.code)) {
    warnNotMigrated(error);
    return accountRowConnection(brandId, provider);
  }
  if (error) throw new Error(error.message);
  return data?.account ? connectionOf(brandId, provider, data.account) : null;
}

/** Before 00470: every brand of an Account whose row is connected, with that row. */
async function connectedAccountRows(provider, { organizationId }) {
  let query = supabaseAdmin
    .from('integration_connections')
    .select('organization_id, composio_entity_id, composio_account_id, status')
    .eq('provider', provider)
    .eq('status', 'connected');
  if (organizationId) query = query.eq('organization_id', organizationId);
  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);
  const byOrg = new Map((rows ?? []).map((row) => [row.organization_id, row]));
  const { data: brands, error: brandError } = await selectInChunks([...byOrg.keys()], (ids) =>
    supabaseAdmin.from('brands').select('id, organization_id').in('organization_id', ids),
  );
  if (brandError) throw new Error(brandError.message);
  return (brands ?? []).map((brand) =>
    connectionOf(brand.id, provider, {
      ...byOrg.get(brand.organization_id),
      id: null,
      label: null,
    }),
  );
}

/**
 * The brands whose connection for `provider` is live, each with it: every
 * such brand, an organization's (the manual sync), or the one brand (right
 * after its property is picked). Whether the brand is active, a demo or has
 * its property picked is the caller's to check.
 * @param {string} provider
 * @param {{ organizationId?: string, brandId?: string }} [scope]
 * @returns {Promise<BrandConnection[]>}
 */
export async function connectedBrands(provider, { organizationId, brandId } = {}) {
  if (brandId) {
    const connection = await brandConnection(brandId, provider);
    if (!connection?.connected) return [];
    return !organizationId || connection.organizationId === organizationId ? [connection] : [];
  }

  // The provider's live sign-ins…
  const { data: accounts, error } = await readAllRpcRows('integration_accounts', (from, to) => {
    let query = supabaseAdmin
      .from('integration_accounts')
      .select(ACCOUNT_COLUMNS)
      .eq('provider', provider)
      .eq('status', 'connected');
    if (organizationId) query = query.eq('organization_id', organizationId);
    return query.order('id').range(from, to);
  });
  if (error && NOT_MIGRATED.has(error.code)) {
    warnNotMigrated(error);
    return connectedAccountRows(provider, { organizationId });
  }
  if (error) throw new Error(error.message);
  const byId = new Map((accounts ?? []).map((account) => [account.id, account]));
  if (byId.size === 0) return [];

  // …and the brands that use them, a hundred sign-ins a read, page by page.
  const { data: uses, error: useError } = await selectInChunks([...byId.keys()], (ids) =>
    readAllRpcRows('brand_integrations', (from, to) =>
      supabaseAdmin
        .from('brand_integrations')
        .select('brand_id, account_id')
        .eq('provider', provider)
        .in('account_id', ids)
        .order('brand_id')
        .range(from, to),
    ),
  );
  if (useError) throw new Error(useError.message);
  return (uses ?? []).map((use) => connectionOf(use.brand_id, provider, byId.get(use.account_id)));
}

// ─── A brand's own Google sign-in (BRAND-ACCESS PR 15) ──────────────────────
// Brand settings › Integrations: a brand keeps the Account's Google sign-in,
// uses the one another brand uses ("Use the same account as…", D6), or a
// login of its own. Every Google login stays one connected account under the
// Account's Composio entity (several may share it: calls name the account).
// The server writes these for an admin or manager who can access the brand.

/** The Google products a brand connects on its own. */
export const BRAND_GOOGLE_PROVIDERS = Object.freeze(['google-search-console', 'google-analytics']);

function httpError(message, status, code) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

/**
 * The sign-ins a brand may use for `provider`: the connected ones of the
 * organization that a brand the person can access uses (`brandIds`), each
 * with those brands. The Account's own sign-in is always among them while
 * it is connected, since every brand used it.
 */
export async function usableAccounts(organizationId, provider, brandIds) {
  const { data: accounts, error } = await supabaseAdmin
    .from('integration_accounts')
    .select(`${ACCOUNT_COLUMNS}, integration_connection_id, connected_by, created_at`)
    .eq('organization_id', organizationId)
    .eq('provider', provider)
    .eq('status', 'connected');
  if (error) throw new Error(error.message);
  if (!accounts?.length) return [];
  const { data: uses, error: useError } = await selectInChunks(brandIds, (ids) =>
    supabaseAdmin
      .from('brand_integrations')
      .select('brand_id, account_id')
      .eq('provider', provider)
      .in('brand_id', ids),
  );
  if (useError) throw new Error(useError.message);
  const usedBy = new Map();
  for (const use of uses ?? []) {
    usedBy.set(use.account_id, [...(usedBy.get(use.account_id) ?? []), use.brand_id]);
  }
  return accounts
    .filter((a) => a.integration_connection_id || usedBy.has(a.id))
    .map((a) => ({
      accountId: a.id,
      label: a.label ?? null,
      accountLevel: Boolean(a.integration_connection_id),
      connectedBy: a.connected_by ?? null,
      connectedAt: a.created_at ?? null,
      brandIds: usedBy.get(a.id) ?? [],
    }));
}

/**
 * Drops a brand's own sign-in nobody uses any more: its connected account on
 * Composio (best effort) and its row. The Account's own sign-in and a CMS
 * site's are left to Settings › Integrations and the CMS cards.
 */
async function forgetUnusedAccount(accountId, { deleteRemote }) {
  const { data: account, error } = await supabaseAdmin
    .from('integration_accounts')
    .select('id, composio_account_id, integration_connection_id, cms_connection_id')
    .eq('id', accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!account || account.integration_connection_id || account.cms_connection_id) return;
  const { count, error: countError } = await supabaseAdmin
    .from('brand_integrations')
    .select('brand_id', { count: 'exact', head: true })
    .eq('account_id', accountId);
  if (countError) throw new Error(countError.message);
  if (count) return;
  if (account.composio_account_id) {
    try {
      await deleteRemote(account.composio_account_id);
    } catch (err) {
      logger.warn({ err, accountId }, '[brand-integrations] could not remove an unused sign-in');
    }
  }
  const { error: deleteError } = await supabaseAdmin
    .from('integration_accounts')
    .delete()
    .eq('id', accountId);
  if (deleteError) throw new Error(deleteError.message);
}

/**
 * The brand uses `accountId` for `provider` from now on. The sign-in must be
 * a connected one of the brand's organization for that product, and one the
 * person may use (usableAccounts). The sign-in it used before goes when no
 * brand uses it any more and it was the brand's own.
 */
export async function useAccountForBrand(
  { brand, provider, accountId, brandIds },
  { deleteRemote },
) {
  const usable = await usableAccounts(brand.organization_id, provider, brandIds);
  if (!usable.some((a) => a.accountId === accountId)) {
    throw httpError('That sign-in is not one this brand can use.', 404, 'unknown_account');
  }
  const before = await brandConnection(brand.id, provider);
  const { error } = await supabaseAdmin.from('brand_integrations').upsert(
    {
      brand_id: brand.id,
      provider,
      account_id: accountId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'brand_id,provider' },
  );
  if (error) throw new Error(error.message);
  if (before?.accountId && before.accountId !== accountId) {
    await forgetUnusedAccount(before.accountId, { deleteRemote });
  }
}

/**
 * Starts a login of the brand's own: one more connected account under the
 * Account's entity, kept as a pending sign-in until Composio says it's
 * active (activateBrandAccount). The brand keeps its sign-in meanwhile.
 */
export async function startBrandAccount({ brand, provider, userId, entityId }, { initiate }) {
  const { redirectUrl, connectedAccountId } = await initiate(entityId);
  if (!connectedAccountId) throw new Error('Composio returned no connected account');
  const { data, error } = await supabaseAdmin
    .from('integration_accounts')
    .insert({
      organization_id: brand.organization_id,
      provider,
      composio_entity_id: entityId,
      composio_account_id: connectedAccountId,
      status: 'pending',
      connected_by: userId,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return { redirectUrl, accountId: data.id };
}

/**
 * Once Composio says the brand's new login is active: the sign-in is
 * connected and the brand uses it. 'pending' while it isn't yet.
 */
export async function activateBrandAccount(
  { brand, provider, accountId, userId },
  { status, deleteRemote },
) {
  const { data: account, error } = await supabaseAdmin
    .from('integration_accounts')
    .select('id, organization_id, provider, composio_account_id, status, connected_by')
    .eq('id', accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (
    !account ||
    account.organization_id !== brand.organization_id ||
    account.provider !== provider ||
    account.connected_by !== userId ||
    !account.composio_account_id
  ) {
    throw httpError('That sign-in is not one this brand can use.', 404, 'unknown_account');
  }
  if (account.status !== 'connected') {
    if ((await status(account.composio_account_id)) !== 'ACTIVE') return 'pending';
    const { error: updateError } = await supabaseAdmin
      .from('integration_accounts')
      .update({ status: 'connected', updated_at: new Date().toISOString() })
      .eq('id', accountId);
    if (updateError) throw new Error(updateError.message);
  }
  const before = await brandConnection(brand.id, provider);
  const { error: useError } = await supabaseAdmin.from('brand_integrations').upsert(
    {
      brand_id: brand.id,
      provider,
      account_id: accountId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'brand_id,provider' },
  );
  if (useError) throw new Error(useError.message);
  if (before?.accountId && before.accountId !== accountId) {
    await forgetUnusedAccount(before.accountId, { deleteRemote });
  }
  return 'connected';
}

/**
 * The brand stops using any sign-in for `provider` (Disconnect on its card):
 * its own login, used by no other brand, goes too; the Account's stays.
 */
export async function removeBrandAccount({ brand, provider }, { deleteRemote }) {
  const before = await brandConnection(brand.id, provider);
  const { error } = await supabaseAdmin
    .from('brand_integrations')
    .delete()
    .eq('brand_id', brand.id)
    .eq('provider', provider);
  if (error) throw new Error(error.message);
  if (before?.accountId) await forgetUnusedAccount(before.accountId, { deleteRemote });
}
