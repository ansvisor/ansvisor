import { beforeEach, describe, expect, it, vi } from 'vitest';

/** #1263: a catalog sync from the browser, through the API's proxy. */

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  }),
}));

const { syncCatalogSource, uploadCatalogFile } = await import('./catalog-client');

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
