import { executeGoogleAdsTool } from '../composio.js';

/**
 * Google Ads reads for Ads Phase 1 (G1), through Composio's managed Google
 * Ads app and its own GOOGLEADS_* tools (toolkit 20261116_00, API v26). With
 * these tools Composio's access is used, so no developer token of ours is
 * needed; #2668's probe read real accounts this way.
 *
 * Read only: list the accounts a sign-in reaches, describe one, and fetch
 * campaign and search-term days for a date range. Every GAQL query is built
 * here from checked ids and dates, never from a model's text, and only
 * SELECTs are sent.
 *
 * `connection` is `{ entityId, accountId }`, the Composio entity and the
 * connected account (composio.js toolTarget).
 */

/** Pages one search may read before it stops: a guard, far above a day's rows. */
const MAX_PAGES = 50;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "123-456-7890" or "customers/1234567890" → "1234567890"; anything else → null. */
export function customerIdOf(value) {
  const id = String(value ?? '')
    .replace(/^customers\//, '')
    .replace(/[-\s]/g, '');
  return /^\d{10}$/.test(id) ? id : null;
}

/** A tool's `data`: Composio documents a string (JSON); an object passes through. */
export function parseToolData(data) {
  if (data == null) return {};
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch {
    throw new Error('Google Ads returned an answer that is not JSON');
  }
}

/** A search answer's rows and its next page token, in either key style. */
export function searchPage(data) {
  const body = parseToolData(data);
  const inner = body.response ?? body;
  return {
    rows: inner.results ?? inner.rows ?? [],
    nextPageToken: inner.nextPageToken ?? inner.next_page_token ?? null,
  };
}

/** Google's int64 fields arrive as strings; a missing one is 0. */
function int(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function decimal(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

/** Checks a `{ since, until }` range of YYYY-MM-DD days, since ≤ until. */
export function dateRange({ since, until }) {
  if (!DATE.test(since ?? '') || !DATE.test(until ?? '') || since > until) {
    throw new Error('A Google Ads date range needs since ≤ until, both YYYY-MM-DD');
  }
  return { since, until };
}

/** Every page of one GAQL SELECT on one customer. */
async function searchAll(connection, customerId, query) {
  const rows = [];
  let pageToken = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await executeGoogleAdsTool('GOOGLEADS_SEARCH_GAQL', connection, {
      customer_id: customerId,
      query,
      ...(pageToken ? { page_token: pageToken } : {}),
    });
    const next = searchPage(data);
    rows.push(...next.rows);
    if (!next.nextPageToken) return rows;
    pageToken = next.nextPageToken;
  }
  throw new Error(`Google Ads search stopped after ${MAX_PAGES} pages`);
}

/** A customer id the caller passed, checked: GAQL and the tools take only digits. */
function checkedCustomer(customerId) {
  const id = customerIdOf(customerId);
  if (!id) throw new Error('A Google Ads customer id is 10 digits');
  return id;
}

/** The customer ids the sign-in reaches directly (not the children of a manager). */
export async function listAccessibleCustomers(connection) {
  const body = parseToolData(
    await executeGoogleAdsTool('GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS', connection, {}),
  );
  const names = body.resourceNames ?? body.resource_names ?? body.response?.resourceNames ?? [];
  return [...new Set(names.map(customerIdOf).filter(Boolean))];
}

/**
 * One customer: its name, currency, time zone, and whether it is a manager
 * (an MCC, which has no metrics of its own) or a test account. Null when the
 * customer answers no row.
 */
export async function customerInfo(connection, customerId) {
  const id = checkedCustomer(customerId);
  const [row] = await searchAll(
    connection,
    id,
    'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.test_account FROM customer LIMIT 1',
  );
  if (!row?.customer) return null;
  const c = row.customer;
  return {
    id,
    name: c.descriptiveName ?? c.descriptive_name ?? null,
    currencyCode: c.currencyCode ?? c.currency_code ?? null,
    timeZone: c.timeZone ?? c.time_zone ?? null,
    manager: Boolean(c.manager),
    testAccount: Boolean(c.testAccount ?? c.test_account),
  };
}

/**
 * Each campaign's days in the range, shaped as ads_campaign_daily rows
 * without the account id: impressions, clicks, cost in micros, conversions
 * and their value, in the customer's currency.
 */
export async function campaignDays(connection, customerId, range) {
  const id = checkedCustomer(customerId);
  const { since, until } = dateRange(range);
  const rows = await searchAll(
    connection,
    id,
    `SELECT campaign.id, campaign.name, campaign.status, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`,
  );
  return rows
    .filter((row) => row.campaign?.id && row.segments?.date)
    .map((row) => {
      const m = row.metrics ?? {};
      return {
        campaign_id: String(row.campaign.id),
        day: row.segments.date,
        campaign_name: row.campaign.name ?? null,
        campaign_status: row.campaign.status ?? null,
        impressions: int(m.impressions),
        clicks: int(m.clicks),
        cost_micros: int(m.costMicros ?? m.cost_micros),
        conversions: decimal(m.conversions),
        conversion_value: decimal(m.conversionsValue ?? m.conversions_value),
      };
    });
}

/**
 * The search terms that showed the customer's ads, per campaign and day,
 * shaped as ads_search_term_daily rows without the account id. Google
 * returns search_term_view once per ad group, so a term shown by two ad
 * groups of a campaign on one day comes twice: those rows are added up, one
 * per campaign, term and day (the table's key), or spend would be undercounted
 * and the upsert would touch one row twice.
 */
export async function searchTermDays(connection, customerId, range) {
  const id = checkedCustomer(customerId);
  const { since, until } = dateRange(range);
  const rows = await searchAll(
    connection,
    id,
    `SELECT campaign.id, search_term_view.search_term, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM search_term_view WHERE segments.date BETWEEN '${since}' AND '${until}'`,
  );
  const byKey = new Map();
  for (const row of rows) {
    const term = row.searchTermView?.searchTerm ?? row.search_term_view?.search_term;
    if (!row.campaign?.id || !row.segments?.date || !term) continue;
    const m = row.metrics ?? {};
    const day = {
      campaign_id: String(row.campaign.id),
      search_term: String(term).slice(0, 1000),
      day: row.segments.date,
      impressions: int(m.impressions),
      clicks: int(m.clicks),
      cost_micros: int(m.costMicros ?? m.cost_micros),
      conversions: decimal(m.conversions),
    };
    const key = `${day.campaign_id}|${day.search_term}|${day.day}`;
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, day);
      continue;
    }
    seen.impressions += day.impressions;
    seen.clicks += day.clicks;
    seen.cost_micros += day.cost_micros;
    seen.conversions = Math.round((seen.conversions + day.conversions) * 100) / 100;
  }
  return [...byKey.values()];
}
