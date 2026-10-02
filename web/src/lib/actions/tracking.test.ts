import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    in: () => builder,
    order: () => builder,
    range: () => builder,
    // Awaiting a list query yields no rows.
    then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null, count: 0 }),
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

// Every RPC the loaders make, by name and arguments.
let rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

// Empty-but-valid payloads per rollup read, for tests that drive whole loaders.
const emptyRollups: Record<string, unknown> = {
  insights_aggregates_daily: insightsAggregatesRow,
  visible_prompt_stats_daily: { visible_prompts: 0, visible_results: 0, sum_visibility_visible: 0 },
  ai_visibility_aggregates_daily: { answers: 0, by_competitor: [] },
  competitor_aggregates_daily: { brand_row_count: 0 },
  share_of_voice_aggregates_daily: {
    total_brand_mentions: 0,
    total_competitor_mentions: 0,
    by_platform: [],
    by_day: [],
  },
  visibility_rate_trend_daily: [],
};
let rpcByName = false;

let sessionMock: { access_token: string } | null = { access_token: 'access-token' };

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => fakeQueryBuilder(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return rpcByName ? Promise.resolve({ data: emptyRollups[name], error: null }) : rpcMock();
    },
    auth: { getSession: async () => ({ data: { session: sessionMock } }) },
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

describe('topic-filtered reads (00101)', () => {
  beforeEach(() => {
    rpcCalls = [];
  });
  afterEach(() => {
    rpcByName = false;
  });

  it('serves the topic detail page from the daily rollups, every call scoped to the topic', async () => {
    rpcByName = true;
    const { getTopicDetail } = await import('./tracking');

    await getTopicDetail('brand-id', 'topic-1');

    expect(rpcCalls.length).toBeGreaterThan(0);
    for (const call of rpcCalls) {
      expect(call.name).toMatch(/_daily$/);
      // Without the topic, a rollup read answers for the whole brand.
      expect(call.args.p_topic_id).toBe('topic-1');
    }
  });

  it('passes the topic along when a topic filter is applied with a day window', async () => {
    rpcByName = true;
    const { getCompetitorComparison, getShareOfVoiceData, getVisibilityRateKpi } =
      await import('./tracking');
    const days = { dayFrom: '2026-09-01', dayTo: '2026-09-30' };

    await getCompetitorComparison('brand-id', { topicId: 'topic-1', days });
    await getShareOfVoiceData('brand-id', { topicId: 'topic-1', days });
    await getVisibilityRateKpi('brand-id', { topicId: 'topic-1', days });

    expect(rpcCalls.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'competitor_aggregates_daily',
        'ai_visibility_aggregates_daily',
        'share_of_voice_aggregates_daily',
        'visible_prompt_stats_daily',
      ]),
    );
    for (const call of rpcCalls) {
      expect(call.name).toMatch(/_daily$/);
      expect(call.args.p_topic_id).toBe('topic-1');
    }
  });

  it('leaves brand-level reads unscoped', async () => {
    rpcByName = true;
    const { getInsightsSummary } = await import('./tracking');

    await getInsightsSummary('brand-id', { days: {} });

    expect(rpcCalls.length).toBeGreaterThan(0);
    for (const call of rpcCalls) {
      expect(call.name).toBe('insights_aggregates_daily');
      expect(call.args.p_topic_id).toBeUndefined();
    }
  });
});

describe('analyzeNewPrompt', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionMock = { access_token: 'access-token' };
  });

  it('submits the prompt that was just created and nothing else', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ jobId: 'job-1' })));
    vi.stubGlobal('fetch', fetchMock);
    const { analyzeNewPrompt } = await import('./tracking');

    await expect(analyzeNewPrompt('brand-id', 'new-prompt')).resolves.toEqual({ started: true });

    // The whole point of naming the id: the brand's other unanalyzed prompts —
    // including any still waiting on Cloro's webhook — must not be swept in and
    // paid for twice.
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      brandId: 'brand-id',
      promptIds: ['new-prompt'],
    });
  });

  it('reports not-started rather than throwing when the run is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'limit' }), { status: 429 })),
    );
    const { analyzeNewPrompt } = await import('./tracking');

    // The prompt is already saved by this point, so a refusal must stay quiet
    // and leave it for the daily scheduled run.
    await expect(analyzeNewPrompt('brand-id', 'new-prompt')).resolves.toEqual({ started: false });
  });

  it('reports not-started when the server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const { analyzeNewPrompt } = await import('./tracking');

    await expect(analyzeNewPrompt('brand-id', 'new-prompt')).resolves.toEqual({ started: false });
  });

  it('makes no request at all when there is no session', async () => {
    sessionMock = null;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { analyzeNewPrompt } = await import('./tracking');

    await expect(analyzeNewPrompt('brand-id', 'new-prompt')).resolves.toEqual({ started: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
