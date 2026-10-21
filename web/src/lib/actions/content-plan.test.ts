import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the Content plan (CE-014) reads: the brand's pages (00220), its open
 * opportunities for its own pages, and the drafts still being written.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';

let reads: Record<string, unknown>;
let rpcResult: unknown;
let rpcCalls: [string, unknown][];
let filters: [string, string, string, unknown][];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    rpc: async (name: string, args: unknown) => (
      rpcCalls.push([name, args]),
      { data: rpcResult, error: null }
    ),
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, v: unknown) => (filters.push([table, 'eq', col, v]), chain),
        in: (col: string, v: unknown) => (filters.push([table, 'in', col, v]), chain),
        order: () => chain,
        limit: () => chain,
        then: (resolve: (r: unknown) => void) => resolve({ data: reads[table] ?? [], error: null }),
      };
      return chain;
    },
  })),
}));

const getSuggestionSourceStates = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/integrations', () => ({ getSuggestionSourceStates }));
const GA_CONNECTED = { configured: true, connected: true, mapped: true, lastDataAt: '2026-10-20' };

const { getContentPlan, getContentPlanInsights } = await import('./content-plan');

beforeEach(() => {
  reads = {};
  rpcResult = { days: 30, pages: [] };
  rpcCalls = [];
  filters = [];
  getSuggestionSourceStates.mockReset().mockResolvedValue({ ga: GA_CONNECTED });
});

describe('getContentPlan', () => {
  it('reads the pages, the open opportunities for own pages and the drafts being written', async () => {
    rpcResult = {
      days: 7,
      answers: { cur: 120, prev: 140 },
      prevFrom: '2026-10-07',
      trackedSince: '2026-09-09',
      pages: [
        {
          page: 'https://acme.example/guides/espresso',
          title: 'Espresso guide',
          citations: { cur: 4, prev: 9 },
          platformsDown: ['chatgpt-web'],
          aiVisits: 12,
          overlaps: 1,
        },
      ],
    };
    reads.content_opportunities = [
      {
        id: 'o1',
        title: 'Expand the espresso guide',
        decision: 'expand',
        opportunity_score: '81.10',
        brief: { suggestedTitle: ' The home espresso guide ' },
        source_data: {
          targetPages: [
            { url: '' },
            { url: 'https://acme.example/guides/espresso', title: 'The home espresso guide' },
          ],
          competitorsCited: ['Daily Grind Co.', '', 'Origin Box'],
          visibilityScore: 6,
          prompts: ['p1', 'p2'],
        },
      },
    ];
    reads.content_drafts = [
      {
        id: 'd1',
        author: 'agent',
        created_by: 'u1',
        method: 'create',
        opportunity_id: 'o2',
        source_url: null,
      },
    ];

    await expect(getContentPlan(BRAND, 7)).resolves.toEqual({
      pages: [
        {
          page: 'https://acme.example/guides/espresso',
          title: 'Espresso guide',
          citations: { cur: 4, prev: 9 },
          platformsDown: ['chatgpt-web'],
          aiVisits: 12,
          overlaps: 1,
        },
      ],
      answers: { cur: 120, prev: 140 },
      tracking: { prevFrom: '2026-10-07', trackedSince: '2026-09-09' },
      opportunities: [
        {
          id: 'o1',
          title: 'Expand the espresso guide',
          pageTitle: 'The home espresso guide',
          decision: 'expand',
          score: 81.1,
          targetPage: 'https://acme.example/guides/espresso',
          targetTitle: 'The home espresso guide',
          competitorsCited: ['Daily Grind Co.', 'Origin Box'],
          visibility: 6,
          prompts: 2,
        },
      ],
      drafts: [
        {
          id: 'd1',
          author: 'agent',
          isMine: true,
          method: 'create',
          opportunityId: 'o2',
          sourceUrl: null,
        },
      ],
    });
    expect(rpcCalls).toEqual([['content_plan_pages', { p_brand_id: BRAND, p_days: 7 }]]);
    expect(filters).toContainEqual(['content_opportunities', 'eq', 'type', 'owned']);
    expect(filters).toContainEqual([
      'content_opportunities',
      'in',
      'status',
      ['new', 'reviewed', 'sent', 'in_progress'],
    ]);
    expect(filters).toContainEqual([
      'content_drafts',
      'in',
      'status',
      ['draft', 'in_review', 'ready'],
    ]);
  });

  it('reads nothing of another organization’s brand, and refuses another period', async () => {
    rpcResult = null;
    await expect(getContentPlan(BRAND, 30)).resolves.toBeNull();
    await expect(getContentPlan(BRAND, 14 as 30)).rejects.toThrow('invalid');
    await expect(getContentPlan('nope', 30)).rejects.toThrow('invalid');
  });
});

describe('getContentPlanInsights', () => {
  it('reads what AI cites and what AI visits brought in', async () => {
    rpcResult = {
      days: 30,
      totalCitations: 120,
      citations: [
        { url: 'https://acme.example/vs/hubspot', title: null, own: true, citations: '7' },
      ],
      results: { visits: 40, keyEvents: 5, analytics: true, purchases: false },
    };
    await expect(getContentPlanInsights(BRAND, 30)).resolves.toEqual({
      totalCitations: 120,
      citations: [{ url: 'https://acme.example/vs/hubspot', title: null, own: true, citations: 7 }],
      results: {
        visits: 40,
        keyEvents: 5,
        transactions: 0,
        revenue: 0,
        analytics: true,
        purchases: false,
      },
    });
    expect(rpcCalls).toEqual([['content_plan_insights', { p_brand_id: BRAND, p_days: 30 }]]);
  });

  it('counts Analytics as connected only as AI Traffic does: connected and synced', async () => {
    rpcResult = { totalCitations: 0, citations: [], results: { analytics: true } };
    getSuggestionSourceStates.mockResolvedValue({ ga: { ...GA_CONNECTED, lastDataAt: null } });
    expect((await getContentPlanInsights(BRAND, 30))!.results.analytics).toBe(false);
    getSuggestionSourceStates.mockResolvedValue({ ga: { ...GA_CONNECTED, connected: false } });
    expect((await getContentPlanInsights(BRAND, 30))!.results.analytics).toBe(false);
    // The connection can't be read: the property set says it.
    getSuggestionSourceStates.mockRejectedValue(new Error('down'));
    expect((await getContentPlanInsights(BRAND, 30))!.results.analytics).toBe(true);
  });

  it('reads nothing of another organization’s brand', async () => {
    rpcResult = null;
    await expect(getContentPlanInsights(BRAND, 7)).resolves.toBeNull();
    await expect(getContentPlanInsights(BRAND, 14 as 7)).rejects.toThrow('invalid');
  });
});
