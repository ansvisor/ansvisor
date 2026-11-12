import { proxyRequest } from '../composio.js';

/**
 * Slack's Web API for a brand's Slack connection (#2139), through Composio's
 * proxy on the connection's connected account: Composio adds the bot token,
 * so it never reaches us. Reads are GETs with their arguments in the query,
 * writes POST JSON, as Slack takes them.
 *
 * Slack answers 200 with `ok: false` and a code for its own refusals, 429
 * with Retry-After when we post too fast. Every failure is a SlackError
 * carrying only a code (Slack's own, or one of ours below), never the
 * message's text or a channel's name: callers log the code.
 */

const BASE = 'https://slack.com/api/';

/** A Slack call that failed: Slack's code, or ours for a failure around it. */
export class SlackError extends Error {
  /**
   * @param {string} code Slack's `error` (`channel_not_found`), or `ratelimited`,
   *   `slack_unavailable`, `http_{status}`, `composio_refused`
   * @param {{ status?: number, retryAfter?: number|null }} [details]
   */
  constructor(code, { status = null, retryAfter = null } = {}) {
    super(`Slack: ${code}`);
    this.name = 'SlackError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/**
 * Codes that mean the workspace no longer takes the connection (the app was
 * removed, the token revoked, the workspace gone): it needs a reconnect.
 */
export const REFUSED_CODES = new Set([
  'invalid_auth',
  'not_authed',
  'token_revoked',
  'token_expired',
  'account_inactive',
  'team_access_not_granted',
  'composio_refused',
]);

/** Codes that mean the brand's channel can't be posted to as it is. */
export const CHANNEL_CODES = new Set(['channel_not_found', 'is_archived', 'not_in_channel']);

/** Retry-After in seconds, or null when Slack gave none. */
function retryAfterOf(headers) {
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/** Slack's answer, or a SlackError for a refusal, a 429 or a failure around it. */
function answerOf(res) {
  if (res.status === 429) {
    throw new SlackError('ratelimited', { status: 429, retryAfter: retryAfterOf(res.headers) });
  }
  if (res.status >= 500) throw new SlackError('slack_unavailable', { status: res.status });
  if (res.status < 200 || res.status >= 300) {
    throw new SlackError(`http_${res.status}`, { status: res.status });
  }
  const data = res.data;
  if (!data || typeof data !== 'object') {
    throw new SlackError('bad_response', { status: res.status });
  }
  if (data.ok !== true) {
    const code = typeof data.error === 'string' && data.error ? data.error : 'unknown_error';
    throw new SlackError(code.slice(0, 100), { status: res.status });
  }
  return data;
}

async function call(connection, method, request, { proxy = proxyRequest } = {}) {
  if (!connection?.composioAccountId) throw new SlackError('not_connected');
  let res;
  try {
    res = await proxy(connection.composioAccountId, { endpoint: `${BASE}${method}`, ...request });
  } catch (err) {
    // Composio itself refused (the connected account is gone or inactive), or
    // the request never got an answer: said by code, never by its message.
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      throw new SlackError('timeout');
    }
    const status = Number(err?.status ?? err?.statusCode);
    if (status === 401 || status === 403 || status === 404) {
      throw new SlackError('composio_refused', { status });
    }
    throw new SlackError('composio_failed', { status: Number.isFinite(status) ? status : null });
  }
  return answerOf(res);
}

/**
 * A read: Slack `method` with `query`, on the connection's account.
 * @param {{ composioAccountId: string|null }} connection
 * @param {string} method e.g. `conversations.list`
 * @param {Record<string, string|number|boolean|undefined>} [query]
 */
export function slackGet(connection, method, query = {}, options) {
  return call(connection, method, { method: 'GET', query }, options);
}

/**
 * A write: Slack `method` with a JSON `body`, on the connection's account.
 * @param {{ composioAccountId: string|null }} connection
 * @param {string} method e.g. `chat.postMessage`
 * @param {object} body
 */
export function slackPost(connection, method, body, options) {
  return call(connection, method, { method: 'POST', body }, options);
}
