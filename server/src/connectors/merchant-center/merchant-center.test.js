import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The plumbing reaches the Supabase admin client at import time, whose config
// exits without its env (as in CI). Every connector test starts like this.
vi.mock('../../config/supabase.js', () => ({ default: {} }));

import { signInRequest } from '../../lib/catalog/sign-in.js';
import { ConnectError } from '../errors.js';
import { runSync } from '../testing.js';
import merchantCenter, { API, PAGE_SIZE, accountId, moneyText } from './index.js';

/**
 * The Merchant Center connector (#1270) against a fake of the Merchant API,
 * answered as Composio's proxy would, through the real sign-in request
 * (lib/catalog/sign-in.js).
 */

const page = (n) =>
  JSON.parse(
    readFileSync(new URL(`./__fixtures__/products-page-${n}.json`, import.meta.url), 'utf8'),
  );

const ACCOUNT = '123456789';
const PRODUCTS = `${API}/products/v1/accounts/${ACCOUNT}/products`;
const ok = (data) => ({ status: 200, headers: {}, data });

/** The workspace's Google sign-in: the proxy answers by endpoint; no route is a 404. */
function google(routes, { connected = true } = {}) {
  const proxy = vi.fn(async (_accountId, { endpoint, query }) => {
    const route = routes[endpoint];
    return route
      ? route(query ?? {})
      : { status: 404, headers: {}, data: { error: { code: 404 } } };
  });
  const active = vi.fn(async () => (connected ? { id: 'ca_1' } : null));
  const factory = vi.fn((provider, entityId) =>
    signInRequest(provider, entityId, { active, proxy, wait: async () => {} }),
  );
  return { factory, proxy, active };
}

const products = () => ({
  [PRODUCTS]: (query) => ok(query.pageToken === 'page-2' ? page(2) : page(1)),
});

beforeEach(() => {
  // The server's Merchant Center sign-in is set up (composio.js isComposioConfigured).
  vi.stubEnv('COMPOSIO_API_KEY', 'test-composio-key');
  vi.stubEnv('COMPOSIO_GMC_AUTH_CONFIG_ID', 'ac_gmc');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('moneyText', () => {
  it("writes the API's micros as the feeds write a price", () => {
    expect(moneyText({ amountMicros: '129990000', currencyCode: 'USD' })).toBe('129.99 USD');
    expect(moneyText({ amountMicros: '1234500000', currencyCode: 'EUR' })).toBe('1234.50 EUR');
    // Three decimals would read as thousands: six are written.
    expect(moneyText({ amountMicros: '12345000', currencyCode: 'KWD' })).toBe('12.345000 KWD');
    expect(moneyText(undefined)).toBeUndefined();
    expect(moneyText({ amountMicros: '-1' })).toBeUndefined();
  });
});

describe('accountId', () => {
  it('reads an id as a person or the API gives it', () => {
    expect(accountId('accounts/123456789')).toBe('123456789');
    expect(accountId(' 123456789 ')).toBe('123456789');
    expect(accountId('my-shop')).toBeNull();
  });
});

describe('readCatalog, through the real plumbing', () => {
  it("reads every page into the catalog, with each item's issues", async () => {
    const { factory, proxy } = google(products());
    const {
      outcome,
      products: rows,
      variants,
      issues,
    } = await runSync(merchantCenter, { account: ACCOUNT }, { signInRequest: factory });

    // The workspace's Merchant Center sign-in, a page at a time, at the API's largest page.
    expect(factory).toHaveBeenCalledWith('google-merchant-center', 'org_org-1');
    expect(proxy.mock.calls.map(([, call]) => call.query)).toEqual([
      { pageSize: PAGE_SIZE, pageToken: undefined },
      { pageSize: PAGE_SIZE, pageToken: 'page-2' },
    ]);

    expect(outcome).toMatchObject({
      status: 'ok',
      counts: {
        format: 'merchant_center',
        items: 2,
        // The German listing of an offer read already, and a product with no price.
        skipped: 2,
        issues: { items: 2, disapproved: 1, demoted: 1, not_impacted: 1 },
      },
    });
    expect(outcome.counts.errors).toEqual([
      'Item 3: offer TB-42-BRN is listed again (de, DE); the first is kept.',
      'Item 4: price is missing.',
    ]);

    // Colors of one item group are one product.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      external_id: 'TB',
      product_brand: 'Acme',
      product_type: 'Shoes > Boots',
    });
    const brown = variants.find((v) => v.external_id === 'TB-42-BRN');
    expect(brown).toMatchObject({
      gtin: '00012345678905',
      mpn: 'TB-42',
      price: 129.99,
      sale_price: 99,
      currency: 'USD',
      availability: 'in_stock',
      condition: 'new',
      attributes: { color: 'Brown', size: '42', material: 'Leather' },
    });
    expect(variants.find((v) => v.external_id === 'TB-43-BLK')).toMatchObject({
      availability: 'out_of_stock',
    });

    // An item with no issues has none; one the catalog can't keep still has its own.
    expect(issues.map((i) => [i.external_id, i.code, i.severity, i.reporting_context])).toEqual([
      ['TB-42-BRN', 'image_too_small', 'demoted', 'SHOPPING_ADS'],
      ['TB-42-BRN', 'image_too_small', 'not_impacted', 'FREE_LISTINGS'],
      ['SOCK-1', 'missing_price', 'disapproved', 'SHOPPING_ADS'],
    ]);
    expect(issues[0]).toMatchObject({
      brand_id: 'brand-1',
      attribute: 'image link',
      description: 'Image too small',
      detail: 'Use an image of at least 100 x 100 pixels',
      resolution: 'merchant_action',
      countries: ['US', 'CA'],
    });
  });

  it('asks to reconnect when the workspace has no active Google sign-in, and reads nothing', async () => {
    const { factory, proxy } = google(products(), { connected: false });
    const {
      outcome,
      products: rows,
      issues,
    } = await runSync(merchantCenter, { account: ACCOUNT }, { signInRequest: factory });
    expect(proxy).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      status: 'auth_failed',
      error:
        "The Google sign-in can't open this Google Merchant Center account anymore. Reconnect it in Settings › Integrations.",
    });
    expect(rows).toHaveLength(0);
    expect(issues).toHaveLength(0);
  });

  it("says so, and calls nothing, when this server hasn't the sign-in set up", async () => {
    vi.stubEnv('COMPOSIO_GMC_AUTH_CONFIG_ID', '');
    const { factory } = google(products());
    const { outcome } = await runSync(
      merchantCenter,
      { account: ACCOUNT },
      { signInRequest: factory },
    );
    expect(factory).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      status: 'failed',
      error: "Google Merchant Center isn't set up on this server.",
    });
  });

  it('asks to reconnect when Google refuses the sign-in', async () => {
    const { factory } = google({
      [PRODUCTS]: () => ({
        status: 401,
        headers: {},
        data: { error: { status: 'UNAUTHENTICATED' } },
      }),
    });
    const { outcome } = await runSync(
      merchantCenter,
      { account: ACCOUNT },
      { signInRequest: factory },
    );
    expect(outcome.status).toBe('auth_failed');
  });

  it('waits on a 429 and reads on', async () => {
    let calls = 0;
    const { factory } = google({
      [PRODUCTS]: () => {
        calls += 1;
        return calls === 1
          ? { status: 429, headers: { 'Retry-After': '2' }, data: null }
          : ok({ products: page(1).products });
      },
    });
    const { outcome } = await runSync(
      merchantCenter,
      { account: ACCOUNT },
      { signInRequest: factory },
    );
    expect(calls).toBe(2);
    expect(outcome).toMatchObject({ status: 'ok', counts: { items: 2 } });
  });
});

describe('listAccounts', () => {
  it("lists the accounts the sign-in opens, and an advanced account's sub-accounts", async () => {
    const { factory } = google({
      [`${API}/accounts/v1/accounts`]: () =>
        ok({
          accounts: [
            { name: 'accounts/100', accountId: '100', accountName: 'Acme (advanced)' },
            { name: 'accounts/200', accountId: '200', accountName: 'Other shop' },
          ],
        }),
      [`${API}/accounts/v1/accounts/100:listSubaccounts`]: () =>
        ok({ accounts: [{ name: 'accounts/101', accountId: '101', accountName: 'Acme US' }] }),
      // A standalone account has no sub-accounts to list.
      [`${API}/accounts/v1/accounts/200:listSubaccounts`]: () => ({
        status: 403,
        headers: {},
        data: null,
      }),
    });
    const request = factory('google-merchant-center', 'org_org-1');
    await expect(merchantCenter.listAccounts({ request })).resolves.toEqual([
      { id: '100', name: 'Acme (advanced)' },
      { id: '200', name: 'Other shop' },
      { id: '101', name: 'Acme US' },
    ]);
  });

  it('says the sign-in is gone when the workspace has none', async () => {
    const { factory } = google({}, { connected: false });
    const request = factory('google-merchant-center', 'org_org-1');
    await expect(merchantCenter.listAccounts({ request })).rejects.toMatchObject({ code: 'auth' });
  });
});

describe('checkAccount', () => {
  const routes = {
    [`${API}/accounts/v1/accounts/${ACCOUNT}`]: () =>
      ok({ name: `accounts/${ACCOUNT}`, accountId: ACCOUNT, accountName: 'Acme Outdoor' }),
  };

  it('confirms the account the person picked, with its name', async () => {
    const request = google(routes).factory('google-merchant-center', 'org_org-1');
    await expect(merchantCenter.checkAccount(`accounts/${ACCOUNT}`, { request })).resolves.toEqual({
      account: ACCOUNT,
      label: 'Acme Outdoor',
      url: `https://merchants.google.com/mc/overview?a=${ACCOUNT}`,
    });
  });

  it("says so in plain words when the sign-in can't open it, or it isn't an id", async () => {
    const request = google(routes).factory('google-merchant-center', 'org_org-1');
    await expect(merchantCenter.checkAccount('987654321', { request })).rejects.toThrow(
      new ConnectError("This Google sign-in can't open that Merchant Center account."),
    );
    await expect(merchantCenter.checkAccount('my-shop', { request })).rejects.toBeInstanceOf(
      ConnectError,
    );
  });
});

describe('syncOrders', () => {
  it('has none: Merchant Center has no orders', async () => {
    await expect(merchantCenter.syncOrders()).resolves.toEqual({ orders: [] });
  });
});
