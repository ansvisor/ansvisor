// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { PLANS } from '@/config/plans';
import type { Json } from '@/types/supabase';

/**
 * Chat's scope decisions (W1-17; CHAT-04 items 2–6, Rule 1; CHAT-20 §7): the
 * person's date range or the app's 30 days, as the app's pages cut them, and
 * the all-time ask, the plan's platforms (refused when asked for, held to
 * when not), the row limits and what a cut list says.
 */

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { rpc: vi.fn() } }));

const {
  DEFAULT_RANGE_DAYS,
  NAMED_ROWS,
  PAGED_READS,
  ROW_CAP,
  ROW_LIMITS,
  TREND_ROWS,
  asksAllTime,
  capRows,
  givesDates,
  namesRows,
  pagedRead,
  planPlatforms,
  resolveDates,
  scopeRead,
  takesDates,
} = await import('./scope');
const { CHAT_TOOLS } = await import('./registry/tools');
const { getDateRange } = await import('@/lib/date-range');

const NOW = new Date('2026-10-30T12:00:00.000Z');
const BRAND = '11111111-1111-4111-8111-111111111111';

const readTool = (shape: z.ZodRawShape, planGate: { platforms?: true } | null = null) => ({
  name: 'test_read',
  inputSchema: z.object({ brand_id: z.string(), ...shape }),
  planGate,
});

const facts = (over: Partial<Parameters<typeof scopeRead>[2]> = {}) => ({
  question: 'How are we doing?',
  limits: PLANS.growth.limits,
  planName: 'Growth',
  now: NOW,
  ...over,
});

describe('dates', () => {
  it("reads the app's last 30 days when none are given: today and the 29 days before", () => {
    expect(resolveDates(undefined, undefined, false, NOW)).toEqual({
      dateFrom: '2026-10-01',
      dateTo: '2026-10-30',
      dates: 'default',
      range: '30d',
      values: { date_from: '2026-10-01', date_to: '2026-10-30' },
    });
    expect(DEFAULT_RANGE_DAYS).toBe(30);
  });

  it("reads the person's range as the app's pages cut the same preset", () => {
    for (const preset of ['7d', '30d', '90d'] as const) {
      const page = getDateRange(preset, { from: '', to: '' }, NOW).days!;
      expect(resolveDates(undefined, undefined, false, NOW, preset)).toMatchObject({
        dates: 'default',
        range: preset,
        values: { date_from: page.dayFrom, date_to: page.dayTo },
      });
    }
    // The last 24 hours roll, as the pages' own: from this hour yesterday.
    expect(resolveDates(undefined, undefined, false, NOW, '24h').values).toEqual({
      date_from: getDateRange('24h', { from: '', to: '' }, NOW).dateFrom,
      date_to: '2026-10-30',
    });
    expect(resolveDates(null, null, false, NOW, '2026-10-01/2026-10-15').values).toEqual({
      date_from: '2026-10-01',
      date_to: '2026-10-15',
    });
    // The model's own dates, from a period the person named, still win.
    expect(resolveDates('2026-10-20', '2026-10-25', false, NOW, '7d').values).toEqual({
      date_from: '2026-10-20',
      date_to: '2026-10-25',
    });
  });

  it('knows which reads cover a period, and which inputs give their own', () => {
    expect(takesDates(readTool({ date_from: z.string().optional() }))).toBe(true);
    expect(takesDates(readTool({ days: z.number().optional() }))).toBe(true);
    expect(takesDates(readTool({ limit: z.number().optional() }))).toBe(false);
    expect(givesDates({ brand_id: BRAND })).toBe(false);
    expect(givesDates({ brand_id: BRAND, date_from: ' ' })).toBe(false);
    expect(givesDates({ brand_id: BRAND, date_to: '2026-10-01' })).toBe(true);
    expect(givesDates({ brand_id: BRAND, days: 7 })).toBe(true);
  });

  it('reads all time only on an all-time ask', () => {
    expect(resolveDates(null, null, true, NOW)).toMatchObject({ dates: 'all_time', values: {} });
    for (const question of [
      'Citations of all time',
      'all-time best prompts',
      'How have we done since we started?',
      'Başından beri en iyi promptlarımız',
      'Tüm zamanların en çok atıf alan sayfası',
      'Şimdiye kadar kaç kez anıldık?',
    ]) {
      expect(asksAllTime(question)).toBe(true);
    }
    for (const question of ['How are we doing?', 'Bu hafta Perplexity’de neden düştük?', null]) {
      expect(asksAllTime(question)).toBe(false);
    }
  });

  it("keeps the model's dates, ends today at the latest and puts them in order", () => {
    expect(resolveDates('2026-10-01', '2026-10-15', false, NOW).values).toEqual({
      date_from: '2026-10-01',
      date_to: '2026-10-15',
    });
    expect(resolveDates('2026-10-20', '2027-01-01', false, NOW).values).toEqual({
      date_from: '2026-10-20',
      date_to: '2026-10-30',
    });
    expect(resolveDates('2026-10-15', '2026-10-01', false, NOW).values).toEqual({
      date_from: '2026-10-01',
      date_to: '2026-10-15',
    });
    // Only an end: the 30 days before it. Only a start: until today.
    expect(resolveDates(undefined, '2026-10-10', false, NOW).values).toEqual({
      date_from: '2026-09-10',
      date_to: '2026-10-10',
    });
    expect(resolveDates('2026-10-01', undefined, false, NOW).values).toEqual({
      date_from: '2026-10-01',
      date_to: '2026-10-30',
    });
    // Not a date: as if none were given.
    expect(resolveDates('last week', undefined, false, NOW).dates).toBe('default');
    // A start after today: neither date passes today.
    expect(resolveDates('2027-02-01', '2027-03-01', false, NOW).values).toEqual({
      date_from: '2026-10-30',
      date_to: '2026-10-30',
    });
    expect(resolveDates('2027-02-01', undefined, false, NOW).values).toEqual({
      date_from: '2026-10-30',
      date_to: '2026-10-30',
    });
  });

  it('gives a `days` read its default, or the most it reaches on an all-time ask', async () => {
    const tool = { ...readTool({ days: z.number().int().min(1).max(90).optional() }) };
    const plain = await scopeRead(tool, { brand_id: BRAND }, facts());
    expect(plain).toMatchObject({ input: { days: 30 }, used: { dates: 'days', days: 30 } });
    const google = await scopeRead(
      { ...tool, name: 'get_gsc_summary' },
      { brand_id: BRAND },
      facts(),
    );
    expect(google).toMatchObject({ input: { days: 28 } });
    const all = await scopeRead(tool, { brand_id: BRAND }, facts({ question: 'all time please' }));
    expect(all).toMatchObject({ input: { days: 90 }, used: { dates: 'all_time', days: 90 } });
  });

  it("gives a `days` read the person's range in days back, Google's reads too", async () => {
    const tool = { ...readTool({ days: z.number().int().min(1).max(90).optional() }) };
    expect(await scopeRead(tool, { brand_id: BRAND }, facts({ range: '7d' }))).toMatchObject({
      input: { days: 7 },
      used: { dates: 'days', days: 7, range: '7d' },
    });
    expect(
      await scopeRead(
        { ...tool, name: 'get_gsc_summary' },
        { brand_id: BRAND },
        facts({ range: '90d' }),
      ),
    ).toMatchObject({ input: { days: 90 }, used: { range: '90d' } });
    expect(await scopeRead(tool, { brand_id: BRAND }, facts({ range: '24h' }))).toMatchObject({
      input: { days: 1 },
    });
    // A custom range: from its first day to today.
    expect(
      await scopeRead(tool, { brand_id: BRAND }, facts({ range: '2026-10-21/2026-10-25' })),
    ).toMatchObject({ input: { days: 10 } });
    // Days the model gave stay, with no range.
    const asked = await scopeRead(tool, { brand_id: BRAND, days: 14 }, facts({ range: '7d' }));
    expect(asked).toMatchObject({ input: { days: 14 } });
    expect(asked.kind === 'read' && asked.used.range).toBeUndefined();
  });

  it("reads a date read's window from the person's range", async () => {
    const tool = readTool({ date_from: z.string().optional(), date_to: z.string().optional() });
    expect(await scopeRead(tool, { brand_id: BRAND }, facts({ range: '7d' }))).toMatchObject({
      input: { date_from: '2026-10-24', date_to: '2026-10-30' },
      used: { dates: 'default', range: '7d', dateFrom: '2026-10-24', dateTo: '2026-10-30' },
    });
    // None set: the app's 30 days.
    expect(await scopeRead(tool, { brand_id: BRAND }, facts({ range: null }))).toMatchObject({
      input: { date_from: '2026-10-01', date_to: '2026-10-30' },
      used: { range: '30d' },
    });
  });
});

describe('platforms', () => {
  const visibility = readTool(
    { model: z.string().optional(), date_from: z.string().optional() },
    { platforms: true },
  );

  it('knows what each plan tracks', () => {
    expect(planPlatforms(PLANS.starter.limits)).toMatchObject({
      scrapers: ['chatgpt-web', 'gemini-web'],
      models: [],
      someScrapers: true,
    });
    // Growth: every scraped app, no Claude.
    const growth = planPlatforms(PLANS.growth.limits)!;
    expect(growth.someScrapers).toBe(false);
    expect(growth.families.has('anthropic')).toBe(false);
    expect(planPlatforms(null)).toBeNull();
  });

  it('refuses a platform the plan does not track, naming what it does', async () => {
    const starter = facts({ limits: PLANS.starter.limits, planName: 'Starter' });
    const scoped = await scopeRead(
      readTool({ platform: z.string().optional() }),
      { brand_id: BRAND, platform: 'perplexity-web' },
      starter,
    );
    expect(scoped).toEqual({
      kind: 'not_on_plan',
      result: {
        code: 'not_on_plan',
        plan: 'Starter',
        asked: ['Perplexity'],
        on_plan: expect.arrayContaining(['ChatGPT']),
      },
    });
    // Claude on Growth (CHAT-04 item 2).
    const claude = await scopeRead(
      visibility,
      { brand_id: BRAND, model: 'claude-sonnet-5' },
      facts(),
    );
    expect(claude.kind).toBe('not_on_plan');
  });

  it('keeps the asked platforms the plan tracks and drops the rest', async () => {
    const scoped = await scopeRead(
      visibility,
      { brand_id: BRAND, model: 'gpt-5-3-mini,sonar-pro' },
      facts({ limits: PLANS.starter.limits, planName: 'Starter' }),
    );
    expect(scoped).toMatchObject({
      kind: 'read',
      input: { model: 'gpt-5-3-mini' },
      used: { platforms: ['gpt-5-3-mini'] },
    });
  });

  it("holds a read with no platform to the plan's, on a plan that tracks some", async () => {
    const modelsOf = vi.fn(async () => ['gpt-5-3-mini', 'sonar-pro', 'google-aio', 'gemini-web']);
    const scoped = await scopeRead(
      visibility,
      { brand_id: BRAND },
      facts({ limits: PLANS.starter.limits, planName: 'Starter', modelsOf }),
    );
    expect(modelsOf).toHaveBeenCalledWith(BRAND);
    expect(scoped).toMatchObject({
      input: { model: 'gpt-5-3-mini,gemini-web' },
      platformNames: expect.arrayContaining(['ChatGPT']),
    });
    // None of the plan's seen yet: its own ids, which match its rows or none.
    const unseen = await scopeRead(
      visibility,
      { brand_id: BRAND },
      facts({ limits: PLANS.starter.limits, modelsOf: async () => ['sonar-pro'] }),
    );
    expect(unseen).toMatchObject({ input: { model: 'chatgpt-web,gemini-web' } });
    // The brand's models couldn't be read: not read, rather than held to ids that read empty.
    const failed = await scopeRead(
      visibility,
      { brand_id: BRAND },
      facts({ limits: PLANS.starter.limits, modelsOf: async () => null }),
    );
    expect(failed).toEqual({ kind: 'failed' });
  });

  it('leaves a plan that tracks every app alone when no platform is named', async () => {
    const modelsOf = vi.fn(async () => []);
    const scoped = await scopeRead(visibility, { brand_id: BRAND }, facts({ modelsOf }));
    expect(modelsOf).not.toHaveBeenCalled();
    expect(scoped).toMatchObject({ input: { brand_id: BRAND }, used: { platforms: null } });
    expect((scoped as { input: Record<string, unknown> }).input.model).toBeUndefined();
  });
});

describe("the page's period and filters (the owner's rule, 2026-11-16)", () => {
  const citations = {
    ...readTool(
      {
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        model: z.string().optional(),
        source_filter: z.enum(['all', 'owned', 'competitor', 'external']).optional(),
      },
      { platforms: true },
    ),
    route: '/dashboard/citations',
  };
  const page = {
    route: '/dashboard/citations',
    brandId: BRAND,
    filters: [
      { key: 'platform', label: 'ChatGPT', value: 'chatgpt-web' },
      { key: 'sources', label: 'Brand', value: 'own' },
    ],
  };

  it("reads the page's range and filters, and says they were the page's", async () => {
    const scoped = await scopeRead(
      citations,
      { brand_id: BRAND },
      facts({ range: '7d', rangeFrom: 'page', page }),
    );
    expect(scoped).toMatchObject({
      kind: 'read',
      input: {
        date_from: '2026-10-24',
        date_to: '2026-10-30',
        model: 'chatgpt-web',
        source_filter: 'owned',
      },
      used: {
        dates: 'default',
        range: '7d',
        platforms: ['chatgpt-web'],
        page: ['period', 'platform', 'sources'],
      },
    });
  });

  it("names no period of the page's when the dates are the model's, the person's or all time asked", async () => {
    const asked = await scopeRead(
      citations,
      { brand_id: BRAND, date_from: '2026-10-01', date_to: '2026-10-15' },
      facts({ range: '7d', rangeFrom: 'page', page }),
    );
    expect(asked.kind === 'read' && asked.used.page).toEqual(['platform', 'sources']);
    const saved = await scopeRead(citations, { brand_id: BRAND }, facts({ range: '30d' }));
    expect(saved.kind === 'read' && saved.used.page).toBeUndefined();
    const allTime = await scopeRead(
      citations,
      { brand_id: BRAND },
      facts({ question: 'Citations of all time', range: '7d', rangeFrom: 'page' }),
    );
    expect(allTime).toMatchObject({ used: { dates: 'all_time' } });
    expect(allTime.kind === 'read' && allTime.used.page).toBeUndefined();
  });

  it('reads all of it when the page shows All time', async () => {
    const scoped = await scopeRead(
      citations,
      { brand_id: BRAND },
      facts({ range: null, rangeFrom: 'page', allTime: true }),
    );
    expect(scoped).toMatchObject({
      input: { brand_id: BRAND },
      used: { dates: 'all_time', page: ['period'] },
    });
    expect(scoped.kind === 'read' && scoped.input).not.toHaveProperty('date_from');
    const days = await scopeRead(
      readTool({ days: z.number().int().min(1).max(90).optional() }),
      { brand_id: BRAND },
      facts({ rangeFrom: 'page', allTime: true }),
    );
    expect(days).toMatchObject({
      input: { days: 90 },
      used: { dates: 'all_time', page: ['period'] },
    });
  });

  it("holds the page's platform to the plan, as one the person named", async () => {
    const scoped = await scopeRead(
      citations,
      { brand_id: BRAND },
      facts({
        limits: PLANS.starter.limits,
        planName: 'Starter',
        page: {
          ...page,
          filters: [{ key: 'platform', label: 'Perplexity', value: 'perplexity-web' }],
        },
      }),
    );
    expect(scoped).toMatchObject({ kind: 'not_on_plan', result: { asked: ['Perplexity'] } });
  });

  it("gives Ads' read its own page's period, or one the message named; else its 30 days", async () => {
    const ads = CHAT_TOOLS.find((t) => t.name === 'get_ads_opportunities')!;
    const adsPage = { route: '/dashboard/ads', brandId: BRAND, filters: [] };
    const citationsPage = { ...adsPage, route: '/dashboard/citations' };
    const read = (over: Partial<Parameters<typeof scopeRead>[2]>, raw = {}) =>
      scopeRead(ads, { brand_id: BRAND, ...raw }, facts(over));
    // On Ads: the page's period.
    for (const period of ['7d', '30d', '90d'] as const) {
      expect(await read({ range: period, rangeFrom: 'page', page: adsPage })).toMatchObject({
        input: { period },
        used: { dates: 'default', range: period, page: ['period'] },
      });
    }
    expect(await read({ range: '7d', rangeFrom: 'page', page: adsPage })).toMatchObject({
      used: { dateFrom: '2026-10-24', dateTo: '2026-10-30' },
    });
    // A period the message named, on Ads or off it.
    expect(await read({ range: '90d', rangeFrom: 'message', page: citationsPage })).toMatchObject({
      input: { period: '90d' },
    });
    // Off Ads: the person's default and another page's range leave Ads' own 30 days.
    for (const over of [
      { range: '7d', rangeFrom: 'default' },
      { range: '90d', rangeFrom: 'default' },
      { range: '90d' },
      { range: '7d', rangeFrom: 'page', page: citationsPage },
      { range: '7d', rangeFrom: 'page', page: null },
      // A range Ads doesn't offer, or all time.
      { range: '24h', rangeFrom: 'page', page: adsPage },
      { range: '7d', rangeFrom: 'page', page: adsPage, allTime: true },
      {},
    ] as const) {
      const scoped = await read(over);
      expect(scoped.kind === 'read' && scoped.input, JSON.stringify(over)).not.toHaveProperty(
        'period',
      );
    }
    // The model's own period wins.
    expect(
      await read({ range: '7d', rangeFrom: 'page', page: adsPage }, { period: '30d' }),
    ).toMatchObject({ input: { period: '30d' }, used: { dates: 'none' } });
  });
});

describe('rows', () => {
  const listed = readTool({ limit: z.number().int().min(1).max(100).optional() });

  it("reads the tool's default, the model's count up to the max, and one more to see if there are more", async () => {
    const named = { ...listed, name: 'get_gsc_queries' };
    expect(await scopeRead(named, { brand_id: BRAND }, facts())).toMatchObject({
      input: { limit: 26 },
      cap: { rows: 25, probe: 26 },
    });
    expect(await scopeRead(named, { brand_id: BRAND, limit: 500 }, facts())).toMatchObject({
      input: { limit: 50 },
      cap: { rows: 49, probe: 50 },
    });
    // A schema that can't take one more: no probe.
    const tight = readTool({ limit: z.number().int().min(1).max(10).optional() });
    expect(
      await scopeRead({ ...tight, name: 'x' }, { brand_id: BRAND, limit: 10 }, facts()),
    ).toMatchObject({ input: { limit: 10 }, cap: { rows: 10, probe: null } });
  });

  it('reads a page of 50 actions, not 10, and no extra row: the read counts them all itself', async () => {
    const actions = CHAT_TOOLS.find((t) => t.name === 'list_action_center_tasks')!;
    expect(ROW_LIMITS.list_action_center_tasks).toEqual({ default: ROW_CAP, max: ROW_CAP });
    expect(await scopeRead(actions, { brand_id: BRAND }, facts())).toMatchObject({
      input: { limit: 50 },
      used: { rows: 50 },
      cap: { rows: 50, probe: null },
    });
    // The next page keeps its offset; a bigger page is held to 50.
    expect(
      await scopeRead(actions, { brand_id: BRAND, limit: 200, offset: 50 }, facts()),
    ).toMatchObject({ input: { limit: 50, offset: 50 }, cap: { rows: 50, probe: null } });
    expect([...PAGED_READS].every((name) => CHAT_TOOLS.some((t) => t.name === name))).toBe(true);
  });

  it('never cuts the actions a read names by their codes, whatever limit came with them', async () => {
    // The owner's report (2026-11-16): a code can name two actions, and both come back.
    const actions = CHAT_TOOLS.find((t) => t.name === 'list_action_center_tasks')!;
    const scoped = await scopeRead(
      actions,
      { brand_id: BRAND, codes: ['AC-59', 'AC 481'], limit: 1 },
      facts(),
    );
    expect(scoped).toMatchObject({
      input: { brand_id: BRAND, codes: ['AC-59', 'AC 481'] },
      cap: { rows: ROW_CAP, probe: null },
    });
    expect(scoped.kind === 'read' && 'limit' in scoped.input).toBe(false);
    for (const [name, fields] of Object.entries(NAMED_ROWS)) {
      const tool = CHAT_TOOLS.find((t) => t.name === name)!;
      for (const field of fields) expect(field in tool.inputSchema.shape, name).toBe(true);
    }
  });

  // The owner's plan (2026-11-16, item 2): "what is X?" never depends on X being on the first page.
  it.each([
    ['list_signals', { codes: ['S-07', 's12'] }],
    ['list_signals', { ids: ['a8e00000-0000-4000-8000-000000000001'] }],
    ['list_prompts', { search: 'cold brew' }],
    ['list_prompts', { ids: ['a1e00000-0000-4000-8000-000000000001'] }],
    ['get_prompt_performance', { prompt_ids: ['a1e00000-0000-4000-8000-000000000001'] }],
    ['list_citations', { domains: ['www.example.com'] }],
    ['list_citations', { urls: ['https://example.com/a/'] }],
    ['list_content_opportunities', { search: 'storage guide' }],
    ['list_drafts', { search: 'gift boxes' }],
    ['get_reports', { ids: ['a4e00000-0000-4000-8000-000000000001'] }],
  ])('never cuts a lookup by %s %j to a limit given beside it', async (name, lookup) => {
    const tool = CHAT_TOOLS.find((t) => t.name === name)!;
    const scoped = await scopeRead(tool, { brand_id: BRAND, ...lookup, limit: 1 }, facts());
    expect(scoped).toMatchObject({ kind: 'read', input: lookup, cap: { rows: ROW_CAP } });
    expect(scoped.kind === 'read' && 'limit' in scoped.input, name).toBe(false);
    // The same read without a lookup keeps its page.
    const page = await scopeRead(tool, { brand_id: BRAND, limit: 1 }, facts());
    expect(page.kind === 'read' && page.input.limit, name).toBe(1);
  });

  it('reads blank words or an empty list as no lookup', () => {
    expect(namesRows('list_prompts', { search: '  ' })).toBe(false);
    // The page's search, as listed (page-scope.ts AS_LISTED): the list's page, not a lookup.
    expect(namesRows('list_prompts', { search: 'decaf', as_listed: true })).toBe(false);
    expect(namesRows('list_content_opportunities', { search: 'x', as_listed: true })).toBe(false);
    expect(namesRows('list_prompts', { ids: [BRAND], search: 'x', as_listed: true })).toBe(true);
    expect(namesRows('list_signals', { codes: [] })).toBe(false);
    expect(namesRows('list_signals', { codes: ['S-07'] })).toBe(true);
    expect(namesRows('list_topics', { search: 'x' })).toBe(false);
  });

  it('cuts every list to its rows and says how many were left out', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i })) as Json[];
    const exact = capRows(
      { items: rows(60), totals: { n: 60, pages: rows(55) }, ok: true },
      {
        rows: 50,
        probe: null,
      },
    );
    expect(exact.cut).toBe(true);
    expect(exact.value).toMatchObject({
      items_more: 10,
      totals: { pages_more: 5 },
      truncated: true,
      ok: true,
    });
    expect((exact.value as { items: Json[] }).items).toHaveLength(50);
    // A probe's extra row: more exist, the count isn't known.
    expect(capRows({ items: rows(11) }, { rows: 10, probe: 11 }).value).toMatchObject({
      items_more: null,
      truncated: true,
    });
    expect(capRows(rows(3), { rows: 50, probe: null })).toEqual({ value: rows(3), cut: false });
    expect(capRows(rows(52), { rows: 50, probe: null }).value).toMatchObject({
      more: 2,
      truncated: true,
    });
    // A series oldest first (a trend's days) keeps its latest rows.
    const days = Array.from({ length: 91 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 7, 1) + i * 86_400_000).toISOString().slice(0, 10),
    })) as Json[];
    const trend = capRows({ granularity: 'day', buckets: days }, { rows: 50, probe: null });
    const kept = (trend.value as { buckets: { date: string }[] }).buckets;
    expect(kept).toHaveLength(50);
    expect(kept[kept.length - 1].date).toBe('2026-10-30');
    expect(trend.value).toMatchObject({ buckets_more: 41, truncated: true });
    // Newest first: its first rows are its latest.
    const newest = capRows([...days].reverse(), { rows: 50, probe: null }).value;
    expect((newest as { items: { date: string }[] }).items[0].date).toBe('2026-10-30');
    // Lists inside rows stay as they are.
    const nested = capRows({ items: [{ tags: rows(80) }] as Json[] }, { rows: 50, probe: null });
    expect(nested.cut).toBe(false);
  });

  it('has a limit for every registry read that takes one, within its schema', () => {
    for (const tool of CHAT_TOOLS.filter((t) => t.class === 'read')) {
      const shape = tool.inputSchema.shape as Record<string, unknown>;
      const limits = ROW_LIMITS[tool.name];
      if ('limit' in shape) {
        // A list read pages ROW_CAP at a time; any other read has its own limit.
        expect(limits !== undefined || pagedRead(tool), tool.name).toBe(true);
        // One more for the probe, unless the read counts its rows itself.
        const probe = pagedRead(tool) ? 0 : 1;
        const input = { ...tool.fixture.input, limit: (limits?.max ?? ROW_CAP) + probe };
        expect(tool.inputSchema.safeParse(input).success, tool.name).toBe(true);
      }
      // A trend reads every day of its period (TREND_ROWS); any other list ROW_CAP at most.
      const most = tool.name === 'get_visibility_trend' ? TREND_ROWS : ROW_CAP;
      expect(limits ? limits.max <= most : true, tool.name).toBe(true);
    }
    for (const name of Object.keys(ROW_LIMITS)) {
      expect(
        CHAT_TOOLS.some((tool) => tool.name === name),
        name,
      ).toBe(true);
    }
  });

  // The owner's rule (2026-11-16): Chat reads all a page shows, a page of 50 at a time.
  const LIST_READS = [
    'list_brands',
    'list_prompts',
    'get_prompt_performance',
    'list_prompt_suggestions',
    'get_prompt_volumes',
    'list_topics',
    'list_mentions',
    'list_citations',
    'list_competitors',
    'get_site_audit_summary',
    'list_action_center_tasks',
    'list_signals',
    'get_action_history',
    'list_content_opportunities',
    'list_drafts',
    'get_reports',
    'get_ads_opportunities',
  ];

  it.each(LIST_READS)('pages %s: 50 by default, its offset kept, no extra row', async (name) => {
    const tool = CHAT_TOOLS.find((t) => t.name === name)!;
    expect(pagedRead(tool)).toBe(true);
    expect(ROW_LIMITS[name]?.max ?? ROW_CAP).toBe(ROW_CAP);
    expect(await scopeRead(tool, { ...tool.fixture.input }, facts())).toMatchObject({
      input: { limit: ROW_CAP },
      cap: { rows: ROW_CAP, probe: null },
    });
    expect(
      await scopeRead(tool, { ...tool.fixture.input, limit: 200, offset: 100 }, facts()),
    ).toMatchObject({ input: { limit: ROW_CAP, offset: 100 }, cap: { probe: null } });
    expect(tool.description).toContain('next_offset');
  });
});
