import { BROWSER_API_BASE_URL } from '@/config/api';
import { apiFailure } from '@/lib/api-failure';
import { createClient } from '@/lib/supabase/client';
import { INTEGRATION_READ_TIMEOUT_MS } from '@/lib/integrations-client';

/**
 * A brand's Slack (#2139), from the browser through the API's same-origin
 * proxy (server routes/slack.js): the workspace the brand posts to, its
 * channel and what goes there. Slack's install runs in a popup; Composio
 * keeps the bot token, so nothing here ever holds one.
 */

/** What a brand's channel may get (server lib/slack/connection.js SEND_KINDS). */
export const SLACK_SEND_KINDS = ['pulse', 'drops', 'suggestion', 'needsYou'] as const;
export type SlackSendKind = (typeof SLACK_SEND_KINDS)[number];

/**
 * The switches the card shows: the kinds Ansvisor posts today. The drop
 * alerts, the daily suggestion and "an agent needs you" each add theirs with
 * the server's send (#2139).
 */
export const SLACK_SHOWN_KINDS: readonly SlackSendKind[] = ['pulse', 'drops', 'suggestion'];

/**
 * Where the brand's Slack stands: none; posting (once a channel is picked);
 * the workspace refused the connection; whoever connected it can't see the
 * brand any more.
 */
export type SlackState = 'not_connected' | 'connected' | 'refused' | 'access_lost';

export interface SlackChannel {
  id: string;
  name: string;
  private: boolean;
}

export interface SlackChannelOption extends SlackChannel {
  members: number | null;
}

export interface SlackWorkspace {
  /** The sign-in (integration_accounts.id). */
  accountId: string;
  /** "Acme Inc (acme.slack.com)"; null while Slack hasn't said. */
  label: string | null;
  /** Who connected it, by name; null when unknown. */
  connectedBy: string | null;
  connectedAt: string | null;
  /** The other brands, of those the person can access, that post to it. */
  sharedWith: string[];
}

export interface SlackCardRead {
  /** This server has Slack set up (Composio's key and the Slack auth config). */
  configured: boolean;
  /** The plan has Slack notifications. */
  allowed: boolean;
  state: SlackState;
  workspace: SlackWorkspace | null;
  channel: SlackChannel | null;
  send: Record<SlackSendKind, boolean>;
  /** Workspaces other brands use that this brand may use too. */
  usable: { accountId: string; label: string | null; brandIds: string[] }[];
}

export type SlackError =
  | 'not_configured'
  | 'invalid'
  | 'forbidden'
  | 'not_connected'
  | 'refused'
  | 'not_in_channel'
  | 'channel_gone'
  | 'no_channel'
  | 'access_lost'
  | 'connector_no_access'
  | 'unknown_account'
  | 'rate_limited'
  | 'session'
  | 'workspace'
  | 'busy'
  /** A read-only workspace or the demo brand: the upgrade dialog, not a message. */
  | 'subscription'
  /** A plan without Slack: the plan dialog. */
  | 'plan'
  | 'failed';

const KNOWN: readonly SlackError[] = [
  'not_configured',
  'invalid',
  'forbidden',
  'not_connected',
  'refused',
  'not_in_channel',
  'channel_gone',
  'no_channel',
  'access_lost',
  'connector_no_access',
  'unknown_account',
  'rate_limited',
];

export type SlackResult<T> = ({ ok: true } & T) | { ok: false; code: SlackError };

async function call<T>(
  brandId: string,
  path: string,
  init: RequestInit = {},
): Promise<SlackResult<T>> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false, code: 'session' };
    const res = await fetch(
      `${BROWSER_API_BASE_URL}/api/slack/brands/${encodeURIComponent(brandId)}${path}`,
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
      // The plan dialog first: a plan without Slack, a read-only workspace, the demo brand.
      const general = apiFailure(res.status, body);
      if (general === 'plan' || general === 'subscription') return { ok: false, code: general };
      const known = KNOWN.find((c) => c === body.code);
      if (known) return { ok: false, code: known };
      return {
        ok: false,
        code:
          general === 'session' || general === 'workspace' || general === 'busy'
            ? general
            : 'failed',
      };
    }
    return { ok: true, ...(body as T) };
  } catch (err) {
    console.error('Slack call failed:', (err as Error)?.name ?? err);
    return { ok: false, code: 'failed' };
  }
}

/** Where the brand's Slack stands, and whether this server and plan have it. */
export function readSlack(brandId: string) {
  return call<SlackCardRead>(brandId, '', {
    signal: AbortSignal.timeout(INTEGRATION_READ_TIMEOUT_MS),
  });
}

/** Starts Slack's install of the app: the address to open, and the sign-in to activate. */
export function startSlackConnect(brandId: string, callbackUrl: string) {
  return call<{ redirectUrl: string; accountId: string }>(brandId, '/connect', {
    method: 'POST',
    body: JSON.stringify({ callbackUrl }),
  });
}

/** Whether the install is done: `connected` once Composio says so, else `pending`. */
export function activateSlack(brandId: string, accountId: string) {
  return call<{ status: 'connected' | 'pending' }>(brandId, '/activate', {
    method: 'POST',
    body: JSON.stringify({ accountId }),
  });
}

/** The brand posts to the workspace another brand uses. */
export function chooseSlackWorkspace(brandId: string, accountId: string) {
  return call<SlackCardRead>(brandId, '/use', {
    method: 'POST',
    body: JSON.stringify({ accountId }),
  });
}

/** The workspace's channels: public ones, and private ones the app was invited to. */
export function listSlackChannels(brandId: string) {
  return call<{ channels: SlackChannelOption[] }>(brandId, '/channels', {
    signal: AbortSignal.timeout(INTEGRATION_READ_TIMEOUT_MS),
  });
}

/** The brand's channel (null: none), and what goes to it. */
export function saveSlack(
  brandId: string,
  patch: { channelId?: string | null; send?: Partial<Record<SlackSendKind, boolean>> },
) {
  return call<SlackCardRead>(brandId, '', { method: 'PUT', body: JSON.stringify(patch) });
}

/** A test message to the brand's channel. */
export function sendSlackTest(brandId: string) {
  return call<{ sent: boolean; channel: SlackChannel }>(brandId, '/test', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** The brand stops posting to Slack. */
export function disconnectSlack(brandId: string) {
  return call<{ success: boolean }>(brandId, '', { method: 'DELETE' });
}
