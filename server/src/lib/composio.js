import { Composio } from '@composio/core';

/**
 * Composio managed-auth helper (#577). Composio's verified Google app runs
 * the OAuth consent flow and stores the tokens — we only ever hold the
 * connected-account id. Self-host installs without the env vars stay fully
 * functional: isComposioConfigured() gates every route and the UI renders a
 * "not configured" card instead of erroring.
 */

let client = null;

export function isComposioConfigured() {
  return Boolean(process.env.COMPOSIO_API_KEY && process.env.COMPOSIO_GSC_AUTH_CONFIG_ID);
}

function getClient() {
  if (!client) {
    client = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  }
  return client;
}

function gscAuthConfigId() {
  return process.env.COMPOSIO_GSC_AUTH_CONFIG_ID;
}

/**
 * Start the hosted OAuth flow for an entity. Returns the URL the client
 * opens in a popup plus the pending connected-account id.
 */
export async function initiateGscConnection(entityId, callbackUrl) {
  const request = await getClient().connectedAccounts.link(entityId, gscAuthConfigId(), {
    callbackUrl,
  });
  return {
    redirectUrl: request.redirectUrl,
    connectedAccountId: request.connectedAccountId ?? request.id ?? null,
    status: request.connectionStatus ?? 'INITIATED',
  };
}

/** The entity's ACTIVE Search Console connection on Composio, or null. */
export async function getActiveGscConnection(entityId) {
  const connections = await getClient().connectedAccounts.list({
    authConfigIds: [gscAuthConfigId()],
    userIds: [entityId],
    statuses: ['ACTIVE'],
  });
  return connections.items?.[0] ?? null;
}

export async function deleteGscConnection(connectedAccountId) {
  await getClient().connectedAccounts.delete(connectedAccountId);
}
