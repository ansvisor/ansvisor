// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';
import { pageExists } from '@/lib/app-pages';
import { platformName } from '@/lib/signals/names';
import { PROMPT_ASSOCIATION_LABEL, conversionRate } from '@/lib/traffic-conversions';

/**
 * Chat's reads of customers and revenue from AI visits (ai-conversions.ts,
 * tracking-setup.ts) on one fake database: they read only the run's
 * organization and brand, say what to set up for each missing source, page
 * their lists, never add two currencies, always label the prompt
 * association, and give the AI Traffic page's own numbers for the same
 * period.
 */

type Call = [string, ...unknown[]];
type Answer = { data: unknown; error: null; count?: number };

const db = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, (calls: Call[]) => Answer>,
    rpcs: {} as Record<string, (args: Record<string, unknown>) => unknown>,
    reads: [] as { table: string; calls: Call[] }[],
    rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  };
  const client = () => ({
    from(table: string) {
      const calls: Call[] = [];
      state.reads.push({ table, calls });
      const chain: Record<string, unknown> = {};
      for (const method of [
        'select',
        'eq',
        'in',
        'is',
        'not',
        'or',
        'gt',
        'gte',
        'lte',
        'order',
        'limit',
        'range',
        'ilike',
      ]) {
        chain[method] = (...args: unknown[]) => (calls.push([method, ...args]), chain);
      }
      const answer = () => state.tables[table]?.(calls) ?? { data: [], error: null, count: 0 };
      chain.maybeSingle = async () => {
        const out = answer();
        return { ...out, data: Array.isArray(out.data) ? (out.data[0] ?? null) : out.data };
      };
      chain.then = (resolve: (value: Answer) => unknown) => resolve(answer());
      return chain;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      state.rpcCalls.push({ name, args });
      return { data: state.rpcs[name]?.(args) ?? null, error: null };
    },
  });
  return Object.assign(state, { client });
});

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: db.client() }));
// The AI Traffic page's own reads, through the member's session: the same fake database.
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => db.client() }));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

const reads = await import('./ai-conversions');
const setup = await import('./tracking-setup');
const traffic = await import('@/lib/actions/traffic');

const ORG = 'org-1';
const BRAND = 'b1000000-0000-4000-8000-000000000001';
const ctx: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: ORG,
  role: 'analyst',
  apiKeyId: 'agent-internal',
  brandAccess: 'all',
};

const has = (calls: Call[], method: string, ...args: unknown[]) =>
  calls.some(
    ([m, ...rest]) =>
      m === method && args.every((a, i) => JSON.stringify(rest[i]) === JSON.stringify(a)),
  );
const eqOf = (calls: Call[], column: string) =>
  calls.find(([m, c]) => m === 'eq' && c === column)?.[2];

/** A conversion as the snippet stores it. */
const conversion = (
  goal: string,
  value: number | null,
  currency: string | null,
  source: string,
  landing: string,
  extra: { units?: number; label?: string; origin?: string; at?: string } = {},
) => ({
  goal,
  value,
  currency,
  units: extra.units ?? null,
  label: extra.label ?? null,
  origin: extra.origin ?? 'call',
  first_source: source,
  first_key: landing,
  occurred_at: extra.at ?? '2026-11-10T10:00:00.000Z',
});

const EVENTS = [
  conversion('signup', null, null, 'chatgpt.com', '/pricing', { origin: 'form' }),
  conversion('signup', null, null, 'chatgpt.com', '/pricing', { origin: 'form' }),
  conversion('order', 120, 'EUR', 'perplexity.ai', '/shop', { units: 3 }),
  conversion('order', 80.5, 'USD', 'chatgpt.com', '/shop', { units: 1 }),
  conversion('booking', 50, 'EUR', 'gemini.google.com', '/tours'),
  conversion('order', null, null, 'evil.example', '/shop', { units: 1 }),
  // A value on a goal that isn't an order or a booking is no revenue, as in the Content Editor.
  conversion('custom', 30, 'EUR', 'claude.ai', '/pricing', { label: 'subscription' }),
];

let brand: Record<string, unknown>;
let events: ReturnType<typeof conversion>[];
let gaConnected: boolean;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-16T12:00:00.000Z'));
  db.reads.length = 0;
  db.rpcCalls.length = 0;
  brand = {
    id: BRAND,
    name: 'Brewline',
    conversions_enabled: true,
    conversions_consent: 'wait',
    site_type: 'ecommerce',
    industry: null,
    shopping_mode_enabled: false,
    ga_property_id: null,
    gsc_property: null,
    snippet_found_at: null,
    snippet_checked_at: null,
  };
  events = EVENTS;
  gaConnected = false;
  db.tables = {
    // Found only by its id in its organization, as every read looks it up.
    brands: (calls) => ({
      data:
        eqOf(calls, 'id') === BRAND &&
        [undefined, ORG].includes(eqOf(calls, 'organization_id') as string)
          ? [{ ...brand, ga_property_id: gaConnected ? 'properties/1' : null }]
          : [],
      error: null,
    }),
    brand_integrations: () => ({
      data: gaConnected
        ? [
            {
              provider: 'google-analytics',
              account: { id: 'a1', label: null, status: 'connected' },
            },
          ]
        : [],
      error: null,
    }),
    ga_ai_traffic_stats: () => ({ data: gaConnected ? [{ date: '2026-11-15' }] : [], error: null }),
    ai_traffic_events: (calls) => {
      let rows = events;
      const origin = eqOf(calls, 'origin');
      if (origin) rows = rows.filter((row) => row.origin === origin);
      if (has(calls, 'in', 'goal', ['order', 'booking'])) {
        rows = rows.filter((row) => ['order', 'booking'].includes(row.goal) && row.value !== null);
      }
      const range = calls.find(([m]) => m === 'range') as [string, number, number] | undefined;
      return { data: range ? rows.slice(range[1], range[2] + 1) : rows.slice(0, 1), error: null };
    },
  };
  db.rpcs = {};
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** Every direct read of a brand's rows names the brand and its organization. */
function expectScoped() {
  for (const { table, calls } of db.reads) {
    if (['ai_traffic_events', 'prompt_result_citations', 'brand_domains'].includes(table)) {
      expect(eqOf(calls, 'brand_id'), table).toBe(BRAND);
      expect(eqOf(calls, 'brands.organization_id'), table).toBe(ORG);
    }
  }
}

describe('scope: the run’s organization and brand, never another', () => {
  const all = (auth: McpAuthContext, brandId = BRAND) => [
    setup.getTrackingSetupFor(auth, { brandId }),
    reads.getAiConversionsFor(auth, { brandId }),
    reads.getAiConvertingPagesFor(auth, { brandId }),
    reads.getAiPipelineFor(auth, { brandId }),
    reads.listAiVisitsFor(auth, { brandId }),
    reads.getPromptConversionsFor(auth, { brandId }),
  ];

  it.each([
    ['another organization', { ...ctx, organizationId: 'org-2' }, BRAND],
    ['a brand not shared with the person', { ...ctx, brandAccess: ['b-other'] }, BRAND],
    ['a brand of no one’s', ctx, 'b9000000-0000-4000-8000-000000000009'],
  ])('reads %s as not found, and nothing of it', async (_name, auth, brandId) => {
    for (const read of all(auth as McpAuthContext, brandId)) await expect(read).resolves.toBeNull();
    expect(new Set(db.reads.map((r) => r.table))).toEqual(new Set(['brands']));
    expect(db.rpcCalls).toEqual([]);
  });

  it('limits every read of conversions, citations and domains to the brand and its organization', async () => {
    await setup.getTrackingSetupFor(ctx, { brandId: BRAND });
    await reads.getAiConversionsFor(ctx, { brandId: BRAND });
    await reads.getPromptConversionsFor(ctx, { brandId: BRAND });
    expect(db.reads.some((r) => r.table === 'ai_traffic_events')).toBe(true);
    expectScoped();
  });
});

describe('conversions from AI visits', () => {
  it('adds up each currency on its own, never across currencies', () => {
    const tally = reads.tallyConversions(EVENTS);
    expect(tally.conversions).toBe(7);
    expect(tally.revenue).toEqual([
      { currency: 'EUR', value: 170 },
      { currency: 'USD', value: 80.5 },
    ]);
    expect(tally.by_type).toEqual([
      {
        type: 'order',
        conversions: 3,
        units: 5,
        value: [
          { currency: 'EUR', value: 120 },
          { currency: 'USD', value: 80.5 },
        ],
      },
      { type: 'signup', conversions: 2 },
      { type: 'booking', conversions: 1, value: [{ currency: 'EUR', value: 50 }] },
      { type: 'custom', conversions: 1 },
    ]);
    expect(tally.orders_without_value).toBe(1);
    // No figure anywhere is a sum of two currencies.
    expect(JSON.stringify(tally)).not.toMatch(/250\.5|200\.5|170\.5/);
  });

  it('credits the assistant that first sent the visitor and its landing page, Other last', () => {
    const tally = reads.tallyConversions(EVENTS);
    expect(tally.by_assistant.map((row) => [row.assistant, row.conversions])).toEqual([
      ['ChatGPT', 3],
      ['Claude', 1],
      ['Gemini', 1],
      ['Perplexity', 1],
      ['Other', 1],
    ]);
    expect(tally.by_assistant[0].revenue).toEqual([{ currency: 'USD', value: 80.5 }]);
    expect(
      tally.landing_pages.map((row) => [row.page, row.conversions, row.top_assistant]),
    ).toEqual([
      ['/pricing', 3, 'ChatGPT'],
      ['/shop', 3, 'ChatGPT'],
      ['/tours', 1, 'Gemini'],
    ]);
    expect(tally.labels).toEqual([{ type: 'custom', label: 'subscription', conversions: 1 }]);
  });

  it('pages the landing pages, with their total and the next page', async () => {
    const result = await reads.getAiConversionsFor(ctx, {
      brandId: BRAND,
      dateFrom: '2026-11-01',
      dateTo: '2026-11-15',
      limit: 1,
      offset: 1,
    });
    expect(result).toMatchObject({
      measured: true,
      conversions: 7,
      total: 3,
      offset: 1,
      next_offset: 2,
      landing_pages: [{ page: '/shop', conversions: 3 }],
    });
    expect((result as { note: string }).note).toContain('Showing 2–2 of 3 landing pages');
    // The period's whole days, as the Content Plan's line counts them.
    const read = db.reads.find(
      (r) => r.table === 'ai_traffic_events' && has(r.calls, 'range', 0, 999),
    )!;
    expect(has(read.calls, 'gte', 'occurred_at', '2026-11-01')).toBe(true);
    expect(has(read.calls, 'lte', 'occurred_at', '2026-11-15T23:59:59.999Z')).toBe(true);
  });

  it('says "not measured" with the step that turns conversions on, and no number, when they are off', async () => {
    brand.conversions_enabled = false;
    events = [];
    const result = await reads.getAiConversionsFor(ctx, { brandId: BRAND });
    expect(result).toEqual({
      measured: false,
      enabled: false,
      period: { from: null, to: '2026-11-16T12:00:00.000Z' },
      not_measured: expect.stringContaining('Not measured'),
      next_step: expect.stringContaining('Track conversions from AI visits'),
      where: `/dashboard/brands/${BRAND}/settings?tab=tracking`,
    });
  });
});

describe('the tracking setup: each missing piece with its next step', () => {
  const facts = (over: Partial<import('./tracking-setup').SetupFacts> = {}) => ({
    brandId: BRAND,
    snippet: 'active' as const,
    snippetLastVisitAt: '2026-11-15T09:00:00.000Z',
    conversionsOn: true,
    consent: 'wait' as const,
    lastConversion: { form: '2026-11-14T10:00:00.000Z', call: null, shopify: null },
    lastValuedOrderAt: '2026-11-13T10:00:00.000Z',
    sells: true,
    ecommerce: true,
    ga: 'connected' as const,
    gaReports: { keyEvents: true, revenue: false },
    hubspot: 'connected' as const,
    hubspotPlan: null,
    ...over,
  });
  const item = (items: ReturnType<typeof setup.setupItems>, name: string) =>
    items.find((i) => i.item === name);

  it.each([
    ['snippet', { snippet: 'not_detected' as const }, 'Install', '/dashboard/traffic'],
    [
      'conversions',
      { conversionsOn: false },
      'Track conversions from AI visits',
      `/dashboard/brands/${BRAND}/settings?tab=tracking`,
    ],
    [
      'conversion_events',
      { lastConversion: { form: null, call: null, shopify: null } },
      "ansvisor('consent', 'granted')",
      `/dashboard/brands/${BRAND}/settings?tab=tracking`,
    ],
    [
      'orders',
      { lastValuedOrderAt: null },
      "type: 'order', value, currency",
      `/dashboard/brands/${BRAND}/settings?tab=tracking`,
    ],
    ['shopify_pixel', {}, 'Customer events', `/dashboard/brands/${BRAND}/settings?tab=tracking`],
    [
      'google_analytics',
      { ga: 'not_connected' as const, gaReports: null },
      'Connect Google Analytics',
      '/dashboard/settings?tab=integrations',
    ],
    [
      'hubspot',
      { hubspot: 'not_connected' as const },
      'Connect HubSpot',
      '/dashboard/settings/integrations#hubspot',
    ],
    [
      'hubspot',
      { hubspot: 'marking_off' as const },
      'marking contacts',
      '/dashboard/settings/integrations#hubspot',
    ],
    [
      'hubspot',
      { hubspot: 'first_sync' as const },
      'Sync now',
      '/dashboard/settings/integrations#hubspot',
    ],
    [
      'hubspot',
      { hubspot: 'not_on_plan' as const, hubspotPlan: 'Growth' },
      'comes with the Growth plan',
      '/dashboard/settings/billing',
    ],
  ])('%s: %o gives its step and its page', (name, over, words, where) => {
    const found = item(setup.setupItems(facts(over)), name)!;
    expect(found.ok).toBe(false);
    expect(found.next_step).toContain(words);
    expect(found.where).toBe(where);
    expect(pageExists(where.split('#')[0])).toBe(true);
  });

  it('gives no step for what is set up, and counts only what the answer needs as missing', () => {
    const items = setup.setupItems(
      facts({ lastConversion: { form: null, call: null, shopify: '2026-11-12T08:00:00.000Z' } }),
    );
    expect(items.map((i) => i.item)).toEqual([
      'snippet',
      'conversions',
      'conversion_events',
      'orders',
      'shopify_pixel',
      'google_analytics',
      'hubspot',
    ]);
    expect(items.filter((i) => i.next_step)).toEqual([]);
    // Analytics' missing revenue is said, not a step.
    expect(item(items, 'google_analytics')!.detail).toContain('GA4 purchase events');
    const off = setup.setupItems(facts({ snippet: 'not_detected', conversionsOn: false }));
    expect(off.filter((i) => !i.ok && !i.optional).map((i) => i.item)).toEqual([
      'snippet',
      'conversions',
    ]);
    // A B2B site needs no orders, and has no Shopify item.
    const b2b = setup.setupItems(
      facts({ sells: false, ecommerce: false, lastValuedOrderAt: null }),
    );
    expect(item(b2b, 'orders')!.optional).toBe(true);
    expect(item(b2b, 'shopify_pixel')).toBeUndefined();
    // Consent that doesn't wait needs no banner call.
    const always = setup.setupItems(
      facts({ consent: 'always', lastConversion: { form: null, call: null, shopify: null } }),
    );
    expect(item(always, 'conversion_events')!.next_step).not.toContain('consent');
  });

  it('reads the brand as the page does: snippet, conversions, Analytics and HubSpot behind its plan', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    db.tables.organizations = () => ({
      data: [{ plan: 'starter', subscription_status: 'active', plan_overrides: null }],
      error: null,
    });
    brand.conversions_enabled = false;
    events = [];
    const result = await setup.getTrackingSetupFor(ctx, { brandId: BRAND });
    expect(result).toMatchObject({ brand: 'Brewline', site_type: 'ecommerce', missing: 2 });
    expect(result!.items.map((i) => [i.item, i.state])).toEqual([
      ['snippet', 'not_detected'],
      ['conversions', 'off'],
      ['google_analytics', 'not_connected'],
      ['hubspot', 'not_on_plan'],
    ]);
    expect(result!.who_can_change).toContain('is not one');
    // Starter has no CRM integrations: HubSpot's read never runs.
    expect(db.rpcCalls.map((c) => c.name)).not.toContain('brand_ai_pipeline');
  });
});

describe("AI Traffic's numbers, as the page reads them for the same period", () => {
  const WINDOW = { dateFrom: '2026-11-09', dateTo: '2026-11-15' };
  const pageRow = (page: string, sessions: number, keyEvents: number, revenue: number) => ({
    page,
    sessions,
    key_events: keyEvents,
    key_event_sessions: Math.max(0, keyEvents - 1),
    transactions: 1,
    revenue,
    best_platform: 'chatgpt.com',
  });
  const GA_PAGES = [
    pageRow('/Gifts', 80, 9, 640.4),
    pageRow('/pricing', 45, 6, 210.6),
    pageRow('/blog/brew', 12, 2, 0),
  ];

  beforeEach(() => {
    gaConnected = true;
    db.rpcs.ai_traffic_conversions = (args) => ({
      sessions: 137,
      has_revenue: true,
      page_count: GA_PAGES.length,
      answer_count: 1,
      pages: GA_PAGES.slice(0, args.p_limit as number),
      answers: [
        {
          platform: 'perplexity.ai',
          topic_id: 't1',
          topic: 'Coffee gifts',
          pages: 1,
          sessions: 40,
          key_events: 4,
          key_event_sessions: 3,
          revenue: 120.5,
        },
      ],
    });
  });

  it('gives Top converting pages from AI with the page’s figures, rate rule and ranking', async () => {
    const page = await traffic.getTrafficConversions(BRAND, WINDOW);
    const chat = await reads.getAiConvertingPagesFor(ctx, { brandId: BRAND, ...WINDOW });
    const [pageCall, chatCall] = db.rpcCalls.filter((c) => c.name === 'ai_traffic_conversions');
    // The same days; Chat asks for its page of up to 50 where the page shows 10.
    expect({ ...chatCall.args, p_limit: 10 }).toEqual(pageCall.args);
    const rows = (chat as { pages: Record<string, unknown>[] }).pages;
    expect(rows).toEqual(
      page.pages.map((row) => {
        const rate = conversionRate(row);
        return {
          page: row.page,
          ai_visits: row.aiVisits,
          key_events: row.keyEvents,
          revenue: Math.round(row.revenue),
          ...(rate.kind === 'rate'
            ? { rate_pct: rate.pct }
            : { rate_pct: null, rate_note: 'Low sample: fewer than 30 AI visits' }),
          best_assistant: 'ChatGPT',
        };
      }),
    );
    expect(chat).toMatchObject({
      measured: true,
      ranked_by: 'revenue from AI visits',
      ai_visits: page.aiVisits,
      total: 3,
      next_offset: null,
      buyer_answers_total: 1,
      buyer_answers: [
        { assistant: 'Perplexity', topic: 'Coffee gifts', key_events: 4, revenue: 121 },
      ],
    });
  });

  it('pages them by offset, and widens a thin period to the last 30 days as the page does', async () => {
    const second = await reads.getAiConvertingPagesFor(ctx, {
      brandId: BRAND,
      ...WINDOW,
      limit: 2,
      offset: 2,
    });
    expect(db.rpcCalls.at(-1)!.args.p_limit).toBe(4);
    expect(second).toMatchObject({
      total: 3,
      offset: 2,
      next_offset: null,
      pages: [{ page: '/blog/brew' }],
    });
    expect(second).not.toHaveProperty('buyer_answers');

    const thin = db.rpcs.ai_traffic_conversions;
    db.rpcs.ai_traffic_conversions = (args) => ({ ...(thin(args) as object), sessions: 12 });
    const widened = await reads.getAiConvertingPagesFor(ctx, { brandId: BRAND, ...WINDOW });
    expect(widened).toMatchObject({
      widened: expect.stringContaining('last 30 days'),
      period: { from: '2026-10-17' },
    });
  });

  it('says Analytics is not measured, with its step, when it isn’t connected', async () => {
    gaConnected = false;
    expect(await reads.getAiConvertingPagesFor(ctx, { brandId: BRAND, ...WINDOW })).toEqual({
      measured: false,
      connected: false,
      not_measured: expect.stringContaining('Not measured'),
      next_step: expect.stringContaining('Connect Google Analytics'),
      where: '/dashboard/settings?tab=integrations',
    });
    expect(db.rpcCalls).toEqual([]);
  });

  it('gives the AI-sourced pipeline’s figures, or HubSpot’s step', async () => {
    const pipeline = {
      connected: true,
      contactsConsent: true,
      currency: 'EUR',
      syncedAt: '2026-11-16T03:00:00Z',
      syncError: null,
      totals: {
        contacts: 14,
        contactsPrev: 9,
        deals: 4,
        wonDeals: 2,
        wonRevenue: 8200,
        wonRevenuePrev: 3100,
        openDeals: 2,
        openPipeline: 5400,
      },
      byEngine: [
        {
          source: 'chatgpt.com',
          contacts: 10,
          deals: 3,
          wonDeals: 2,
          wonRevenue: 8200,
          openPipeline: 2000,
        },
      ],
      byPage: [
        {
          page: 'https://brew.example/pricing',
          contacts: 6,
          deals: 2,
          wonRevenue: 8200,
          topSource: 'chatgpt.com',
        },
      ],
      hubspotNative: { contacts: 3, deals: 0, wonRevenue: 0 },
    };
    db.rpcs.brand_ai_pipeline = () => pipeline;
    const page = await traffic.getTrafficAiPipeline(BRAND, WINDOW);
    const chat = await reads.getAiPipelineFor(ctx, { brandId: BRAND, ...WINDOW });
    const [pageCall, chatCall] = db.rpcCalls.filter((c) => c.name === 'brand_ai_pipeline');
    expect(chatCall.args).toEqual(pageCall.args);
    expect(chat).toMatchObject({
      measured: true,
      currency: 'EUR',
      totals: {
        contacts: page!.totals.contacts,
        won_revenue: page!.totals.wonRevenue,
        open_pipeline: page!.totals.openPipeline,
        won_revenue_before: page!.totals.wonRevenuePrev,
      },
      by_assistant: [{ assistant: 'ChatGPT', won_revenue: 8200 }],
      by_page: [{ page: '/pricing', top_assistant: 'ChatGPT' }],
    });

    db.rpcs.brand_ai_pipeline = () => ({ ...pipeline, connected: false });
    expect(await reads.getAiPipelineFor(ctx, { brandId: BRAND })).toMatchObject({
      measured: false,
      state: 'not_connected',
      next_step: expect.stringContaining('Connect HubSpot'),
    });
  });

  it('pages the visit log with the page’s own total and rows', async () => {
    const logs = Array.from({ length: 3 }, (_, i) => ({
      id: `v${i}`,
      brand_id: BRAND,
      url: `https://brew.example/p${i}?utm_source=chatgpt.com`,
      referrer: 'https://chatgpt.com/',
      source_platform: 'chatgpt.com',
      country: 'TR',
      language: 'tr',
      screen: null,
      created_at: `2026-11-1${i}T10:00:00.000Z`,
    }));
    db.tables.ai_traffic_logs = (calls) => {
      if (calls.some(([m, c]) => m === 'in' && c === 'visit_of')) {
        return { data: [{ visit_of: 'v0' }], error: null };
      }
      const range = calls.find(([m]) => m === 'range') as [string, number, number] | undefined;
      return {
        data: range ? logs.slice(range[1], range[2] + 1) : [],
        error: null,
        count: range ? 41 : 57,
      };
    };
    const page = await traffic.getTrafficLogs(BRAND, { limit: 2, offset: 0, ...WINDOW });
    const chat = await reads.listAiVisitsFor(ctx, { brandId: BRAND, limit: 2, ...WINDOW });
    expect(chat).toMatchObject({ total: page.total, offset: 0, next_offset: 2, pageviews: 57 });
    expect(
      (chat as { visits: { page: string; pageviews: number; assistant: string }[] }).visits,
    ).toEqual(
      page.logs.map((log) =>
        expect.objectContaining({
          page: new URL(log.url).pathname,
          pageviews: log.pageviews,
          assistant: 'ChatGPT',
        }),
      ),
    );
  });
});

describe('prompts cited on pages that converted: an association, always labelled', () => {
  beforeEach(() => {
    db.tables.brand_domains = () => ({ data: [{ domain: 'www.Brew.example' }], error: null });
    db.tables.citation_urls = () => ({
      data: [
        { id: 1, url: 'https://brew.example/Pricing/' },
        { id: 2, url: 'https://brew.example/shop?ref=ai' },
        { id: 3, url: 'https://brew.example/blog' },
      ],
      error: null,
    });
    const cite = (url: number, result: string, prompt: string, platform: string, text: string) => ({
      url_id: url,
      prompt_result_id: result,
      prompt_results: { prompt_id: prompt, platform, prompts: { text } },
    });
    db.tables.prompt_result_citations = () => ({
      data: [
        cite(1, 'r1', 'p1', 'chatgpt-web', 'best coffee subscription'),
        cite(2, 'r2', 'p1', 'chatgpt-web', 'best coffee subscription'),
        cite(2, 'r3', 'p2', 'perplexity-web', 'coffee gift ideas'),
      ],
      error: null,
    });
  });

  it('joins the prompts citing a converting page with its conversions, per currency, labelled', async () => {
    const result = await reads.getPromptConversionsFor(ctx, { brandId: BRAND });
    expect(result).toMatchObject({
      label: PROMPT_ASSOCIATION_LABEL,
      measured: true,
      counted_as: 'conversions from AI visits (the tracking snippet)',
      total: 2,
      prompts: [
        {
          prompt: 'best coffee subscription',
          answers_citing: 2,
          assistants: [platformName('chatgpt-web')],
          conversions_on_cited_pages: 6,
          revenue_on_cited_pages: [
            { currency: 'EUR', value: 120 },
            { currency: 'USD', value: 80.5 },
          ],
        },
        { prompt: 'coffee gift ideas', answers_citing: 1, conversions_on_cited_pages: 3 },
      ],
    });
    expect(PROMPT_ASSOCIATION_LABEL).toMatch(/^Association, not measured attribution/);
    // Only the own domain's URLs, by the brand's own domain without www.
    const urls = db.reads.find((r) => r.table === 'citation_urls')!;
    expect(has(urls.calls, 'in', 'domain', ['brew.example'])).toBe(true);
    const cited = db.reads.find((r) => r.table === 'prompt_result_citations')!;
    expect(has(cited.calls, 'in', 'url_id', [1, 2])).toBe(true);
    expectScoped();
  });

  it('keeps its label when nothing is measured, and when no page converted', async () => {
    brand.conversions_enabled = false;
    events = [];
    const off = await reads.getPromptConversionsFor(ctx, { brandId: BRAND });
    expect(off).toMatchObject({ label: PROMPT_ASSOCIATION_LABEL, measured: false });
    expect((off as { next_steps: unknown[] }).next_steps).toHaveLength(2);
    brand.conversions_enabled = true;
    const none = await reads.getPromptConversionsFor(ctx, { brandId: BRAND });
    expect(none).toMatchObject({
      label: PROMPT_ASSOCIATION_LABEL,
      measured: true,
      total: 0,
      prompts: [],
    });
  });

  it('reads the page key as the database writes it', () => {
    expect(reads.pageKeyOf('https://Brew.example/Caf%C3%A9/?a=1#top')).toBe('/café');
    expect(reads.pageKeyOf('https://brew.example')).toBe('/');
    expect(reads.pageKeyOf('/Shop//')).toBe('/shop');
  });
});
