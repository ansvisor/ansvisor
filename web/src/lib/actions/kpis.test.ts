import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KPI_SET, KPI_KEYS, KPI_REGISTRY, KPI_TEMPLATES } from '@/lib/kpis/registry';

/**
 * The Positive Sentiment KPI (AC): Insights' Positive sentiment card as an
 * Action Center KPI — the positive share of the answers naming the brand, its
 * change in points, and a daily sparkline that leaves out days without a
 * mention rather than drawing them as 0%.
 */

let definitions: unknown[] = [];
// One insights_aggregates_daily row per day, by p_day_from.
let dailyRows: Record<string, Record<string, number>> = {};
const rpcCalls: Record<string, unknown>[] = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: async () => ({ data: definitions, error: null }),
      };
      return q;
    },
    rpc: async (...call: [string, Record<string, unknown>]) => {
      const args = call[1];
      rpcCalls.push(args);
      return { data: dailyRows[String(args.p_day_from)] ?? {}, error: null };
    },
  })),
}));

const getInsightsSummary = vi.fn();
vi.mock('./tracking', () => ({
  getInsightsSummary: (...args: unknown[]) => getInsightsSummary(...args),
  getShareOfVoiceData: vi.fn(),
  getVisibilityRateTrend: vi.fn(),
}));
vi.mock('./traffic', () => ({ getTrafficSummary: vi.fn(), getTrafficTrend: vi.fn() }));

const { getKpiSnapshots } = await import('./kpis');

const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);

beforeEach(() => {
  definitions = [];
  dailyRows = {};
  rpcCalls.length = 0;
  getInsightsSummary.mockReset();
});

describe('the Positive Sentiment KPI', () => {
  it('is listed last, under Mentions, and makes Brand Monitoring a usable template', () => {
    expect(KPI_KEYS.at(-1)).toBe('positive_sentiment');
    expect(DEFAULT_KPI_SET.at(-1)).toBe('positive_sentiment');
    expect(KPI_REGISTRY.positive_sentiment).toMatchObject({
      category: 'mentions',
      unit: 'percent',
      direction: 'higher_is_better',
    });
    expect(KPI_TEMPLATES.brand_monitoring).toEqual(['mentions', 'positive_sentiment']);
  });

  it("reads Insights' positive share and its change in points, with a sparkline of the days named", async () => {
    definitions = [
      { kpi_key: 'positive_sentiment', target: 50, timeframe: 'monthly', is_active: true },
    ];
    getInsightsSummary.mockResolvedValue({
      positiveSentimentPct: 40,
      sentimentChange: 6,
      totalMentions: 107,
      totalCitations: 0,
    });
    dailyRows = {
      [daysAgo(6)]: { positive_count: 3, mentioning_results: 4 },
      // daysAgo(5): no answer named the brand.
      [daysAgo(4)]: { positive_count: 1, mentioning_results: 3 },
      [daysAgo(0)]: { positive_count: 0, mentioning_results: 2 },
    };

    const { configured, kpis } = await getKpiSnapshots('b1');

    expect(configured).toBe(true);
    expect(kpis).toHaveLength(1);
    expect(kpis[0]).toMatchObject({
      key: 'positive_sentiment',
      category: 'mentions',
      unit: 'percent',
      value: 40,
      change: 6,
      changeKind: 'points',
      target: 50,
      progress: 80,
    });
    expect(kpis[0].trend).toEqual([
      { date: daysAgo(6), value: 75 },
      { date: daysAgo(4), value: 33 },
      { date: daysAgo(0), value: 0 },
    ]);
    // One rollup read per day of the sparkline, shared with Mentions and Citations.
    expect(rpcCalls).toHaveLength(7);
  });

  it('comes after the other KPIs in the table', async () => {
    definitions = [
      { kpi_key: 'positive_sentiment', target: 50, timeframe: 'monthly', is_active: true },
      { kpi_key: 'mentions', target: 100, timeframe: 'monthly', is_active: true },
    ];
    getInsightsSummary.mockResolvedValue({
      positiveSentimentPct: 40,
      sentimentChange: null,
      totalMentions: 107,
      mentionsChange: 25,
      totalCitations: 0,
    });
    const { kpis } = await getKpiSnapshots('b1');
    expect(kpis.map((k) => k.key)).toEqual(['mentions', 'positive_sentiment']);
    expect(kpis[1].change).toBeNull();
  });
});
