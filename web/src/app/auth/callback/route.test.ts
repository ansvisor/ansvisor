import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * /auth/callback, where GitHub and Google sign-in come back: on to the page
 * the visitor asked for (`?next=` or the OAuth buttons' cookie), only one of
 * ours, and the cookie is cleared.
 */

const exchange = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: exchange } }),
}));

const sendSignedUp = vi.fn();
vi.mock('@/lib/resend-event', () => ({ sendSignedUpEvent: (u: unknown) => sendSignedUp(u) }));

const capturePostHog = vi.fn();
vi.mock('@/lib/posthog-server', () => ({
  capturePostHog: (...args: unknown[]) => capturePostHog(...args),
}));

const { GET } = await import('./route');

const callback = (query: string, cookie?: string) =>
  GET(
    new NextRequest(`https://app.example.com/auth/callback?${query}`, {
      headers: cookie ? { cookie } : {},
    }),
  );

beforeEach(() => {
  exchange.mockReset().mockResolvedValue({ error: null });
  sendSignedUp.mockReset();
  capturePostHog.mockReset().mockResolvedValue(undefined);
});

describe('GET /auth/callback', () => {
  it('goes on to ?next=, or the page the OAuth buttons kept, and clears the cookie', async () => {
    let res = await callback('code=c1&next=%2Fdashboard%2Ftraffic%3Ftab%3Dpages');
    expect(res.headers.get('location')).toBe('https://app.example.com/dashboard/traffic?tab=pages');

    res = await callback(
      'code=c1',
      `auth_next=${encodeURIComponent('/dashboard/settings?tab=notifications')}`,
    );
    expect(res.headers.get('location')).toBe(
      'https://app.example.com/dashboard/settings?tab=notifications',
    );
    expect(res.headers.get('set-cookie')).toMatch(
      /^auth_next=;.*Max-Age=0|Expires=Thu, 01 Jan 1970/,
    );
  });

  it('never leaves the site, and goes to the dashboard without a page', async () => {
    for (const next of ['@evil.example', '//evil.example', 'https://evil.example']) {
      const res = await callback(`code=c1&next=${encodeURIComponent(next)}`);
      expect(res.headers.get('location'), next).toBe('https://app.example.com/dashboard');
    }
    const res = await callback('code=c1');
    expect(res.headers.get('location')).toBe('https://app.example.com/dashboard');
  });

  it('sends a failed sign-in back to the sign-in page', async () => {
    exchange.mockResolvedValue({ error: { message: 'bad code' } });
    const res = await callback('code=c1&next=%2Fdashboard%2Ftraffic');
    expect(res.headers.get('location')).toBe('https://app.example.com/sign-in?error=auth');
  });

  it('tells Resend once for a first sign-in, not for a later one', async () => {
    const user = (signedInAt: string) => ({
      id: 'u1',
      app_metadata: { provider: 'google' },
      email: 'a@b.co',
      created_at: '2026-11-13T10:00:00Z',
      last_sign_in_at: signedInAt,
    });
    exchange.mockResolvedValue({ data: { user: user('2026-11-13T10:00:01Z') }, error: null });
    await callback('code=c1');
    expect(sendSignedUp).toHaveBeenCalledTimes(1);
    expect(capturePostHog).toHaveBeenCalledWith('signed_up', 'u1', {
      source: 'oauth',
      provider: 'google',
    });

    sendSignedUp.mockClear();
    capturePostHog.mockClear();
    exchange.mockResolvedValue({ data: { user: user('2026-11-20T09:00:00Z') }, error: null });
    await callback('code=c1');
    expect(sendSignedUp).not.toHaveBeenCalled();
    expect(capturePostHog).not.toHaveBeenCalled();
  });
});
