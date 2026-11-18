// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * Brand access over MCP (BRAND-ACCESS §5.3, PR 10). A key carries its
 * owner's access, since keys belong to people: a Selected-brands person's key
 * reads a brand that wasn't shared with them, and every row of it, as another
 * organization's. It gets not found, nothing is written, and no database
 * function or internal endpoint runs. With All brands nothing changes; the
 * tools' own tests read as the organization's brands.
 */

type Row = Record<string, unknown>;

/** What a table answers, the tables read, and the writes and functions asked for. */
const db = vi.hoisted(() => ({
  rows: {} as Record<string, Row | null>,
  lists: {} as Record<string, Row[]>,
  reads: [] as string[],
  writes: [] as unknown[][],
  rpcs: [] as string[],
}));

vi.mock('@/lib/supabase/admin', () => {
  const from = (table: string) => {
    db.reads.push(table);
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const name of [
      'select',
      'eq',
      'in',
      'is',
      'or',
      'order',
      'limit',
      'range',
      'gte',
      'lte',
    ]) {
      chain[name] = self;
    }
    chain.update = (value: unknown) => (db.writes.push([table, 'update', value]), chain);
    chain.insert = (value: unknown) => (db.writes.push([table, 'insert', value]), chain);
    chain.delete = () => (db.writes.push([table, 'delete']), chain);
    chain.maybeSingle = async () => ({ data: db.rows[table] ?? null, error: null });
    chain.single = async () => ({ data: db.rows[table] ?? null, error: null });
    chain.then = (resolve: (value: unknown) => void) =>
      resolve({ data: db.lists[table] ?? [], error: null, count: 0 });
    return chain;
  };
  const rpc = async (fn: string) => (db.rpcs.push(fn), { data: null, error: null });
  return { supabaseAdmin: { from, rpc } };
});

const data = await import('./data');
const mentions = await import('./mentions');
const content = await import('./content');
const taskReviews = await import('./task-reviews');
const { listSignalsPageFor, lookUpSignalsFor } = await import('./signal-page');
const { exportActionFor } = await import('./action-export');
const { getContentDraftPackageFor } = await import('./content-package');
const { getContentPlanFor } = await import('./content-plan');
const extra = await import('./visibility-extra-reads');
const { explainChangeFor } = await import('./why');
const { createMcpServer } = await import('./server');
const { listActionsByCodeFor, listActionsPageFor } = await import('./action-center-reads');
const today = await import('./today-reads');
const { listAgentRunsFor } = await import('./agent-reads');
const { getActionScorecardFor } = await import('./learning');
const { getCatalogSourcesFor, listCatalogProductsFor } = await import('./catalog');
const productVisibility = await import('./product-visibility');
const { getPromptLocationsFor } = await import('./prompt-locations');
const aiConversions = await import('./ai-conversions');
const { getTrackingSetupFor } = await import('./tracking-setup');

const ALL: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  role: 'manager',
  apiKeyId: 'key-1',
  brandAccess: 'all',
};
/** A Selected-brands Manager's key: b2 was shared with them, b1 wasn't. */
const SELECTED: McpAuthContext = { ...ALL, brandAccess: ['b2'] };

const fetchSpy = vi.spyOn(globalThis, 'fetch');

beforeEach(() => {
  // b1 is the organization's: found by id and organization, as every tool reads it.
  db.rows = { brands: { id: 'b1', name: 'Acme', brand_domains: [] } };
  db.lists = {};
  db.reads = [];
  db.writes = [];
  db.rpcs = [];
  fetchSpy.mockReset();
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
});

describe('brandAllowed', () => {
  it('lets in a brand of the organization that the access reaches', async () => {
    expect(await data.brandAllowed(ALL, 'b1')).toBe(true);
    expect(await data.brandAllowed({ ...SELECTED, brandAccess: ['b1'] }, 'b1')).toBe(true);
  });

  it("refuses one that wasn't shared, or that isn't the organization's", async () => {
    expect(await data.brandAllowed(SELECTED, 'b1')).toBe(false);
    db.rows.brands = null;
    expect(await data.brandAllowed(ALL, 'b9')).toBe(false);
    expect(await data.brandAllowed({ ...ALL, organizationId: null }, 'b1')).toBe(false);
    // Someone no longer in the workspace reaches none.
    db.rows.brands = { id: 'b1' };
    expect(await data.brandAllowed({ ...ALL, brandAccess: null }, 'b1')).toBe(false);
  });
});

describe('mayUseBrand', () => {
  it('reaches every brand with All brands, the shared ones otherwise', async () => {
    expect(await data.mayUseBrand(ALL, 'b1')).toBe(true);
    expect(await data.mayUseBrand(ALL, undefined)).toBe(true);
    expect(await data.mayUseBrand(SELECTED, 'b2')).toBe(true);
    expect(await data.mayUseBrand(SELECTED, 'b1')).toBe(false);
    expect(await data.mayUseBrand(SELECTED, null)).toBe(false);
    expect(await data.mayUseBrand({ ...ALL, brandAccess: null }, 'b1')).toBe(false);
  });
});

describe("a Selected-brands key on a brand that wasn't shared", () => {
  const byBrand: [string, () => Promise<unknown>][] = [
    ['getVisibilitySummaryFor', () => data.getVisibilitySummaryFor(SELECTED, { brandId: 'b1' })],
    ['listTopicsFor', () => data.listTopicsFor(SELECTED, 'b1')],
    ['listTopicSuggestionsFor', () => data.listTopicSuggestionsFor(SELECTED, 'b1')],
    ['listPromptSuggestionsFor', () => data.listPromptSuggestionsFor(SELECTED, 'b1')],
    ['listPromptsFor', () => data.listPromptsFor(SELECTED, { brandId: 'b1' })],
    [
      'listContentOpportunitiesFor',
      () => data.listContentOpportunitiesFor(SELECTED, { brandId: 'b1' }),
    ],
    ['listSiteAuditsFor', () => data.listSiteAuditsFor(SELECTED, 'b1')],
    ['getPromptUsageFor', () => data.getPromptUsageFor(SELECTED, 'b1')],
    ['runSiteAuditFor', () => data.runSiteAuditFor(SELECTED, 'b1', 'https://acme.example/')],
    [
      'getCompetitorComparisonFor',
      () => data.getCompetitorComparisonFor(SELECTED, { brandId: 'b1' }),
    ],
    ['listCitationsFor', () => data.listCitationsFor(SELECTED, { brandId: 'b1' })],
    ['getVisibilityTrendFor', () => data.getVisibilityTrendFor(SELECTED, { brandId: 'b1' })],
    ['getAiTrafficFor', () => data.getAiTrafficFor(SELECTED, { brandId: 'b1' })],
    ['getPromptVolumesFor', () => data.getPromptVolumesFor(SELECTED, { brandId: 'b1' })],
    ['listShoppingCards', () => data.listShoppingCards(SELECTED, { brandId: 'b1' })],
    [
      'getProductVisibility',
      () => data.getProductVisibility(SELECTED, { brandId: 'b1', productTitle: 'Beans' }),
    ],
    ['getPromptPerformanceFor', () => data.getPromptPerformanceFor(SELECTED, { brandId: 'b1' })],
    ['listActionsFor', () => data.listActionsFor(SELECTED, { brandId: 'b1' })],
    // Chat's page of actions (list_action_center_tasks).
    ['listActionsPageFor', () => listActionsPageFor(SELECTED, { brandId: 'b1' })],
    // Chat's read of actions by their codes (list_action_center_tasks' codes).
    [
      'listActionsByCodeFor',
      () => listActionsByCodeFor(SELECTED, { brandId: 'b1', codes: ['AC-481'] }),
    ],
    ['listSignalsFor', () => data.listSignalsFor(SELECTED, { brandId: 'b1' })],
    ['listActionHistoryFor', () => data.listActionHistoryFor(SELECTED, { brandId: 'b1' })],
    ['listCompetitorsFor', () => data.listCompetitorsFor(SELECTED, 'b1')],
    ['listReportsFor', () => data.listReportsFor(SELECTED, 'b1')],
    ['getMentionsSummaryFor', () => mentions.getMentionsSummaryFor(SELECTED, { brandId: 'b1' })],
    // What Visibility, Prompts, Competitors and AI Traffic show (visibility-extra-reads.ts).
    ['getTopicsOverviewFor', () => extra.getTopicsOverviewFor(SELECTED, { brandId: 'b1' })],
    ['getQueryFanoutsFor', () => extra.getQueryFanoutsFor(SELECTED, { brandId: 'b1' })],
    [
      'getCompetitorHeadToHeadFor',
      () => extra.getCompetitorHeadToHeadFor(SELECTED, { brandId: 'b1', competitor: 'Acme' }),
    ],
    ['getTopicCompetitorMapFor', () => extra.getTopicCompetitorMapFor(SELECTED, { brandId: 'b1' })],
    [
      'getVisibilityOpportunitiesFor',
      () => extra.getVisibilityOpportunitiesFor(SELECTED, { brandId: 'b1' }),
    ],
    ['getAiBotsFor', () => extra.getAiBotsFor(SELECTED, { brandId: 'b1' })],
    ['getGscPagesFor', () => extra.getGscPagesFor(SELECTED, { brandId: 'b1' })],
    // Citations › Gaps, on functions that let the service role through (00541).
    [
      'getCitationGapsFor',
      () =>
        extra.getCitationGapsFor(SELECTED, {
          brandId: 'b1',
          topicId: 't1',
          competitorId: 'c1',
        }),
    ],
    ['listContentDraftsFor', () => content.listContentDraftsFor(SELECTED, 'b1')],
    ['getContentPlanFor', () => getContentPlanFor(SELECTED, { brandId: 'b1', days: 30 })],
    [
      'explainChangeFor',
      () => explainChangeFor(SELECTED, { brandId: 'b1', metric: 'mention_rate' }),
    ],
    ['listTaskReviewsFor', () => taskReviews.listTaskReviewsFor(SELECTED, { brandId: 'b1' })],
    // The MCP reads Chat wraps too (chat/registry/mcp-wrapped-reads.ts).
    ['getActionScorecardFor', () => getActionScorecardFor(SELECTED, { brandId: 'b1' })],
    ['getCatalogSourcesFor', () => getCatalogSourcesFor(SELECTED, 'b1')],
    ['listCatalogProductsFor', () => listCatalogProductsFor(SELECTED, { brandId: 'b1' })],
    [
      'getShoppingShelfFor',
      () => productVisibility.getShoppingShelfFor(SELECTED, { brandId: 'b1' }),
    ],
    [
      'getShoppingReadinessFor',
      () => productVisibility.getShoppingReadinessFor(SELECTED, { brandId: 'b1' }),
    ],
    [
      'getProductAiSaysFor',
      () => productVisibility.getProductAiSaysFor(SELECTED, { brandId: 'b1', productId: 'p1' }),
    ],
    ['getPromptLocationsFor', () => getPromptLocationsFor(SELECTED, { brandId: 'b1' })],
    // Chat's list reads, a page at a time.
    ['listSignalsPageFor', () => listSignalsPageFor(SELECTED, { brandId: 'b1', offset: 50 })],
    ['actionHistoryPageFor', () => data.actionHistoryPageFor(SELECTED, { brandId: 'b1' })],
    // Today, History, the Signals summary and an agent's runs, from their pages' reads (plan 6b).
    ['getTodayFor', () => today.getTodayFor(SELECTED, { brandId: 'b1' })],
    ['historyPageFor', () => today.historyPageFor(SELECTED, { brandId: 'b1', offset: 50 })],
    ['getSignalsSummaryFor', () => today.getSignalsSummaryFor(SELECTED, { brandId: 'b1' })],
    [
      'listAgentRunsFor',
      () =>
        listAgentRunsFor(SELECTED, {
          brandId: 'b1',
          agentId: 'a6000000-0000-4000-8000-000000000001',
        }),
    ],
    [
      'contentOpportunitiesPageFor',
      () => data.contentOpportunitiesPageFor(SELECTED, { brandId: 'b1', offset: 50 }),
    ],
    ['promptsPageFor', () => data.promptsPageFor(SELECTED, { brandId: 'b1', offset: 50 })],
    ['promptVolumesPageFor', () => data.promptVolumesPageFor(SELECTED, { brandId: 'b1' })],
    ['reportsPageFor', () => data.reportsPageFor(SELECTED, 'b1', 50, 50)],
    ['siteAuditsPageFor', () => data.siteAuditsPageFor(SELECTED, 'b1', { offset: 50 })],
    ['contentDraftsPageFor', () => content.contentDraftsPageFor(SELECTED, 'b1', undefined, {})],
    [
      'listMentionsFor (a page by offset)',
      () => mentions.listMentionsFor(SELECTED, { brandId: 'b1', offset: 50, limit: 50 }),
    ],
    // Customers and revenue from AI visits.
    ['getTrackingSetupFor', () => getTrackingSetupFor(SELECTED, { brandId: 'b1' })],
    ['getAiConversionsFor', () => aiConversions.getAiConversionsFor(SELECTED, { brandId: 'b1' })],
    [
      'getAiConvertingPagesFor',
      () => aiConversions.getAiConvertingPagesFor(SELECTED, { brandId: 'b1' }),
    ],
    ['getAiPipelineFor', () => aiConversions.getAiPipelineFor(SELECTED, { brandId: 'b1' })],
    ['listAiVisitsFor', () => aiConversions.listAiVisitsFor(SELECTED, { brandId: 'b1' })],
    [
      'getPromptConversionsFor',
      () => aiConversions.getPromptConversionsFor(SELECTED, { brandId: 'b1' }),
    ],
    // Chat's lookups by code, id, words, domain or address (the owner's plan, 2026-11-16).
    [
      'lookUpSignalsFor',
      () =>
        lookUpSignalsFor(SELECTED, {
          brandId: 'b1',
          codes: ['S-07'],
          ids: ['5a000000-0000-4000-8000-000000000007'],
        }),
    ],
    [
      'lookUpPromptsFor',
      () =>
        data.lookUpPromptsFor(SELECTED, {
          brandId: 'b1',
          search: 'skip a month',
          ids: ['a1000000-0000-4000-8000-000000000005'],
        }),
    ],
    [
      'lookUpPromptPerformanceFor',
      () =>
        data.lookUpPromptPerformanceFor(SELECTED, {
          brandId: 'b1',
          promptIds: ['a1000000-0000-4000-8000-000000000005'],
        }),
    ],
    [
      'lookUpCitationsFor',
      () =>
        data.lookUpCitationsFor(SELECTED, {
          brandId: 'b1',
          domains: ['beanbulletin.example'],
          urls: ['https://beanbulletin.example/best'],
        }),
    ],
    [
      'lookUpOpportunitiesFor',
      () => data.lookUpOpportunitiesFor(SELECTED, { brandId: 'b1', search: 'storage guide' }),
    ],
    [
      'lookUpDraftsFor',
      () => content.lookUpDraftsFor(SELECTED, { brandId: 'b1', search: 'gift boxes' }),
    ],
    [
      'lookUpReportsFor',
      () =>
        data.lookUpReportsFor(SELECTED, {
          brandId: 'b1',
          ids: ['ae000000-0000-4000-8000-000000000001'],
        }),
    ],
  ];

  it.each(byBrand)('%s reads it as not found, reading nothing of it', async (_name, call) => {
    await expect(call()).resolves.toBeNull();
    // Only the brand itself was looked up: none of its data, no function.
    expect(new Set(db.reads)).toEqual(new Set(['brands']));
    expect(db.rpcs).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it('still reads a brand that was shared', async () => {
    db.rows.brands = { id: 'b2', name: 'Shared' };
    await expect(data.listTopicsFor(SELECTED, 'b2')).resolves.toEqual([]);
    expect(db.reads).toContain('topics');
  });
});

describe("a Selected-brands key on a row of a brand that wasn't shared", () => {
  beforeEach(() => {
    const ofB1 = { id: 'row-1', brand_id: 'b1', brands: { organization_id: 'org-1' } };
    db.rows = {
      topic_suggestions: { ...ofB1, name: 'Espresso', status: 'new' },
      prompt_suggestions: { ...ofB1, suggested_text: 'Best beans?', status: 'new' },
      content_opportunities: { ...ofB1, status: 'new' },
      site_audits: ofB1,
      actions: { ...ofB1, kind: 'content_gap', payload: {} },
      action_tasks: { id: 'task-1', action_id: 'row-1', actions: { brand_id: 'b1' } },
      action_task_reviews: {
        id: 'review-1',
        action_id: 'row-1',
        title: 'Fix the page',
        details: {},
        actions: { brand_id: 'b1' },
      },
      prompts: { id: 'prompt-1', prompt_sets: { brand_id: 'b1' } },
      reports: { ...ofB1, title: 'Monthly' },
      content_drafts: { ...ofB1, archived_at: null, brands: { name: 'Acme' } },
      prompt_results: ofB1,
    };
  });

  const byRow: [string, () => Promise<unknown>, unknown][] = [
    ['dismissTopicSuggestionFor', () => data.dismissTopicSuggestionFor(SELECTED, 'row-1'), null],
    ['acceptTopicSuggestionFor', () => data.acceptTopicSuggestionFor(SELECTED, 'row-1'), null],
    ['dismissPromptSuggestionFor', () => data.dismissPromptSuggestionFor(SELECTED, 'row-1'), null],
    ['acceptPromptSuggestionFor', () => data.acceptPromptSuggestionFor(SELECTED, 'row-1'), null],
    ['generateBriefFor', () => data.generateBriefFor(SELECTED, 'row-1'), null],
    ['getSiteAuditFor', () => data.getSiteAuditFor(SELECTED, 'row-1'), null],
    ['getContentOpportunityFor', () => data.getContentOpportunityFor(SELECTED, 'row-1'), null],
    [
      'updateOpportunityStatusFor',
      () => data.updateOpportunityStatusFor(SELECTED, 'row-1', 'reviewed'),
      null,
    ],
    ['getActionFor', () => data.getActionFor(SELECTED, 'row-1'), null],
    ['updateTaskStatusFor', () => data.updateTaskStatusFor(SELECTED, 'task-1', 'completed'), null],
    [
      'createImproveActionFor',
      () =>
        data.createImproveActionFor(SELECTED, {
          promptId: 'prompt-1',
          range: { preset: '7d', from: '2026-10-25' },
          idempotencyKey: 'k-1',
          suggestions: [],
        }),
      null,
    ],
    ['getReportFor', () => data.getReportFor(SELECTED, 'row-1'), null],
    ['exportActionFor', () => exportActionFor(SELECTED, 'row-1', 'markdown'), null],
    ['getContentDraftFor', () => content.getContentDraftFor(SELECTED, 'row-1'), null],
    // A draft's live page and its sources (Chat's get_content_impact, get_content_sources).
    ['getContentImpactFor', () => content.getContentImpactFor(SELECTED, 'row-1', 30), null],
    ['getContentSourcesFor', () => content.getContentSourcesFor(SELECTED, 'row-1'), null],
    [
      'getContentDraftPackageFor',
      () => getContentDraftPackageFor(SELECTED, 'row-1'),
      { error: 'not_found', message: 'Draft not found' },
    ],
    ['getMentionFor', () => mentions.getMentionFor(SELECTED, 'row-1'), null],
    [
      'overrideMentionSentimentFor',
      () => mentions.overrideMentionSentimentFor(SELECTED, 'row-1', 'neutral'),
      { error: 'missing', message: 'Answer not found' },
    ],
    [
      'approveTaskReviewFor',
      () => taskReviews.approveTaskReviewFor(SELECTED, 'review-1', {}),
      expect.objectContaining({ error: 'missing' }),
    ],
    [
      'dismissTaskReviewFor',
      () => taskReviews.dismissTaskReviewFor(SELECTED, 'review-1'),
      expect.objectContaining({ error: 'missing' }),
    ],
  ];

  it.each(byRow)('%s reads it as not found, changing nothing', async (_name, call, answer) => {
    await expect(call()).resolves.toEqual(answer);
    expect(db.rpcs).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it('lets a shared brand’s row through', async () => {
    db.rows.topic_suggestions = { ...db.rows.topic_suggestions, brand_id: 'b2' };
    await expect(data.dismissTopicSuggestionFor(SELECTED, 'row-1')).resolves.not.toBeNull();
    expect(db.writes).toContainEqual(['topic_suggestions', 'update', expect.anything()]);
  });
});

describe('the MCP server for a Selected-brands key', () => {
  async function connect(auth: McpAuthContext) {
    const server = createMcpServer(auth);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    return client;
  }
  const text = (result: Awaited<ReturnType<Client['callTool']>>) =>
    (result.content as { text: string }[])[0]?.text;

  it('lists only the brands shared with its owner', async () => {
    db.lists.brands = [
      { id: 'b1', name: 'Acme', is_demo: false },
      { id: 'b2', name: 'Shared', is_demo: false },
    ];
    const client = await connect(SELECTED);
    const result = await client.callTool({ name: 'list_brands', arguments: {} });
    expect(JSON.parse(text(result)).map((b: { id: string }) => b.id)).toEqual(['b2']);

    const all = await (await connect(ALL)).callTool({ name: 'list_brands', arguments: {} });
    expect(JSON.parse(text(all)).map((b: { id: string }) => b.id)).toEqual(['b1', 'b2']);
  });

  it('answers a brand it may not use as not found', async () => {
    // The tools take brand ids as UUIDs.
    const hidden = '11111111-1111-4111-8111-111111111111';
    db.rows.brands = { id: hidden, name: 'Acme' };
    const client = await connect(SELECTED);
    const result = await client.callTool({ name: 'list_topics', arguments: { brand_id: hidden } });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('Brand not found');
  });

  it('answers a code on a brand it may not use as not found, reading none of its actions', async () => {
    const hidden = '11111111-1111-4111-8111-111111111111';
    db.rows.brands = { id: hidden, name: 'Acme' };
    const client = await connect(SELECTED);
    const result = await client.callTool({
      name: 'list_actions',
      arguments: { brand_id: hidden, codes: ['AC-481', '#12'] },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('Brand not found');
    expect(new Set(db.reads)).toEqual(new Set(['brands']));
    expect(db.rpcs).toEqual([]);
  });

  // The list tools' lookups (Chat's reads, over MCP): what a person names on a brand they may not use.
  const lookups: [string, Record<string, unknown>][] = [
    ['list_signals', { codes: ['S-07'], ids: ['5a000000-0000-4000-8000-000000000007'] }],
    ['list_prompts', { search: 'skip a month', ids: ['a1000000-0000-4000-8000-000000000005'] }],
    ['get_prompt_performance', { prompt_ids: ['a1000000-0000-4000-8000-000000000005'] }],
    [
      'list_citations',
      { domains: ['beanbulletin.example'], urls: ['https://beanbulletin.example/best'] },
    ],
    ['list_content_opportunities', { search: 'storage guide' }],
    [
      'list_content_drafts',
      { search: 'gift boxes', ids: ['a4000000-0000-4000-8000-000000000001'] },
    ],
    ['list_reports', { ids: ['ae000000-0000-4000-8000-000000000001'] }],
  ];

  it.each(lookups)(
    '%s answers a lookup on a brand it may not use as not found, reading none of its rows',
    async (name, args) => {
      const hidden = '11111111-1111-4111-8111-111111111111';
      db.rows.brands = { id: hidden, name: 'Acme' };
      const client = await connect(SELECTED);
      const result = await client.callTool({ name, arguments: { brand_id: hidden, ...args } });
      expect(result.isError).toBe(true);
      expect(text(result)).toBe('Brand not found');
      expect(new Set(db.reads)).toEqual(new Set(['brands']));
      expect(db.rpcs).toEqual([]);
    },
  );

  // Customers and revenue from AI visits (Chat's reads, over MCP): no figure, no plan read.
  const aiRevenue: [string, Record<string, unknown>][] = [
    ['get_tracking_setup', {}],
    ['get_ai_conversions', { date_from: '2026-11-01', limit: 10 }],
    ['get_ai_converting_pages', { date_from: '2026-11-01', offset: 50 }],
    ['get_ai_pipeline', { date_from: '2026-11-01', date_to: '2026-11-15' }],
    ['list_ai_visits', { assistant: 'chatgpt.com', search: 'pricing' }],
    ['get_prompt_conversions', { date_to: '2026-11-15' }],
  ];

  it.each(aiRevenue)(
    '%s answers a brand it may not use as not found, reading none of its rows',
    async (name, args) => {
      const hidden = '11111111-1111-4111-8111-111111111111';
      db.rows.brands = { id: hidden, name: 'Acme' };
      const client = await connect(SELECTED);
      const result = await client.callTool({ name, arguments: { brand_id: hidden, ...args } });
      expect(result.isError).toBe(true);
      expect(text(result)).toBe('Brand not found');
      expect(new Set(db.reads)).toEqual(new Set(['brands']));
      expect(db.rpcs).toEqual([]);
    },
  );
});
