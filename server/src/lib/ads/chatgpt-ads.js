/**
 * ChatGPT Ads' API for Ads Phase 1 (C1): one ad account per key. OpenAI
 * scopes each Ads API key to one ad account and has no OAuth or delegation
 * (#2668's probe), so every customer pastes their own key. Read only: GET
 * requests, never a write.
 *
 * The key travels only in the Authorization header. It is never logged,
 * never put in an error message, and never returned to a caller.
 */

const DEFAULT_BASE = 'https://api.ads.openai.com/v1';
const TIMEOUT_MS = 15_000;

/** The API's base: OpenAI's, unless OPENAI_ADS_API_BASE names another https one. */
export function chatGptAdsBase(env = process.env) {
  const base = String(env.OPENAI_ADS_API_BASE ?? '').replace(/\/+$/, '');
  return /^https:\/\/[^/\s]+/.test(base) ? base : DEFAULT_BASE;
}

/** A key the person pasted, trimmed, or null when it can't be one. */
export function cleanKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  return key.length >= 20 && key.length <= 512 && !/\s/.test(key) ? key : null;
}

/** The key was refused (401/403): wrong, revoked, or without Ads access. */
export class ChatGptAdsKeyError extends Error {
  constructor() {
    super('ChatGPT Ads refused the key');
    this.name = 'ChatGptAdsKeyError';
  }
}

/** ChatGPT Ads didn't answer as expected (down, slow, or another error). */
export class ChatGptAdsUnavailableError extends Error {
  constructor(status) {
    super(status ? `ChatGPT Ads answered ${status}` : 'ChatGPT Ads did not answer');
    this.name = 'ChatGptAdsUnavailableError';
    this.upstreamStatus = status ?? null;
  }
}

/** One GET with the key; the parsed JSON body. */
export async function chatGptAdsGet(key, path, { fetchImpl = fetch, env = process.env } = {}) {
  let res;
  try {
    res = await fetchImpl(`${chatGptAdsBase(env)}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ChatGptAdsUnavailableError(null);
  }
  if (res.status === 401 || res.status === 403) throw new ChatGptAdsKeyError();
  if (!res.ok) throw new ChatGptAdsUnavailableError(res.status);
  try {
    return await res.json();
  } catch {
    throw new ChatGptAdsUnavailableError(res.status);
  }
}

/**
 * The key's ad account: what Ads › Connections shows and ads_accounts keeps.
 * Throws ChatGptAdsKeyError for a refused key.
 */
export async function fetchAdAccount(key, options) {
  const body = await chatGptAdsGet(key, '/ad_account', options);
  if (!body?.id) throw new ChatGptAdsUnavailableError(200);
  const currency = typeof body.currency_code === 'string' ? body.currency_code.toUpperCase() : null;
  return {
    externalId: String(body.id).slice(0, 64),
    name: String(body.name ?? body.account_name ?? body.brand_name ?? '').slice(0, 300) || null,
    currencyCode: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
    timeZone: typeof body.timezone === 'string' ? body.timezone.slice(0, 64) : null,
  };
}

const PAGE_LIMIT = 2000;
const MAX_PAGES = 50;

/** Follows a list's cursor (first_id/last_id/has_more) to its end; every item. */
async function readAllPages(key, path, params, options) {
  const items = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams(params);
    if (after) query.set('after', after);
    const body = await chatGptAdsGet(key, `${path}?${query}`, options);
    if (!Array.isArray(body?.data)) throw new ChatGptAdsUnavailableError(200);
    items.push(...body.data);
    if (!body.has_more || !body.last_id || body.last_id === after) return items;
    after = String(body.last_id);
  }
  throw new ChatGptAdsUnavailableError(200);
}

/** The account's campaigns' statuses (active, paused, archived), by campaign id. */
export async function fetchCampaignStatuses(key, options) {
  const campaigns = await readAllPages(key, '/campaigns', [['limit', '500']], options);
  const statuses = new Map();
  for (const campaign of campaigns) {
    if (campaign?.id) statuses.set(String(campaign.id), campaign.status ?? null);
  }
  return statuses;
}

/** Spend in the account's currency (a decimal, e.g. 18.42) as micros. */
export function spendMicros(spend) {
  const n = Number(spend);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1_000_000) : 0;
}

/**
 * Each campaign's days in a window (since/until YYYY-MM-DD, inclusive):
 * `GET /ad_account/insights` at the campaign level, daily. ChatGPT Ads
 * reports spend as a decimal in the account's currency; its conversions come
 * from another endpoint, not read in Phase 1, so they stay 0.
 */
export async function fetchCampaignDays(key, { since, until }, options) {
  const params = [
    ['time_ranges[]', JSON.stringify({ type: 'date_range', since, until })],
    ['time_granularity', 'daily'],
    ['aggregation_level', 'campaign'],
    ['fields[]', 'campaign.id'],
    ['fields[]', 'campaign.name'],
    ['fields[]', 'campaign.impressions'],
    ['fields[]', 'campaign.clicks'],
    ['fields[]', 'campaign.spend'],
    ['fields[]', 'metadata.readable_time'],
    ['limit', String(PAGE_LIMIT)],
  ];
  const rows = await readAllPages(key, '/ad_account/insights', params, options);
  return rows.map((row) => ({
    campaignId: row?.campaign_id ?? null,
    campaignName: row?.campaign_name ?? null,
    day: typeof row?.readable_time === 'string' ? row.readable_time.slice(0, 10) : null,
    impressions: row?.impressions,
    clicks: row?.clicks,
    costMicros: spendMicros(row?.spend),
  }));
}
