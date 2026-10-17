import { describe, expect, it, vi } from 'vitest';

const tables = {};
vi.mock('../../config/supabase.js', () => ({
  default: { from: (table) => tables[table]() },
}));

const { BASKET_KPIS, basketScope, basketValues, pageScope } = await import('./basket-metrics.js');

/** A query builder that resolves to `result` however it is chained. */
function chain(result) {
  const b = {
    select: () => b,
    eq: () => b,
    in: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve) => resolve(result),
  };
  return b;
}

describe('pageScope', () => {
  it('turns page URLs into citation keys, hosts and GA paths', () => {
    expect(
      pageScope([
        'https://www.Example.com/Blog/Post/?utm=x#top',
        'https://docs.example.com/',
        'not a url',
      ]),
    ).toEqual({
      keys: ['example.com/blog/post', 'docs.example.com'],
      domains: ['example.com', 'docs.example.com'],
      paths: ['/Blog/Post', '/'],
    });
  });
});

describe('basketValues', () => {
  const raw = {
    cells: 40,
    visible: 10,
    mention_answers: 12,
    competitor_visible_total: 30,
    top_competitor_visible: 20,
    page_citations: 7,
    ga_connected: true,
    page_ai_sessions: 55,
  };

  it('measures the basket', () => {
    expect(basketValues(raw, { pageCount: 2 })).toEqual({
      ai_visibility: 25,
      share_of_voice: 25,
      // 25% against the strongest competitor's 50%.
      competitor_lead: -25,
      mentions: 12,
      citations: 7,
      ai_referral_traffic: 55,
    });
  });

  it('leaves unanswerable metrics unmeasured instead of zero', () => {
    const none = basketValues(
      { ...raw, cells: 0, visible: 0, competitor_visible_total: 0 },
      {
        pageCount: 0,
      },
    );
    expect(Object.values(none).every((v) => v === null)).toBe(true);
    expect(
      basketValues({ ...raw, ga_connected: false }, { pageCount: 2 }).ai_referral_traffic,
    ).toBe(null);
  });

  it('covers every basket KPI', () => {
    expect(Object.keys(basketValues(raw, { pageCount: 1 })).sort()).toEqual(
      Object.keys(BASKET_KPIS).sort(),
    );
  });
});

describe('basketScope', () => {
  it('uses the prompt ids the action was sent with', async () => {
    expect(await basketScope({ payload: { promptIds: ['p1'], pages: ['u'] } })).toEqual({
      promptIds: ['p1'],
      pages: ['u'],
    });
  });

  it("falls back to the opportunity's clusters, then to its own prompt", async () => {
    tables.content_opportunities = () =>
      chain({ data: { cluster_id: 'c1', related_cluster_ids: [], prompt_id: 'p9' } });
    tables.prompt_cluster_members = () =>
      chain({ data: [{ prompt_id: 'p1' }, { prompt_id: 'p2' }], error: null });
    expect((await basketScope({ payload: { opportunityId: 'o1' } })).promptIds).toEqual([
      'p1',
      'p2',
    ]);

    tables.content_opportunities = () =>
      chain({ data: { cluster_id: null, related_cluster_ids: [], prompt_id: 'p9' } });
    expect((await basketScope({ payload: { opportunityId: 'o1' } })).promptIds).toEqual(['p9']);
  });

  it('takes the prompts a topic has now when none were tracked when it was sent', async () => {
    tables.prompts = () => chain({ data: [{ id: 'p3' }, { id: 'p4' }], error: null });
    expect(
      (await basketScope({ brand_id: 'b1', payload: { topicId: 't1', promptIds: [] } })).promptIds,
    ).toEqual(['p3', 'p4']);
    // Prompt ids it was sent with are kept, so the basket doesn't move.
    expect(
      (await basketScope({ brand_id: 'b1', payload: { topicId: 't1', promptIds: ['p1'] } }))
        .promptIds,
    ).toEqual(['p1']);
  });
});
