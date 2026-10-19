import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "A new AI platform starts sending visits" (AT-013, spec §3.8): a platform
 * with AI visits this week and none before, for a brand that had AI visits
 * before.
 */

const rpc = vi.fn();
vi.mock('../../config/supabase.js', () => ({ default: { rpc: (...args) => rpc(...args) } }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../logger.js', () => ({ logger }));

const { newAiPlatformCandidates, newPlatforms } = await import('./traffic-platforms.js');

const NOW = new Date('2026-10-19T06:30:00Z');

beforeEach(() => {
  rpc.mockReset();
  logger.error.mockClear();
});

describe('newPlatforms', () => {
  const before = {
    visits: 40,
    platforms: [
      { platform: 'chatgpt.com', visits: 30 },
      { platform: 'gemini.google.com', visits: 10 },
      // Listed, but with no visits: never sent one.
      { platform: 'claude.ai', visits: 0 },
    ],
  };

  it('names the platforms sending visits for the first time, with their first day', () => {
    const week = {
      visits: 16,
      platforms: [
        { platform: 'chatgpt.com', visits: 9 },
        { platform: 'perplexity.ai', visits: 3 },
        { platform: 'claude.ai', visits: 5 },
        // A referrer the source list couldn't name is not a platform.
        { platform: 'unknown', visits: 4 },
        // Nor is a key the public beacon was sent that isn't on the list.
        { platform: 'made-up.example', visits: 50 },
        // One or two visits aren't a platform starting to send them.
        { platform: 'grok.com', visits: 2 },
      ],
      days: [
        { day: '2026-10-15', platform: 'claude.ai', visits: 3 },
        { day: '2026-10-14', platform: 'claude.ai', visits: 2 },
        { day: '2026-10-17', platform: 'perplexity.ai', visits: 3 },
        { day: '2026-10-12', platform: 'perplexity.ai', visits: 0 },
      ],
    };
    expect(newPlatforms(week, before)).toEqual([
      { platform: 'claude.ai', visits: 5, firstDay: '2026-10-14' },
      { platform: 'perplexity.ai', visits: 3, firstDay: '2026-10-17' },
    ]);
  });

  it('has nothing new for a brand with no AI visits before the week', () => {
    const week = { visits: 3, platforms: [{ platform: 'chatgpt.com', visits: 3 }] };
    expect(newPlatforms(week, { visits: 0, platforms: [] })).toEqual([]);
    expect(newPlatforms(week, null)).toEqual([]);
  });
});

describe('newAiPlatformCandidates', () => {
  it('reads the last seven whole days against everything before them', async () => {
    rpc.mockImplementation(async (_name, params) => ({
      data:
        params.p_from === null
          ? { visits: 12, platforms: [{ platform: 'chatgpt.com', visits: 12 }] }
          : {
              visits: 4,
              // A list of days, as ai_traffic_merged returns it (00176).
              analytics_days: [],
              platforms: [{ platform: 'perplexity.ai', visits: 4 }],
              days: [{ day: '2026-10-16', platform: 'perplexity.ai', visits: 4 }],
            },
      error: null,
    }));

    const found = await newAiPlatformCandidates('b1', { now: NOW });

    expect(rpc).toHaveBeenCalledWith('ai_traffic_merged', {
      p_brand_id: 'b1',
      p_from: '2026-10-12T00:00:00.000Z',
      // To the second before midnight, inclusive: that day's Analytics in one read only.
      p_to: '2026-10-18T23:59:59.000Z',
      p_to_inclusive: true,
      p_analytics: true,
    });
    expect(rpc).toHaveBeenCalledWith('ai_traffic_merged', {
      p_brand_id: 'b1',
      p_from: null,
      p_to: '2026-10-11T23:59:59.000Z',
      p_to_inclusive: true,
      p_analytics: true,
    });
    expect(found).toEqual([
      {
        kind: 'ai_platform_new',
        dedupKey: 'ai_platform_new:perplexity.ai',
        source: ['ai_results'],
        payload: { aiSource: 'perplexity.ai', firstDay: '2026-10-16' },
        previousValue: 0,
        currentValue: 4,
        changeValue: 4,
      },
    ]);
  });

  it('says Analytics when the week read it', async () => {
    rpc.mockImplementation(async (_name, params) => ({
      data:
        params.p_from === null
          ? { visits: 12, platforms: [{ platform: 'chatgpt.com', visits: 12 }] }
          : {
              visits: 4,
              analytics_days: ['2026-10-16'],
              platforms: [{ platform: 'perplexity.ai', visits: 4 }],
              days: [{ day: '2026-10-16', platform: 'perplexity.ai', visits: 4 }],
            },
      error: null,
    }));
    const [found] = await newAiPlatformCandidates('b1', { now: NOW });
    expect(found.source).toEqual(['ga4']);
  });

  it('costs only itself when a read fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'statement timeout' } });
    expect(await newAiPlatformCandidates('b1', { now: NOW })).toEqual([]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
