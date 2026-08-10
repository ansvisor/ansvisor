import { Composio } from '@composio/core';

/**
 * Composio managed-auth helper (#577, extended for Google Analytics in #658).
 * Composio's verified Google app runs the OAuth consent flow and stores the
 * tokens — we only ever hold the connected-account id. Self-host installs
 * without the env vars stay fully functional: isComposioConfigured() gates
 * every route and the UI renders a "not configured" card instead of erroring.
 *
 * Providers are described by the map below rather than by copy-pasted
 * functions: the connect / status / disconnect flow is identical for every
 * OAuth source, so only the auth-config env var differs. Provider-specific
 * behaviour (listing GSC properties, querying analytics) stays in its own
 * function further down.
 */

let client = null;

/**
 * Supported integration providers. The key is the public identifier used in
 * API routes, the `integration_connections.provider` column and the UI.
 */
export const PROVIDERS = {
  'google-search-console': {
    label: 'Google Search Console',
    authConfigEnv: 'COMPOSIO_GSC_AUTH_CONFIG_ID',
  },
  'google-analytics': {
    label: 'Google Analytics',
    authConfigEnv: 'COMPOSIO_GA_AUTH_CONFIG_ID',
  },
};

export function isKnownProvider(provider) {
  return Object.hasOwn(PROVIDERS, provider);
}

function authConfigId(provider) {
  const config = PROVIDERS[provider];
  if (!config) throw new Error(`Unknown integration provider: ${provider}`);
  return process.env[config.authConfigEnv];
}

/**
 * A provider is usable only when the API key AND its own auth config are
 * present — one provider being configured must never imply the other is.
 */
export function isComposioConfigured(provider) {
  if (!process.env.COMPOSIO_API_KEY) return false;
  if (!isKnownProvider(provider)) return false;
  return Boolean(authConfigId(provider));
}

function getClient() {
  if (!client) {
    client = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  }
  return client;
}

/**
 * Start the hosted OAuth flow for an entity. Returns the URL the client
 * opens in a popup plus the pending connected-account id.
 */
export async function initiateConnection(provider, entityId, callbackUrl) {
  const request = await getClient().connectedAccounts.link(entityId, authConfigId(provider), {
    callbackUrl,
  });
  return {
    redirectUrl: request.redirectUrl,
    connectedAccountId: request.connectedAccountId ?? request.id ?? null,
    status: request.connectionStatus ?? 'INITIATED',
  };
}

/** The entity's ACTIVE connection for this provider on Composio, or null. */
export async function getActiveConnection(provider, entityId) {
  const connections = await getClient().connectedAccounts.list({
    authConfigIds: [authConfigId(provider)],
    userIds: [entityId],
    statuses: ['ACTIVE'],
  });
  return connections.items?.[0] ?? null;
}

export async function deleteConnection(connectedAccountId) {
  await getClient().connectedAccounts.delete(connectedAccountId);
}

/**
 * Composio requires a pinned toolkit version for manual tool execution
 * ("latest" is rejected). Bump deliberately after checking the changelog;
 * override per-deploy via env if a hotpin is ever needed.
 */
const GSC_TOOLKIT_VERSION = process.env.COMPOSIO_GSC_TOOLKIT_VERSION || '20260721_00';

/**
 * Properties visible to the entity's connected account (#642).
 * Returns [{ siteUrl, permissionLevel }]. Requires the API key to have
 * tool-execution permission (the connect flow only needs connected_accounts).
 */
export async function listGscSites(entityId) {
  const result = await getClient().tools.execute('GOOGLE_SEARCH_CONSOLE_LIST_SITES', {
    userId: entityId,
    arguments: {},
    version: GSC_TOOLKIT_VERSION,
  });
  if (result?.successful === false) {
    throw new Error(result?.error || 'Failed to list Search Console properties');
  }
  const entries = result?.data?.siteEntry ?? result?.data?.sites ?? [];
  return entries.map((e) => ({
    siteUrl: e.siteUrl,
    permissionLevel: e.permissionLevel ?? null,
  }));
}

/**
 * Search analytics rows for a property (#644). Parameters are deterministic —
 * built by the caller, never by an LLM. Returns the raw GSC rows:
 * [{ keys: [query, date], clicks, impressions, ctr, position }].
 */
export async function queryGscSearchAnalytics(entityId, args) {
  const result = await getClient().tools.execute('GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY', {
    userId: entityId,
    arguments: args,
    version: GSC_TOOLKIT_VERSION,
  });
  if (result?.successful === false) {
    throw new Error(result?.error || 'Search analytics query failed');
  }
  return result?.data?.rows ?? [];
}
