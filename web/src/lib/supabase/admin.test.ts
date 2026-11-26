import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The service role's requests are never memoized by Next.js: the welcome's
 * claim read-back got the answer from before the claim was written, and no
 * welcome was sent (readback_mismatch, 19 Nov 2026 on).
 */

const createClient = vi.hoisted(() => vi.fn(() => ({})));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

const { unmemoizedFetch } = await import('./admin');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('supabaseAdmin', () => {
  it('is made with the fetch that is never memoized', () => {
    const options = (createClient.mock.calls[0] as unknown[])[2];
    expect(options).toEqual({ global: { fetch: unmemoizedFetch } });
  });
});

describe('unmemoizedFetch', () => {
  it('gives each request a signal of its own, keeping the rest of what it was asked', async () => {
    const fetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await unmemoizedFetch('https://db.test/auth/v1/admin/users/u1', {
      method: 'GET',
      headers: { apikey: 'k' },
    });
    await unmemoizedFetch('https://db.test/auth/v1/admin/users/u1', { method: 'GET' });
    const [first, second] = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(first[1]).toMatchObject({ method: 'GET', headers: { apikey: 'k' } });
    expect(first[1].signal).toBeInstanceOf(AbortSignal);
    expect(second[1].signal).toBeInstanceOf(AbortSignal);
    // Two identical reads, two signals: neither can stand in for the other.
    expect(first[1].signal).not.toBe(second[1].signal);
  });

  it('keeps a signal the request already has', async () => {
    const fetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const own = new AbortController().signal;
    await unmemoizedFetch('https://db.test/rest/v1/brands', { signal: own });
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(own);
  });

  it('works with no options at all', async () => {
    const fetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await unmemoizedFetch('https://db.test/rest/v1/brands');
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBeInstanceOf(
      AbortSignal,
    );
  });
});
