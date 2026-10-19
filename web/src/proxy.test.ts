import { describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * A signed-out visitor of a dashboard page goes to sign-in with the page as
 * `?next=`, query included, so signing in brings them back to it — an
 * e-mail's "Open AI Traffic" button, say.
 */

// The locale routing isn't what's tested here (and its ESM build doesn't load in Vitest).
vi.mock('next-intl/middleware', () => ({ default: () => () => NextResponse.next() }));
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async () => ({ supabaseResponse: NextResponse.next(), user: null }),
}));

const { proxy } = await import('./proxy');

describe('proxy', () => {
  it('sends a signed-out visitor to sign-in with the page they asked for', async () => {
    const res = await proxy(
      new NextRequest('https://app.example.com/dashboard/settings?tab=notifications'),
    );
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/sign-in');
    expect(location.searchParams.get('next')).toBe('/dashboard/settings?tab=notifications');
  });

  it('names the page without its locale prefix', async () => {
    const res = await proxy(new NextRequest('https://app.example.com/en/dashboard/traffic'));
    expect(new URL(res.headers.get('location')!).searchParams.get('next')).toBe(
      '/dashboard/traffic',
    );
  });
});
