import { describe, expect, it, vi } from 'vitest';

/**
 * The Pay card's and "Do both"'s calls reach Ansvisor's own Ads API through
 * the same-origin proxy, and nothing else: no ad platform (Phase 0 has no
 * client for one). A refusal keeps its code for the drawer to explain.
 */

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  }),
}));
const network = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
  async () => new Response('{}'),
);
vi.stubGlobal('fetch', network);
const { AdsApiError, connectChatGptAds, createAdsDrafts, disconnectAdsAccount, sendAdsEarn } =
  await import('./api');

describe('the Ads writes of the drawer', () => {
  it('go to the two Ads routes only, each with its own key', async () => {
    await sendAdsEarn('b1', 'p1', 'earn-key-1');
    await createAdsDrafts('b1', 'p1', 'pay-key-1');
    expect(
      network.mock.calls.map(([url, init]) => [url, init?.method, JSON.parse(String(init?.body))]),
    ).toEqual([
      [
        '/api/aeo/api/ads/opportunities/p1/earn',
        'POST',
        { brandId: 'b1', idempotencyKey: 'earn-key-1' },
      ],
      [
        '/api/aeo/api/ads/opportunities/p1/drafts',
        'POST',
        { brandId: 'b1', idempotencyKey: 'pay-key-1' },
      ],
    ]);
  });

  it('throws a refusal with its status, code and why', async () => {
    network.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'facts_needed', why: 'off' }), { status: 409 }),
    );
    const err = await createAdsDrafts('b1', 'p1', 'pay-key-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdsApiError);
    const { status, code, body } = err as InstanceType<typeof AdsApiError>;
    expect([status, code, body.why]).toEqual([409, 'facts_needed', 'off']);
  });
});

describe('ad accounts (Phase 1, C2)', () => {
  it('send the key once in a body, and remove an account with no body', async () => {
    network.mockClear();
    network.mockResolvedValueOnce(new Response(JSON.stringify({ account: { id: 'a1' } })));
    network.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'a1' })));
    expect(await connectChatGptAds('b1', 'sk-ads')).toEqual({ id: 'a1' });
    expect(await disconnectAdsAccount('b1', 'a1')).toEqual({ id: 'a1' });
    const [[connectUrl, connect], [removeUrl, remove]] = network.mock.calls;
    expect([connectUrl, connect?.method, JSON.parse(String(connect?.body))]).toEqual([
      '/api/aeo/api/ads/accounts/chatgpt',
      'POST',
      { brandId: 'b1', apiKey: 'sk-ads' },
    ]);
    expect([removeUrl, remove?.method, remove?.body]).toEqual([
      '/api/aeo/api/ads/accounts/a1?brandId=b1',
      'DELETE',
      undefined,
    ]);
    expect(remove?.headers).not.toHaveProperty('Content-Type');
  });
});
