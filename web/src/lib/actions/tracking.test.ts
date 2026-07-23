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

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => fakeQueryBuilder(table),
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
