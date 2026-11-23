/**
 * Can Ansvisor read Google Ads accounts, and how (Ads Phase 1 spike)? Its
 * findings decide how Phase 1's Google Ads connection is built; nothing in
 * the product reads them.
 *
 * Run by hand only, from server/, by whoever holds the keys. Nothing
 * schedules or imports it (ads-probe-parts.test.js checks the imports).
 * Read-only: `customers:listAccessibleCustomers` and Google Ads `search`
 * (GAQL SELECT) calls, never a mutate.
 *
 *   node src/scripts/probe-google-ads.js composio <connectedAccountId>
 *   node src/scripts/probe-google-ads.js direct
 *   node src/scripts/probe-google-ads.js composio-tools <entityId> <connectedAccountId>
 *
 * composio-tools runs Composio's own Google Ads tools (toolkit 20261116_00,
 * or GOOGLEADS_TOOLKIT_VERSION): GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS and
 * GOOGLEADS_SEARCH_GAQL, with no developer token of ours. Composio's docs
 * disagree on whose token those use (the toolkit page calls the auth
 * config's Developer Token field legacy; its knowledge base says the token
 * belongs on the auth config), so this mode shows what actually happens.
 * The entity is `org_<organizationId>`. If GAQL's argument names differ, the
 * printed error names the ones the tool wants.
 *
 * composio and direct need, in server/.env:
 *   GOOGLE_ADS_DEVELOPER_TOKEN   optional: Google stopped issuing tokens on
 *                                9 Sep 2026 and access now sits with the
 *                                Cloud project behind the OAuth client (with
 *                                Composio's app, Composio's project);
 *   GOOGLE_ADS_API_VERSION       e.g. v26, a version Google still serves;
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID optional: the MANAGER account's id when the
 *                                account is reached through one.
 *
 * - composio: through Composio's proxy, as Search Console, Analytics and
 *   Merchant Center already work, so the OAuth token never reaches us.
 *   Needs COMPOSIO_API_KEY and the id of a Composio connected account whose
 *   auth config asks for the Google Ads scope
 *   (https://www.googleapis.com/auth/adwords). This answers whether
 *   Composio's proxy reaches real accounts with no token of ours.
 * - direct: our own OAuth client, for comparison. Needs
 *   GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET and GOOGLE_ADS_REFRESH_TOKEN
 *   (e.g. from Google's OAuth Playground with the Google Ads scope).
 *
 * Prints, per step, the HTTP status and what it means (ads-probe-parts.js
 * googleAdsVerdict): Test vs Basic access, a missing scope, a retired API
 * version. Account names and numbers are the signed-in user's own; no key,
 * token or secret is ever printed (redact).
 */
import 'dotenv/config';
import { Composio } from '@composio/core';
import {
  accessibleCustomerIds,
  customerId,
  googleAdsHeaders,
  googleAdsVerdict,
  redact,
} from './ads-probe-parts.js';

const [mode, connectedAccountId] = process.argv.slice(2);
const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const version = process.env.GOOGLE_ADS_API_VERSION;
const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
const SECRETS = [
  developerToken,
  process.env.COMPOSIO_API_KEY,
  process.env.GOOGLE_ADS_CLIENT_SECRET,
  process.env.GOOGLE_ADS_REFRESH_TOKEN,
];
const say = (text) => console.log(redact(text, SECRETS));

function stop(message) {
  console.error(redact(message, SECRETS));
  process.exit(1);
}

if (mode === 'composio-tools') {
  const [entityId, accountId] = process.argv.slice(3);
  if (!process.env.COMPOSIO_API_KEY || !entityId || !accountId) {
    stop('composio-tools needs COMPOSIO_API_KEY, an entity id and a connected account id.');
  }
  const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  const toolkitVersion = process.env.GOOGLEADS_TOOLKIT_VERSION || '20261116_00';
  const run = (slug, args) =>
    composio.tools.execute(slug, {
      userId: entityId,
      connectedAccountId: accountId,
      arguments: args,
      version: toolkitVersion,
    });
  say(`Google Ads probe · composio-tools · toolkit ${toolkitVersion}`);
  const listed = await run('GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS', {}).catch((err) => ({
    successful: false,
    error: err.message,
  }));
  const ids = accessibleCustomerIds(listed?.data);
  say(
    `\n1. Accessible accounts: ${listed?.successful === false ? `failed · ${String(listed.error).slice(0, 300)}` : 'OK'} · ${ids.length} account(s)${ids.length ? `: ${ids.slice(0, 10).join(', ')}` : ''}`,
  );
  if (ids.length) {
    const searched = await run('GOOGLEADS_SEARCH_GAQL', {
      customer_id: ids[0],
      query: 'SELECT customer.id, customer.manager, customer.test_account FROM customer LIMIT 1',
    }).catch((err) => ({ successful: false, error: err.message }));
    say(
      `\n2. GAQL on ${ids[0]}: ${searched?.successful === false ? `failed · ${String(searched.error).slice(0, 300)}` : `OK · ${JSON.stringify(searched?.data ?? null).length} chars`}`,
    );
  }
  process.exit(0);
}
if (mode !== 'composio' && mode !== 'direct') {
  stop(
    'Usage: probe-google-ads.js composio <connectedAccountId> | direct | composio-tools <entityId> <connectedAccountId>',
  );
}
if (!/^v\d+$/.test(version ?? '')) {
  stop(
    'Set GOOGLE_ADS_API_VERSION (e.g. v26) to a version Google still serves; see the Google Ads API release notes.',
  );
}
if (mode === 'composio' && (!process.env.COMPOSIO_API_KEY || !connectedAccountId)) {
  stop('composio mode needs COMPOSIO_API_KEY and a connected account id argument.');
}

const API = `https://googleads.googleapis.com/${version}`;
const headers = googleAdsHeaders({ developerToken, loginCustomerId });

/** One read call, in either mode: `{ status, data }`. */
let call;
if (mode === 'composio') {
  const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  call = async (url, { method = 'GET', body } = {}) => {
    const parameters = Object.entries(headers).map(([name, value]) => ({
      in: 'header',
      name,
      value,
    }));
    if (body !== undefined) {
      parameters.push({ in: 'header', name: 'Content-Type', value: 'application/json' });
    }
    const res = await composio.tools.proxyExecute({
      endpoint: url,
      method,
      parameters,
      ...(body !== undefined ? { body } : {}),
      connectedAccountId,
    });
    return { status: res.status, data: res.data ?? null };
  };
} else {
  const { GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_ADS_CLIENT_ID || !GOOGLE_ADS_CLIENT_SECRET || !GOOGLE_ADS_REFRESH_TOKEN) {
    stop(
      'direct mode needs GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN.',
    );
  }
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_ADS_CLIENT_ID,
      client_secret: GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!token.access_token) {
    stop(`OAuth refresh failed (${tokenRes.status}): ${token.error ?? 'no access token'}`);
  }
  SECRETS.push(token.access_token);
  call = async (url, { method = 'GET', body } = {}) => {
    const res = await fetch(url, {
      method,
      headers: {
        ...headers,
        Authorization: `Bearer ${token.access_token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

/** A GAQL read: Google Ads' search is a POST, but a SELECT only reads. */
const search = (id, query) =>
  call(`${API}/customers/${customerId(id)}/googleAds:search`, {
    method: 'POST',
    body: { query },
  });

say(`Google Ads probe · ${mode} · API ${version}${loginCustomerId ? ' · via manager' : ''}`);

// 1. Which accounts can the signed-in user reach?
const list = await call(`${API}/customers:listAccessibleCustomers`);
say(`\n1. Accessible accounts: ${list.status} · ${googleAdsVerdict(list.status, list.data)}`);
const ids = accessibleCustomerIds(list.data);
say(`   ${ids.length} account(s)${ids.length ? `: ${ids.slice(0, 10).join(', ')}` : ''}`);
if (list.status !== 200 || !ids.length) process.exit(0);

// 2. What each one is: manager or not, test account or not.
let readable = null;
for (const id of ids.slice(0, 5)) {
  const res = await search(
    id,
    'SELECT customer.id, customer.descriptive_name, customer.manager, customer.test_account, customer.currency_code FROM customer LIMIT 1',
  );
  const row = res.data?.results?.[0]?.customer;
  say(
    `\n2. Account ${id}: ${res.status} · ${googleAdsVerdict(res.status, res.data)}${
      row
        ? `\n   ${row.descriptiveName ?? '(no name)'} · manager: ${Boolean(row.manager)} · test account: ${Boolean(row.testAccount)} · ${row.currencyCode ?? ''}`
        : ''
    }`,
  );
  if (res.status === 200 && row && !row.manager && !readable) readable = id;
}

// 3. The Phase 1 read itself: campaigns with the last 7 days' metrics.
if (readable) {
  const res = await search(
    readable,
    'SELECT campaign.id, campaign.status, campaign.advertising_channel_type, metrics.cost_micros, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date DURING LAST_7_DAYS',
  );
  const rows = res.data?.results ?? [];
  const cost = rows.reduce((sum, r) => sum + Number(r.metrics?.costMicros ?? 0), 0) / 1e6;
  const channels = [...new Set(rows.map((r) => r.campaign?.advertisingChannelType))].join(', ');
  say(
    `\n3. Campaign metrics (last 7 days) on ${readable}: ${res.status} · ${googleAdsVerdict(res.status, res.data)}\n   ${rows.length} row(s) · cost ${cost.toFixed(2)} · channels: ${channels || '-'}`,
  );

  // 4. Search terms, which Overlap (G6) matches to tracked prompts.
  const terms = await search(
    readable,
    'SELECT search_term_view.search_term, metrics.cost_micros FROM search_term_view WHERE segments.date DURING LAST_7_DAYS LIMIT 5',
  );
  say(
    `\n4. Search terms (last 7 days): ${terms.status} · ${googleAdsVerdict(terms.status, terms.data)} · ${terms.data?.results?.length ?? 0} row(s)`,
  );
} else {
  say('\n3. No non-manager account could be read, so campaign metrics were skipped.');
}
