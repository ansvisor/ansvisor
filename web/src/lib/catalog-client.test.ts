import { beforeEach, describe, expect, it, vi } from 'vitest';

/** #1263: a catalog sync from the browser, through the API's proxy. */

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  }),
}));

const {
  connectSignInAccount,
  connectStore,
  listSignInAccounts,
  listStoreConnectors,
  removeStore,
  syncCatalogSource,
  updateStoreSignIn,
  uploadCatalogFile,
} = await import('./catalog-client');

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('syncCatalogSource', () => {
  it('reads a feed now through the proxy, with the session', async () => {
    answer(200, { status: 'ok', error: null, counts: { items: 4 } });
    expect(await syncCatalogSource('s1')).toEqual({
      ok: true,
      status: 'ok',
      error: null,
      counts: { items: 4 },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/aeo/api/catalog/sources/s1/sync');
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer tok' } });
  });

  it("names the API's reasons, and the general ones", async () => {
    answer(409, { code: 'recent' });
    expect(await syncCatalogSource('s1')).toEqual({ ok: false, code: 'recent' });
    answer(403, { code: 'not_in_workspace' });
    expect(await syncCatalogSource('s1')).toEqual({ ok: false, code: 'workspace' });
    answer(429, { message: 'Too many requests' });
    expect(await syncCatalogSource('s1')).toEqual({ ok: false, code: 'busy' });
    answer(500, { code: 'failed' });
    expect(await syncCatalogSource('s1')).toEqual({ ok: false, code: 'failed' });
  });
});

describe('uploadCatalogFile', () => {
  it("sends the file's text as the body, for the brand", async () => {
    answer(200, { status: 'ok', error: null, counts: null });
    // jsdom's File has no text(); a browser's does.
    const file = { size: 15, text: async () => 'id,title\n1,Boot' } as unknown as File;
    await uploadCatalogFile('b1', file);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/aeo/api/catalog/upload?brandId=b1&format=auto');
    expect(init.body).toBe('id,title\n1,Boot');
  });

  it('refuses a file over 4 MB before sending it', async () => {
    const file = new File(['x'.repeat(4 * 1024 * 1024 + 1)], 'big.csv');
    expect(await uploadCatalogFile('b1', file)).toEqual({ ok: false, code: 'too_large' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('stores (00282)', () => {
  it("lists the connectors, or nothing when the API can't be read", async () => {
    answer(200, {
      connectors: [{ kind: 'acme_store', label: 'Acme Store', fields: [] }],
      ready: true,
    });
    expect(await listStoreConnectors()).toEqual({
      connectors: [{ kind: 'acme_store', label: 'Acme Store', fields: [] }],
      ready: true,
      signIns: [],
    });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/aeo/api/catalog/connectors');
    answer(500, {});
    expect(await listStoreConnectors()).toBeNull();
  });

  it('sends what the person typed to the API only, as JSON with the session', async () => {
    answer(201, { id: 'st1', account: 'shop.example' });
    expect(await connectStore('b1', 'acme_store', { apiKey: 'ak_secret' })).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/aeo/api/catalog/sources');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
    });
    expect(JSON.parse(init.body)).toEqual({
      brandId: 'b1',
      kind: 'acme_store',
      input: { apiKey: 'ak_secret' },
    });

    answer(200, { ok: true });
    await updateStoreSignIn('st1', { apiKey: 'ak_new' });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/aeo/api/catalog/sources/st1/credentials');
    expect(fetchMock.mock.calls[1][1].method).toBe('PUT');
    await removeStore('st1');
    expect(fetchMock.mock.calls[2][0]).toBe('/api/aeo/api/catalog/sources/st1');
    expect(fetchMock.mock.calls[2][1].method).toBe('DELETE');
  });

  it("keeps the store's own words only for what to fix", async () => {
    answer(400, { code: 'connect_failed', error: "That isn't a web address." });
    expect(await connectStore('b1', 'acme_store', {})).toEqual({
      ok: false,
      code: 'connect_failed',
      message: "That isn't a web address.",
    });
    answer(400, { code: 'auth_failed', error: 'The store refused this sign-in.' });
    expect(await connectStore('b1', 'acme_store', {})).toEqual({
      ok: false,
      code: 'auth_failed',
      message: null,
    });
    answer(429, { message: 'Too many requests' });
    expect(await updateStoreSignIn('st1', {})).toEqual({ ok: false, code: 'busy', message: null });
  });
});

describe('sign-in platforms (#1270)', () => {
  const GMC = {
    kind: 'merchant_center',
    label: 'Google Merchant Center',
    provider: 'google-merchant-center',
    configured: true,
  };

  it('lists them with the stores', async () => {
    answer(200, { connectors: [], ready: false, signIns: [GMC] });
    expect(await listStoreConnectors()).toEqual({ connectors: [], ready: false, signIns: [GMC] });
  });

  it("reads the accounts the workspace's sign-in opens, for the brand", async () => {
    answer(200, { accounts: [{ id: '123', name: 'Acme' }] });
    expect(await listSignInAccounts('b1', 'merchant_center')).toEqual({
      ok: true,
      accounts: [{ id: '123', name: 'Acme' }],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/aeo/api/catalog/accounts?brandId=b1&kind=merchant_center');
    expect(init).toMatchObject({ headers: { Authorization: 'Bearer tok' } });

    answer(409, { code: 'not_connected', error: 'Connect Google Merchant Center first.' });
    expect(await listSignInAccounts('b1', 'merchant_center')).toEqual({
      ok: false,
      code: 'not_connected',
    });
    answer(500, {});
    expect(await listSignInAccounts('b1', 'merchant_center')).toEqual({
      ok: false,
      code: 'failed',
    });
  });

  it('connects the picked account as the input', async () => {
    answer(201, { id: 'gmc1', account: '123' });
    expect(await connectSignInAccount('b1', 'merchant_center', '123')).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/aeo/api/catalog/sources');
    expect(JSON.parse(init.body)).toEqual({
      brandId: 'b1',
      kind: 'merchant_center',
      input: { account: '123' },
    });
  });
});
