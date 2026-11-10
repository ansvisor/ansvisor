import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** HubSpot (#2140): a brand's connection from the browser, through the API's proxy. */

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  }),
}));

const {
  activateHubspot,
  chooseHubspotAccount,
  disconnectHubspot,
  readHubspot,
  rememberPending,
  retryHubspotSetup,
  saveHubspotConsent,
  startHubspotConnect,
  takePending,
} = await import('./hubspot-client');

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
const BASE = '/api/aeo/api/hubspot/brands/b1';
const CONSENT = { contacts: true, pages: false };
const ACCOUNT = '33333333-3333-4333-8333-333333333333';

describe('hubspot-client', () => {
  it('calls each route with the session, and the body only where there is one', async () => {
    answer(200, { brandId: 'b1', configured: true, allowed: true, connection: null, usable: [] });
    expect(await readHubspot('b1')).toMatchObject({ ok: true, allowed: true });
    expect(fetchMock.mock.calls[0][0]).toBe(BASE);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer tok' });
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);

    answer(200, { redirectUrl: 'https://hs.test/x', accountId: ACCOUNT });
    await startHubspotConnect('b1', { callbackUrl: 'https://app.test/s', consent: CONSENT });
    await activateHubspot('b1', { accountId: ACCOUNT, consent: CONSENT });
    await chooseHubspotAccount('b1', { accountId: ACCOUNT, consent: CONSENT });
    await saveHubspotConsent('b1', CONSENT);
    await retryHubspotSetup('b1');
    await disconnectHubspot('b1');
    const calls = fetchMock.mock.calls.slice(1).map(([url, init]) => [url, init.method, init.body]);
    expect(calls).toEqual([
      [
        `${BASE}/connect`,
        'POST',
        JSON.stringify({ callbackUrl: 'https://app.test/s', consent: CONSENT }),
      ],
      [`${BASE}/activate`, 'POST', JSON.stringify({ accountId: ACCOUNT, consent: CONSENT })],
      [`${BASE}/use`, 'POST', JSON.stringify({ accountId: ACCOUNT, consent: CONSENT })],
      [`${BASE}/settings`, 'PUT', JSON.stringify({ consent: CONSENT })],
      [`${BASE}/setup`, 'POST', undefined],
      [BASE, 'DELETE', undefined],
    ]);
  });

  it("names the API's reasons, and the general ones", async () => {
    for (const code of ['consent_required', 'not_configured', 'forbidden', 'not_connected']) {
      answer(400, { code, error: 'x' });
      expect(await saveHubspotConsent('b1', CONSENT)).toEqual({ ok: false, code });
    }
    answer(403, { success: false, error: 'plan_limit', message: 'Upgrade.' });
    expect(await saveHubspotConsent('b1', CONSENT)).toEqual({ ok: false, code: 'plan' });
    answer(402, { code: 'demo_brand', error: 'plan_limit' });
    expect(await saveHubspotConsent('b1', CONSENT)).toEqual({ ok: false, code: 'subscription' });
    answer(500, { error: 'Something went wrong.' });
    expect(await saveHubspotConsent('b1', CONSENT)).toEqual({ ok: false, code: 'failed' });
    fetchMock.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await readHubspot('b1')).toEqual({ ok: false, code: 'failed' });
  });
});

describe('a sign-in finished on return', () => {
  const pending = { brandId: 'b1', accountId: ACCOUNT, consent: CONSENT, at: 1_000_000 };

  it('is taken once, for its own brand', () => {
    rememberPending(pending);
    expect(takePending('b2', 1_000_100)).toBeNull();
    expect(takePending('b1', 1_000_100)).toEqual(pending);
    expect(takePending('b1', 1_000_100)).toBeNull();
  });

  it('is dropped after half an hour', () => {
    rememberPending(pending);
    expect(takePending('b1', 1_000_000 + 31 * 60 * 1000)).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });
});
