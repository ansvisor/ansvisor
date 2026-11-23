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
