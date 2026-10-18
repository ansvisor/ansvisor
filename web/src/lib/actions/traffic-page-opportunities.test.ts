import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AT-002: the AI Traffic page asks the server for its own range's findings,
 * as the first and last day Analytics stores.
 */

let session: { access_token: string } | null = { access_token: 'tok' };
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getSession: async () => ({ data: { session } }) },
  })),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

import { getPageOpportunities } from './traffic';

const fetchMock = vi.fn();

beforeEach(() => {
  session = { access_token: 'tok' };
  fetchMock.mockReset().mockResolvedValue(
    new Response(
      JSON.stringify({
        pages: '42',
        findings: [
          {
            landing_page: '/pricing',
            value_signal: 'revenue',
            value_percentile: 97.5,
            value_rank: 1,
            sessions: '310',
            engaged_sessions: 200,
            key_events: 4,
            transactions: 3,
            revenue: 1290.5,
            engagement_seconds: 5400,
            citation_state: 'cited',
            citations: '12',
            citing_prompts: 2,
            targeting_prompts: 0,
          },
        ],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const requested = () => new URL(fetchMock.mock.calls[0][0] as string);

describe('getPageOpportunities', () => {
  it("sends the range's first and last UTC day", async () => {
    await getPageOpportunities('b1', {
      dateFrom: '2026-10-11T09:30:00.000Z',
      dateTo: '2026-10-17T23:59:59.999Z',
    });
    const url = requested();
    expect(url.pathname).toBe('/api/integrations/google-analytics/page-opportunities');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      brandId: 'b1',
      from: '2026-10-11',
      to: '2026-10-17',
    });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer tok' },
      cache: 'no-store',
    });
  });

  it('leaves the end open for a preset, and both for all time', async () => {
    await getPageOpportunities('b1', { dateFrom: '2026-10-11T09:30:00.000Z' });
    expect(Object.fromEntries(requested().searchParams)).toEqual({
      brandId: 'b1',
      from: '2026-10-11',
    });

    fetchMock.mockClear();
    await getPageOpportunities('b1', {});
    expect(Object.fromEntries(requested().searchParams)).toEqual({ brandId: 'b1' });
  });

  it('reads the findings into the shape the card shows', async () => {
    const result = await getPageOpportunities('b1', {});
    expect(result.pages).toBe(42);
    expect(result.rows).toEqual([
      {
        landingPage: '/pricing',
        valueSignal: 'revenue',
        valuePercentile: 97.5,
        valueRank: 1,
        sessions: 310,
        engagedSessions: 200,
        keyEvents: 4,
        transactions: 3,
        revenue: 1290.5,
        engagementSeconds: 5400,
        citationState: 'cited',
        citations: 12,
        citingPrompts: 2,
        targetingPrompts: 0,
      },
    ]);
  });

  it("throws the server's error rather than returning an empty range", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    );
    await expect(getPageOpportunities('b1', {})).rejects.toThrow('Forbidden');
  });

  it('needs a signed-in user', async () => {
    session = null;
    await expect(getPageOpportunities('b1', {})).rejects.toThrow('Not authenticated');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
