import { describe, expect, it, vi } from 'vitest';

const tables = {};
vi.mock('../../config/supabase.js', () => ({
  default: { from: (table) => tables[table]() },
}));

const { BASKET_KPIS, basketScope, basketValues, controlScope, netEffect, pageScope } =
  await import('./basket-metrics.js');

/** A query builder that resolves to `result` however it is chained. */
function chain(result) {
  const b = {
    select: () => b,
    eq: () => b,
    in: () => b,
    order: () => b,
    limit: () => Promise.resolve(result),
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
  it('measures the pages an action names and those its drafts went live at, each once', async () => {
    expect(
      (
        await basketScope({
          payload: {
            pages: ['https://www.acme.example/a/'],
            publishedPages: { d1: 'https://acme.example/a', d2: 'https://acme.example/new' },
          },
        })
      ).pages,
    ).toEqual(['https://www.acme.example/a/', 'https://acme.example/new']);
  });

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

/**
 * The control basket (learning B2): the brand's prompts the action didn't
 * touch, and its change net of theirs.
 */
describe('netEffect', () => {
  const metric = (name, unit, before, after) => ({ metric: name, unit, before, after });

  it('takes a rate in points and a count in percent, net of the control', () => {
    expect(
      netEffect(
        [
          metric('ai_visibility', 'percent', 20, 30),
          metric('mentions', 'count', 10, 15),
          metric('citations', 'count', 4, 8),
        ],
        {
          before: { ai_visibility: 40, mentions: 200, citations: null },
          after: { ai_visibility: 44, mentions: 220, citations: null },
        },
      ),
    ).toEqual([
      { metric: 'ai_visibility', net: 6, unit: 'points', control: { before: 40, after: 44 } },
      { metric: 'mentions', net: 40, unit: 'percent', control: { before: 200, after: 220 } },
    ]);
  });

  it('leaves out a count with nothing before to scale by', () => {
    expect(
      netEffect([metric('mentions', 'count', 0, 3)], {
        before: { mentions: 10 },
        after: { mentions: 12 },
      }),
    ).toEqual([]);
  });
});

describe('controlScope', () => {
  const others = (n, topic = 't1') =>
    Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, topic_id: topic }));

  it("takes the brand's other prompts in the action's topics, never its own", async () => {
    tables.prompts = () =>
      chain({ data: [{ id: 'p1', topic_id: 't1' }, ...others(6)], error: null });
    const scope = await controlScope('b1', ['p1']);
    expect(scope).toEqual({
      basis: 'topics',
      promptIds: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
      pages: [],
    });
  });

  it("falls back to the brand's other prompts, and reads none from too few", async () => {
    let call = 0;
    // Its topic has two others; the brand has six.
    tables.prompts = () =>
      chain({
        data: call++ < 2 ? [{ id: 'p1', topic_id: 't1' }, ...others(2)] : others(6, 't9'),
        error: null,
      });
    expect((await controlScope('b1', ['p1'])).basis).toBe('brand');

    tables.prompts = () => chain({ data: others(3), error: null });
    expect(await controlScope('b1', ['p1'])).toBeNull();
    expect(await controlScope('b1', [])).toBeNull();
  });
});
