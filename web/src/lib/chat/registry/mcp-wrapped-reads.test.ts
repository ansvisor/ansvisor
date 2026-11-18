// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { TeamRole } from '@/components/providers/role-provider';
import { pageExists } from '@/lib/app-pages';

/**
 * The reads Chat takes from the Ansvisor MCP Server (the owner's plan of
 * 2026-11-16, step 6a): each calls the MCP tool's own data function with
 * what it was asked, keeps its plan gate, its role rule and its brand
 * scope, and gives a list a page at a time, as every list read does.
 */

const fns = vi.hoisted(() => ({
  getActionScorecardFor: vi.fn(),
  listTaskReviewsFor: vi.fn(),
  getPromptLocationsFor: vi.fn(),
  getPromptUsageFor: vi.fn(),
  listTopicSuggestionsFor: vi.fn(),
  getShoppingShelfFor: vi.fn(),
  getShoppingReadinessFor: vi.fn(),
  getProductAiSaysFor: vi.fn(),
  listShoppingCards: vi.fn(),
  listCatalogProductsFor: vi.fn(),
  getCatalogSourcesFor: vi.fn(),
  getContentPlanFor: vi.fn(),
  getContentOpportunityFor: vi.fn(),
  getContentImpactFor: vi.fn(),
  getContentSourcesFor: vi.fn(),
  getReportFor: vi.fn(),
  getSiteAuditQuotaFor: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { rpc: vi.fn() } }));
vi.mock('@/lib/mcp/learning', () => ({ getActionScorecardFor: fns.getActionScorecardFor }));
vi.mock('@/lib/mcp/task-reviews', () => ({ listTaskReviewsFor: fns.listTaskReviewsFor }));
vi.mock('@/lib/mcp/prompt-locations', () => ({ getPromptLocationsFor: fns.getPromptLocationsFor }));
vi.mock('@/lib/mcp/content-plan', () => ({ getContentPlanFor: fns.getContentPlanFor }));
vi.mock('@/lib/mcp/catalog', () => ({
  getCatalogSourcesFor: fns.getCatalogSourcesFor,
  listCatalogProductsFor: fns.listCatalogProductsFor,
}));
vi.mock('@/lib/mcp/product-visibility', () => ({
  getShoppingShelfFor: fns.getShoppingShelfFor,
  getShoppingReadinessFor: fns.getShoppingReadinessFor,
  getProductAiSaysFor: fns.getProductAiSaysFor,
}));
vi.mock('@/lib/mcp/content', () => ({
  getContentImpactFor: fns.getContentImpactFor,
  getContentSourcesFor: fns.getContentSourcesFor,
}));
vi.mock('@/lib/mcp/data', () => ({
  NOT_IN_PLAN: 'not_in_plan',
  getPromptUsageFor: fns.getPromptUsageFor,
  listTopicSuggestionsFor: fns.listTopicSuggestionsFor,
  listShoppingCards: fns.listShoppingCards,
  getContentOpportunityFor: fns.getContentOpportunityFor,
  getReportFor: fns.getReportFor,
  getSiteAuditQuotaFor: fns.getSiteAuditQuotaFor,
}));

const { MCP_ONLY_READS, MCP_WRAPPED_READS, SHOPPING_CARDS_PAGE, TASK_REVIEWS_READ } =
  await import('./mcp-wrapped-reads');
const { FIXTURE_IDS } = await import('./define-tool');
const { DEFAULT_CHAT_SETTINGS, decideToolCall } = await import('../precedence');
const { planFactsFromOrgRow } = await import('../plan-facts');
const { isUntrustedRead, taintsRun } = await import('../untrusted');
const { scopeRead, pagedRead } = await import('../scope');
const { FALLBACK_RANGE, rangeWindow } = await import('../range');
const { rollingWindow } = await import('../page-periods');

const ctx = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'agent-internal',
  brandAccess: 'all' as const,
  role: 'admin' as const,
};
const { brand: BRAND, item: ITEM } = FIXTURE_IDS;
const row = (name: string) => {
  const tool = MCP_WRAPPED_READS.find((t) => t.name === name);
  if (!tool) throw new Error(`no row ${name}`);
  return tool;
};
const run = (name: string, input: Record<string, unknown>) => {
  const tool = row(name);
  return tool.run(ctx, tool.inputSchema.parse(input) as never);
};
const labels = (messages as Record<string, unknown>).chatTools as Record<
  string,
  { name?: string; step?: string }
>;

/** Each row, the MCP tool it is, and the page its description names, as the page calls it. */
const ROWS: [name: string, mcpTool: string, page: string][] = [
  ['get_action_scorecard', 'get_action_scorecard', 'History'],
  ['list_task_reviews', 'list_task_reviews', 'Review page'],
  ['get_prompt_locations', 'get_prompt_locations', 'Locations view'],
  ['get_prompt_usage', 'get_prompt_usage', 'usage cards'],
  ['list_topic_suggestions', 'list_topic_suggestions', 'Prompts › Topics'],
  ['get_shopping_shelf', 'get_shopping_shelf', 'Shelf'],
  ['get_shopping_readiness', 'get_shopping_readiness', 'Readiness tab'],
  ['get_product_ai_says', 'get_product_ai_says', 'product page'],
  ['list_shopping_cards', 'list_shopping_cards', 'Product Visibility'],
  ['list_catalog_products', 'list_catalog_products', 'Products tab'],
  ['get_catalog_sources', 'get_catalog_sources', 'Settings › Integrations › Catalog'],
  ['get_content_plan', 'get_content_plan', 'Content › Plan'],
  ['get_content_opportunity', 'get_content_opportunity', 'Content › Opportunities'],
  ['get_content_impact', 'get_content_impact', 'Live page tab'],
  ['get_content_sources', 'get_content_sources', 'Sources tab'],
  ['get_report', 'get_report', 'Reports'],
  ['get_site_audit_quota', 'get_site_audit_quota', 'Site Audit'],
];

beforeEach(() => {
  for (const fn of Object.values(fns)) fn.mockReset();
});

describe("the MCP Server's reads in Chat", () => {
  it('are all here, each a read of its MCP tool, labelled and pointing at its page', () => {
    expect(MCP_WRAPPED_READS.map((t) => t.name).sort()).toEqual(ROWS.map(([name]) => name).sort());
    for (const [name, mcpTool, page] of ROWS) {
      const tool = row(name);
      expect(tool.class, name).toBe('read');
      expect(tool.mcpTool, name).toBe(mcpTool);
      expect(tool.description, name).toContain(page);
      expect(labels[tool.labelKey]?.name, name).toBeTruthy();
      expect(labels[tool.labelKey]?.step, name).toBeTruthy();
      expect(tool.route && pageExists(tool.route), name).toBe(true);
      expect(tool.inputSchema.safeParse(tool.fixture.input).success, name).toBe(true);
    }
    // What only MCP reads is none of these.
    for (const name of Object.keys(MCP_ONLY_READS)) {
      expect(MCP_WRAPPED_READS.some((t) => t.mcpTool === name)).toBe(false);
    }
  });

  it("reads the workspace's own numbers as app data, and anything with outside text as untrusted", () => {
    const trusted = [
      'get_action_scorecard',
      'get_prompt_usage',
      'get_site_audit_quota',
      'get_prompt_locations',
    ];
    for (const [name] of ROWS) {
      expect(isUntrustedRead(name), name).toBe(!trusted.includes(name));
    }
    // AI answers, product and page titles, report and draft text, AI-written tasks: they taint.
    for (const name of [
      'get_report',
      'get_product_ai_says',
      'list_task_reviews',
      'get_content_sources',
      'list_catalog_products',
    ]) {
      expect(taintsRun(name), name).toBe(true);
    }
  });

  it('finds the brand of a row a read names by its id, as the other reads do', () => {
    expect(row('get_report').brandOf).toEqual({ lookup: 'reports', idField: 'report_id' });
    expect(row('get_content_opportunity').brandOf).toEqual({
      lookup: 'content_opportunities',
      idField: 'opportunity_id',
    });
    expect(row('get_content_impact').brandOf).toEqual({
      lookup: 'content_drafts',
      idField: 'draft_id',
    });
    expect(row('get_content_sources').brandOf).toEqual({
      lookup: 'content_drafts',
      idField: 'draft_id',
    });
    // The month's audits are the workspace's, about no brand.
    expect(row('get_site_audit_quota').brandOf).toBeNull();
  });
});

describe('who may read them, on which plan, and which brand', () => {
  const facts = (plan: string) => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    try {
      return planFactsFromOrgRow({ plan, subscription_status: 'active' });
    } finally {
      vi.unstubAllEnvs();
    }
  };
  const decide = (
    name: string,
    opts: { role?: TeamRole; plan?: string; brandAccess?: 'all' | string[] } = {},
  ) =>
    decideToolCall(
      row(name),
      {
        organizationId: 'org-1',
        role: opts.role ?? 'admin',
        plan: facts(opts.plan ?? 'growth'),
        settings: DEFAULT_CHAT_SETTINGS,
        mode: 'full_auto',
        surface: 'chat',
        autoChoices: new Set(),
        brandAccess: opts.brandAccess ?? 'all',
        injectionDetected: false,
      },
      { brandId: row(name).brandOf ? BRAND : null, brandIsDemo: false, tainted: false },
    );
  const shopping = [
    'get_shopping_shelf',
    'get_shopping_readiness',
    'get_product_ai_says',
    'list_shopping_cards',
  ];

  it('keeps Product Visibility to the plans with it, as the page and MCP do', () => {
    for (const name of shopping) {
      expect(decide(name, { plan: 'starter' }), name).toEqual({
        kind: 'deny',
        denial: { code: 'plan_locked', needs: 'growth' },
      });
      expect(decide(name), name).toEqual({ kind: 'run', via: 'read' });
    }
    // The catalog is read on every plan, as MCP's: its analytics come with Product Visibility.
    for (const name of ['list_catalog_products', 'get_catalog_sources']) {
      expect(decide(name, { plan: 'starter' }), name).toEqual({ kind: 'run', via: 'read' });
    }
  });

  it('keeps tasks waiting for review to Admins and Managers, as MCP and the Review page', () => {
    for (const role of ['analyst', 'agency_partner'] as const) {
      expect(decide('list_task_reviews', { role })).toEqual({
        kind: 'deny',
        denial: { code: 'forbidden_role', role, roles: ['admin', 'manager'] },
      });
    }
    expect(decide('list_task_reviews', { role: 'manager' })).toEqual({ kind: 'run', via: 'read' });
    // Every other one is every role's.
    for (const [name] of ROWS.filter(([n]) => n !== 'list_task_reviews')) {
      expect(decide(name, { role: 'agency_partner' }), name).toEqual({ kind: 'run', via: 'read' });
    }
  });

  it("refuses a brand that wasn't shared with the person", () => {
    for (const [name] of ROWS) {
      if (!row(name).brandOf) continue;
      expect(decide(name, { brandAccess: ['another-brand'] }), name).toEqual({
        kind: 'deny',
        denial: { code: 'brand_scope' },
      });
    }
  });

  it("answers another workspace's brand, or one the person can't use, as not found", async () => {
    // Each MCP function finds the brand in the person's workspace first (brandAllowed): null.
    for (const fn of Object.values(fns)) fn.mockResolvedValue(null);
    for (const [name] of ROWS) {
      expect(await run(name, row(name).fixture.input as Record<string, unknown>), name).toBeNull();
    }
  });
});

describe('what each read asks its MCP function', () => {
  it('reads the scorecard since the period the app set, or all of it', async () => {
    fns.getActionScorecardFor.mockResolvedValue([]);
    await run('get_action_scorecard', { brand_id: BRAND, date_from: '2026-10-18' });
    await run('get_action_scorecard', { brand_id: BRAND });
    expect(fns.getActionScorecardFor.mock.calls).toEqual([
      [ctx, { brandId: BRAND, since: '2026-10-18' }],
      [ctx, { brandId: BRAND, since: undefined }],
    ]);
  });

  it('reads Product Visibility over the days the app set, as the page reads its window', async () => {
    fns.getShoppingReadinessFor.mockResolvedValue({ score: 80 });
    fns.getProductAiSaysFor.mockResolvedValue({ answers: 2 });
    await run('get_shopping_readiness', { brand_id: BRAND, days: 90, market: 'europe' });
    await run('get_product_ai_says', { brand_id: BRAND, product_id: ITEM, days: 7 });
    await run('get_product_ai_says', { brand_id: BRAND, product_id: ITEM });
    expect(fns.getShoppingReadinessFor).toHaveBeenCalledWith(ctx, {
      brandId: BRAND,
      period: '90d',
      market: 'europe',
    });
    expect(fns.getProductAiSaysFor.mock.calls).toEqual([
      [ctx, { brandId: BRAND, productId: ITEM, period: '7d' }],
      [ctx, { brandId: BRAND, productId: ITEM, period: undefined }],
    ]);
  });

  it("reads a draft's live page over its days, and says when it has none", async () => {
    fns.getContentImpactFor
      .mockResolvedValueOnce({ citations: 4 })
      .mockResolvedValueOnce('no_page');
    expect(await run('get_content_impact', { draft_id: ITEM, days: 90 })).toEqual({ citations: 4 });
    expect(await run('get_content_impact', { draft_id: ITEM })).toMatchObject({ code: 'no_page' });
    expect(fns.getContentImpactFor.mock.calls).toEqual([
      [ctx, ITEM, 90],
      [ctx, ITEM, 30],
    ]);
  });

  it('reads the rest as MCP does, with the same ids', async () => {
    for (const fn of Object.values(fns)) fn.mockResolvedValue({ ok: true });
    expect(await run('get_prompt_usage', { brand_id: BRAND })).toEqual({ ok: true });
    expect(await run('get_catalog_sources', { brand_id: BRAND })).toEqual({ ok: true });
    expect(await run('get_content_opportunity', { opportunity_id: ITEM })).toEqual({ ok: true });
    expect(await run('get_site_audit_quota', {})).toEqual({ ok: true });
    expect(fns.getPromptUsageFor).toHaveBeenCalledWith(ctx, BRAND);
    expect(fns.getCatalogSourcesFor).toHaveBeenCalledWith(ctx, BRAND);
    expect(fns.getContentOpportunityFor).toHaveBeenCalledWith(ctx, ITEM);
    expect(fns.getSiteAuditQuotaFor).toHaveBeenCalledWith(ctx);
  });

  it("gives a report's sections at the top, so a long one is cut alone", async () => {
    const report = {
      id: ITEM,
      brand_id: BRAND,
      title: 'Monthly',
      template: 'executive_summary',
      date_from: '2026-10-01',
      date_to: '2026-10-31',
      created_at: '2026-11-01T00:00:00Z',
      payload: { summaryText: 'Up 4 points.', visibilityTrend: [{ date: '2026-10-01' }] },
    };
    fns.getReportFor.mockResolvedValue(report);
    expect(await run('get_report', { report_id: ITEM })).toEqual({
      id: ITEM,
      brand_id: BRAND,
      title: 'Monthly',
      template: 'executive_summary',
      date_from: '2026-10-01',
      date_to: '2026-10-31',
      created_at: '2026-11-01T00:00:00Z',
      summaryText: 'Up 4 points.',
      visibilityTrend: [{ date: '2026-10-01' }],
    });
    expect(fns.getReportFor).toHaveBeenCalledWith(ctx, ITEM);
  });

  it("gives a draft's sources each list on its own, with the person's choices", async () => {
    fns.getContentSourcesFor.mockResolvedValue({
      sources: { prompts: [{ id: 'p1' }], fanouts: [], citedPages: [], gscQueries: [] },
      choices: [{ kind: 'prompt', ref: 'p1', included: false }],
    });
    expect(await run('get_content_sources', { draft_id: ITEM })).toEqual({
      prompts: [{ id: 'p1' }],
      fanouts: [],
      citedPages: [],
      gscQueries: [],
      choices: [{ kind: 'prompt', ref: 'p1', included: false }],
    });
  });
});

describe('the lists, a page at a time', () => {
  it('pages the tasks waiting for review, reading as many as MCP may', async () => {
    const reviews = Array.from({ length: 70 }, (_, i) => ({ id: `r${i}` }));
    fns.listTaskReviewsFor.mockResolvedValue(reviews);
    expect(await run('list_task_reviews', { brand_id: BRAND, offset: 50 })).toEqual({
      total: 70,
      offset: 50,
      next_offset: null,
      note: 'Showing 51–70 of 70 tasks waiting for review, oldest first. This is the last page.',
      reviews: reviews.slice(50),
    });
    expect(fns.listTaskReviewsFor).toHaveBeenCalledWith(ctx, {
      brandId: BRAND,
      limit: TASK_REVIEWS_READ,
    });
  });

  it('pages the topic suggestions', async () => {
    const suggestions = Array.from({ length: 3 }, (_, i) => ({ id: `s${i}`, name: `T${i}` }));
    fns.listTopicSuggestionsFor.mockResolvedValue(suggestions);
    expect(await run('list_topic_suggestions', { brand_id: BRAND, limit: 2 })).toMatchObject({
      total: 3,
      offset: 0,
      next_offset: 2,
      suggestions: suggestions.slice(0, 2),
    });
  });

  it("pages the Content plan's list, with every card's count beside it", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ key: `k${i}` }));
    fns.getContentPlanFor.mockResolvedValue({
      days: 90,
      counts: { create: 120, optimize: 4, protect: 2, priority: 1 },
      hidden: 3,
      tracked_since: null,
      previous_from: null,
      rows,
    });
    const page = await run('get_content_plan', {
      brand_id: BRAND,
      days: 90,
      card: 'create',
      limit: 20,
      offset: 20,
    });
    expect(page).toMatchObject({
      days: 90,
      counts: { create: 120 },
      hidden: 3,
      total: 50,
      offset: 20,
      next_offset: 40,
      rows: rows.slice(20, 40),
    });
    expect(fns.getContentPlanFor).toHaveBeenCalledWith(ctx, {
      brandId: BRAND,
      days: 90,
      card: 'create',
    });
  });

  it('pages the shelves, the catalog and the prompts by location as their MCP functions count them', async () => {
    fns.getShoppingShelfFor.mockResolvedValue({
      period: '30d',
      stats: { slots: 9 },
      total: 12,
      shelves: Array.from({ length: 10 }, (_, i) => ({ prompt_id: `p${i}` })),
      next_offset: 10,
    });
    expect(
      await run('get_shopping_shelf', { brand_id: BRAND, days: 30, limit: 10, absent_only: true }),
    ).toMatchObject({
      total: 12,
      offset: 0,
      next_offset: 10,
      note: expect.stringContaining('Showing 1–10 of 12 shelves'),
      stats: { slots: 9 },
    });
    expect(fns.getShoppingShelfFor).toHaveBeenCalledWith(ctx, {
      brandId: BRAND,
      period: '30d',
      platform: undefined,
      market: undefined,
      absentOnly: true,
      limit: 10,
      offset: 0,
    });

    fns.listCatalogProductsFor.mockResolvedValue({
      total: 51,
      products: [{ id: 'x', title: 'Trail Runner 2' }],
      next_offset: null,
    });
    expect(
      await run('list_catalog_products', { brand_id: BRAND, search: 'runner', offset: 50 }),
    ).toMatchObject({ total: 51, offset: 50, next_offset: null, products: [{ id: 'x' }] });
    expect(fns.listCatalogProductsFor).toHaveBeenCalledWith(ctx, {
      brandId: BRAND,
      search: 'runner',
      limit: 50,
      offset: 50,
    });

    fns.getPromptLocationsFor.mockResolvedValue({
      window: { from: '2026-10-18', to: null },
      locations: [{ code: 'US', name: 'United States' }],
      ignored_locations: ['XX'],
      averages: { visibility: [40] },
      insights: { overall: 40 },
      total: 60,
      prompts: Array.from({ length: 50 }, (_, i) => ({ id: `p${i}` })),
      next_offset: 50,
    });
    const view = (await run('get_prompt_locations', {
      brand_id: BRAND,
      locations: ['us', 'XX'],
      date_from: '2026-10-18',
      date_to: '2026-11-17',
    })) as Record<string, unknown>;
    // The prompts are the page; the compared locations stay whole beside it.
    expect(view).toMatchObject({
      total: 60,
      offset: 0,
      next_offset: 50,
      window: { from: '2026-10-18', to: null },
      insights: { overall: 40 },
      compared: {
        locations: [{ code: 'US', name: 'United States' }],
        ignored_locations: ['XX'],
        averages: { visibility: [40] },
      },
    });
    expect(Object.keys(view).filter((key) => Array.isArray(view[key]))).toEqual(['prompts']);
    expect(fns.getPromptLocationsFor).toHaveBeenCalledWith(ctx, {
      brandId: BRAND,
      locations: ['us', 'XX'],
      from: '2026-10-18',
      to: '2026-11-17',
      limit: 50,
      offset: 0,
    });
  });

  it('reads the shopping cards a fixed page at a time by their cursor, compact', async () => {
    const card = {
      id: 'c1',
      prompt_result_id: 'r1',
      brand_id: BRAND,
      position: 1,
      product_title: 'Trail Runner 2',
      product_brand: 'Acme',
      price_amount: 120,
      price_currency: 'USD',
      image_url: 'https://cdn.example/a.png',
      merchant_url: 'https://shop.example/a',
      merchant_domain: 'shop.example',
      rating: 4.5,
      review_count: 10,
      raw: { long: 'x'.repeat(5000) },
      matched_brand_id: BRAND,
      matched_brand_role: 'own',
      platform: 'chatgpt-shopping',
      region: 'US',
      created_at: '2026-11-16T00:00:00Z',
    };
    fns.listShoppingCards.mockResolvedValue({ cards: [card], next_cursor: 'abc' });
    const page = await run('list_shopping_cards', {
      brand_id: BRAND,
      role: 'own',
      cursor: 'xyz',
    });
    expect(page).toEqual({
      note: expect.stringContaining('Read the next page with cursor next_cursor'),
      next_cursor: 'abc',
      cards: [
        {
          position: 1,
          product_title: 'Trail Runner 2',
          product_brand: 'Acme',
          price_amount: 120,
          price_currency: 'USD',
          merchant_domain: 'shop.example',
          merchant_url: 'https://shop.example/a',
          rating: 4.5,
          review_count: 10,
          matched_brand_role: 'own',
          platform: 'chatgpt-shopping',
          region: 'US',
          created_at: '2026-11-16T00:00:00Z',
          prompt_result_id: 'r1',
        },
      ],
    });
    expect(fns.listShoppingCards).toHaveBeenCalledWith(ctx, {
      brandId: BRAND,
      role: 'own',
      platform: undefined,
      region: undefined,
      cursor: 'xyz',
      limit: SHOPPING_CARDS_PAGE,
    });
    fns.listShoppingCards.mockResolvedValue({ cards: [], next_cursor: null });
    expect(await run('list_shopping_cards', { brand_id: BRAND })).toMatchObject({
      note: 'No shopping cards.',
      next_cursor: null,
    });
    // The plan's refusal, if the server's check ever says so, goes through as it is.
    fns.listShoppingCards.mockResolvedValue('not_in_plan');
    expect(await run('list_shopping_cards', { brand_id: BRAND })).toBe('not_in_plan');
  });
});

describe("the app's scope on them", () => {
  const now = new Date('2026-11-17T12:00:00Z');
  const facts = { question: 'how are we doing?', limits: null, planName: 'Growth', now };
  const scoped = async (name: string, input: Record<string, unknown>) => {
    const read = await scopeRead(row(name), input, facts);
    if (read.kind !== 'read') throw new Error(read.kind);
    return read.input;
  };

  it("takes the run's period as each read's own dates or days", async () => {
    // The app's 30 days, as its pages cut them; a start only, as MCP's scorecard takes it.
    const window = rangeWindow(FALLBACK_RANGE, now);
    const scorecard = await scoped('get_action_scorecard', { brand_id: BRAND });
    expect(scorecard.date_from).toBe(window.dateFrom);
    expect('date_to' in scorecard).toBe(false);
    // Prompts › Tracked's Locations view: a preset as the Prompts page reads it, the last
    // N × 24 hours up to now (page-periods.ts rollingWindow), as Chat's other Prompts reads.
    const prompts = rollingWindow('/dashboard/prompts/tracked', FALLBACK_RANGE, now)!;
    expect(prompts.dateFrom).toBe('2026-10-18T12:00:00.000Z');
    expect(await scoped('get_prompt_locations', { brand_id: BRAND })).toMatchObject({
      date_from: prompts.dateFrom,
      date_to: prompts.dateTo,
    });
    for (const name of ['get_content_plan', 'get_content_impact', 'get_shopping_shelf']) {
      const input = name === 'get_content_impact' ? { draft_id: ITEM } : { brand_id: BRAND };
      expect((await scoped(name, input)).days, name).toBe(30);
    }
  });

  it('pages each list by its offset, but the shopping cards, which go by their cursor', async () => {
    for (const name of [
      'list_task_reviews',
      'list_topic_suggestions',
      'get_shopping_shelf',
      'list_catalog_products',
      'get_prompt_locations',
      'get_content_plan',
    ]) {
      expect(pagedRead(row(name)), name).toBe(true);
      expect((await scoped(name, { brand_id: BRAND })).limit, name).toBe(50);
    }
    expect(pagedRead(row('list_shopping_cards'))).toBe(false);
    expect('limit' in (await scoped('list_shopping_cards', { brand_id: BRAND }))).toBe(false);
  });
});
