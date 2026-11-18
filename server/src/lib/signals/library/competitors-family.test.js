import { describe, expect, it, vi } from 'vitest';

/**
 * The competitor families raise nothing for a competitor the brand no longer
 * tracks: one deleted, or merged into another (00543). Its rollup rows (its
 * history) are still read by ae_dimension_stats and
 * ae_competitor_prompt_stats, without a name.
 */

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../../../config/supabase.js', () => ({
  default: { rpc: (...args) => rpc(...args), from: () => ({}) },
}));
vi.mock('../../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { LIBRARY_FAMILIES } = await import('./detect.js');
const family = (name) => LIBRARY_FAMILIES.find((f) => f.name === name);

const dims = {
  platforms: [{ cur_mentions: 2 }],
  competitors: [
    { key: 'live', name: 'Sky Air', cur_mentions: 40, prev_mentions: 10 },
    // Merged into Sky Air this week: its rows from before the merge.
    { key: 'merged', name: null, cur_mentions: 40, prev_mentions: 10 },
  ],
};

const ctx = (liveIds) => ({
  brandId: 'b1',
  now: new Date('2026-11-17T05:00:00Z'),
  sources: new Set(['tracking', 'competitors']),
  week: {},
  dimensions: async () => dims,
  prompts: async () => [],
  promptTexts: async () => new Map(),
  ...(liveIds ? { liveCompetitorIds: async () => new Set(liveIds) } : {}),
});

describe('the competitors family', () => {
  it('raises signals for tracked competitors only', async () => {
    const found = await family('competitors').run(ctx(['live']));
    expect(found.length).toBeGreaterThan(0);
    expect(new Set(found.map((f) => f.payload.competitorId))).toEqual(new Set(['live']));
  });

  it('takes every competitor when the context has no list (as before)', async () => {
    const found = await family('competitors').run(ctx(null));
    expect(new Set(found.map((f) => f.payload.competitorId))).toEqual(new Set(['live', 'merged']));
  });
});

describe('the competitorPrompts family', () => {
  const run = (liveIds) =>
    family('competitorPrompts').run({
      ...ctx(liveIds),
      sources: new Set(['tracking', 'competitors', 'volumes']),
      prompts: async () => [
        {
          prompt_id: 'p1',
          volume: 100000,
          cur_mention_days: 0,
          cur_answers: 20,
          cur_days: 7,
          cur_runs: 20,
          cur_results: 20,
        },
      ],
    });

  it('reads the leaders among tracked competitors only', async () => {
    rpc.mockResolvedValue({
      data: [{ prompt_id: 'p1', competitor_id: 'merged', cur_days: 7, cur_answers: 20 }],
      error: null,
    });
    // Still tracked, it leads the prompt; merged, it leads nothing.
    expect((await run(['live', 'merged'])).map((f) => f.kind)).toContain(
      'competitor_high_value_lead',
    );
    expect(await run(['live'])).toEqual([]);
  });
});
