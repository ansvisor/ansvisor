import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Where you stand (AC-02): the latest run's Visibility score, ranked among
 * the brand's primary rivals (its Direct competitors), read as the person,
 * with when that run finished.
 */

const m = vi.hoisted(() => ({
  summary: vi.fn(),
  window: vi.fn(),
  rivals: { data: [] as { id: string; name: string }[] | null, error: null as unknown },
  calls: [] as [string, ...unknown[]][],
}));

vi.mock('@/lib/agent/auth', () => ({ resolveAgentAuth: async () => ({ organizationId: 'o1' }) }));
vi.mock('@/lib/mcp/data', () => ({ getVisibilitySummaryFor: m.summary }));
vi.mock('@/lib/actions/tracking', () => ({ getTrackingWindow: m.window }));
vi.mock('@/lib/actions/prompt', () => ({ getTrackedPromptCount: vi.fn() }));
vi.mock('@/lib/actions/action-center-counts', () => ({ getMyOpenActionCount: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      m.calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq']) {
        chain[method] = (...args: unknown[]) => (m.calls.push([method, ...args]), chain);
      }
      chain.then = (resolve: (value: unknown) => unknown) => resolve(m.rivals);
      return chain;
    },
  }),
}));

const { getTodayStanding } = await import('./today');

const summary = (score: number) => ({
  brand: { name: 'Acme' },
  totals: { aiVisibilityScore: score },
  topCompetitors: [{ name: 'Big', score: 90 }],
  everyCompetitor: [
    { id: 'r1', name: 'Rival One', score: 40, visiblePrompts: 50 },
    { id: 'big', name: 'Big', score: 90, visiblePrompts: 200 },
  ],
});

beforeEach(() => {
  m.calls = [];
  m.rivals = { data: [{ id: 'r1', name: 'Rival One' }], error: null };
  m.window.mockResolvedValue({
    lastRunAt: '2026-11-18T06:00:00Z',
    runDays: { dayFrom: '2026-11-18', dayTo: '2026-11-18' },
    previousRunDays: null,
  });
  m.summary.mockReset().mockResolvedValue(summary(27.4));
});

describe('getTodayStanding', () => {
  it('ranks among the Direct competitors, over every competitor named, and says which run', async () => {
    expect(await getTodayStanding('b1')).toMatchObject({
      score: 27.4,
      rank: 2,
      of: 2,
      set: 'rivals',
      runAt: '2026-11-18T06:00:00Z',
      neighbour: { name: 'Rival One', ahead: false },
    });
    expect(m.summary).toHaveBeenCalledWith(expect.anything(), {
      brandId: 'b1',
      dateFrom: '2026-11-18',
      dateTo: '2026-11-18',
      everyCompetitor: true,
    });
    expect(m.calls).toEqual([
      ['from', 'competitors'],
      ['select', 'id, name'],
      ['eq', 'brand_id', 'b1'],
      ['eq', 'type', 'direct'],
    ]);
  });

  it('falls back to every competitor with enough prompts without rivals', async () => {
    m.rivals = { data: [], error: null };
    expect(await getTodayStanding('b1')).toMatchObject({ rank: 3, of: 3, set: 'competitors' });
  });

  it('reads no rivals on a database without competitor types yet', async () => {
    m.rivals = {
      data: null,
      error: { code: '42703', message: 'column competitors.type does not exist' },
    };
    expect(await getTodayStanding('b1')).toMatchObject({ set: 'competitors' });
  });

  it('is null before the first run', async () => {
    m.window.mockResolvedValue({ lastRunAt: null, runDays: null, previousRunDays: null });
    expect(await getTodayStanding('b1')).toBeNull();
    expect(m.summary).not.toHaveBeenCalled();
  });
});
