import { describe, expect, it, vi } from 'vitest';
import {
  ChatGptAdsKeyError,
  ChatGptAdsUnavailableError,
  chatGptAdsBase,
  cleanKey,
  fetchAdAccount,
} from './chatgpt-ads.js';

/**
 * ChatGPT Ads' API (Ads Phase 1, C1): one ad account per key, read with GET
 * only, the key in the Authorization header and nowhere else.
 */

const KEY = 'sk-ads-0123456789abcdefghij';

/** A fetch that answers `status` with `body`, and remembers what it was asked. */
function fakeFetch(status, body) {
  return vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }));
}

describe('chatGptAdsBase', () => {
  it("is OpenAI's unless an https base is set", () => {
    expect(chatGptAdsBase({})).toBe('https://api.ads.openai.com/v1');
    expect(chatGptAdsBase({ OPENAI_ADS_API_BASE: 'https://ads.example.com/v2/' })).toBe(
      'https://ads.example.com/v2',
    );
    expect(chatGptAdsBase({ OPENAI_ADS_API_BASE: 'http://evil.example' })).toBe(
      'https://api.ads.openai.com/v1',
    );
  });
});

describe('cleanKey', () => {
  it('trims a pasted key and refuses what cannot be one', () => {
    expect(cleanKey(`  ${KEY}\n`)).toBe(KEY);
    expect(cleanKey('short')).toBeNull();
    expect(cleanKey('two words but long enough to pass')).toBeNull();
    expect(cleanKey(42)).toBeNull();
  });
});

describe('fetchAdAccount', () => {
  it('reads the key’s account with a GET and the key as a Bearer token', async () => {
    const fetchImpl = fakeFetch(200, {
      id: 'acct_123',
      name: 'Empler AI',
      currency_code: 'usd',
      timezone: 'America/New_York',
    });
    await expect(fetchAdAccount(KEY, { fetchImpl, env: {} })).resolves.toEqual({
      externalId: 'acct_123',
      name: 'Empler AI',
      currencyCode: 'USD',
      timeZone: 'America/New_York',
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.ads.openai.com/v1/ad_account');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it('says the key was refused on 401 and 403, without the key in the error', async () => {
    for (const status of [401, 403]) {
      const err = await fetchAdAccount(KEY, { fetchImpl: fakeFetch(status, {}), env: {} }).catch(
        (e) => e,
      );
      expect(err).toBeInstanceOf(ChatGptAdsKeyError);
      expect(err.message).not.toContain(KEY);
    }
  });

  it('says ChatGPT Ads is unavailable on another error, a network failure or no account', async () => {
    await expect(fetchAdAccount(KEY, { fetchImpl: fakeFetch(500, {}), env: {} })).rejects.toThrow(
      ChatGptAdsUnavailableError,
    );
    const down = vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED with ${KEY}`);
    });
    const err = await fetchAdAccount(KEY, { fetchImpl: down, env: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ChatGptAdsUnavailableError);
    expect(err.message).not.toContain(KEY);
    await expect(fetchAdAccount(KEY, { fetchImpl: fakeFetch(200, {}), env: {} })).rejects.toThrow(
      ChatGptAdsUnavailableError,
    );
  });
});
