// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS } from '@/config/plans';

/**
 * The rows of what Visibility, Prompts, Competitors and AI Traffic show
 * (visibility-extra-tools.ts): each a read open to every role, in Chat's
 * list, calling its function with the person's inputs as they are named;
 * scoped by the server as the other reads are (its dates, its days, the
 * plan's platforms, a page by offset), and refused for a brand outside the
 * person's scope.
 */

const calls = vi.hoisted(() => [] as { fn: string; args: unknown[] }[]);
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { rpc: vi.fn() } }));
vi.mock('@/lib/mcp/visibility-extra-reads', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(real).map(([key, value]) => [
      key,
      typeof value === 'function' && key.endsWith('For')
        ? vi.fn(async (...args: unknown[]) => {
            calls.push({ fn: key, args });
            return { from: key };
          })
        : value,
    ]),
  );
});

const { VISIBILITY_EXTRA_READS } = await import('./visibility-extra-tools');
const { CHAT_TOOLS, chatTool } = await import('./tools');
const { FIXTURE_IDS } = await import('./define-tool');
const { scopeRead, pagedRead } = await import('../scope');
const { DEFAULT_CHAT_SETTINGS, decideToolCall } = await import('../precedence');
const { planFactsFromOrgRow } = await import('../plan-facts');
const { withSkillRefusal } = await import('../with-skill');
const { isUntrustedRead, taintsRun } = await import('../untrusted');

const BRAND = FIXTURE_IDS.brand;
const TOPIC = 'a0000000-0000-4000-8000-000000000001';
const COMPETITOR = 'c0000000-0000-4000-8000-000000000001';
const ctx = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'agent-internal',
  brandAccess: 'all' as const,
  role: 'analyst' as const,
};
const NAMES = [
  'get_topics_overview',
  'get_query_fanouts',
  'get_competitor_head_to_head',
  'get_topics_vs_competitors',
  'get_visibility_opportunities',
  'get_citation_gaps',
  'get_ai_bots',
  'get_gsc_pages',
];
const run = (name: string, input: Record<string, unknown>) => {
  const tool = chatTool(name)!;
  return tool.run(ctx, tool.inputSchema.parse(input));
};

beforeEach(() => {
  calls.length = 0;
});

describe('the rows', () => {
  it('are reads every role may run, in Chat’s list, each on its page', () => {
    expect(VISIBILITY_EXTRA_READS.map((tool) => tool.name)).toEqual(NAMES);
    for (const tool of VISIBILITY_EXTRA_READS) {
      expect(CHAT_TOOLS).toContain(tool);
      expect(tool).toMatchObject({ class: 'read', minRole: 'analyst', mcpTool: null });
      expect(tool.brandOf).toEqual({ input: 'brand_id' });
      // Plain questions read them: none waits for a skill.
      expect(withSkillRefusal(tool, [])).toBeNull();
    }
    expect(
      Object.fromEntries(VISIBILITY_EXTRA_READS.map((tool) => [tool.name, tool.route])),
    ).toEqual({
      get_topics_overview: '/dashboard/prompts/topics',
      get_query_fanouts: '/dashboard/prompts/fan-outs',
      get_competitor_head_to_head: '/dashboard/competitors',
      get_topics_vs_competitors: '/dashboard/insights',
      get_visibility_opportunities: '/dashboard/insights',
      get_citation_gaps: '/dashboard/citations',
      get_ai_bots: '/dashboard/traffic',
      get_gsc_pages: '/dashboard/traffic',
    });
  });

  it("says which page and tab each reads, and names its inputs as the other reads'", () => {
    const pages: Record<string, string> = {
      get_topics_overview: 'Prompts › Topics',
      get_query_fanouts: 'Prompts › Query Fan-outs',
      get_competitor_head_to_head: "Competitors' head-to-head",
      get_topics_vs_competitors: 'Visibility › Overview',
      get_visibility_opportunities: 'Visibility › Overview',
      get_citation_gaps: 'Citations › Gaps',
      get_ai_bots: 'AI Referral Traffic',
      get_gsc_pages: 'AI Referral Traffic',
    };
    const known = new Set([
      'brand_id',
      'date_from',
      'date_to',
      'model',
      'region',
      'topic_id',
      'days',
      'competitor_id',
      'competitor',
      'view',
      'side',
      'limit',
      'offset',
    ]);
    for (const tool of VISIBILITY_EXTRA_READS) {
      expect(tool.description, tool.name).toContain(pages[tool.name]);
      for (const field of Object.keys(tool.inputSchema.shape)) {
        expect(known.has(field), `${tool.name}.${field}`).toBe(true);
      }
    }
  });

  it('calls each read with the inputs as given', async () => {
    const dates = { date_from: '2026-10-18', date_to: '2026-11-16' };
    await run('get_topics_overview', { brand_id: BRAND, ...dates, offset: 50 });
    await run('get_query_fanouts', { brand_id: BRAND, days: 7, view: 'gaps' });
    await run('get_competitor_head_to_head', {
      brand_id: BRAND,
      competitor: 'Acme',
      side: 'losing',
    });
    await run('get_topics_vs_competitors', {
      brand_id: BRAND,
      ...dates,
      model: 'chatgpt-web',
      region: 'US',
    });
    await run('get_visibility_opportunities', { brand_id: BRAND, ...dates });
    await run('get_citation_gaps', {
      brand_id: BRAND,
      ...dates,
      model: 'chatgpt-web',
      region: 'US',
      topic_id: TOPIC,
      competitor_id: COMPETITOR,
      offset: 50,
    });
    await run('get_ai_bots', { brand_id: BRAND, ...dates });
    await run('get_gsc_pages', { brand_id: BRAND, ...dates });
    const withDates = { brandId: BRAND, dateFrom: '2026-10-18', dateTo: '2026-11-16' };
    expect(calls).toEqual([
      { fn: 'getTopicsOverviewFor', args: [ctx, { ...withDates, limit: undefined, offset: 50 }] },
      {
        fn: 'getQueryFanoutsFor',
        args: [ctx, { brandId: BRAND, days: 7, view: 'gaps', limit: undefined, offset: undefined }],
      },
      {
        fn: 'getCompetitorHeadToHeadFor',
        args: [
          ctx,
          {
            brandId: BRAND,
            competitorId: undefined,
            competitor: 'Acme',
            side: 'losing',
            limit: undefined,
            offset: undefined,
          },
        ],
      },
      {
        fn: 'getTopicCompetitorMapFor',
        args: [
          ctx,
          { ...withDates, model: 'chatgpt-web', region: 'US', limit: undefined, offset: undefined },
        ],
      },
      {
        fn: 'getVisibilityOpportunitiesFor',
        args: [
          ctx,
          {
            ...withDates,
            model: undefined,
            region: undefined,
            limit: undefined,
            offset: undefined,
          },
        ],
      },
      {
        fn: 'getCitationGapsFor',
        args: [
          ctx,
          {
            ...withDates,
            model: 'chatgpt-web',
            region: 'US',
            topicId: TOPIC,
            competitorId: COMPETITOR,
            limit: undefined,
            offset: 50,
          },
        ],
      },
      { fn: 'getAiBotsFor', args: [ctx, withDates] },
      { fn: 'getGscPagesFor', args: [ctx, withDates] },
    ]);
  });

  it('refuses a fan-out read past 30 days, and a competitor or topic id that is no id', () => {
    const fanouts = chatTool('get_query_fanouts')!;
    expect(fanouts.inputSchema.safeParse({ brand_id: BRAND, days: 31 }).success).toBe(false);
    const h2h = chatTool('get_competitor_head_to_head')!;
    expect(h2h.inputSchema.safeParse({ brand_id: BRAND, competitor_id: 'Acme' }).success).toBe(
      false,
    );
    const gaps = chatTool('get_citation_gaps')!;
    for (const input of [{ competitor_id: 'Acme' }, { topic_id: 'Pricing' }]) {
      expect(gaps.inputSchema.safeParse({ brand_id: BRAND, ...input }).success).toBe(false);
    }
  });

  it("reads Citations › Gaps as untrusted: its domains are the answers' cited sources", () => {
    expect(chatTool('get_citation_gaps')!.description).toContain(
      'the domains that cite competitors but not the brand',
    );
    expect(isUntrustedRead('get_citation_gaps')).toBe(true);
    expect(taintsRun('get_citation_gaps')).toBe(true);
  });
});

describe("the server's scope on them", () => {
  const NOW = new Date('2026-11-16T12:00:00.000Z');
  const facts = (over: Partial<Parameters<typeof scopeRead>[2]> = {}) => ({
    question: 'How are we doing?',
    limits: PLANS.growth.limits,
    planName: 'Growth',
    now: NOW,
    ...over,
  });

  it('reads the Query Fan-outs tab’s 7 days with no range set, and 30 at most for a longer one', async () => {
    const tool = chatTool('get_query_fanouts')!;
    expect(await scopeRead(tool, { brand_id: BRAND }, facts())).toMatchObject({
      input: { days: 7 },
    });
    expect(await scopeRead(tool, { brand_id: BRAND }, facts({ range: '90d' }))).toMatchObject({
      input: { days: 30 },
    });
    expect(await scopeRead(tool, { brand_id: BRAND }, facts({ range: '7d' }))).toMatchObject({
      input: { days: 7 },
    });
  });

  it("gives the period reads the person's range, and holds the Overview's to the plan's platforms", async () => {
    const map = chatTool('get_topics_vs_competitors')!;
    const scoped = await scopeRead(
      map,
      { brand_id: BRAND },
      facts({
        range: '30d',
        limits: PLANS.starter.limits,
        planName: 'Starter',
        modelsOf: async () => ['chatgpt-web', 'perplexity-web'],
      }),
    );
    expect(scoped).toMatchObject({
      kind: 'read',
      input: { date_from: '2026-10-18', date_to: '2026-11-16', model: 'chatgpt-web' },
    });
    // Citations › Gaps, as the Citations page: the person's range, the plan's platforms.
    expect(
      await scopeRead(
        chatTool('get_citation_gaps')!,
        { brand_id: BRAND },
        facts({
          range: '30d',
          limits: PLANS.starter.limits,
          planName: 'Starter',
          modelsOf: async () => ['chatgpt-web', 'perplexity-web'],
        }),
      ),
    ).toMatchObject({
      kind: 'read',
      input: { date_from: '2026-10-18', date_to: '2026-11-16', model: 'chatgpt-web' },
    });
    // Topics (on Prompts) and AI Traffic cut a preset as the last N × 24 hours, as their pages
    // do (page-periods.ts).
    for (const name of ['get_topics_overview', 'get_ai_bots', 'get_gsc_pages']) {
      expect(
        await scopeRead(chatTool(name)!, { brand_id: BRAND }, facts({ range: '7d' })),
        name,
      ).toMatchObject({
        input: { date_from: '2026-11-09T12:00:00.000Z', date_to: '2026-11-16' },
      });
    }
    // The head-to-head reads every answer: no period is set on it.
    const h2h = await scopeRead(
      chatTool('get_competitor_head_to_head')!,
      { brand_id: BRAND },
      facts(),
    );
    expect(h2h).toMatchObject({ kind: 'read', used: { dates: 'none' } });
  });

  it('pages every list read by offset', () => {
    const paged = VISIBILITY_EXTRA_READS.filter((tool) => pagedRead(tool)).map((tool) => tool.name);
    expect(paged).toEqual([
      'get_topics_overview',
      'get_query_fanouts',
      'get_competitor_head_to_head',
      'get_topics_vs_competitors',
      'get_visibility_opportunities',
      'get_citation_gaps',
    ]);
  });
});

describe('who may read them', () => {
  const precedence = (brandAccess: 'all' | string[], plan = 'starter') => ({
    organizationId: 'org-1',
    role: 'analyst' as const,
    plan: planFactsFromOrgRow({ plan, subscription_status: 'active' }),
    settings: DEFAULT_CHAT_SETTINGS,
    mode: 'auto' as const,
    surface: 'chat' as const,
    autoChoices: new Set<string>(),
    brandAccess,
    injectionDetected: false,
  });
  const call = { brandId: BRAND, brandIsDemo: false, tainted: false };

  it('lets every plan read them (the bot report decides at run time, as its page)', () => {
    for (const tool of VISIBILITY_EXTRA_READS) {
      expect(decideToolCall(tool, precedence('all'), call), tool.name).toEqual({
        kind: 'run',
        via: 'read',
      });
    }
  });

  it("refuses them for a brand that isn't shared with the person", () => {
    for (const tool of VISIBILITY_EXTRA_READS) {
      expect(decideToolCall(tool, precedence(['another-brand']), call), tool.name).toMatchObject({
        kind: 'deny',
        denial: { code: 'brand_scope' },
      });
    }
  });
});
