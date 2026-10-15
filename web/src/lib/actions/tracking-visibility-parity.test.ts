import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * VIS-001: the Visibility card, the "View breakdown" panel and the
 * leaderboard's own row must show the same number and the same change for
 * the same filters. All three are fed the same aggregate payloads here; they
 * used to disagree because the panel scored a 1,000-row sample over its own
 * windows, and the leaderboard compared All time with a 7-day window.
 */

type Call = { name: string; args: Record<string, unknown> };
let calls: Call[] = [];

// Current window: 1,800 answers; previous window: 1,600.
const visibilityPayload = (answers: number, mentions: number, citations: number) => ({
  answers,
  mention_answers: mentions,
  citation_answers: citations,
  position_factor: 0.5,
  by_competitor: [],
});
const CUR = visibilityPayload(1800, 540, 180);
let PREV = visibilityPayload(1600, 400, 176);

// The Mentions card's aggregates: insights_aggregates(_daily).
const summaryPayload = (results: number, mentions: number) => ({
  total_results: results,
  sum_visibility: 0,
  total_mentions: mentions,
  total_citations: 0,
  positive_count: 0,
  mentioning_results: 0,
  last_checked_at: null,
  by_model: [],
});
const SUMMARY_CUR = summaryPayload(1800, 710);
let SUMMARY_PREV = summaryPayload(1600, 500);

const groups = {
  groups: [
    {
      prompt_id: 'p1',
      platform: 'chatgpt',
      answers: 900,
      mention_answers: 300,
      citation_answers: 100,
      sum_inv_position: 150,
      position_count: 300,
      mentions: 410,
    },
    {
      prompt_id: 'p2',
      platform: 'gemini',
      answers: 900,
      mention_answers: 240,
      citation_answers: 80,
      sum_inv_position: 120,
      position_count: 240,
      mentions: 300,
    },
  ],
  prompts: [
    { id: 'p1', text: 'best rank tracker', topic_id: null, topic_name: null },
    { id: 'p2', text: 'geo tools', topic_id: null, topic_name: null },
  ],
};

const competitorAgg = {
  brand_row_count: 1800,
  brand_sum_visibility: 0,
  brand_total_mentions: 710,
  brand_total_citations: 180,
  brand_prompt_count: 2,
  brand_visible_prompts: 2,
  by_competitor: [],
  by_brand_provider: [],
  by_competitor_provider: [],
};

/** Which window a call reads: the previous one starts before the current one. */
const isPrev = (args: Record<string, unknown>) =>
  args.p_day_from === '2026-08-16' || args.p_date_from === '2026-10-12T06:00:00.000Z';

function rpc(name: string, args: Record<string, unknown>) {
  calls.push({ name, args });
  let data: unknown = null;
  if (name.startsWith('ai_visibility_aggregates')) data = isPrev(args) ? PREV : CUR;
  else if (name === 'insights_breakdown_groups') data = groups;
  else if (name.startsWith('visibility_rate_trend')) data = [];
  else if (name.startsWith('competitor_aggregates')) data = competitorAgg;
  else if (name.startsWith('insights_aggregates')) data = isPrev(args) ? SUMMARY_PREV : SUMMARY_CUR;
  return Promise.resolve({ data, error: null });
}

function table() {
  const result = { data: [] as unknown[], error: null };
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    single: async () => ({ data: { name: 'Ansvisor', logo_url: null }, error: null }),
    then: (resolve: (v: typeof result) => unknown) => resolve(result),
  };
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: () => table(), rpc }),
}));
vi.mock('@/lib/actions/topic', () => ({ getTopicById: vi.fn() }));

const {
  getVisibilityRateTrend,
  getInsightsBreakdown,
  getCompetitorComparison,
  getInsightsSummary,
} = await import('./tracking');

const thirtyDays = {
  dateFrom: '2026-09-15T00:00:00.000Z',
  days: { dayFrom: '2026-09-15', dayTo: '2026-10-14' },
};

describe('Visibility parity (VIS-001)', () => {
  beforeEach(() => {
    calls = [];
    PREV = visibilityPayload(1600, 400, 176);
    SUMMARY_PREV = summaryPayload(1600, 500);
  });

  it('shows the same number and change on the card, the panel and the leaderboard', async () => {
    const card = (await getVisibilityRateTrend('b1', thirtyDays)).summary;
    const panel = await getInsightsBreakdown('b1', 'visibility', thirtyDays);
    const own = (await getCompetitorComparison('b1', thirtyDays)).brands.find((e) => e.isOwnBrand)!;

    expect(card.change).not.toBeNull();
    expect(panel.curTotal).toBe(card.rate);
    expect(panel.prevTotal).toBe(card.prevRate);
    expect(panel.delta).toBe(card.change);
    expect(own.score).toBe(card.rate);
    expect(own.scoreChange).toBe(card.change);
    expect(panel.windowDays).toBe(30);
  });

  it('labels the change with the whole days it was measured against', async () => {
    const card = (await getVisibilityRateTrend('b1', thirtyDays)).summary;

    expect(card.prevFrom).toBe('2026-08-16');
    expect(card.prevTo).toBe('2026-09-14');
  });

  it('reads the panel slices in Postgres over the card’s whole days', async () => {
    await getInsightsBreakdown('b1', 'visibility', thirtyDays);

    const groupCalls = calls.filter((c) => c.name === 'insights_breakdown_groups');
    expect(groupCalls.map((c) => [c.args.p_day_from, c.args.p_day_to])).toEqual([
      ['2026-09-15', '2026-10-14'],
      ['2026-08-16', '2026-09-14'],
    ]);
  });

  it('shows no change anywhere for All time', async () => {
    const allTime = { days: {} };
    const card = (await getVisibilityRateTrend('b1', allTime)).summary;
    const panel = await getInsightsBreakdown('b1', 'visibility', allTime);
    const own = (await getCompetitorComparison('b1', allTime)).brands.find((e) => e.isOwnBrand)!;

    expect(card.change).toBeNull();
    expect(panel).toMatchObject({ prevTotal: null, delta: null, windowDays: null });
    expect(panel.curTotal).toBe(card.rate);
    // The leaderboard used to compare all time with the trailing 7 days.
    expect(own.scoreChange).toBeNull();
    expect(calls.filter((c) => c.name === 'insights_breakdown_groups')).toHaveLength(1);
  });

  it('uses the anchored 24h window and the topic on the raw path', async () => {
    const anchored = {
      dateFrom: '2026-10-13T06:00:00.000Z',
      dateTo: '2026-10-14T06:00:00.000Z',
      topicId: 'topic-1',
    };
    const card = (await getVisibilityRateTrend('b1', anchored)).summary;
    const panel = await getInsightsBreakdown('b1', 'visibility', anchored);

    expect(panel.delta).toBe(card.change);
    const groupCalls = calls.filter((c) => c.name === 'insights_breakdown_groups');
    expect(
      groupCalls.map((c) => [c.args.p_date_from, c.args.p_date_to, c.args.p_topic_id]),
    ).toEqual([
      ['2026-10-13T06:00:00.000Z', '2026-10-14T06:00:00.000Z', 'topic-1'],
      ['2026-10-12T06:00:00.000Z', '2026-10-13T06:00:00.000Z', 'topic-1'],
    ]);
  });

  it('says there is nothing to compare when the previous window had no answers', async () => {
    PREV = visibilityPayload(0, 0, 0);
    const card = (await getVisibilityRateTrend('b1', thirtyDays)).summary;
    const panel = await getInsightsBreakdown('b1', 'visibility', thirtyDays);

    expect(card.change).toBeNull();
    expect(panel).toMatchObject({ prevTotal: null, delta: null, windowDays: 30 });
    expect(panel.rootCause).toContain('No answers in one of the two 30-day windows');
  });

  it('matches the Mentions card, which shows no change without previous answers', async () => {
    const withPrev = await getInsightsBreakdown('b1', 'mentions', thirtyDays);
    const cardWithPrev = await getInsightsSummary('b1', thirtyDays);
    expect(withPrev).toMatchObject({ curTotal: 710, prevTotal: 500, delta: 210 });
    expect(withPrev.deltaPct).toBe(cardWithPrev.mentionsChange);

    SUMMARY_PREV = summaryPayload(0, 0);
    const panel = await getInsightsBreakdown('b1', 'mentions', thirtyDays);
    const card = await getInsightsSummary('b1', thirtyDays);
    expect(card.mentionsChange).toBeNull();
    expect(panel).toMatchObject({ curTotal: 710, prevTotal: null, delta: null, deltaPct: null });
  });
});
