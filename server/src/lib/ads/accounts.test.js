import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A brand's ad accounts (Ads Phase 1, C1): a ChatGPT Ads key is checked,
 * then kept sealed for its account and never answered back; every write is
 * scoped to the route's workspace and brand (CLAUDE.md rule 3); a
 * disconnect of another brand's account reads as not found.
 */

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { AdsAccountError, connectChatGptAccount, disconnectAccount, readChatGptKey } =
  await import('./accounts.js');
const { ChatGptAdsKeyError } = await import('./chatgpt-ads.js');

const KEY = 'sk-ads-0123456789abcdefghij';
const ORG = '11111111-1111-1111-1111-111111111111';
const BRAND = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';
const ACCOUNT = '44444444-4444-4444-4444-444444444444';

/**
 * A fake Supabase client: records every call on a table, and answers each
 * query with what `answers[table]` gives.
 */
function fakeDb(answers) {
  const calls = [];
  const db = {
    calls,
    from(table) {
      const call = { table, ops: [] };
      calls.push(call);
      const chain = {};
      for (const op of ['select', 'upsert', 'delete', 'eq', 'order']) {
        chain[op] = (...args) => {
          call.ops.push([op, ...args]);
          return chain;
        };
      }
      const answer = () => answers[table]?.(call) ?? { data: null, error: null };
      chain.single = async () => answer();
      chain.maybeSingle = async () => answer();
      chain.then = (resolve) => resolve(answer());
      return chain;
    },
  };
  return db;
}

const okFetch = vi.fn(async () => ({
  status: 200,
  ok: true,
  json: async () => ({ id: 'acct_123', name: 'Empler AI', currency_code: 'USD' }),
}));

beforeEach(() => {
  vi.stubEnv('CONNECTOR_CREDENTIALS_KEY', randomBytes(32).toString('base64'));
  okFetch.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('connectChatGptAccount', () => {
  it('checks the key, keeps the account on the route’s workspace and brand, and seals the key', async () => {
    const db = fakeDb({
      ads_accounts: () => ({
        data: {
          id: ACCOUNT,
          platform: 'chatgpt',
          external_id: 'acct_123',
          name: 'Empler AI',
          currency_code: 'USD',
          status: 'active',
          created_at: '2026-11-22T10:00:00Z',
        },
        error: null,
      }),
      ads_account_keys: () => ({ error: null }),
    });
    const log = vi.fn();

    const account = await connectChatGptAccount(
      { orgId: ORG, brandId: BRAND, userId: USER, apiKey: ` ${KEY} ` },
      { db, fetchImpl: okFetch, log },
    );

    expect(account).toMatchObject({ id: ACCOUNT, platform: 'chatgpt', externalId: 'acct_123' });
    expect(JSON.stringify(account)).not.toContain(KEY);

    const [accountsCall, keysCall] = db.calls;
    const [, row, options] = accountsCall.ops.find(([op]) => op === 'upsert');
    expect(row).toMatchObject({
      organization_id: ORG,
      brand_id: BRAND,
      platform: 'chatgpt',
      external_id: 'acct_123',
      status: 'active',
    });
    expect(options).toEqual({ onConflict: 'brand_id,platform,external_id' });

    const [, keyRow] = keysCall.ops.find(([op]) => op === 'upsert');
    expect(keyRow.account_id).toBe(ACCOUNT);
    expect(keyRow.secret).not.toContain(KEY);

    // The sealed key opens for its own account, and only for it.
    const readDb = fakeDb({ ads_account_keys: () => ({ data: { secret: keyRow.secret } }) });
    await expect(readChatGptKey(ACCOUNT, { db: readDb })).resolves.toBe(KEY);
    await expect(readChatGptKey(BRAND, { db: readDb })).resolves.toBeNull();

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'connection.connect', orgId: ORG, brandId: BRAND }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(KEY);
  });

  it('refuses a key that cannot be one, before asking ChatGPT Ads', async () => {
    const db = fakeDb({});
    const err = await connectChatGptAccount(
      { orgId: ORG, brandId: BRAND, userId: USER, apiKey: 'nope' },
      { db, fetchImpl: okFetch },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(AdsAccountError);
    expect(err.code).toBe('invalid_key');
    expect(okFetch).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
  });

  it('keeps nothing when the server has no key to seal with', async () => {
    vi.stubEnv('CONNECTOR_CREDENTIALS_KEY', '');
    const db = fakeDb({});
    const err = await connectChatGptAccount(
      { orgId: ORG, brandId: BRAND, userId: USER, apiKey: KEY },
      { db, fetchImpl: okFetch },
    ).catch((e) => e);
    expect(err.code).toBe('not_configured');
    expect(db.calls).toEqual([]);
  });

  it('keeps nothing when ChatGPT Ads refuses the key', async () => {
    const db = fakeDb({});
    const refused = vi.fn(async () => ({ status: 401, ok: false, json: async () => ({}) }));
    await expect(
      connectChatGptAccount(
        { orgId: ORG, brandId: BRAND, userId: USER, apiKey: KEY },
        { db, fetchImpl: refused },
      ),
    ).rejects.toThrow(ChatGptAdsKeyError);
    expect(db.calls).toEqual([]);
  });
});

describe('disconnectAccount', () => {
  it('deletes only on the route’s workspace and brand, and logs it', async () => {
    const db = fakeDb({
      ads_accounts: () => ({
        data: [{ id: ACCOUNT, platform: 'chatgpt', external_id: 'acct_123' }],
        error: null,
      }),
    });
    const log = vi.fn();
    await expect(
      disconnectAccount(
        { orgId: ORG, brandId: BRAND, userId: USER, accountId: ACCOUNT },
        { db, log },
      ),
    ).resolves.toEqual({ id: ACCOUNT });
    const eqs = db.calls[0].ops.filter(([op]) => op === 'eq').map(([, col, val]) => [col, val]);
    expect(eqs).toEqual([
      ['id', ACCOUNT],
      ['organization_id', ORG],
      ['brand_id', BRAND],
    ]);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: 'connection.disconnect' }));
  });

  it("reads another brand's account as not found, and logs nothing", async () => {
    const db = fakeDb({ ads_accounts: () => ({ data: [], error: null }) });
    const log = vi.fn();
    const err = await disconnectAccount(
      { orgId: ORG, brandId: BRAND, userId: USER, accountId: ACCOUNT },
      { db, log },
    ).catch((e) => e);
    expect(err.code).toBe('not_found');
    expect(log).not.toHaveBeenCalled();
  });
});
