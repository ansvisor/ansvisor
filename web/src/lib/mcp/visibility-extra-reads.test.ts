// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * Chat's reads of what Visibility, Prompts, Competitors and AI Traffic show
 * (visibility-extra-reads.ts), on one workspace in memory: each equals what
 * its page reads from the same data (the page's own function runs here on
 * the same tables), a brand of another workspace or one not shared reads as
 * not found with nothing of it read, the plan gates are the page's, lists
 * page, and no read touches the tracked answers (prompt_results).
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));
// The pages' own reads run on the same tables: the person's client is the same fake.
vi.mock('@/lib/supabase/server', async () => ({
  createClient: async () => (await import('@/lib/supabase/admin')).supabaseAdmin,
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const reads = await import('./visibility-extra-reads');
const { getTopicsOverview } = await import('@/lib/actions/topic');
const { getCitationGaps } = await import('@/lib/actions/citations');
const { getHeadToHeadComparison } = await import('@/lib/actions/tracking');
const { getTrafficBots, getTrafficGooglePages } = await import('@/lib/actions/traffic');
const { parseTopicCompetitors, topicHeatmap } = await import('@/lib/insights-topics');
const { opportunities, topicStandings } = await import('@/lib/insights-opportunities');

const ORG = 'org-1';
const BRAND = '11111111-1111-4111-8111-111111111111';
const OTHER_BRAND = '66666666-6666-4666-8666-666666666666';
const T = ['a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'];
const T3 = 'a0000000-0000-4000-8000-000000000003';
const T_OTHER = 'a0000000-0000-4000-8000-000000000009';
const C1 = 'c0000000-0000-4000-8000-000000000001';
const C2 = 'c0000000-0000-4000-8000-000000000002';
const C_OTHER = 'c0000000-0000-4000-8000-000000000009';
const P = ['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002'];

const AUTH: McpAuthContext = {
  userId: 'u1',
  email: null,
  organizationId: ORG,
  role: 'manager',
  apiKeyId: 'agent-internal',
  brandAccess: 'all',
};
/** A Selected-brands person the brand wasn't shared with. */
const NOT_SHARED: McpAuthContext = { ...AUTH, brandAccess: ['someone-elses-brand'] };

const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
const rpc = (name: string, answer: (args: Record<string, unknown>) => unknown) => {
  db.rpcs[name] = (args) => {
    rpcCalls.push({ name, args });
    return answer(args);
  };
};

/** A topic's figures as topics_overview_window (00536) sums them. */
const topicAgg = (topicId: string, answers: number, mentions: number, competitor: number) => ({
  topic_id: topicId,
  answers,
  mention_answers: mentions,
  citation_answers: Math.floor(mentions / 2),
  pos_sum: 0.5 * mentions,
  pos_n: mentions,
  prev_answers: answers,
  prev_mention_answers: Math.max(mentions - 2, 0),
  prev_citation_answers: 0,
  prev_pos_sum: 0,
  prev_pos_n: 0,
  total_mentions: mentions * 2,
  total_citations: mentions,
  comp_mentions: competitor,
  active_prompts: 2,
  visible_prompts: 1,
  last_run_at: '2026-11-16T06:00:00.000Z',
  competitors: { [C1]: { name: 'Acme CRM', sov: competitor } },
  daily: { '2026-11-15': { visible: mentions, count: answers } },
});

/** One (prompt, engine, model, region) of head_to_head_window_daily (00552, 00169's read). */
const group = (
  promptId: string,
  platform: string,
  /** Of the group's 2 answers, how many name the brand, and the competitor. */
  brand: number,
  comp: number,
  latest: string,
) => ({
  prompt_id: promptId,
  platform,
  model_used: null,
  region: 'US',
  runs: 2,
  brand_total: brand * 50,
  comp_total: comp * 50,
  brand_mention_answers: brand,
  comp_mention_answers: comp,
  latest_at: latest,
});

/** A domain of citation_gap_domains_daily (00203), as the Gaps tab reads it. */
const gapRow = (
  domain: string,
  competitorAnswers: number,
  appearsInOurs: boolean,
  strength: number,
  names: string[],
) => ({
  domain,
  competitor_answers: competitorAnswers,
  appears_in_ours: appearsInOurs,
  strength,
  competitor_names: names,
  our_answer_count: 0,
  total_answers: 0,
});

function seed() {
  db.tables = {
    brands: [
      { id: BRAND, organization_id: ORG, name: 'Northwind', gsc_property: 'sc-domain:nw.example' },
      { id: OTHER_BRAND, organization_id: 'org-2', name: 'Elsewhere' },
    ],
    organizations: [
      { id: ORG, plan: 'growth', subscription_status: 'active', plan_overrides: null },
    ],
    topics: [
      { id: T[0], brand_id: BRAND, name: 'Pricing', is_active: true, created_at: '2026-01-01' },
      {
        id: T[1],
        brand_id: BRAND,
        name: 'Integrations',
        is_active: true,
        created_at: '2026-01-02',
      },
      { id: T3, brand_id: BRAND, name: 'Support', is_active: true, created_at: '2026-01-03' },
      {
        id: T_OTHER,
        brand_id: OTHER_BRAND,
        name: 'Elsewhere',
        is_active: true,
        created_at: '2026-01-04',
      },
    ],
    brand_domains: [{ brand_id: BRAND, domain: 'www.nw.example' }],
    prompt_sets: [{ id: 'set-1', brand_id: BRAND }],
    prompts: [
      {
        id: P[0],
        prompt_set_id: 'set-1',
        topic_id: T[0],
        is_active: true,
        created_at: '2026-01-01',
        text: 'Best  CRM',
        prompt_sets: { brand_id: BRAND },
      },
      {
        id: P[1],
        prompt_set_id: 'set-1',
        topic_id: T[1],
        is_active: true,
        created_at: '2026-01-02',
        text: 'crm pricing comparison',
        prompt_sets: { brand_id: BRAND },
      },
    ],
    competitors: [
      { id: C1, brand_id: BRAND, name: 'Acme CRM', domain: 'acme.example', created_at: '1' },
      { id: C2, brand_id: BRAND, name: 'Zen CRM', domain: 'www.zencrm.example', created_at: '2' },
      {
        id: C_OTHER,
        brand_id: OTHER_BRAND,
        name: 'Acme CRM',
        domain: 'acme.example',
        created_at: '3',
      },
    ],
    insights_brand_daily: [{ brand_id: BRAND, day: '2026-11-10', mention_answers: 5 }],
    insights_competitor_daily: [
      { brand_id: BRAND, competitor_id: C1, day: '2026-11-11', mention_answers: 7 },
    ],
    competitor_page_events: [
      {
        brand_id: BRAND,
        competitor_id: C1,
        kind: 'first_cited',
        at: '2026-11-12T10:00:00.000Z',
        url: 'https://acme.example/pricing',
        domain: 'acme.example',
        detail: { answers: 4 },
      },
    ],
    kpi_definitions: [{ brand_id: BRAND, kpi_key: 'ai_visibility', is_active: true, target: 60 }],
    prompt_suggestions: [
      {
        id: 's1',
        brand_id: BRAND,
        status: 'new',
        suggested_text: 'crm for agencies',
        topic_id: T[0],
        topic_name: 'Pricing',
        est_volume: 900,
        relevance: 0.9,
        source: 'generated',
        generated_at: '2026-11-10',
      },
      {
        id: 's2',
        brand_id: BRAND,
        status: 'new',
        suggested_text: 'crm with invoicing',
        topic_id: T3,
        topic_name: 'Support',
        est_volume: 4000,
        relevance: 0.8,
        source: 'generated',
        generated_at: '2026-11-11',
      },
      {
        id: 's3',
        brand_id: BRAND,
        status: 'new',
        suggested_text: 'crm from the hub',
        topic_id: T3,
        topic_name: 'Support',
        est_volume: 99_000,
        relevance: 1,
        source: 'business_hub',
        generated_at: '2026-11-12',
      },
    ],
    ai_bot_connections: [{ id: 'conn-1', brand_id: BRAND, revoked_at: null }],
    brand_integrations: [
      {
        brand_id: BRAND,
        provider: 'google-search-console',
        account: { id: 'acct-1', label: 'Search Console', status: 'connected' },
      },
    ],
  };
  rpcCalls.length = 0;
  db.log.length = 0;
  db.rpcs = {};
  rpc('topics_overview_window', () => [topicAgg(T[0], 40, 10, 30), topicAgg(T[1], 40, 30, 10)]);
  rpc('brand_prompt_fanout_queries', () => [
    [P[0], 'crm pricing', 3],
    [P[1], 'crm pricing', 2],
    [P[0], 'best crm', 4],
    [null, 'free crm', 1],
  ]);
  rpc('report_query_fanout_engines', () => [
    { engine: 'chatgpt-web', distinct_queries: 3, answers_with_fanout: 8 },
  ]);
  rpc('report_query_fanout', () => [
    { query: 'crm pricing', engines: ['chatgpt-web', 'perplexity'], times_searched: 5 },
    { query: 'Best CRM', engines: ['chatgpt-web'], times_searched: 4 },
  ]);
  rpc('ae_fanout_gaps', () => [{ query: 'free crm', results: 1, prompts: 0, competitor_only: 1 }]);
  // All time, as the page's all-time view: no day bounds (00552).
  rpc('head_to_head_window_daily', (args) =>
    args.p_competitor_id === C1
      ? {
          groups: [
            group(P[0], 'chatgpt-web', 0, 2, '2026-11-15T06:00:00Z'),
            group(P[1], 'chatgpt-web', 2, 1, '2026-11-16T06:00:00Z'),
            group(P[1], 'perplexity', 0, 1, '2026-11-14T06:00:00Z'),
          ],
          engines: [
            {
              platform: 'chatgpt-web',
              model_used: null,
              brand_count: 4,
              brand_total: 180,
              comp_count: 4,
              comp_total: 180,
              brand_mention_answers: 2,
              comp_mention_answers: 3,
            },
          ],
          prompts: [
            { id: P[0], text: 'best crm for small teams', category: null },
            { id: P[1], text: 'crm pricing comparison', category: null },
          ],
        }
      : { groups: [], engines: [], prompts: [] },
  );
  rpc('insights_topic_competitors_daily', () => ({
    complete: true,
    topics: [
      {
        topic_id: T[0],
        name: 'Pricing',
        prompts: 1,
        answers: 40,
        mention_answers: 10,
        citation_answers: 4,
        sum_inv_position: 3,
        position_count: 6,
        competitors: [
          {
            competitor_id: C1,
            mention_answers: 30,
            citation_answers: 10,
            sum_inv_position: 8,
            position_count: 10,
          },
        ],
      },
      {
        topic_id: T3,
        name: 'Support',
        prompts: 1,
        answers: 40,
        mention_answers: 30,
        citation_answers: 10,
        sum_inv_position: 9,
        position_count: 10,
        competitors: [
          {
            competitor_id: C2,
            mention_answers: 5,
            citation_answers: 1,
            sum_inv_position: 1,
            position_count: 2,
          },
        ],
      },
    ],
  }));
  rpc('insights_trend_markers', () => ({
    prompts_added: [{ day: '2026-11-03', count: 4 }],
    actions_sent: [],
  }));
  rpc('ai_bot_report', () => ({
    first_day: '2026-09-01',
    last_seen: '2026-11-16T05:00:00Z',
    types: [
      {
        type: 'search',
        hits: 120,
        pages: 30,
        last_seen: '2026-11-16T05:00:00Z',
        bots: ['oai-searchbot'],
      },
    ],
    bots: [
      {
        bot: 'oai-searchbot',
        type: 'search',
        hits: 120,
        pages: 30,
        last_seen: '2026-11-16T05:00:00Z',
      },
    ],
    page_count: 30,
    pages: [
      {
        page: '/pricing',
        hits: 40,
        training_last: null,
        search_last: '2026-11-16',
        user_last: null,
      },
    ],
    uncrawled_count: 1,
    uncrawled: [{ page: '/faq', citations: 6 }],
    alert_state: 'on',
    alert_from: '2026-10-01',
    since: '2026-10-18',
  }));
  rpc('citation_gap_domains_daily', () => [
    // The window's totals: the brand is in 12 of 40 answers.
    { domain: null, our_answer_count: 12, total_answers: 40 },
    gapRow('review.example', 5, false, 2.5, ['Acme CRM', 'Zen CRM']),
    gapRow('forum.example', 2, false, 1.2, ['Zen CRM']),
    gapRow('blog.example', 3, false, 1.2, ['Acme CRM']),
    // Also where the brand appears, and cited by one answer only: not gaps.
    gapRow('news.example', 4, true, 3, ['Acme CRM']),
    gapRow('lone.example', 1, false, 0.9, ['Zen CRM']),
  ]);
  rpc('citation_competitor_sources_daily', () => [
    { competitor_id: C1, domain: 'review.example', answers_feeding: 4, strength: 2 },
    { competitor_id: C1, domain: 'news.example', answers_feeding: 3, strength: 2.5 },
    { competitor_id: C2, domain: 'forum.example', answers_feeding: 2, strength: 1.2 },
  ]);
  rpc('ai_traffic_google_pages', () => ({
    last_day: '2026-11-14',
    since: '2026-10-16',
    until: '2026-11-14',
    prev_since: '2026-09-16',
    prev_until: '2026-10-15',
    incomplete: false,
    count: 1,
    rows: [
      {
        page: '/pricing',
        url: 'https://nw.example/pricing',
        impressions: 1400,
        prev_impressions: 1000,
        clicks: 20,
        prev_clicks: 40,
        prompt_id: null,
      },
    ],
  }));
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  seed();
});
afterEach(() => vi.unstubAllEnvs());

const DATES = { dateFrom: '2026-10-18', dateTo: '2026-11-16' };
const tablesRead = () => new Set(db.log.map(([table]) => table));

describe('Prompts › Topics (get_topics_overview)', () => {
  it("returns the tab's figures for each topic, highest AI Visibility Score first, from its own read", async () => {
    const read = await reads.getTopicsOverviewFor(AUTH, { brandId: BRAND, ...DATES });
    // The tab's own read of the same window.
    const page = await getTopicsOverview(BRAND, {
      from: '2026-10-18T00:00:00.000Z',
      to: '2026-11-16T23:59:59.999Z',
    });
    const byScore = [...page.topics].sort((a, b) => b.visibilityRate - a.visibilityRate);
    expect(read!.topics.map((t) => t.topic_id)).toEqual(byScore.map((t) => t.id));
    for (const row of read!.topics) {
      const own = page.topics.find((t) => t.id === row.topic_id)!;
      expect(row).toMatchObject({
        name: own.name,
        prompts: own.promptCount,
        visibility: Math.round(own.visibilityRate * 10) / 10,
        visibility_change: own.visibilityChange,
        mentions: own.totalMentions,
        citations: own.totalCitations,
        share_of_voice: own.shareOfVoice,
        trend: own.trendSparkline,
      });
    }
    // Support has prompts but no answers in the window: still in the table, at 0.
    expect(read!.topics.at(-1)).toMatchObject({ name: 'Support', visibility: 0 });
    expect(read!.summary).toMatchObject({ topics: 3, best: { name: byScore[0].name } });
    expect(read).toMatchObject({ total: 3, offset: 0, next_offset: null });
    // The window as the tab passes it: the first and last instants of its days.
    expect(rpcCalls.find((c) => c.name === 'topics_overview_window')?.args).toMatchObject({
      p_brand_id: BRAND,
      p_date_from: '2026-10-18T00:00:00.000Z',
      p_date_to: '2026-11-16T23:59:59.999Z',
    });
  });

  it('pages the table', async () => {
    const read = await reads.getTopicsOverviewFor(AUTH, { brandId: BRAND, limit: 1, offset: 1 });
    expect(read).toMatchObject({ total: 3, offset: 1, next_offset: 2 });
    expect(read!.topics).toHaveLength(1);
    expect(read!.note).toContain('Read the next page with offset 2');
  });
});

describe('Prompts › Query Fan-outs, outside a skill (get_query_fanouts)', () => {
  /** One view's result, whichever it is. */
  type FanoutRead = Record<string, unknown> &
    Record<'sub_queries' | 'engines' | 'prompts' | 'gaps', unknown[]>;
  const fanouts = async (params: Parameters<typeof reads.getQueryFanoutsFor>[1]) =>
    (await reads.getQueryFanoutsFor(AUTH, params)) as unknown as FanoutRead;

  it('lists the sub-queries most searched first, with engines, prompts and tracked, over the last 7 days', async () => {
    const read = await fanouts({ brandId: BRAND });
    expect(read).toMatchObject({ days: 7, view: 'queries', total: 3 });
    expect(read.sub_queries).toEqual([
      {
        query: 'crm pricing',
        times_searched: 5,
        prompts: 2,
        engines: ['chatgpt-web', 'perplexity'],
        tracked: false,
      },
      // "Best  CRM" is tracked: compared as the tab does, spaces and case aside.
      { query: 'best crm', times_searched: 4, prompts: 1, engines: ['chatgpt-web'], tracked: true },
      { query: 'free crm', times_searched: 1, prompts: 0, engines: null, tracked: false },
    ]);
    expect(read.engines).toEqual([
      { engine: 'chatgpt-web', sub_queries: 3, answers_with_fanout: 8 },
    ]);
    const since = Date.parse(
      String(rpcCalls.find((c) => c.name === 'brand_prompt_fanout_queries')!.args.p_since),
    );
    expect(Math.round((Date.now() - since) / 86_400_000)).toBe(7);
  });

  it('reads 30 days at most, and the By prompt and gaps views', async () => {
    const prompts = await fanouts({
      brandId: BRAND,
      days: 90,
      view: 'prompts',
    });
    expect(prompts).toMatchObject({ days: 30, total: 2 });
    expect(prompts.prompts[0]).toEqual({
      prompt_id: P[0],
      text: 'Best  CRM',
      sub_queries: 2,
      top_sub_queries: [
        { query: 'best crm', times_searched: 4 },
        { query: 'crm pricing', times_searched: 3 },
      ],
    });
    const gaps = await fanouts({ brandId: BRAND, view: 'gaps' });
    expect(gaps.gaps).toEqual([
      {
        query: 'free crm',
        answers: 1,
        prompts: 0,
        answers_naming_only_competitors: 1,
        tracked: false,
      },
    ]);
  });
});

describe("Competitors' head-to-head (get_competitor_head_to_head)", () => {
  it("lists where the competitor is ahead as the page's Gaps tab does, with its timeline", async () => {
    const read = (await reads.getCompetitorHeadToHeadFor(AUTH, {
      brandId: BRAND,
      competitor: 'acme crm',
      side: 'losing',
    })) as unknown as Record<string, unknown> & {
      prompts: { prompt: string; difference: number }[];
    };
    const page = await getHeadToHeadComparison(BRAND, C1);
    expect(read.competitor).toEqual({
      competitor_id: C1,
      name: 'Acme CRM',
      domain: 'acme.example',
    });
    expect(read.prompts.map((p) => [p.prompt, p.difference])).toEqual(
      page.gaps.map((g) => [g.promptText, Math.round(g.diff)]),
    );
    expect(read.summary).toMatchObject({
      brand_visibility: page.brandAvg,
      competitor_visibility: page.competitorAvg,
      prompts_compared: 3,
      competitor_ahead: 2,
      brand_ahead: 1,
    });
    expect(read.timeline).toMatchObject({
      events_total: 1,
      events: [{ kind: 'first_cited', url: 'https://acme.example/pricing', answers: 4 }],
    });
    const weeks = (read.timeline as { weeks: { brand_mentioning_answers: number }[] }).weeks;
    expect(weeks).toHaveLength(12);
  });

  it('finds the competitor by its id, its domain or its words, and never another', async () => {
    for (const asked of [
      { competitorId: C2 },
      { competitor: "Zen CRM'e" },
      { competitor: 'zencrm.example' },
      { competitor: 'Zen' },
    ]) {
      const read = await reads.getCompetitorHeadToHeadFor(AUTH, { brandId: BRAND, ...asked });
      expect(read, JSON.stringify(asked)).toMatchObject({ competitor: { competitor_id: C2 } });
    }
    // Another brand's competitor, and a name no competitor has: not found, nothing else offered.
    for (const asked of [{ competitorId: C_OTHER }, { competitor: 'Globex' }]) {
      const read = await reads.getCompetitorHeadToHeadFor(AUTH, { brandId: BRAND, ...asked });
      expect(read).toMatchObject({ not_found: [asked.competitorId ?? asked.competitor] });
      expect(read).not.toHaveProperty('prompts');
    }
    // Two have the word: both are offered, none picked.
    const both = await reads.getCompetitorHeadToHeadFor(AUTH, {
      brandId: BRAND,
      competitor: 'CRM',
    });
    expect(both).toMatchObject({ competitors: [{ competitor_id: C1 }, { competitor_id: C2 }] });
    expect(
      rpcCalls
        .filter((c) => c.name === 'head_to_head_window_daily')
        .map((c) => [c.args.p_competitor_id, c.args.p_day_from, c.args.p_day_to]),
    ).toEqual([
      [C2, null, null],
      [C2, null, null],
      [C2, null, null],
      [C2, null, null],
    ]);
  });
});

describe("Visibility › Overview's Topics vs competitors and Opportunities", () => {
  it("scores each topic as the map does, every competitor a column, with the trend's markers", async () => {
    const read = await reads.getTopicCompetitorMapFor(AUTH, {
      brandId: BRAND,
      ...DATES,
      model: 'chatgpt-web,chatgpt-web',
    });
    const data = parseTopicCompetitors(await db.rpcs.insights_topic_competitors_daily({}))!;
    const map = topicHeatmap(data, ['you', C1, C2]);
    expect(read!.topics.map((t) => [t.name, t.status, t.gap])).toEqual(
      map.map((row) => [row.name, row.status, row.gap]),
    );
    expect(read!.topics[0]).toMatchObject({ name: 'Support', status: 'lead', leader: 'You' });
    expect(read!.topics[1]).toMatchObject({
      name: 'Pricing',
      status: 'behind',
      leader: 'Acme CRM',
    });
    expect(read!.trend_markers).toEqual({
      prompts_added: [{ day: '2026-11-03', count: 4 }],
      goal: 60,
    });
    expect(rpcCalls.find((c) => c.name === 'insights_topic_competitors_daily')?.args).toMatchObject(
      {
        p_day_from: '2026-10-18',
        p_day_to: '2026-11-16',
        p_models: ['chatgpt-web'],
      },
    );
  });

  it("ranks the Opportunities card's items as the card does, Business Hub's left out", async () => {
    const read = await reads.getVisibilityOpportunitiesFor(AUTH, { brandId: BRAND, ...DATES });
    const data = parseTopicCompetitors(await db.rpcs.insights_topic_competitors_daily({}));
    const card = opportunities(
      [
        {
          id: 's1',
          text: 'crm for agencies',
          topicId: T[0],
          topicName: 'Pricing',
          estVolume: 900,
          relevance: 0.9,
        },
        {
          id: 's2',
          text: 'crm with invoicing',
          topicId: T3,
          topicName: 'Support',
          estVolume: 4000,
          relevance: 0.8,
        },
      ],
      topicStandings(data, { [C1]: 'Acme CRM', [C2]: 'Zen CRM' }, new Set([T[0]])),
    );
    expect(card.status).toBe('ready');
    expect(read!.opportunities.map((o) => o.title)).toEqual(
      card.status === 'ready' ? card.items.map((i) => i.title) : [],
    );
    expect(read!.opportunities).not.toContainEqual(
      expect.objectContaining({ title: 'crm from the hub' }),
    );
    expect(read!.opportunities.find((o) => o.title === 'crm for agencies')).toMatchObject({
      leader: 'Acme CRM',
      monthly_ai_searches: 900,
    });
  });
});

describe('AI Traffic: AI bots and Search Console pages', () => {
  it('returns the bot report as the page reads it, and locks it on Starter as the page does', async () => {
    const read = await reads.getAiBotsFor(AUTH, { brandId: BRAND, ...DATES, limit: 10 });
    const page = await getTrafficBots(BRAND, {
      dateFrom: '2026-10-18T00:00:00.000Z',
      dateTo: '2026-11-16T23:59:59.999Z',
    });
    expect(read).toMatchObject({
      state: 'data',
      by_type: page.types,
      by_bot: page.bots,
      pages_total: page.pageCount,
      cited_pages_no_search_bot_read: page.uncrawled,
    });
    db.tables.organizations[0].plan = 'starter';
    rpcCalls.length = 0;
    expect(await reads.getAiBotsFor(AUTH, { brandId: BRAND })).toMatchObject({
      locked: true,
      needs: 'growth',
    });
    expect(rpcCalls).toEqual([]);
    // A Growth trial has the report, as on the page.
    db.tables.organizations[0] = {
      ...db.tables.organizations[0],
      plan: 'growth',
      subscription_status: 'trialing',
    };
    expect(await reads.getAiBotsFor(AUTH, { brandId: BRAND })).toMatchObject({ state: 'data' });
  });

  it('returns the Search Console pages as the page reads them, or that it is not connected', async () => {
    const read = await reads.getGscPagesFor(AUTH, { brandId: BRAND, ...DATES });
    const page = await getTrafficGooglePages(BRAND, {
      dateFrom: '2026-10-18T00:00:00.000Z',
      dateTo: '2026-11-16T23:59:59.999Z',
    });
    expect(read).toMatchObject({
      connected: true,
      pages_total: page.count,
      since: page.since,
      until: page.until,
    });
    expect(read!.pages).toEqual([
      {
        page: '/pricing',
        url: 'https://nw.example/pricing',
        impressions: 1400,
        previous_impressions: 1000,
        clicks: 20,
        previous_clicks: 40,
        prompt_id: null,
      },
    ]);
    db.tables.brand_integrations = [];
    rpcCalls.length = 0;
    expect(await reads.getGscPagesFor(AUTH, { brandId: BRAND })).toMatchObject({
      connected: false,
    });
    expect(rpcCalls).toEqual([]);
  });
});

describe('Citations › Gaps (get_citation_gaps)', () => {
  it("lists the Gap list as the tab does, strongest first, from the tab's own read", async () => {
    const read = await reads.getCitationGapsFor(AUTH, {
      brandId: BRAND,
      ...DATES,
      model: 'chatgpt-web,perplexity',
      region: 'US',
      topicId: T[0],
    });
    // The tab's own read of the same filters, a custom range as its date control passes it.
    const tab = await getCitationGaps(BRAND, {
      datePreset: 'custom',
      dateFrom: '2026-10-18',
      dateTo: '2026-11-16T23:59:59.999Z',
      platforms: ['chatgpt-web,perplexity'],
      regions: ['US'],
      topicIds: [T[0]],
    });
    expect(read).toMatchObject({
      view: 'gap_list',
      period: { day_from: '2026-10-18', day_to: '2026-11-16' },
      answers: tab.totalAnswers,
      answers_with_brand: tab.ourAnswerCount,
      low_visibility: false,
      total: 3,
      offset: 0,
      next_offset: null,
    });
    expect((read as { gap_domains: unknown[] }).gap_domains).toEqual(
      tab.gapDomains.map((g) => ({
        domain: g.domain,
        source_type: g.category,
        competitor_answers: g.competitorAnswers,
        competitors: g.competitors,
        strength: g.strength,
      })),
    );
    // Strongest first, more competitor answers first on a tie; never where the brand appears.
    expect(
      (read as { gap_domains: { domain: string }[] }).gap_domains.map((g) => g.domain),
    ).toEqual(['review.example', 'blog.example', 'forum.example']);
    expect((read as { competitors: unknown[] }).competitors).toEqual([
      { competitor_id: C1, name: 'Acme CRM', source_domains: 2 },
      { competitor_id: C2, name: 'Zen CRM', source_domains: 1 },
    ]);
    // The tab's arguments: whole UTC days, the brand's and its competitors' domains, its filters.
    const calls = rpcCalls.filter((c) => c.name === 'citation_gap_domains_daily');
    expect(calls).toHaveLength(2);
    expect(calls[0].args).toEqual(calls[1].args);
    expect(calls[0].args).toEqual({
      p_brand_id: BRAND,
      p_day_from: '2026-10-18',
      p_day_to: '2026-11-16',
      p_models: ['chatgpt-web', 'perplexity'],
      p_regions: ['US'],
      p_topic_ids: [T[0]],
      p_brand_domains: ['nw.example'],
      p_competitor_domains: ['acme.example', 'zencrm.example'],
    });
  });

  it("reads one competitor's sources as the By competitor view does", async () => {
    const read = (await reads.getCitationGapsFor(AUTH, {
      brandId: BRAND,
      ...DATES,
      competitorId: C1,
    })) as Record<string, unknown> & { source_domains: Record<string, unknown>[] };
    const tab = await getCitationGaps(BRAND, {
      datePreset: 'custom',
      dateFrom: '2026-10-18',
      dateTo: '2026-11-16T23:59:59.999Z',
    });
    expect(read).toMatchObject({
      view: 'by_competitor',
      competitor: { competitor_id: C1, name: 'Acme CRM' },
      total: 2,
    });
    expect(read.source_domains).toEqual(
      tab.byCompetitor[C1].map((d) => ({
        domain: d.domain,
        source_type: d.category,
        answers_feeding: d.answersFeeding,
        also_cites_brand: d.alsoCitesUs,
        strength: d.strength,
      })),
    );
    expect(read.source_domains.map((d) => [d.domain, d.also_cites_brand])).toEqual([
      ['news.example', true],
      ['review.example', false],
    ]);
  });

  it("reads all time with no period (the tab's All time), and says when the list may be broad", async () => {
    rpc('citation_gap_domains_daily', () => [
      { domain: null, our_answer_count: 3, total_answers: 40 },
      gapRow('review.example', 5, false, 2.5, ['Acme CRM']),
    ]);
    const read = await reads.getCitationGapsFor(AUTH, { brandId: BRAND });
    expect(read).toMatchObject({ period: 'all time', low_visibility: true, total: 1 });
    expect((read as { low_visibility_note: string }).low_visibility_note).toContain('broad');
    const args = rpcCalls.find((c) => c.name === 'citation_gap_domains_daily')!.args;
    expect(args.p_day_from).toBeUndefined();
    expect(args.p_day_to).toBeUndefined();
  });

  it('pages the Gap list', async () => {
    const read = await reads.getCitationGapsFor(AUTH, {
      brandId: BRAND,
      ...DATES,
      limit: 1,
      offset: 1,
    });
    expect(read).toMatchObject({ total: 3, offset: 1, next_offset: 2 });
    expect((read as { gap_domains: { domain: string }[] }).gap_domains).toEqual([
      expect.objectContaining({ domain: 'blog.example' }),
    ]);
    expect((read as { note: string }).note).toContain('Read the next page with offset 2');
  });

  it("finds another brand's topic or competitor not, and reads no gaps for it", async () => {
    for (const asked of [{ topicId: T_OTHER }, { competitorId: C_OTHER }]) {
      rpcCalls.length = 0;
      const read = await reads.getCitationGapsFor(AUTH, { brandId: BRAND, ...DATES, ...asked });
      expect(read, JSON.stringify(asked)).toMatchObject({
        not_found: [asked.topicId ?? asked.competitorId],
      });
      expect(read).not.toHaveProperty('gap_domains');
      expect(rpcCalls).toEqual([]);
    }
  });
});

/** Every new read, on the brand given. */
const everyRead = (auth: McpAuthContext, brandId: string) =>
  [
    () => reads.getTopicsOverviewFor(auth, { brandId, ...DATES }),
    () => reads.getQueryFanoutsFor(auth, { brandId }),
    () => reads.getQueryFanoutsFor(auth, { brandId, view: 'prompts' }),
    () => reads.getQueryFanoutsFor(auth, { brandId, view: 'gaps' }),
    () => reads.getCompetitorHeadToHeadFor(auth, { brandId, competitorId: C1 }),
    () => reads.getTopicCompetitorMapFor(auth, { brandId, ...DATES }),
    () => reads.getVisibilityOpportunitiesFor(auth, { brandId, ...DATES }),
    () => reads.getAiBotsFor(auth, { brandId, ...DATES }),
    () => reads.getGscPagesFor(auth, { brandId, ...DATES }),
    () => reads.getCitationGapsFor(auth, { brandId, ...DATES, topicId: T[0] }),
    () => reads.getCitationGapsFor(auth, { brandId, ...DATES, competitorId: C1 }),
  ] as const;

describe('scope', () => {
  it("reads another workspace's brand, or one not shared, as not found, and nothing of it", async () => {
    for (const [auth, brandId] of [
      [AUTH, OTHER_BRAND],
      [NOT_SHARED, BRAND],
    ] as const) {
      for (const read of everyRead(auth, brandId)) {
        db.log.length = 0;
        rpcCalls.length = 0;
        await expect(read()).resolves.toBeNull();
        expect(tablesRead()).toEqual(new Set(['brands']));
        expect(rpcCalls).toEqual([]);
      }
    }
  });

  it('never reads the tracked answers themselves (prompt_results)', async () => {
    for (const read of everyRead(AUTH, BRAND)) await read();
    expect(tablesRead().has('prompt_results')).toBe(false);
    expect(tablesRead().size).toBeGreaterThan(5);
  });
});
