import supabaseAdmin from '../../config/supabase.js';
import { brandReaders } from '../access.js';
import { slackGet, slackPost } from './api.js';
import { connectedMessage } from './blocks/connected.js';

/**
 * A brand's Slack (#2139): the workspace it posts to and its channel.
 *
 * Integrations per brand (00470): a Slack workspace's install is one sign-in
 * in the Account's pool (integration_accounts, provider `slack`, labelled with
 * the workspace's name), and each brand names the one it uses
 * (brand_integrations), as a brand's own Google login does. The brand's own
 * choices on it live in that row's `settings`:
 *
 *   { channel: { id, name, private } | null,
 *     send: { pulse, drops, suggestion, needsYou } }
 *
 * The channel belongs to the workspace, so the choices go when the brand
 * uses another one (brand-integrations.js). What to send is on by default.
 *
 * Brand access (owner, 2026-11-10): a brand's messages are posted only
 * while the person who connected its workspace can still see the brand.
 */

export const PROVIDER = 'slack';

/** What a brand's channel may get, each on unless turned off. */
export const SEND_KINDS = Object.freeze(['pulse', 'drops', 'suggestion', 'needsYou']);

/**
 * The kinds Ansvisor posts today (the card shows their switches): the Daily
 * Pulse (deliver.js, pulse/engine.js) and the drop alerts (drops.js). The
 * daily suggestion and "an agent needs you" join with their sends.
 */
export const POSTED_KINDS = Object.freeze(['pulse', 'drops']);

/** Slack's channel ids: C… (G… for older private channels). */
export const CHANNEL_ID = /^[CG][A-Z0-9]{6,20}$/;

/** Channels a picker lists at most: conversations.list pages of 200. */
const CHANNEL_PAGE = 200;
const MAX_CHANNEL_PAGES = 5;

const ACCOUNT_COLUMNS =
  'id, organization_id, composio_entity_id, composio_account_id, label, status, connected_by, created_at';

/** Postgres' code for a missing table, PostgREST's for one (or a relationship) not in its cache. */
const NOT_MIGRATED = new Set(['42P01', 'PGRST205', 'PGRST200']);

/**
 * A brand's choices as stored, made whole: an unknown key dropped, a send
 * kind missing or not a boolean taken as on, a channel that isn't one as none.
 * @param {unknown} raw
 * @returns {{ channel: { id: string, name: string, private: boolean } | null,
 *   send: Record<'pulse'|'drops'|'suggestion'|'needsYou', boolean> }}
 */
export function settingsOf(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const channel = value.channel;
  const send = value.send && typeof value.send === 'object' ? value.send : {};
  return {
    channel:
      channel &&
      typeof channel.id === 'string' &&
      CHANNEL_ID.test(channel.id) &&
      typeof channel.name === 'string' &&
      channel.name
        ? { id: channel.id, name: channel.name.slice(0, 80), private: channel.private === true }
        : null,
    send: Object.fromEntries(SEND_KINDS.map((kind) => [kind, send[kind] !== false])),
  };
}

/**
 * @typedef {object} BrandSlack
 * @property {string} accountId the sign-in (integration_accounts.id)
 * @property {string} organizationId
 * @property {string|null} entityId the Composio entity
 * @property {string|null} composioAccountId the Composio connected account
 * @property {string|null} label the workspace, as "Acme Inc (acme.slack.com)"
 * @property {string} status pending, connected or auth_failed
 * @property {string|null} connectedBy who installed it
 * @property {string|null} connectedAt
 * @property {ReturnType<typeof settingsOf>} settings
 */

/**
 * The brand's Slack, whatever its status, or null when it uses none. The
 * caller checks the person's access to the brand first.
 * @param {string} brandId
 * @returns {Promise<BrandSlack|null>}
 */
export async function brandSlack(brandId) {
  const { data, error } = await supabaseAdmin
    .from('brand_integrations')
    .select(
      `settings, account:integration_accounts!brand_integrations_account_id_fkey(${ACCOUNT_COLUMNS})`,
    )
    .eq('brand_id', brandId)
    .eq('provider', PROVIDER)
    .maybeSingle();
  // Before 00470 there is no pool, and no brand has Slack.
  if (error && NOT_MIGRATED.has(error.code)) return null;
  if (error) throw new Error(error.message);
  const account = Array.isArray(data?.account) ? data.account[0] : data?.account;
  if (!account) return null;
  return {
    accountId: account.id,
    organizationId: account.organization_id,
    entityId: account.composio_entity_id ?? null,
    composioAccountId: account.composio_account_id ?? null,
    label: account.label ?? null,
    status: account.status,
    connectedBy: account.connected_by ?? null,
    connectedAt: account.created_at ?? null,
    settings: settingsOf(data.settings),
  };
}

/**
 * Whether `userId` (the person who connected a workspace) may see the brand:
 * a member of its organization with access to it. No one, for none.
 * @param {{ id: string, organization_id: string }} brand
 * @param {string|null} userId
 */
export async function seesBrand(brand, userId) {
  if (!userId) return false;
  const readers = await brandReaders(brand.organization_id, [brand.id]);
  return readers.has(userId);
}

/**
 * Where the brand's Slack stands, for its card and before a post:
 *   - not_connected: it uses none (or a sign-in that isn't finished);
 *   - refused: the workspace no longer takes the connection (reconnect);
 *   - access_lost: whoever connected it can't see the brand any more;
 *   - connected: it posts, once a channel is picked.
 * @param {BrandSlack|null} slack
 * @param {boolean} connectorSees seesBrand for slack.connectedBy
 */
export function stateOf(slack, connectorSees) {
  if (!slack) return 'not_connected';
  if (slack.status === 'auth_failed') return 'refused';
  if (slack.status !== 'connected') return 'not_connected';
  if (!connectorSees) return 'access_lost';
  return 'connected';
}

/** The workspace's name and address, as a card says it: "Acme Inc (acme.slack.com)". */
export function workspaceLabel({ team, url }) {
  const name = typeof team === 'string' ? team.trim() : '';
  let host = null;
  try {
    host = url ? new URL(url).hostname : null;
  } catch {
    host = null;
  }
  const label = name && host ? `${name} (${host})` : name || host;
  return label ? label.slice(0, 300) : null;
}

/** The workspace the connection installed into, by auth.test: its label. */
export async function readWorkspaceLabel(connection, { get = slackGet } = {}) {
  return workspaceLabel(await get(connection, 'auth.test'));
}

/** Names the sign-in after its workspace (best effort: the caller logs a failure). */
export async function saveWorkspaceLabel(accountId, label) {
  if (!label) return;
  const { error } = await supabaseAdmin
    .from('integration_accounts')
    .update({ label, updated_at: new Date().toISOString() })
    .eq('id', accountId);
  if (error) throw new Error(error.message);
}

/**
 * The workspace's channels the brand may post to, by name: public ones, and
 * the private ones the app was invited to (Slack lists only those). At most
 * MAX_CHANNEL_PAGES pages; archived ones left out.
 * @returns {Promise<{ id: string, name: string, private: boolean, members: number|null }[]>}
 */
export async function listChannels(connection, { get = slackGet } = {}) {
  const channels = [];
  let cursor;
  for (let page = 0; page < MAX_CHANNEL_PAGES; page++) {
    const data = await get(connection, 'conversations.list', {
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: CHANNEL_PAGE,
      cursor,
    });
    for (const c of data.channels ?? []) {
      if (!c?.id || !CHANNEL_ID.test(c.id) || !c.name || c.is_archived) continue;
      channels.push({
        id: c.id,
        name: String(c.name).slice(0, 80),
        private: c.is_private === true,
        members: Number.isInteger(c.num_members) ? c.num_members : null,
      });
    }
    cursor = data.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  return channels.sort((a, b) => a.name.localeCompare(b.name));
}

/** One channel of the workspace, as conversations.info says it. */
export async function readChannel(connection, channelId, { get = slackGet } = {}) {
  const { channel } = await get(connection, 'conversations.info', { channel: channelId });
  return {
    id: channel?.id ?? channelId,
    name: String(channel?.name ?? '').slice(0, 80),
    private: channel?.is_private === true,
    archived: channel?.is_archived === true,
  };
}

/** Keeps the brand's choices on its Slack. */
export async function saveSettings(brandId, settings) {
  const { error } = await supabaseAdmin
    .from('brand_integrations')
    .update({ settings: settingsOf(settings), updated_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .eq('provider', PROVIDER);
  if (error) throw new Error(error.message);
}

/**
 * The workspace no longer takes the connection: its sign-in says so for
 * every brand that uses it, until it is connected again.
 */
export async function markRefused(accountId) {
  const { error } = await supabaseAdmin
    .from('integration_accounts')
    .update({ status: 'auth_failed', updated_at: new Date().toISOString() })
    .eq('id', accountId)
    .eq('status', 'connected');
  if (error) throw new Error(error.message);
}

/**
 * The message Send a test message posts to the brand's channel. Slack's
 * answer: the message's channel and ts.
 */
export async function postConnectedMessage(
  connection,
  { channelId, brand, by, kinds },
  { post = slackPost } = {},
) {
  const message = connectedMessage({ brand, by, kinds });
  const data = await post(connection, 'chat.postMessage', {
    channel: channelId,
    ...message,
    unfurl_links: false,
    unfurl_media: false,
  });
  return { channel: data.channel ?? channelId, ts: data.ts ?? null };
}
