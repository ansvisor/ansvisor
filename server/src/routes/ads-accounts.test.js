import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /api/ads/accounts (Ads Phase 1, C1): anyone who reaches the brand lists its
 * accounts; only an Admin, on a plan that reads every opportunity and never
 * on the demo brand, connects a ChatGPT Ads key or disconnects an account.
 * The key never comes back in an answer or a log line.
 */

const BRAND = '22222222-2222-2222-2222-222222222222';
const ACCOUNT = '44444444-4444-4444-4444-444444444444';
const KEY = 'sk-ads-0123456789abcdefghij';

const assertBrandAccess = vi.fn();
const assertRole = vi.fn();
const readsEveryOpportunity = vi.fn();
const lib = { listAccounts: vi.fn(), connectChatGptAccount: vi.fn(), disconnectAccount: vi.fn() };
const logError = vi.fn();

vi.mock('../config/supabase.js', () => ({ default: {} }));
vi.mock('../lib/access.js', () => ({
  assertBrandAccess: (...a) => assertBrandAccess(...a),
  assertRole: (...a) => assertRole(...a),
}));
vi.mock('../lib/ads/opportunities.js', () => ({
  readsEveryOpportunity: (...a) => readsEveryOpportunity(...a),
}));
vi.mock('../lib/ads/accounts.js', async (importOriginal) => ({
  ...(await importOriginal()),
  listAccounts: (...a) => lib.listAccounts(...a),
  connectChatGptAccount: (...a) => lib.connectChatGptAccount(...a),
  disconnectAccount: (...a) => lib.disconnectAccount(...a),
}));

const { AdsAccountError } = await import('../lib/ads/accounts.js');
const { ChatGptAdsKeyError, ChatGptAdsUnavailableError } =
  await import('../lib/ads/chatgpt-ads.js');

let server;
let baseUrl;

beforeAll(async () => {
  const { default: router } = await import('./ads-accounts.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: logError };
    next();
  });
  app.use('/api/ads/accounts', router);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/ads/accounts`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));
afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.stubEnv('ADS_ENABLED', 'true');
  assertBrandAccess.mockReset().mockResolvedValue({ brand: { id: BRAND }, orgId: 'o1' });
  assertRole.mockReset().mockResolvedValue('admin');
  readsEveryOpportunity.mockReset().mockResolvedValue(true);
  for (const fn of Object.values(lib)) fn.mockReset();
  logError.mockReset();
});

const connect = (body) =>
  fetch(`${baseUrl}/chatgpt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('while Ads is off', () => {
  it('finds no path, whatever the method', async () => {
    vi.stubEnv('ADS_ENABLED', '');
    expect((await fetch(`${baseUrl}?brandId=${BRAND}`)).status).toBe(404);
    expect((await connect({ brandId: BRAND, apiKey: KEY })).status).toBe(404);
    expect(lib.connectChatGptAccount).not.toHaveBeenCalled();
  });
});

describe('GET /api/ads/accounts', () => {
  it("lists the brand's accounts for anyone who reaches it", async () => {
    lib.listAccounts.mockResolvedValue([{ id: ACCOUNT, platform: 'chatgpt' }]);
    const res = await fetch(`${baseUrl}?brandId=${BRAND}`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ accounts: [{ id: ACCOUNT, platform: 'chatgpt' }] });
    expect(lib.listAccounts).toHaveBeenCalledWith({ orgId: 'o1', brandId: BRAND });
    expect(assertRole).not.toHaveBeenCalled();
  });

  it('answers a brand the person cannot reach as the access check does', async () => {
    assertBrandAccess.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
    expect((await fetch(`${baseUrl}?brandId=${BRAND}`)).status).toBe(404);
    expect((await fetch(`${baseUrl}?brandId=nope`)).status).toBe(400);
  });
});

describe('POST /api/ads/accounts/chatgpt', () => {
  it('connects with the workspace and brand the access check returned (201)', async () => {
    lib.connectChatGptAccount.mockResolvedValue({ id: ACCOUNT, platform: 'chatgpt' });
    const res = await connect({ brandId: BRAND, apiKey: KEY });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(lib.connectChatGptAccount).toHaveBeenCalledWith({
      orgId: 'o1',
      brandId: BRAND,
      userId: 'u1',
      apiKey: KEY,
    });
  });

  it('is for Admins only', async () => {
    assertRole.mockRejectedValue(Object.assign(new Error('Only admins'), { status: 403 }));
    expect((await connect({ brandId: BRAND, apiKey: KEY })).status).toBe(403);
    expect(lib.connectChatGptAccount).not.toHaveBeenCalled();
  });

  it('is refused on the demo brand (402) and on a plan that reads only some rows (403)', async () => {
    assertBrandAccess.mockResolvedValueOnce({ brand: { id: BRAND, is_demo: true }, orgId: 'o1' });
    expect((await connect({ brandId: BRAND, apiKey: KEY })).status).toBe(402);
    readsEveryOpportunity.mockResolvedValue(false);
    const res = await connect({ brandId: BRAND, apiKey: KEY });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: 'plan_limit' });
    expect(lib.connectChatGptAccount).not.toHaveBeenCalled();
  });

  it('answers a refused key 422, a server without a sealing key 503, ChatGPT Ads down 502', async () => {
    lib.connectChatGptAccount.mockRejectedValueOnce(new ChatGptAdsKeyError());
    let res = await connect({ brandId: BRAND, apiKey: KEY });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_key' });

    lib.connectChatGptAccount.mockRejectedValueOnce(new AdsAccountError('not_configured', 'x'));
    res = await connect({ brandId: BRAND, apiKey: KEY });
    expect(res.status).toBe(503);

    lib.connectChatGptAccount.mockRejectedValueOnce(new ChatGptAdsUnavailableError(500));
    res = await connect({ brandId: BRAND, apiKey: KEY });
    expect(res.status).toBe(502);
  });

  it('never logs the key when something else fails', async () => {
    lib.connectChatGptAccount.mockRejectedValueOnce(new Error('db down'));
    const res = await connect({ brandId: BRAND, apiKey: KEY });
    expect(res.status).toBe(500);
    expect(JSON.stringify(logError.mock.calls)).not.toContain(KEY);
  });

  it('refuses a body without a brand or a key', async () => {
    expect((await connect({ apiKey: KEY })).status).toBe(400);
    expect((await connect({ brandId: BRAND })).status).toBe(400);
  });
});

describe('DELETE /api/ads/accounts/:accountId', () => {
  it("removes one of the brand's accounts, for an Admin", async () => {
    lib.disconnectAccount.mockResolvedValue({ id: ACCOUNT });
    const res = await fetch(`${baseUrl}/${ACCOUNT}?brandId=${BRAND}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(lib.disconnectAccount).toHaveBeenCalledWith({
      orgId: 'o1',
      brandId: BRAND,
      userId: 'u1',
      accountId: ACCOUNT,
    });
  });

  it("answers another brand's account 404, and a member 403", async () => {
    lib.disconnectAccount.mockRejectedValueOnce(new AdsAccountError('not_found', 'No such'));
    expect(
      (await fetch(`${baseUrl}/${ACCOUNT}?brandId=${BRAND}`, { method: 'DELETE' })).status,
    ).toBe(404);
    assertRole.mockRejectedValue(Object.assign(new Error('Only admins'), { status: 403 }));
    expect(
      (await fetch(`${baseUrl}/${ACCOUNT}?brandId=${BRAND}`, { method: 'DELETE' })).status,
    ).toBe(403);
  });
});
