import supabaseAdmin from '../../config/supabase.js';
import { ConnectorHttpError, MAX_WAIT_MS, RETRIES, retryAfterMs } from '../../connectors/http.js';
import { getActiveConnection, proxyRequest } from '../composio.js';

/**
 * Catalog sources read with the workspace's own sign-in to a platform
 * (#1270): a Google Merchant Center account, through the Google connection
 * the workspace made in Settings › Integrations, which Composio keeps
 * (integration_connections, 00045). Such a source has no credentials of its
 * own (00282): its connector's `signIn` names the Composio provider, and its
 * calls go through Composio's proxy (composio.js proxyRequest), so the token
 * never reaches us.
 *
 * The request it gives a connector answers like the HTTP client's
 * (connectors/http.js requestJson): `{ status, headers, data }` for a 2xx,
 * else a ConnectorHttpError:
 *   - 'auth': the sign-in is gone or refused (no active connection, a
 *     401 or 403, Composio saying the account expired);
 *   - 'rate_limited': still 429 after RETRIES waits;
 *   - 'http_error': any other status;
 *   - 'unreachable' or 'timeout': Composio couldn't be reached in time.
 * It waits and tries again on 429 and 5xx, as long as Retry-After says,
 * else 1, 2, 4 seconds. Errors name the host and path only.
 */

/** The Composio entity of a brand's workspace: one connection per workspace and provider. */
export async function workspaceEntity(brandId, { db = supabaseAdmin } = {}) {
  const { data, error } = await db
    .from('brands')
    .select('organization_id')
    .eq('id', brandId)
    .maybeSingle();
  if (error) throw new Error(`brands read: ${error.message}`);
  if (!data?.organization_id) throw new Error('The brand has no workspace.');
  return `org_${data.organization_id}`;
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
/** Composio's own refusals that mean the sign-in is gone, not that Composio is down. */
const SIGN_IN_GONE = /expired|inactive|not active|revoked|invalid_grant|unauthori[sz]ed|reauth/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Header names in lower case, as retryAfterMs reads them. */
function lowerKeys(headers) {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

/**
 * A connector's request for the workspace's sign-in to `provider`. The
 * connection is looked up once, on the first call.
 *
 * @param {string} provider a Composio provider (composio.js PROVIDERS)
 * @param {string} entityId the workspace's entity (workspaceEntity)
 * @param {{ active?: Function, proxy?: Function, wait?: Function }} [stand-ins] the tests'
 */
export function signInRequest(
  provider,
  entityId,
  { active = getActiveConnection, proxy = proxyRequest, wait = sleep } = {},
) {
  let accountId = null;
  return async function request(address, { query, signal } = {}) {
    const url = new URL(address);
    const where = `GET ${url.host}${url.pathname}`;
    if (!accountId) {
      let account;
      try {
        account = await active(provider, entityId);
      } catch {
        throw new ConnectorHttpError('unreachable', `${where}: the sign-in couldn't be looked up`);
      }
      if (!account?.id) throw new ConnectorHttpError('auth', `${where}: no active sign-in`);
      accountId = account.id;
    }
    for (let attempt = 0; ; attempt += 1) {
      let res;
      try {
        res = await proxy(accountId, { endpoint: url.href, query, signal });
      } catch (err) {
        if (signal?.aborted) throw new ConnectorHttpError('timeout', `${where} took too long`);
        const status = err?.status ?? err?.statusCode;
        if (status === 401 || status === 403 || SIGN_IN_GONE.test(String(err?.message ?? ''))) {
          throw new ConnectorHttpError('auth', `${where}: sign-in refused`, { status });
        }
        throw new ConnectorHttpError('unreachable', `${where} couldn't be reached`);
      }
      if (res.status >= 200 && res.status < 300) return res;
      if (res.status === 401 || res.status === 403) {
        throw new ConnectorHttpError('auth', `${where} answered ${res.status}`, {
          status: res.status,
        });
      }
      if (RETRY_STATUSES.has(res.status) && attempt < RETRIES) {
        const ms = retryAfterMs(lowerKeys(res.headers)) ?? 1000 * 2 ** attempt;
        if (ms <= MAX_WAIT_MS) {
          await wait(ms);
          continue;
        }
      }
      if (res.status === 429) {
        throw new ConnectorHttpError('rate_limited', `${where} asked to wait`, { status: 429 });
      }
      throw new ConnectorHttpError('http_error', `${where} answered ${res.status}`, {
        status: res.status,
      });
    }
  };
}
