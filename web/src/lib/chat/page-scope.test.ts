// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * The page's filters as a read's inputs (the owner's rule, 2026-11-16): each
 * page that sends a context, with the chips it really sends
 * (useChatPageContext on Actions, Content Opportunities, Prompts, AI
 * Traffic, Mentions, Citations, Visibility and Ads), on the reads Chat has.
 */

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { rpc: vi.fn(), from: vi.fn() } }));

const { asksAllOf, pageFilterInputs, pageScopeOf } = await import('./page-scope');
const { CHAT_TOOLS } = await import('./registry/tools');

const BRAND = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOPIC = '33333333-3333-4333-8333-333333333333';
const PROMPT = '44444444-4444-4444-8444-444444444444';
const CHATGPT = 'chatgpt-web,gpt-5-chat-latest';

const tool = (name: string) => {
  const found = CHAT_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};

/** A page's context as the side panel posts it, the brand chip the run's. */
const pageOf = (route: string, filters: [string, string, string][]) =>
  pageScopeOf({
    route,
    chips: [
      { key: 'page', label: 'The page' },
      { key: 'brand', label: 'Northwind', value: BRAND },
      { key: 'dates', label: 'Last 24 hours', value: '24h/' },
      ...filters.map(([key, label, value]) => ({ key: `filter:${key}`, label, value })),
    ],
  });

/** What the page adds to a read the model gave `raw`. */
const added = (
  name: string,
  page: ReturnType<typeof pageOf>,
  raw: Record<string, unknown> = {},
  question = 'How are we doing?',
) => {
  const out = pageFilterInputs(tool(name), { brand_id: BRAND, ...raw }, page, question);
  const input = { ...out.input };
  delete input.brand_id;
  return { input, applied: out.applied };
};

describe("a page's scope", () => {
  it('reads the route, the brand chip and the filters with a value, from the chips', () => {
    expect(
      pageScopeOf({
        route: '/dashboard/citations/',
        chips: [
          { key: 'page', label: 'Citations' },
          { key: 'brand', label: 'Northwind', value: BRAND },
          { key: 'filter:platform', label: 'All platforms', value: '' },
          { key: 'filter:sources', label: 'Brand', value: 'own' },
        ],
      }),
    ).toEqual({
      route: '/dashboard/citations',
      brandId: BRAND,
      filters: [{ key: 'sources', label: 'Brand', value: 'own' }],
    });
    expect(pageScopeOf({ chips: [] })).toEqual({ route: null, brandId: null, filters: [] });
    expect(pageScopeOf(undefined)).toBeNull();
  });
});

describe("each page's filters", () => {
  it('Actions: category and status on its own list; priority and Stale stay words', () => {
    const page = pageOf('/dashboard/action-center/actions', [
      ['category', 'Growth', 'growth'],
      ['priority', 'High', 'high'],
      ['status', 'Completed', 'completed'],
    ]);
    expect(added('list_action_center_tasks', page)).toEqual({
      input: { category: 'growth', status: 'completed' },
      applied: ['category', 'status'],
    });
    // Stale is no status the read takes: never guessed.
    const stale = pageOf('/dashboard/action-center/actions', [['status', 'Stale', 'stale']]);
    expect(added('list_action_center_tasks', stale)).toEqual({ input: {}, applied: [] });
    // Another page's list: Actions' "In progress" isn't an opportunity's.
    const busy = pageOf('/dashboard/action-center/actions', [
      ['status', 'In progress', 'in_progress'],
    ]);
    expect(added('list_content_opportunities', busy)).toEqual({ input: {}, applied: [] });
    // Actions read by their codes come back whatever the page shows.
    expect(added('list_action_center_tasks', page, { codes: ['AC-12'] }).applied).toEqual([]);
  });

  it('Content Opportunities: type, impact and status on its own list only', () => {
    const page = pageOf('/dashboard/content', [
      ['type', 'Owned', 'owned'],
      ['impact', 'High', 'high'],
      ['status', 'In progress', 'in_progress'],
    ]);
    expect(added('list_content_opportunities', page)).toEqual({
      input: { type: 'owned', impact: 'high', status: 'in_progress' },
      applied: ['type', 'impact', 'status'],
    });
    expect(added('list_action_center_tasks', page)).toEqual({ input: {}, applied: [] });
    expect(added('list_drafts', page)).toEqual({ input: {}, applied: [] });
  });

  it('Prompts: the location on every read that takes a region', () => {
    const page = pageOf('/dashboard/prompts', [['region', '🇺🇸 United States', 'US']]);
    expect(added('get_prompt_performance', page)).toEqual({
      input: { region: 'US' },
      applied: ['region'],
    });
    expect(added('get_visibility_summary', page).input).toEqual({ region: 'US' });
    expect(added('list_prompts', page)).toEqual({ input: {}, applied: [] });
  });

  it('Prompts: /dashboard/prompts is Tracked Prompts, whose own list its filters reach', () => {
    // The maintainer's review of 2026-11-17: the base path opens on Tracked Prompts
    // (page-route.ts), so its scope is that page's and a read of that page's list is its own.
    expect(pageOf('/dashboard/prompts', [])!.route).toBe('/dashboard/prompts/tracked');
    const ownList = {
      route: '/dashboard/prompts/tracked',
      inputSchema: z.object({ brand_id: z.string(), status: z.string().optional() }),
    };
    const status: [string, string, string][] = [['status', 'Paused', 'paused']];
    for (const route of [
      '/dashboard/prompts',
      '/dashboard/prompts/',
      '/dashboard/prompts/tracked',
    ]) {
      expect(
        pageFilterInputs(ownList, { brand_id: BRAND }, pageOf(route, status), 'Which ones?'),
        route,
      ).toEqual({ input: { brand_id: BRAND, status: 'paused' }, applied: ['status'] });
    }
    // Another view of the Prompts area is another page: its list filters stay its own.
    expect(
      pageFilterInputs(
        ownList,
        { brand_id: BRAND },
        pageOf('/dashboard/prompts/topics', status),
        'Which ones?',
      ),
    ).toEqual({ input: { brand_id: BRAND }, applied: [] });
  });

  it("AI Traffic: its platform is the visit's source, which no read takes", () => {
    const page = pageOf('/dashboard/traffic', [['platform', 'ChatGPT', 'chatgpt']]);
    for (const name of [
      'get_ai_traffic_summary',
      'get_visibility_summary',
      'get_mentions_summary',
    ]) {
      expect(added(name, page), name).toEqual({ input: {}, applied: [] });
    }
  });

  it('Mentions: a platform id on the reads that take one, region and topic on all', () => {
    const page = pageOf('/dashboard/mentions', [
      ['platform', 'ChatGPT', 'chatgpt-web'],
      ['region', '🇺🇸 United States', 'US'],
      ['topic', 'Coffee subscriptions', TOPIC],
    ]);
    for (const name of ['get_mentions_summary', 'list_mentions', 'get_mention_competitors']) {
      expect(added(name, page), name).toEqual({
        input: { platform: 'chatgpt-web', region: 'US', topic_id: TOPIC },
        applied: ['platform', 'region', 'topic'],
      });
    }
    // A platform id isn't the AI model answers are stored under: no `model` from it.
    expect(added('get_visibility_trend', page)).toEqual({
      input: { region: 'US', topic_id: TOPIC },
      applied: ['region', 'topic'],
    });
  });

  it('Citations: the model family, region, topic and Sources on its list; the prompt stays words', () => {
    const page = pageOf('/dashboard/citations', [
      ['platform', 'ChatGPT', CHATGPT],
      ['region', '🇺🇸 United States', 'US'],
      ['topic', 'Coffee subscriptions', TOPIC],
      ['prompt', 'Which coffee subscription lets you skip a month?', PROMPT],
      ['sources', 'Brand', 'own'],
    ]);
    expect(added('list_citations', page)).toEqual({
      input: { model: CHATGPT, region: 'US', topic_id: TOPIC, source_filter: 'owned' },
      applied: ['platform', 'region', 'topic', 'sources'],
    });
    for (const [scope, filter] of [
      ['competitors', 'competitor'],
      ['third_party', 'external'],
      ['all', 'all'],
    ]) {
      const sources = pageOf('/dashboard/citations', [['sources', scope, scope]]);
      expect(added('list_citations', sources).input).toEqual({ source_filter: filter });
    }
    // Ads' prompt is its drawer: Citations' prompt isn't Ads' scope.
    expect(added('get_ads_opportunities', page)).toEqual({ input: {}, applied: [] });
    // A mentions read takes a platform id, not a model family.
    expect(added('get_mentions_summary', page).input).toEqual({ region: 'US', topic_id: TOPIC });
    // A prompt's answers name their prompt themselves.
    expect(added('list_ai_answers', page, { prompt_id: PROMPT }).input).toEqual({
      prompt_id: PROMPT,
    });
  });

  it('Visibility: model, region and topic on every read that takes them', () => {
    const page = pageOf('/dashboard/insights', [
      ['platform', 'ChatGPT', CHATGPT],
      ['region', '🇺🇸 United States', 'US'],
      ['topic', 'Coffee subscriptions', TOPIC],
    ]);
    expect(added('get_visibility_summary', page).input).toEqual({ model: CHATGPT, region: 'US' });
    expect(added('get_overview_summary', page).input).toEqual({ model: CHATGPT });
    for (const name of ['get_visibility_trend', 'get_competitor_comparison', 'explain_change']) {
      expect(added(name, page, {}).input, name).toMatchObject({
        model: CHATGPT,
        region: 'US',
        topic_id: TOPIC,
      });
    }
    // A read that takes none of them is left as it was.
    expect(added('list_competitors', page)).toEqual({ input: {}, applied: [] });
  });

  it('Ads: its period only, no filter', () => {
    const page = pageScopeOf({
      route: '/dashboard/ads',
      chips: [
        { key: 'page', label: 'Ads' },
        { key: 'brand', label: 'Northwind', value: BRAND },
        { key: 'dates', label: 'Last 30 days', value: '30d/' },
      ],
    });
    expect(page?.filters).toEqual([]);
    expect(added('get_ads_opportunities', page)).toEqual({ input: {}, applied: [] });
  });
});

describe('what wins over the page', () => {
  const page = pageOf('/dashboard/citations', [
    ['platform', 'ChatGPT', CHATGPT],
    ['region', '🇺🇸 United States', 'US'],
    ['topic', 'Coffee subscriptions', TOPIC],
    ['sources', 'Brand', 'own'],
  ]);

  it('keeps the model\'s own inputs, and reads all of them for its ""', () => {
    expect(
      added('list_citations', page, { model: 'gemini-web', source_filter: 'all', region: '' }),
    ).toEqual({
      input: { model: 'gemini-web', source_filter: 'all', topic_id: TOPIC },
      applied: ['topic'],
    });
  });

  it('drops a chip the question asks all of', () => {
    expect(added('list_citations', page, {}, 'Top domains on all platforms?').input).toEqual({
      region: 'US',
      topic_id: TOPIC,
      source_filter: 'owned',
    });
    expect(
      added('list_citations', page, {}, 'Tüm konularda ve tüm kaynaklarda en çok atıf?').input,
    ).toEqual({ model: CHATGPT, region: 'US' });
  });

  it("skips a value the read doesn't take, and a chip it can't read", () => {
    const odd = pageOf('/dashboard/insights', [
      ['topic', 'Old topic', 'not-a-uuid'],
      ['sentiment', 'Negative', 'negative'],
    ]);
    expect(added('get_visibility_trend', odd)).toEqual({ input: {}, applied: [] });
    // A platform on a page Chat doesn't know: not guessed.
    const unknown = pageOf('/dashboard/shopping', [['platform', 'ChatGPT', 'chatgpt-web']]);
    expect(added('get_mentions_summary', unknown)).toEqual({ input: {}, applied: [] });
  });

  it('gives nothing to a read of another brand, or with the brand left out', () => {
    const other = pageFilterInputs(tool('list_citations'), { brand_id: OTHER }, page, 'Hi');
    expect(other).toEqual({ input: { brand_id: OTHER }, applied: [] });
    const noBrand = pageScopeOf({
      route: '/dashboard/citations',
      chips: [{ key: 'filter:region', label: 'US', value: 'US' }],
    });
    expect(added('list_citations', noBrand)).toEqual({ input: {}, applied: [] });
    expect(added('list_citations', null)).toEqual({ input: {}, applied: [] });
  });
});

describe('a question that asks for all of them', () => {
  it('knows "all platforms", "every region", "tüm konular" and their like', () => {
    for (const [key, question] of [
      ['platform', 'How do we do across all platforms?'],
      ['platform', 'Compare every AI engine'],
      ['platform', 'Her platformda durum ne?'],
      ['region', 'In all countries'],
      ['region', 'Tüm bölgelerde'],
      ['topic', 'For each topic, the top domain'],
      ['sources', 'All sources, please'],
      ['status', 'Actions of every status'],
    ] as const) {
      expect(asksAllOf(key, question), question).toBe(true);
    }
    for (const [key, question] of [
      ['platform', 'How are we doing on ChatGPT?'],
      ['topic', 'What are my top cited domains?'],
      ['region', 'Is it all good?'],
      ['platform', null],
    ] as const) {
      expect(asksAllOf(key, question), String(question)).toBe(false);
    }
  });
});

// The owner's plan (2026-11-16, item 8): the page's search, from its view, is one more list
// filter: on the reads of the page's own list that take a search, in the lookups' words.
describe("the page's search", () => {
  /** A page with a search, as the side panel posts its context and view. */
  const searched = (route: string, search: string, filters: [string, string, string][] = []) =>
    pageScopeOf({
      route,
      chips: [
        { key: 'brand', label: 'Northwind', value: BRAND },
        ...filters.map(([key, label, value]) => ({ key: `filter:${key}`, label, value })),
      ],
      view: { search },
    });

  it('comes from the view, trimmed, and is none when empty', () => {
    expect(
      pageScopeOf({ route: '/dashboard/content', chips: [], view: { search: '  decaf ' } }),
    ).toMatchObject({ search: 'decaf' });
    expect(
      pageScopeOf({ route: '/dashboard/content', chips: [], view: { search: ' ' } }),
    ).not.toHaveProperty('search');
  });

  it("fills the search of its own list's reads only, beside its filters", () => {
    // On both Prompts routes: /dashboard/prompts opens on Tracked Prompts (page-route.ts).
    for (const route of ['/dashboard/prompts/tracked', '/dashboard/prompts']) {
      // A lookup read's search reads its list as listed with it (as_listed).
      expect(added('list_prompts', searched(route, 'skip a month')), route).toEqual({
        input: { search: 'skip a month', as_listed: true },
        applied: ['search'],
      });
    }
    const prompts = searched('/dashboard/prompts/tracked', 'skip a month');
    // A read of another page's list, or one with no search, takes none.
    expect(added('list_content_opportunities', prompts)).toEqual({ input: {}, applied: [] });
    expect(added('get_prompt_performance', prompts).applied).toEqual([]);
    const content = searched('/dashboard/content', 'office coffee', [['status', 'New', 'new']]);
    expect(added('list_content_opportunities', content)).toEqual({
      input: { status: 'new', search: 'office coffee', as_listed: true },
      applied: ['status', 'search'],
    });
    expect(added('list_drafts', content)).toEqual({ input: {}, applied: [] });
    // Mentions' search is the whole page's: every one of its reads that takes one.
    const mentions = searched('/dashboard/mentions', 'espresso');
    for (const name of ['list_mentions', 'get_mentions_summary', 'get_mentions_perception']) {
      expect(added(name, mentions), name).toEqual({
        input: { search: 'espresso' },
        applied: ['search'],
      });
    }
    // Actions' read takes no search: its rows are read by their codes.
    expect(
      added('list_action_center_tasks', searched('/dashboard/action-center/actions', 'gift box')),
    ).toEqual({
      input: {},
      applied: [],
    });
  });

  it("takes the lookups' words: 8 at most, of the first 200 characters, no wildcard", () => {
    const long = searched(
      '/dashboard/prompts/tracked',
      'one two three four five six seven eight nine ten',
    );
    expect(added('list_prompts', long).input).toEqual({
      search: 'one two three four five six seven eight',
      as_listed: true,
    });
    const odd = searched('/dashboard/prompts/tracked', `*decaf*, "beans"! ${'x'.repeat(300)}`);
    const search = String(added('list_prompts', odd).input.search);
    expect(search.startsWith('decaf beans ')).toBe(true);
    expect(search.length).toBeLessThanOrEqual(200);
    expect(search).not.toContain('*');
    expect(
      added('list_prompts', searched('/dashboard/prompts/tracked', '** ,, !')).applied,
    ).toEqual([]);
  });

  it("never over the model's own search or named rows, nor when the question asks for all", () => {
    const page = searched('/dashboard/prompts/tracked', 'skip a month');
    expect(added('list_prompts', page, { search: 'decaf' })).toEqual({
      input: { search: 'decaf' },
      applied: [],
    });
    // The model's own search on a lookup read names rows: none of the page's list filters
    // either, which the lookup (every status) wouldn't apply (the review of 2026-11-17).
    const content = searched('/dashboard/content', 'office coffee', [
      ['status', 'New', 'new'],
      ['impact', 'High', 'high'],
    ]);
    expect(added('list_content_opportunities', content, { search: 'gift box' })).toEqual({
      input: { search: 'gift box' },
      applied: [],
    });
    // Asked to search the list as listed, it takes them.
    expect(
      added('list_content_opportunities', content, { search: 'gift box', as_listed: true }),
    ).toEqual({
      input: { search: 'gift box', as_listed: true, status: 'new', impact: 'high' },
      applied: ['status', 'impact'],
    });
    // A read whose search is a filter (Mentions') keeps the page's other filters beside it.
    const mentions = searched('/dashboard/mentions', 'espresso', [['region', 'US', 'US']]);
    expect(added('list_mentions', mentions, { search: 'decaf' })).toEqual({
      input: { search: 'decaf', region: 'US' },
      applied: ['region'],
    });
    expect(added('list_prompts', page, { search: '' })).toEqual({
      input: { search: '' },
      applied: [],
    });
    expect(added('list_prompts', page, { ids: [PROMPT] })).toEqual({
      input: { ids: [PROMPT] },
      applied: [],
    });
    for (const question of [
      'How are all prompts doing?',
      'Tüm promptlar nasıl?',
      'Show every prompt',
      'Top 5 without the search',
    ]) {
      expect(added('list_prompts', page, {}, question).applied, question).toEqual([]);
    }
    expect(added('list_prompts', page, {}, 'How are these doing?').applied).toEqual(['search']);
    // Another brand's read, or no brand chip: none.
    expect(pageFilterInputs(tool('list_prompts'), { brand_id: OTHER }, page, 'Hi').applied).toEqual(
      [],
    );
    const noBrand = pageScopeOf({
      route: '/dashboard/prompts/tracked',
      chips: [],
      view: { search: 'x' },
    });
    expect(added('list_prompts', noBrand).applied).toEqual([]);
  });
});
