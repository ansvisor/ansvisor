import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import batchResponse from './fixtures/google-sheets-batch-update.json' with { type: 'json' };

/**
 * A brand's own Google sign-in (BRAND-ACCESS §3.3, PR 15): anyone who can
 * access the brand reads it; an admin or manager who can access it uses
 * another brand's account, connects one of its own or disconnects. The
 * demo brand connects nothing. No token, entity or Composio id leaves.
 */

const BRAND = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';

const access = vi.fn();
const allBrands = vi.fn();
const everyBrand = vi.fn();
const signInBrandIds = vi.fn();
const lib = {
  brandConnection: vi.fn(),
  usableAccounts: vi.fn(),
  useAccountForBrand: vi.fn(),
  startBrandAccount: vi.fn(),
  activateBrandAccount: vi.fn(),
  removeBrandAccount: vi.fn(),
};
const configured = vi.fn(() => true);
const proxy = vi.fn();
const initiateConnection = vi.fn(async () => ({
  redirectUrl: 'https://g.test/x',
  connectedAccountId: 'ca_new',
}));

vi.mock('../config/supabase.js', () => ({
  default: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        then: (resolve) => resolve({ data: [{ id: BRAND }], error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('../lib/composio.js', () => ({
  PROVIDERS: {},
  entityIdFor: (orgId) => `org_${orgId}`,
  isKnownProvider: (p) =>
    [
      'google-search-console',
      'google-analytics',
      'google-sheets',
      'google-merchant-center',
    ].includes(p),
  isComposioConfigured: (...args) => configured(...args),
  proxyRequest: (...args) => proxy(...args),
  initiateConnection: (...args) => initiateConnection(...args),
  getActiveConnection: vi.fn(),
  deleteConnection: vi.fn(),
  connectedAccountStatus: vi.fn(),
  listGscSites: vi.fn(),
  listGaProperties: vi.fn(),
}));
vi.mock('../lib/brand-integrations.js', () => ({
  BRAND_GOOGLE_PROVIDERS: ['google-search-console', 'google-analytics', 'google-sheets'],
  composioTarget: vi.fn(),
  signInBrandIds: (...args) => signInBrandIds(...args),
  ...Object.fromEntries(Object.entries(lib).map(([k, fn]) => [k, (...a) => fn(...a)])),
}));
vi.mock('../lib/ga-sync.js', () => ({ runGaSync: vi.fn() }));
vi.mock('../lib/gsc-sync.js', () => ({ runGscSync: vi.fn() }));
vi.mock('../lib/page-opportunities.js', () => ({ detectPageOpportunitiesInWindow: vi.fn() }));
vi.mock('../lib/access.js', () => ({
  assertBrandAccess: (...args) => access(...args),
  assertAllBrands: (...args) => allBrands(...args),
  assertEveryBrand: (...args) => everyBrand(...args),
  brandAccessOf: async () => ({ all: true, brandIds: new Set() }),
}));

let server;
let baseUrl;

beforeAll(async () => {
  const { default: router } = await import('./integrations.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/integrations', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/integrations`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const brand = (over = {}) => ({
  id: BRAND,
  organization_id: 'org-1',
  is_demo: false,
  gsc_property: 'sc-domain:acme.test',
  ga_property_id: null,
  ...over,
});

beforeEach(() => {
  for (const fn of Object.values(lib)) fn.mockReset();
  access.mockReset().mockResolvedValue({ brand: brand(), role: 'manager' });
  configured.mockReset().mockReturnValue(true);
  proxy.mockReset();
  initiateConnection.mockClear();
  allBrands.mockReset().mockResolvedValue({ orgId: 'org-1' });
  everyBrand.mockReset().mockResolvedValue({ orgId: 'org-1' });
  // The target sign-in is used by this brand and another.
  signInBrandIds.mockReset().mockResolvedValue([BRAND, 'b-other']);
  lib.brandConnection.mockResolvedValue({
    accountId: ACCOUNT,
    label: null,
    status: 'connected',
    connected: true,
    entityId: 'org_org-1',
    composioAccountId: 'ca_secret',
  });
  lib.usableAccounts.mockResolvedValue([
    {
      accountId: ACCOUNT,
      label: null,
      accountLevel: true,
      connectedBy: null,
      connectedAt: '2026-10-01',
      brandIds: [BRAND],
    },
  ]);
  lib.startBrandAccount.mockResolvedValue({ redirectUrl: 'https://g.test/x', accountId: ACCOUNT });
  lib.activateBrandAccount.mockResolvedValue('connected');
});

const post = (path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('GET /api/integrations/brands/:brandId', () => {
  it('says which sign-in the brand uses and which it could, with no Composio id', async () => {
    const res = await fetch(`${baseUrl}/brands/${BRAND}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(access).toHaveBeenCalledWith(BRAND, 'u1', { columns: 'gsc_property, ga_property_id' });
    expect(body.products.map((p) => [p.provider, p.property, p.current.accountLevel])).toEqual([
      ['google-search-console', 'sc-domain:acme.test', true],
      ['google-analytics', null, true],
      ['google-sheets', null, true],
    ]);
    expect(JSON.stringify(body)).not.toMatch(/ca_secret|org_org-1/);
  });

  it('refuses a brand the caller can’t access', async () => {
    access.mockRejectedValue(Object.assign(new Error('nope'), { status: 403 }));
    expect((await fetch(`${baseUrl}/brands/${BRAND}`)).status).toBe(403);
  });
});

describe('changing a brand’s sign-in', () => {
  it('uses another brand’s account, for a manager', async () => {
    const res = await post(`/google-analytics/brands/${BRAND}/use`, { accountId: ACCOUNT });
    expect(res.status).toBe(200);
    expect(lib.useAccountForBrand).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'google-analytics',
        accountId: ACCOUNT,
        brandIds: [BRAND],
      }),
      expect.anything(),
    );
  });

  it('connects another Google account as one more account under the Account’s entity', async () => {
    const res = await post(`/google-search-console/brands/${BRAND}/connect`, {
      callbackUrl: 'http://localhost:3000/x',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirectUrl: 'https://g.test/x', accountId: ACCOUNT });
    const [args, deps] = lib.startBrandAccount.mock.calls[0];
    expect(args).toMatchObject({
      provider: 'google-search-console',
      userId: 'u1',
      entityId: 'org_org-1',
    });
    await deps.initiate('org_org-1');
    expect(initiateConnection).toHaveBeenCalledWith(
      'google-search-console',
      'org_org-1',
      'http://localhost:3000/x',
      { allowMultiple: true },
    );
  });

  it('activates and disconnects', async () => {
    const done = await post(`/google-search-console/brands/${BRAND}/activate`, {
      accountId: ACCOUNT,
    });
    expect(await done.json()).toEqual({ status: 'connected' });
    const off = await fetch(`${baseUrl}/google-search-console/brands/${BRAND}`, {
      method: 'DELETE',
    });
    expect(off.status).toBe(200);
    expect(lib.removeBrandAccount).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google-search-console' }),
      expect.anything(),
    );
  });

  it('needs every brand on the target sign-in, since reading through it lists theirs', async () => {
    const ok = await post(`/google-analytics/brands/${BRAND}/use`, { accountId: ACCOUNT });
    expect(ok.status).toBe(200);
    expect(signInBrandIds).toHaveBeenCalledWith({ accountId: ACCOUNT });
    expect(everyBrand).toHaveBeenCalledWith([BRAND, 'b-other'], 'u1');

    everyBrand.mockRejectedValue(
      Object.assign(new Error('nope'), { status: 403, code: 'no_brand_access' }),
    );
    lib.useAccountForBrand.mockClear();
    const res = await post(`/google-analytics/brands/${BRAND}/use`, { accountId: ACCOUNT });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'no_brand_access' });
    expect(lib.useAccountForBrand).not.toHaveBeenCalled();
  });

  it('passes the Composio delete to connect, to drop unfinished logins', async () => {
    await post(`/google-search-console/brands/${BRAND}/connect`, {
      callbackUrl: 'http://localhost:3000/x',
    });
    const [, deps] = lib.startBrandAccount.mock.calls[0];
    expect(typeof deps.deleteRemote).toBe('function');
  });

  it('is for admins and managers only', async () => {
    access.mockResolvedValue({ brand: brand(), role: 'analyst' });
    const res = await post(`/google-analytics/brands/${BRAND}/use`, { accountId: ACCOUNT });
    expect(res.status).toBe(403);
    expect(lib.useAccountForBrand).not.toHaveBeenCalled();
  });

  it('connects nothing for the demo brand', async () => {
    access.mockResolvedValue({ brand: brand({ is_demo: true }), role: 'admin' });
    const res = await post(`/google-search-console/brands/${BRAND}/connect`, {
      callbackUrl: 'http://localhost:3000/x',
    });
    expect(res.status).toBe(409);
    expect(lib.startBrandAccount).not.toHaveBeenCalled();
  });

  it('refuses Merchant Center (PR 16) and a bad body', async () => {
    expect(
      (await post(`/google-merchant-center/brands/${BRAND}/use`, { accountId: ACCOUNT })).status,
    ).toBe(404);
    expect((await post(`/google-analytics/brands/${BRAND}/use`, { accountId: 'x' })).status).toBe(
      400,
    );
    expect(lib.useAccountForBrand).not.toHaveBeenCalled();
  });
});

describe('brand Sheets export', () => {
  const path = '/google-sheets/brands/' + BRAND;
  const body = {
    accountId: ACCOUNT,
    view: 'Prompts',
    values: [
      ['text', 'volume'],
      ["'=1", 2],
    ],
  };
  it('writes the snapshot with the selected brand account and returns the new tab', async () => {
    proxy.mockResolvedValue({ status: 200, data: { spreadsheetId: 'fixture' } });
    const res = await post(path + '/export', body);
    expect(res.status).toBe(200);
    expect((await res.json()).url).toMatch(
      /^https:\/\/docs\.google\.com\/spreadsheets\/d\/fixture\/edit#gid=\d+$/,
    );
    expect(lib.brandConnection).toHaveBeenCalledWith(BRAND, 'google-sheets');
    const [account, request] = proxy.mock.calls[0];
    expect(account).toBe('ca_secret');
    expect(request.endpoint).toBe('https://sheets.googleapis.com/v4/spreadsheets');
    expect(request.body.sheets[0].data[0].rowData[1].values).toEqual([
      { userEnteredValue: { stringValue: "'=1" } },
      { userEnteredValue: { numberValue: 2 } },
    ]);
  });
  it('adds and fills a fresh tab atomically in an existing file', async () => {
    // gspread 7ca71ea, SpreadsheetTest.test_add_del_worksheet, first batchUpdate.
    // Only the requested response field is kept and the spreadsheet ID is replaced.
    proxy.mockResolvedValue(batchResponse);
    const res = await post(path + '/export', { ...body, spreadsheetId: 'existing' });
    expect(res.status).toBe(200);
    const request = proxy.mock.calls[0][1];
    expect(request.endpoint).toBe(
      'https://sheets.googleapis.com/v4/spreadsheets/existing:batchUpdate',
    );
    const [add, update] = request.body.requests;
    expect(update.updateCells.start.sheetId).toBe(add.addSheet.properties.sheetId);
    expect(update.updateCells.rows).toHaveLength(2);
  });
  it('gates an unconfigured install before reading credentials', async () => {
    configured.mockReturnValue(false);
    expect(await (await fetch(baseUrl + path + '/status')).json()).toEqual({
      configured: false,
      accountId: null,
    });
    expect((await post(path + '/export', body)).status).toBe(409);
    expect(lib.brandConnection).not.toHaveBeenCalled();
    expect(proxy).not.toHaveBeenCalled();
  });
  it('refuses inaccessible brands, stale sign-ins and disconnected brands', async () => {
    access.mockRejectedValueOnce(Object.assign(new Error(), { status: 403 }));
    expect((await post(path + '/export', body)).status).toBe(403);
    expect(lib.brandConnection).not.toHaveBeenCalled();
    expect((await post(path + '/export', { ...body, accountId: BRAND })).status).toBe(409);
    lib.brandConnection.mockResolvedValue(null);
    expect((await post(path + '/export', body)).status).toBe(409);
    expect(proxy).not.toHaveBeenCalled();
  });
  it('requires access to the brands sharing a sign-in before targeting an existing file', async () => {
    everyBrand.mockRejectedValueOnce(Object.assign(new Error(), { status: 403 }));
    expect((await post(path + '/export', { ...body, spreadsheetId: 'existing' })).status).toBe(403);
    expect(proxy).not.toHaveBeenCalled();
  });
  it('sanitizes provider failures and rejects malformed destinations', async () => {
    expect((await post(path + '/export', { ...body, spreadsheetId: 'bad/path' })).status).toBe(400);
    proxy.mockRejectedValue(new Error('private response'));
    const response = await post(path + '/export', body);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private');
  });
});
