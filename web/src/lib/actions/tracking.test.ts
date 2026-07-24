import { describe, expect, it, vi } from 'vitest';

const promptResultRow = {
  id: 'result-id',
  prompt_id: 'prompt-id',
  brand_id: 'brand-id',
  platform: 'perplexity-web',
  response: 'AI response',
  citations: [],
  mention_count: 0,
  citation_count: 0,
  sentiment: 'neutral',
  visibility_score: 0,
  model_used: null,
  region: null,
  competitor_mentions: null,
  search_queries: [
    {
      query: 'best answer engine monitoring tools',
      engine: 'sonar-pro',
      source_platform: 'perplexity-web',
    },
  ],
  created_at: '2026-07-07T00:00:00.000Z',
};

function fakeQueryBuilder(table: string) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    neq: () => builder,
    single: async () => {
      if (table === 'prompt_results') return { data: promptResultRow, error: null };
      if (table === 'prompts') {
        return {
          data: {
            text: 'Which answer engine monitor should I use?',
            category: null,
            topic_id: null,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  };

  return builder;
}

// #508 — a brand tracked broadly but rarely mentioned: most of the 427 rows
// never mention the brand (sentiment analysis is skipped for those), but of
// the 127 that do, 51 are positive.
const insightsAggregatesRow = {
  total_results: 427,
  sum_visibility: 7546,
  total_mentions: 380,
  total_citations: 192,
  positive_count: 51,
  mentioning_results: 127,
  last_checked_at: '2026-07-22T16:59:39.570Z',
  by_model: [],
};

let rpcMock = vi.fn(async () => ({ data: insightsAggregatesRow, error: null }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => fakeQueryBuilder(table),
    rpc: () => rpcMock(),
  }),
}));

vi.mock('@/lib/actions/topic', () => ({
  getTopicById: vi.fn(),
}));

describe('getPromptResultById', () => {
  it('carries observed search queries through to prompt result details', async () => {
    const { getPromptResultById } = await import('./tracking');

    await expect(getPromptResultById('result-id')).resolves.toMatchObject({
      id: 'result-id',
      searchQueries: promptResultRow.search_queries,
    });
  });
});

describe('getInsightsSummary', () => {
  it('divides positive sentiment by brand-mentioning results, not all results (#508)', async () => {
    rpcMock = vi.fn(async () => ({ data: insightsAggregatesRow, error: null }));
    const { getInsightsSummary } = await import('./tracking');

    const summary = await getInsightsSummary('brand-id');

    // 51/127 ≈ 40%, not the diluted 51/427 ≈ 12% the old formula produced.
    expect(summary.positiveSentimentPct).toBe(40);
  });

  it('renders 0% instead of NaN when the brand is tracked but never mentioned', async () => {
    rpcMock = vi.fn(async () => ({
      data: { ...insightsAggregatesRow, positive_count: 0, mentioning_results: 0 },
      error: null,
    }));
    const { getInsightsSummary } = await import('./tracking');

    const summary = await getInsightsSummary('brand-id');

    expect(summary.positiveSentimentPct).toBe(0);
  });
});
