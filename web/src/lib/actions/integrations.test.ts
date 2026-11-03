import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The integrations server actions that remain: each call to the API has a
 * time limit, so one that hangs can't hold up the page's other server actions
 * (Next runs them one at a time) for good.
 */

const update = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
    from: () => ({ update: () => ({ eq: update }) }),
  }),
}));
vi.mock('@/lib/subscription-guard', () => ({ assertWritable: async () => {} }));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'https://api.example' }));

const { disconnectIntegration, getMerchantCenterOffered, setBrandGscProperty } =
  await import('./integrations');

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  update.mockReset().mockResolvedValue({ error: null });
  vi.stubGlobal('fetch', fetchMock);
});

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
const timedOut = () =>
  fetchMock.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));

describe('integrations actions', () => {
  it('offers Merchant Center only when the config says so, within a time limit', async () => {
    answer(200, { googleMerchantCenter: true });
    expect(await getMerchantCenterOffered()).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example/api/integrations/config');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // An older API without the config, and one that hangs, offer nothing.
    answer(404, { error: 'Not found' });
    expect(await getMerchantCenterOffered()).toBe(false);
    timedOut();
    expect(await getMerchantCenterOffered()).toBe(false);
  });

  it('disconnects within a time limit', async () => {
    answer(200, { success: true });
    await disconnectIntegration('google-search-console');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example/api/integrations/google-search-console');
    expect(init.method).toBe('DELETE');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("starts a mapped brand's first sync within a time limit, and keeps the pick when it can't", async () => {
    timedOut();
    await expect(setBrandGscProperty('b1', 'https://acme.com/')).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledWith('id', 'b1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example/api/integrations/google-search-console/sync');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
