import { MAX_WAIT_MS, RETRIES, retryAfterMs } from '../../connectors/http.js';
import { proxyRequest } from '../composio.js';
import { logger } from '../logger.js';

/**
 * Calls to HubSpot's API (#2140), on a brand's HubSpot sign-in: through
 * Composio's proxy (composio.js proxyRequest), which adds the account's
 * OAuth token on its side, so the token never reaches us. Only HubSpot's API
 * host is called, over https.
 *
 * Answers `{ status, headers, data }` for a 2xx, else a HubspotError:
 *   - 'auth': the sign-in is gone or refused (Composio says the account
 *     expired or was revoked, or HubSpot's 401). The card asks to connect
 *     HubSpot again;
 *   - 'scopes': HubSpot's 403 for a scope the sign-in wasn't given (an
 *     older connection, or an auth config missing one);
 *   - 'forbidden': any other 403 (a portal without the product, a user
 *     without the permission);
 *   - 'not_set_up': Composio refused this server (its API key);
 *   - 'not_found' (404), 'conflict' (409), 'invalid' (400): HubSpot's words
 *     on the request;
 *   - 'rate_limited': still 429 after RETRIES waits, or asked to wait longer
 *     than the call allows;
 *   - 'http_error': any other status; 'unreachable' or 'timeout': Composio
 *     couldn't be reached in time.
 *
 * It waits and tries again on 429 (HubSpot didn't take the call, whatever
 * its method), and on 5xx for a read only: a write HubSpot may have taken
 * isn't sent twice. Errors name the method and the path's shape only, and
 * refusals are logged as warnings with HubSpot's category and correlation
 * id, never the body, the query or an id.
 */

export const HUBSPOT_API = 'https://api.hubapi.com';

/** The longest one wait may be while a person waits on the call (connect, settings). */
export const INTERACTIVE_WAIT_MS = 10_000;

const RETRY_STATUSES = new Set([500, 502, 503, 504]);
/**
 * Composio's own refusals that mean the connection is gone (it expired, was
 * revoked or removed), not that this server's setup is wrong: they name the
 * connection (lib/catalog/sign-in.js reads them the same way).
 */
const SIGN_IN_GONE =
  /^(?=[\s\S]*(connected[\s_-]?account|connection))(?=[\s\S]*(expired|inactive|not[\s_-]?active|revoked|deleted|not[\s_-]?found))|invalid_grant|re-?auth/i;

export class HubspotError extends Error {
  /**
   * @param {'auth'|'scopes'|'forbidden'|'not_set_up'|'not_found'|'conflict'|'invalid'|
   *   'rate_limited'|'http_error'|'unreachable'|'timeout'|'no_sign_in'} code
   * @param {string} message
   * @param {{ status?: number, category?: string }} [extra]
   */
  constructor(code, message, { status, category } = {}) {
    super(message);
    this.name = 'HubspotError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (category !== undefined) this.category = category;
  }
}

/** A wait that ends early when `signal` aborts. */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

const clip = (value, max = 100) => (typeof value === 'string' ? value.slice(0, max) : undefined);

/** Header names in lower case, as retryAfterMs reads them. */
function lowerKeys(headers) {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

/** The path as logged and named in errors: its ids (numbers, a property's name) left out. */
export function pathShape(path) {
  return String(path)
    .split('?')[0]
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/(properties\/contacts)\/(?!groups|batch)[^/]+/, '/$1/:name')
    .replace(/\/(groups)\/[^/]+/, '/$1/:name');
}

/** A refusal, logged for whoever runs the server: what refused and why. */
function logRefusal(code, { method, path, status, data, name }) {
  logger.warn(
    {
      code,
      method,
      path: pathShape(path),
      err: { name: clip(name), status },
      ...(data && typeof data === 'object'
        ? { hubspot: { category: clip(data.category), correlationId: clip(data.correlationId) } }
        : {}),
    },
    '[hubspot] call refused',
  );
}

/** What a HubSpot status means, as a HubspotError code. */
function codeOf(status, data) {
  if (status === 401) return 'auth';
  if (status === 403) return data?.category === 'MISSING_SCOPES' ? 'scopes' : 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 400) return 'invalid';
  if (status === 429) return 'rate_limited';
  return 'http_error';
}

/**
 * One call to HubSpot on a connected account.
 *
 * @param {string} accountId the Composio connected account (a brand's HubSpot sign-in)
 * @param {{ method?: string, path: string, query?: object, body?: unknown,
 *   signal?: AbortSignal, maxWaitMs?: number }} call `path` under api.hubapi.com
 * @param {{ proxy?: Function, wait?: Function }} [deps] the tests' stand-ins
 */
export async function hubspotRequest(
  accountId,
  { method = 'GET', path, query, body, signal, maxWaitMs = MAX_WAIT_MS },
  { proxy = proxyRequest, wait = sleep } = {},
) {
  const where = `${method} ${pathShape(path)}`;
  if (!accountId) throw new HubspotError('no_sign_in', `${where}: no HubSpot sign-in`);
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
    throw new HubspotError('invalid', `${where}: not a HubSpot API path`);
  }
  const endpoint = `${HUBSPOT_API}${path}`;
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) throw new HubspotError('timeout', `${where} took too long`);
    let res;
    try {
      res = await proxy(accountId, { endpoint, method, query, body, signal });
    } catch (err) {
      if (signal?.aborted) throw new HubspotError('timeout', `${where} took too long`);
      const status = err?.status ?? err?.statusCode;
      const refused = { method, path, status, name: err?.name };
      if (SIGN_IN_GONE.test(String(err?.message ?? ''))) {
        logRefusal('auth', refused);
        throw new HubspotError('auth', `${where}: the HubSpot sign-in is gone`);
      }
      if (status === 401 || status === 403) {
        logRefusal('not_set_up', refused);
        throw new HubspotError('not_set_up', `${where}: Composio refused this server`);
      }
      throw new HubspotError('unreachable', `${where} couldn't be reached`);
    }
    if (res.status >= 200 && res.status < 300) return res;
    const retryable = res.status === 429 || (method === 'GET' && RETRY_STATUSES.has(res.status));
    if (retryable && attempt < RETRIES) {
      const ms = retryAfterMs(lowerKeys(res.headers)) ?? 1000 * 2 ** attempt;
      if (ms <= maxWaitMs) {
        await wait(ms, signal);
        continue;
      }
    }
    const code = codeOf(res.status, res.data);
    if (code === 'auth' || code === 'scopes' || code === 'forbidden') {
      logRefusal(code, { method, path, status: res.status, data: res.data });
    }
    throw new HubspotError(code, `${where} answered ${res.status}`, {
      status: res.status,
      category: clip(res.data?.category),
    });
  }
}

/**
 * A request bound to one connected account, as the setup and the later syncs
 * call it: `request({ method, path, query, body })`.
 */
export function hubspotClient(accountId, { maxWaitMs, signal, proxy, wait } = {}) {
  return (call) =>
    hubspotRequest(
      accountId,
      { maxWaitMs, signal, ...call },
      { ...(proxy ? { proxy } : {}), ...(wait ? { wait } : {}) },
    );
}
