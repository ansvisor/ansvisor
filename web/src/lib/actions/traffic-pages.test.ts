import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AT-006 (spec §3.5): the Pages section reads one tab of ai_traffic_pages
 * (00178) at a time, with every tab's count, and turns its rows into the
 * card's shape.
 */

const rpc = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc }),
}));

import { getTrafficPages } from './traffic';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-18T12:30:00.000Z'));
  rpc.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getTrafficPages', () => {
  it('reads one tab of the range, a slice at a time', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await getTrafficPages(
      'b1',
      { dateFrom: '2026-10-11T12:30:00.000Z' },
      { tab: 'citedNotClicked', limit: 20, offset: 10 },
    );
    expect(rpc).toHaveBeenCalledWith('ai_traffic_pages', {
      p_brand_id: 'b1',
      p_from: '2026-10-11T12:30:00.000Z',
      p_to: '2026-10-18T12:30:00.000Z',
      p_tab: 'cited_not_clicked',
      p_limit: 20,
      p_offset: 10,
    });

    // All time has no start; ten rows unless asked for more.
    await getTrafficPages('b1', undefined, { tab: 'all' });
    expect(rpc).toHaveBeenLastCalledWith('ai_traffic_pages', {
      p_brand_id: 'b1',
      p_from: null,
      p_to: null,
      p_tab: 'all',
      p_limit: 10,
      p_offset: 0,
    });
  });

  it('gives every tab its count and each row in the card’s terms', async () => {
    rpc.mockResolvedValue({
      data: {
        counts: { all: 14, no_ai_traffic: 8, cited_not_clicked: 1, traffic_no_prompt: 5 },
        rows: [
          {
            page: '/subscriptions',
            ai_visits: 2,
            ai_key_events: 1,
            ai_platforms: ['chatgpt.com'],
            citations: 4,
            targeting_prompts: 1,
            sessions: 90,
            engaged_sessions: 60,
            key_events: 7,
            transactions: 3,
            revenue: '129.50',
            engagement_seconds: 5400,
            in_sitemap: true,
            value_rank: 2,
          },
          { page: '/menu', ai_platforms: null, in_sitemap: false, value_rank: null },
        ],
      },
      error: null,
    });

    expect(await getTrafficPages('b1', undefined, { tab: 'all' })).toEqual({
      counts: { noAiTraffic: 8, citedNotClicked: 1, trafficNoPrompt: 5, all: 14 },
      rows: [
        {
          page: '/subscriptions',
          aiVisits: 2,
          aiKeyEvents: 1,
          aiPlatforms: ['chatgpt.com'],
          citations: 4,
          targetingPrompts: 1,
          sessions: 90,
          engagedSessions: 60,
          keyEvents: 7,
          transactions: 3,
          revenue: 129.5,
          engagementSeconds: 5400,
          inSitemap: true,
          valueRank: 2,
        },
        {
          page: '/menu',
          aiVisits: 0,
          aiKeyEvents: 0,
          aiPlatforms: [],
          citations: 0,
          targetingPrompts: 0,
          sessions: 0,
          engagedSessions: 0,
          keyEvents: 0,
          transactions: 0,
          revenue: 0,
          engagementSeconds: 0,
          inSitemap: false,
          valueRank: null,
        },
      ],
    });
  });

  it('gives empty lists for a brand outside the organization', async () => {
    // 00178 answers null rather than another brand's pages.
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getTrafficPages('b1', undefined, { tab: 'noAiTraffic' })).toEqual({
      counts: { noAiTraffic: 0, citedNotClicked: 0, trafficNoPrompt: 0, all: 0 },
      rows: [],
    });
  });

  it('fails loudly when the read fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'unknown tab' } });
    await expect(getTrafficPages('b1', undefined, { tab: 'all' })).rejects.toThrow('unknown tab');
  });
});
