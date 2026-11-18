// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * Chat counts and ranks as the pages do (the owner's plan of 2026-11-16,
 * item 7: its numbers and its "top" lists equal the screen). Each fixture
 * is read the way Chat reads it and the way the page reads it, with the
 * page's own function or rule: citations past PostgREST's 1,000 rows (from
 * the page's daily rollups, never pages of answers), Overview's and
 * Citations' Last 24 hours, the Prompts table's Visibility and order (the
 * page's own function, on Starter too), the Actions and Content lists'
 * default order, the Why read's periods, and a trend's every day.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));
// The pages' own reads, through the person's client: the same tables here.
vi.mock('@/lib/supabase/server', async () => ({
  createClient: async () => (await import('@/lib/supabase/admin')).supabaseAdmin,
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { CHAT_TOOLS } = await import('./registry/tools');
const { scopeRead, capRows } = await import('./scope');
const { fitResult } = await import('./fit');
const { readBudget, resultCharsFor } = await import('./run-limits');
const { pageOrderLine, pageOrderOf } = await import('./page-order');
const { latestRunDaysFor } = await import('@/lib/mcp/overview-reads');
const { PLANS } = await import('@/config/plans');
const { whyPeriods } = await import('@/lib/mcp/why');
const { getCitationsOverview } = await import('@/lib/actions/citations');
const { getTrackingWindow, getPromptVisibilitySummaries } = await import('@/lib/actions/tracking');
const { comparePromptSortRows } =
  await import('@/app/[locale]/(dashboard)/dashboard/prompts/prompt-sort');
const { compareActions, DEFAULT_ACTION_SORT } = await import('@/lib/action-center/sort');
const { DEFAULT_OPPORTUNITY_SORT } = await import('@/lib/content/opportunity-list');
const { resolvePromptRange } = await import('@/config/prompt-options');
const { getDateRange } = await import('@/lib/date-range');
const { deltaDayWindows } = await import('@/lib/insights-windows');

const ORG = 'org-1';
const BRAND = 'b1000000-0000-4000-8000-000000000001';
const AUTH: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: ORG,
  role: 'analyst',
  apiKeyId: 'agent-internal',
  brandAccess: 'all',
};
const NOW = new Date('2026-11-16T12:00:00.000Z');
const MIN = 60_000;
const uuid = (group: string, n: number) => `${group}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tool = (name: string) => CHAT_TOOLS.find((t) => t.name === name)!;
const run = (name: string, input: Record<string, unknown>) =>
  tool(name).run(AUTH as never, tool(name).inputSchema.parse(input) as never) as Promise<
    Record<string, unknown>
  >;
type Row = Record<string, unknown>;

/**
 * The database's functions, as PostgREST answers them: awaited whole, or a
 * set-returning one read a page at a time (`.order().range()`), never more
 * than max_rows a page. Unknown: PGRST202, as before a migration.
 */
const fns: Record<string, (args: Row) => unknown> = {};
const calls: { fn: string; args: Row }[] = [];
function rpc(fn: string, args: Row = {}) {
  let order: string | null = null;
  let from = 0;
  let to = Number.POSITIVE_INFINITY;
  const answer = async () => {
    calls.push({ fn, args });
    const body = fns[fn];
    if (!body) return { data: null, error: { code: 'PGRST202', message: `No function ${fn}` } };
    let data = body(args);
    if (Array.isArray(data)) {
      const rows = order
        ? [...data].sort((a, b) => String(a[order!]).localeCompare(String(b[order!])))
        : data;
      data = rows.slice(from, Math.min(to + 1, from + (db.maxRows ?? Infinity)));
    }
    return { data, error: null };
  };
  const call = {
    order(column: string) {
      order = column;
      return call;
    },
    range(start: number, end: number) {
      from = start;
      to = end;
      return call;
    },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return answer().then(resolve, reject);
    },
  };
  return call;
}
(db as unknown as { rpc: typeof rpc }).rpc = rpc;

/**
 * Each table a read selected from, and those it paged with an offset
 * (`.range()`): the reads the review asked to leave behind (2026-11-16).
 */
const reads: { table: string; ranged: boolean }[] = [];
const plainFrom = db.from.bind(db);
db.from = (table: string) => {
  const builder = plainFrom(table);
  const read = { table, ranged: false };
  reads.push(read);
  const range = builder.range.bind(builder);
  builder.range = (from: number, to: number) => {
    read.ranged = true;
    return range(from, to);
  };
  return builder;
};
/** The selects of a table since the last reset: how many, and whether any paged by offset. */
const readsOf = (table: string) => reads.filter((r) => r.table === table);

const answers = () => (db.tables.prompt_results ?? []) as Row[];
const day = (at: unknown) => String(at).slice(0, 10);
const inDays = (row: Row, args: Row) =>
  (!args.p_day_from || day(row.created_at) >= String(args.p_day_from)) &&
  (!args.p_day_to || day(row.created_at) <= String(args.p_day_to));
const inWindow = (row: Row, args: Row) =>
  (!args.p_date_from || String(row.created_at) >= String(args.p_date_from)) &&
  (!args.p_date_to || String(row.created_at) <= String(args.p_date_to));
const host = (url: string) => new URL(url).hostname.replace(/^www\./, '');

beforeEach(() => {
  db.tables = { brands: [{ id: BRAND, organization_id: ORG, name: 'Brewline' }] };
  db.log = [];
  db.maxRows = 1000;
  calls.length = 0;
  reads.length = 0;
  for (const key of Object.keys(fns)) delete fns[key];
});
afterEach(() => {
  vi.useRealTimers();
});

// ─── Citations past 1,000 answers ───────────────────────────────────────────

describe('citations past 1,000 answers in the window', () => {
  /** 2,400 answers over three days: every other one cites the brand, every third the press. */
  const busyWindow = () =>
    Array.from({ length: 2_400 }, (_, i) => ({
      id: uuid('a0000000', i),
      brand_id: BRAND,
      prompt_id: uuid('9a000000', i % 4),
      platform: 'chatgpt-web',
      model_used: 'chatgpt-web',
      region: 'US',
      created_at: new Date(Date.parse('2026-11-12T23:00:00Z') - i * MIN).toISOString(),
      citation_count: 1,
      citations: [
        ...(i % 2 === 0 ? [{ url: 'https://brewline.example/subscriptions', title: 'Subs' }] : []),
        ...(i % 3 === 0 ? [{ url: 'https://beanbulletin.example/best', title: 'Best' }] : []),
      ],
    }));

  /** The Citations page's daily functions (00118), over every answer of the days. */
  const citationFunctions = () => {
    fns.citations_window_stats_daily = (args) => [
      { results: answers().filter((r) => inDays(r, args)).length, regions: ['US'] },
    ];
    const domains = (args: Row) => {
      const by = new Map<string, { total: number; results: Set<unknown> }>();
      for (const answer of answers().filter((r) => inDays(r, args))) {
        for (const cite of answer.citations as { url: string }[]) {
          const row = by.get(host(cite.url)) ?? { total: 0, results: new Set() };
          row.total += 1;
          row.results.add(answer.id);
          by.set(host(cite.url), row);
        }
      }
      return [...by].map(([domain, row]) => ({
        domain,
        total_citations: row.total,
        results_citing: row.results.size,
        models: ['chatgpt-web'],
      }));
    };
    fns.citations_domains_daily = domains;
    fns.citations_urls_daily = () => [];
  };

  it("counts every answer from the page's daily rollups, where one read stopped at 1,000", async () => {
    db.tables.prompt_results = busyWindow();
    citationFunctions();
    // One plain select of the window: PostgREST's 1,000 rows, as Chat read it before.
    expect(((await db.from('prompt_results').select('*')).data as Row[]).length).toBe(1_000);
    reads.length = 0;

    const chat = (await run('list_citations', {
      brand_id: BRAND,
      date_from: '2026-11-10',
      date_to: '2026-11-12',
    })) as {
      totals: { citations: number; domains: number; avg_citations_per_result: number };
      top_domains: { domain: string; total_citations: number; results_citing: number }[];
      answers_cut?: { counted_from: string | null; note: string };
      note: string;
    };
    // The page's own daily functions over the window's days, the service role's after the brand check.
    const daily = calls.filter((c) => c.fn.endsWith('_daily')).map((c) => c.fn);
    expect(daily.sort()).toEqual(['citations_domains_daily', 'citations_window_stats_daily']);
    expect(calls.find((c) => c.fn === 'citations_domains_daily')!.args).toMatchObject({
      p_brand_id: BRAND,
      p_day_from: '2026-11-10',
      p_day_to: '2026-11-12',
    });
    // The answers: one bounded request for the pages, never pages of them by offset.
    expect(readsOf('prompt_results')).toHaveLength(1);
    expect(readsOf('prompt_results').some((r) => r.ranged)).toBe(false);
    const page = await getCitationsOverview(BRAND, {
      datePreset: 'custom',
      dateFrom: '2026-11-10',
      dateTo: '2026-11-12',
    });

    expect(chat.totals.citations).toBe(page.totals.citations);
    expect(chat.totals.citations).toBe(1_200 + 800);
    expect(chat.totals.avg_citations_per_result).toBe(page.totals.avgCitationsPerResult);
    expect(chat.totals.domains).toBe(page.totals.domains);
    expect(chat.top_domains.map((d) => [d.domain, d.total_citations, d.results_citing])).toEqual(
      page.rows.map((r) => [r.domain, r.totalCitations, r.resultsCiting]),
    );
    // The pages come from the newest answers read, and the result says so; the totals don't.
    expect(chat.answers_cut?.counted_from).toBe(answers()[999].created_at);
    expect(chat.note).toContain('The domains and citation totals cover the whole period');
    expect(chat.note).toContain('from 2026-11-12 on');
  });

  it("looks a named domain up in the page's rollups, its prompts in the one bounded read", async () => {
    db.tables.prompt_results = busyWindow();
    db.tables.prompts = [0, 1, 2, 3].map((n) => ({
      id: uuid('9a000000', n),
      text: `Prompt ${n}`,
      prompt_sets: { brand_id: BRAND },
    }));
    citationFunctions();
    const found = (await run('list_citations', {
      brand_id: BRAND,
      date_from: '2026-11-10',
      date_to: '2026-11-12',
      domains: ['beanbulletin.example'],
    })) as {
      domains: { domain: string; total_citations: number; prompts: { prompt_id: string }[] }[];
      answers_cut?: unknown;
    };
    const page = await getCitationsOverview(BRAND, {
      datePreset: 'custom',
      dateFrom: '2026-11-10',
      dateTo: '2026-11-12',
    });
    const row = page.rows.find((r) => r.domain === 'beanbulletin.example')!;
    // The domain's count is the page's row; the prompts citing it come from the newest answers read.
    expect(found.domains.map((d) => [d.domain, d.total_citations])).toEqual([
      ['beanbulletin.example', row.totalCitations],
    ]);
    expect(found.domains[0].prompts.length).toBeGreaterThan(0);
    expect(found.answers_cut).toBeDefined();
    expect(readsOf('prompt_results')).toHaveLength(1);
    expect(readsOf('prompt_results').some((r) => r.ranged)).toBe(false);
  });

  it('reads a window that fits the bounded read whole, with no cut', async () => {
    db.tables.prompt_results = busyWindow().slice(0, 600);
    citationFunctions();
    const chat = (await run('list_citations', {
      brand_id: BRAND,
      date_from: '2026-11-12',
      date_to: '2026-11-12',
    })) as { totals: { citations: number }; answers_cut?: unknown; top_urls: unknown[] };
    expect(chat.answers_cut).toBeUndefined();
    expect(chat.totals.citations).toBe(300 + 200);
    expect(chat.top_urls).toHaveLength(2);
    expect(readsOf('prompt_results')).toHaveLength(1);
  });

  it('adds up the visibility summary of a day starting inside a day over every answer too', async () => {
    db.tables.prompt_results = busyWindow().map((row, i) => ({
      ...row,
      visibility_score: 50,
      mention_count: i % 2,
      sentiment: 'neutral',
      competitor_mentions: [],
    }));
    // The Visibility page's raw aggregates for a window inside a day, as their SQL adds the answers up.
    fns.competitor_aggregates = (args) => {
      const rows = answers().filter((r) => inWindow(r, args));
      return {
        brand_row_count: rows.length,
        brand_sum_visibility: rows.reduce((s, r) => s + Number(r.visibility_score), 0),
        brand_total_mentions: rows.reduce((s, r) => s + Number(r.mention_count), 0),
        brand_total_citations: rows.reduce((s, r) => s + Number(r.citation_count), 0),
        brand_prompt_count: 4,
        brand_visible_prompts: 4,
        by_competitor: [],
      };
    };
    fns.visible_prompt_stats = () => ({ visible_prompts: 4, visible_results: 1_200 });
    fns.tracked_prompt_count = () => 4;
    fns.ai_visibility_aggregates = () => ({ answers: 2_400, mention_answers: 1_200 });
    // 24 hours and a half, from inside one day to inside the next: read to the minute.
    const summary = (await run('get_visibility_summary', {
      brand_id: BRAND,
      date_from: '2026-11-11T23:00:00.000Z',
      date_to: '2026-11-12T23:30:00.000Z',
    })) as {
      totals: { resultCount: number; totalMentions: number; totalCitations: number };
      answers_cut?: unknown;
    };
    // The KPI card's aggregate counts the same answers: one a minute from 23:00 to 23:00.
    expect(summary.totals).toMatchObject({
      resultCount: 1_441,
      totalMentions: 720,
      totalCitations: 1_441,
      avgVisibility: 50,
      visiblePrompts: 4,
      promptCount: 4,
    });
    expect(summary).not.toHaveProperty('answers_cut');
    expect(summary).not.toHaveProperty('note');
    // From the page's aggregates: no answer row leaves the database.
    expect(readsOf('prompt_results')).toHaveLength(0);
    expect(calls.map((c) => c.fn).sort()).toEqual([
      'ai_visibility_aggregates',
      'competitor_aggregates',
      'tracked_prompt_count',
      'visible_prompt_stats',
    ]);
  });

  it('reads a longer window inside a day over the whole days it touches, from the rollups', async () => {
    db.tables.prompt_results = busyWindow().map((row, i) => ({
      ...row,
      visibility_score: 50,
      mention_count: i % 2,
    }));
    // The Visibility page's daily rollups, as their SQL adds a day's answers up.
    fns.competitor_aggregates_daily = (args) => {
      const rows = answers().filter((r) => inDays(r, args));
      return {
        brand_row_count: rows.length,
        brand_sum_visibility: rows.reduce((s, r) => s + Number(r.visibility_score), 0),
        brand_total_mentions: rows.reduce((s, r) => s + Number(r.mention_count), 0),
        brand_total_citations: rows.reduce((s, r) => s + Number(r.citation_count), 0),
        brand_prompt_count: 4,
        brand_visible_prompts: 4,
        by_competitor: [],
      };
    };
    fns.ai_visibility_aggregates_daily = () => ({ answers: 2_400, mention_answers: 1_200 });
    // 65 hours and a half from inside one day: an MCP call's timestamps (the review of 2026-11-17).
    const summary = (await run('get_visibility_summary', {
      brand_id: BRAND,
      date_from: '2026-11-10T06:00:00Z',
      date_to: '2026-11-12T23:30:00Z',
    })) as {
      totals: { resultCount: number; totalMentions: number };
      roundedToDays?: unknown;
      note?: string;
    };
    expect(summary.totals).toMatchObject({ resultCount: 2_400, totalMentions: 1_200 });
    expect(summary.roundedToDays).toEqual({ dayFrom: '2026-11-10', dayTo: '2026-11-12' });
    expect(summary.note).toContain('rounded to whole UTC days: 2026-11-10 to 2026-11-12');
    // Never the raw aggregates, whose cost follows the answers in the window.
    expect(calls.map((c) => c.fn).sort()).toEqual([
      'ai_visibility_aggregates_daily',
      'competitor_aggregates_daily',
    ]);
    expect(readsOf('prompt_results')).toHaveLength(0);
  });
});

// ─── A product's appearances ────────────────────────────────────────────────

describe("a product's appearances", () => {
  it('counts every one in one bounded read, never pages of them', async () => {
    const { getProductVisibility } = await import('@/lib/mcp/data');
    db.tables.prompt_result_shopping_cards = Array.from({ length: 1_200 }, (_, i) => ({
      id: uuid('ca000000', i),
      brand_id: BRAND,
      product_title: 'Brewline Starter Kit',
      platform: i % 3 === 0 ? 'chatgpt-shopping' : 'google-aimode',
      region: 'US',
      created_at: new Date(NOW.getTime() - i * 60 * MIN).toISOString(),
      price_amount: 39,
      price_currency: 'USD',
      rating: 4.5,
      review_count: 10,
      merchant_domain: 'brewline.example',
    }));
    const read = (await getProductVisibility(AUTH, {
      brandId: BRAND,
      productTitle: 'Brewline Starter Kit',
    })) as { total_appearances: number; answers_cut?: { note: string } };
    // Every appearance counted; the breakdowns of the newest, and the result says so.
    expect(read.total_appearances).toBe(1_200);
    expect(read.answers_cut?.note).toContain('total_appearances counts every appearance');
    expect(readsOf('prompt_result_shopping_cards')).toHaveLength(1);
    expect(readsOf('prompt_result_shopping_cards').some((r) => r.ranged)).toBe(false);
  });
});

// ─── Last 24 hours ──────────────────────────────────────────────────────────

describe('"Last 24 hours" as Overview and Citations read it', () => {
  /** The nightly run started before midnight and finished after it; the one before, a day earlier. */
  const RUNS = [
    {
      id: uuid('7a000000', 1),
      brand_id: BRAND,
      source: 'cron',
      started_at: '2026-11-15T23:40:00.000Z',
      completed_at: '2026-11-16T00:55:00.000Z',
    },
    {
      id: uuid('7a000000', 2),
      brand_id: BRAND,
      source: 'cron',
      started_at: '2026-11-14T23:40:00.000Z',
      completed_at: '2026-11-15T00:50:00.000Z',
    },
  ];
  const facts = {
    question: 'What are my top cited domains?',
    range: '24h' as const,
    rangeFrom: 'page' as const,
    limits: null,
    planName: 'Growth',
    now: NOW,
    runDaysOf: (id: string) => latestRunDaysFor(AUTH, id),
  };
  const scoped = async (name: string, input: Row = {}) => {
    const read = await scopeRead(tool(name), { brand_id: BRAND, ...input }, facts);
    if (read.kind !== 'read') throw new Error(read.kind);
    return read;
  };

  it("reads Citations' and Overview's 24 hours as the latest completed run's days", async () => {
    db.tables.tracking_runs = RUNS;
    fns.citations_window_stats_daily = () => [{ results: 0, regions: [] }];
    fns.citations_domains_daily = () => [];
    fns.citations_urls_daily = () => [];
    // The Citations page: its daily functions over the latest run's days (rollupWindow).
    await getCitationsOverview(BRAND, { datePreset: '24h' });
    const pageDays = calls.find((c) => c.fn === 'citations_domains_daily')!.args;
    expect(pageDays).toMatchObject({ p_day_from: '2026-11-15', p_day_to: '2026-11-16' });
    // The Overview: getInsightsData reads its rollups over getTrackingWindow's runDays.
    const overview = await getTrackingWindow(BRAND);
    expect(overview.runDays).toEqual({ dayFrom: '2026-11-15', dayTo: '2026-11-16' });

    for (const name of [
      'list_citations',
      'get_visibility_summary',
      'get_overview_summary',
      'get_visibility_trend',
    ]) {
      const read = await scoped(name);
      expect(read.input, name).toMatchObject({ date_from: '2026-11-15', date_to: '2026-11-16' });
      expect(read.used, name).toMatchObject({ range: '24h', window: 'latest_run' });
      expect(read.used.page, name).toContain('period');
    }
    expect((await scoped('list_citations')).input).toMatchObject({
      date_from: pageDays.p_day_from,
      date_to: pageDays.p_day_to,
    });
  });

  it('keeps the rolling 24 hours before the first run, and on pages that read them so', async () => {
    // No completed run yet: the Citations page reads its raw functions over the rolling 24 hours.
    db.tables.tracking_runs = [];
    const before = await scoped('list_citations');
    expect(before.used.window).toBeUndefined();
    expect(Date.parse(String(before.input.date_from))).toBe(NOW.getTime() - 24 * 60 * MIN);
    // Mentions reads its 24 hours from the answers, rolling, whatever the runs.
    db.tables.tracking_runs = RUNS;
    const mentions = await scoped('get_mentions_summary');
    expect(mentions.used.window).toBeUndefined();
    expect(Date.parse(String(mentions.input.date_from))).toBe(NOW.getTime() - 24 * 60 * MIN);
    // A brand outside the person's access: no run is read for it.
    expect(await latestRunDaysFor({ ...AUTH, brandAccess: [] }, BRAND)).toBeNull();
  });

  it('keeps a period the person named, and a longer range in whole days', async () => {
    db.tables.tracking_runs = RUNS;
    const named = await scopeRead(
      tool('list_citations'),
      { brand_id: BRAND, date_from: '2026-11-01', date_to: '2026-11-07' },
      facts,
    );
    expect(named.kind === 'read' && named.input).toMatchObject({
      date_from: '2026-11-01',
      date_to: '2026-11-07',
    });
    const week = await scopeRead(
      tool('list_citations'),
      { brand_id: BRAND },
      {
        ...facts,
        range: '7d',
      },
    );
    expect(week.kind === 'read' && week.input).toMatchObject({
      date_from: '2026-11-10',
      date_to: '2026-11-16',
    });
  });
});

// ─── The Prompts table's Visibility and order ───────────────────────────────

describe("prompts ranked by the Prompts page's Visibility", () => {
  /**
   * Four prompts, ten answers each: the AI Visibility Score (mentions,
   * citations, position) ranks them otherwise than the average answer score.
   */
  const PROMPTS = [
    { n: 1, named: 9, cited: 0, position: 4, answerScore: 30 },
    { n: 2, named: 4, cited: 8, position: 1, answerScore: 80 },
    { n: 3, named: 10, cited: 6, position: 1, answerScore: 40 },
    { n: 4, named: 2, cited: 1, position: 2, answerScore: 90 },
  ];
  const id = (n: number) => uuid('9a000000', n);
  const answerRows = (model = 'chatgpt-web') =>
    PROMPTS.flatMap((p) =>
      Array.from({ length: 10 }, (_, i) => ({
        id: uuid(`a${p.n}000000`, i),
        brand_id: BRAND,
        prompt_id: id(p.n),
        platform: 'chatgpt-web',
        model_used: model,
        region: 'US',
        created_at: new Date(NOW.getTime() - (i + 1) * 60 * MIN).toISOString(),
        visibility_score: p.answerScore,
        mention_count: i < p.named ? 1 : 0,
        citation_count: i < p.cited ? 1 : 0,
        mention_position: i < p.named ? p.position : null,
        competitor_mentions: [],
      })),
    );

  /** The Prompts table's functions (00434, 00013), as their SQL adds the answers up. */
  const promptFunctions = () => {
    fns.prompt_visibility_summaries = (args) => {
      const by = new Map<string, Row[]>();
      for (const row of answers().filter((r) => inWindow(r, args))) {
        by.set(String(row.prompt_id), [...(by.get(String(row.prompt_id)) ?? []), row]);
      }
      return [...by].map(([promptId, rows]) => {
        const positioned = rows.filter((r) => r.mention_position !== null);
        return {
          prompt_id: promptId,
          avg_visibility: rows.reduce((s, r) => s + Number(r.visibility_score), 0) / rows.length,
          avg_visibility_visible: null,
          total_mentions: rows.reduce((s, r) => s + Number(r.mention_count), 0),
          total_citations: rows.reduce((s, r) => s + Number(r.citation_count), 0),
          runs: rows.length,
          visible_runs: rows.filter(
            (r) => Number(r.mention_count) > 0 || Number(r.citation_count) > 0,
          ).length,
          mention_answers: rows.filter((r) => Number(r.mention_count) > 0).length,
          citation_answers: rows.filter((r) => Number(r.citation_count) > 0).length,
          position_factor: positioned.length
            ? positioned.reduce((s, r) => s + 1 / Number(r.mention_position), 0) / positioned.length
            : null,
          last_run_at: rows[0].created_at,
        };
      });
    };
    fns.prompt_performance_aggregates = (args) => {
      const models = args.p_models as string[] | null;
      const rows = answers().filter(
        (r) => inWindow(r, args) && (!models || models.includes(String(r.model_used))),
      );
      return PROMPTS.map((p) => {
        const own = rows.filter((r) => r.prompt_id === id(p.n));
        return {
          prompt_id: id(p.n),
          prompt_text: `Prompt ${p.n}`,
          topic_name: null,
          result_count: own.length,
          sum_visibility: own.reduce((s, r) => s + Number(r.visibility_score), 0),
          total_mentions: own.reduce((s, r) => s + Number(r.mention_count), 0),
          total_citations: own.reduce((s, r) => s + Number(r.citation_count), 0),
          comp_sum_visibility: 0,
          comp_count: 0,
        };
      }).filter((p) => p.result_count > 0);
    };
  };

  it("ranks as the page's Visibility column, with the page's scores", async () => {
    db.tables.prompt_results = answerRows();
    promptFunctions();
    const from = new Date(NOW.getTime() - 24 * 60 * MIN).toISOString();
    const chat = (await run('get_prompt_performance', {
      brand_id: BRAND,
      date_from: from,
      date_to: '2026-11-16',
    })) as {
      prompts: { prompt_id: string; ai_visibility_score: number; avg_visibility: number }[];
      note: string;
    };

    // The page: its own read, sorted by its own Visibility column, highest first.
    const visibility = await getPromptVisibilitySummaries(BRAND, { from });
    const page = Object.keys(visibility).sort((a, b) =>
      comparePromptSortRows(
        'visibility',
        { createdAt: '', visibility: { ...visibility[a], lastRunAt: '' } },
        { createdAt: '', visibility: { ...visibility[b], lastRunAt: '' } },
        'desc',
      ),
    );
    expect(chat.prompts.map((p) => p.prompt_id)).toEqual(page);
    expect(chat.prompts.map((p) => p.ai_visibility_score)).toEqual(
      page.map((p) => visibility[p].score),
    );
    expect(chat.note).toContain('by AI Visibility Score, as the Prompts page lists them');
    // The old order, by the average answer score, put other prompts on top.
    const byAnswerScore = [...chat.prompts].sort((a, b) => b.avg_visibility - a.avg_visibility);
    expect(byAnswerScore.map((p) => p.prompt_id).slice(0, 2)).not.toEqual(page.slice(0, 2));
    // Its own name still sorts by it.
    const old = (await run('get_prompt_performance', {
      brand_id: BRAND,
      date_from: from,
      date_to: '2026-11-16',
      sort_by: 'answer_score',
    })) as { prompts: { prompt_id: string }[] };
    expect(old.prompts.map((p) => p.prompt_id)).toEqual(byAnswerScore.map((p) => p.prompt_id));
  });

  it("scores Starter's prompts with the page's function, off-plan answers too, as the page counts them", async () => {
    // Prompt 4 also has answers on a platform Starter doesn't track, named first each time.
    const offPlan = Array.from({ length: 10 }, (_, i) => ({
      id: uuid('a9000000', i),
      brand_id: BRAND,
      prompt_id: id(4),
      platform: 'perplexity-web',
      model_used: 'perplexity-web',
      region: 'US',
      created_at: new Date(NOW.getTime() - (i + 1) * 60 * MIN).toISOString(),
      visibility_score: 90,
      mention_count: 1,
      citation_count: 1,
      mention_position: 1,
      competitor_mentions: [],
    }));
    db.tables.prompt_results = [...answerRows(), ...offPlan];
    promptFunctions();
    // Chat's scope holds a Starter read to the plan's platforms (scope.ts).
    const scoped = await scopeRead(
      tool('get_prompt_performance'),
      { brand_id: BRAND },
      {
        question: 'What are my top prompts?',
        range: '24h',
        rangeFrom: 'page',
        limits: PLANS.starter.limits,
        planName: 'Starter',
        now: NOW,
        modelsOf: async () => ['chatgpt-web', 'perplexity-web'],
      },
    );
    if (scoped.kind !== 'read') throw new Error(scoped.kind);
    expect(scoped.input.model).toBe('chatgpt-web');
    const chat = (await run('get_prompt_performance', scoped.input)) as {
      prompts: { prompt_id: string; ai_visibility_score: number; coverage_pct: number }[];
    };
    // The page's own function, whatever the plan: no answer row leaves the database.
    expect(calls.map((c) => c.fn)).toContain('prompt_visibility_summaries');
    expect(readsOf('prompt_results')).toHaveLength(0);
    // The page: its function over every platform's answers, sorted by its Visibility column.
    const from = String(scoped.input.date_from);
    const page = await getPromptVisibilitySummaries(BRAND, { from });
    const pageOrder = Object.keys(page).sort((a, b) =>
      comparePromptSortRows(
        'visibility',
        { createdAt: '', visibility: { ...page[a], lastRunAt: '' } },
        { createdAt: '', visibility: { ...page[b], lastRunAt: '' } },
        'desc',
      ),
    );
    for (const prompt of chat.prompts) {
      expect(prompt.ai_visibility_score).toBe(page[prompt.prompt_id].score);
      expect(prompt.coverage_pct).toBe(page[prompt.prompt_id].visibilityRate);
    }
    expect(chat.prompts.map((p) => p.prompt_id)).toEqual(pageOrder);
    // The off-plan answers count, as on the page: prompt 4 scores above its ChatGPT answers alone.
    const withOffPlan = await getPromptVisibilitySummaries(BRAND, { from });
    db.tables.prompt_results = answerRows();
    const chatgptOnly = await getPromptVisibilitySummaries(BRAND, { from });
    expect(withOffPlan[id(4)].score!).toBeGreaterThan(chatgptOnly[id(4)].score!);
  });

  it('sorts ties and prompts without a score as the Prompts table does', async () => {
    db.tables.prompt_results = answerRows();
    promptFunctions();
    // The page's function: a score, a prompt with no runs (no score: 0 on the page), a 0, and none.
    const summary = (n: number, runs: number, named: number) => ({
      prompt_id: id(n),
      avg_visibility: 0,
      avg_visibility_visible: null,
      total_mentions: named,
      total_citations: 0,
      runs,
      visible_runs: named,
      mention_answers: named,
      citation_answers: 0,
      position_factor: named > 0 ? 1 : null,
      last_run_at: NOW.toISOString(),
    });
    fns.prompt_visibility_summaries = () => [
      summary(1, 10, 6),
      summary(2, 0, 0),
      summary(3, 10, 0),
    ];
    const from = new Date(NOW.getTime() - 24 * 60 * MIN).toISOString();
    const order = async (dir: 'asc' | 'desc') =>
      (
        (await run('get_prompt_performance', {
          brand_id: BRAND,
          date_from: from,
          date_to: '2026-11-16',
          order: dir,
        })) as { prompts: { prompt_id: string; ai_visibility_score: number | null }[] }
      ).prompts.map((p) => p.prompt_id);
    const page = await getPromptVisibilitySummaries(BRAND, { from });
    expect(page[id(2)].score).toBeNull();
    // The page's comparator over the same rows (a prompt it doesn't score has no row: last).
    const pageOrder = (dir: 'asc' | 'desc') =>
      [1, 2, 3, 4]
        .map(id)
        .sort(
          (a, b) =>
            comparePromptSortRows(
              'visibility',
              { createdAt: '', visibility: page[a] && { ...page[a], lastRunAt: '' } },
              { createdAt: '', visibility: page[b] && { ...page[b], lastRunAt: '' } },
              dir,
            ) || a.localeCompare(b),
        );
    // No score counts as 0, beside the 0 (ties in a fixed order); unscored last, either way.
    expect(await order('desc')).toEqual([1, 2, 3, 4].map(id));
    expect(await order('desc')).toEqual(pageOrder('desc'));
    expect(await order('asc')).toEqual([2, 3, 1, 4].map(id));
    expect(await order('asc')).toEqual(pageOrder('asc'));
  });

  it("reads a preset over the Prompts and AI Traffic pages' own window: the last N × 24 hours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    for (const range of ['24h', '7d', '30d'] as const) {
      const read = await scopeRead(
        tool('get_prompt_performance'),
        { brand_id: BRAND },
        { question: '', range, rangeFrom: 'page', limits: null, planName: 'Growth', now: NOW },
      );
      expect(read.kind === 'read' && read.input.date_from, range).toBe(
        resolvePromptRange(range).from,
      );
      expect(read.kind === 'read' && read.used.window, range).toBe('rolling');
    }
    // AI Referral Traffic's page counts its presets back from now the same way.
    const traffic = await scopeRead(
      tool('get_ai_traffic_summary'),
      { brand_id: BRAND },
      { question: '', range: '7d', rangeFrom: 'page', limits: null, planName: 'Growth', now: NOW },
    );
    expect(traffic.kind === 'read' && traffic.input.date_from).toBe(
      new Date(NOW.getTime() - 7 * 24 * 60 * MIN).toISOString(),
    );
    // Elsewhere a preset is whole UTC days, as Overview, Citations and Mentions cut it.
    const mentions = await scopeRead(
      tool('get_mentions_summary'),
      { brand_id: BRAND },
      { question: '', range: '7d', rangeFrom: 'page', limits: null, planName: 'Growth', now: NOW },
    );
    expect(mentions.kind === 'read' && mentions.input.date_from).toBe('2026-11-10');
  });
});

// ─── The lists' default order ───────────────────────────────────────────────

describe("the page's default order, for its first rows", () => {
  it('reads the Actions list as it opens: every status, most recently updated first', async () => {
    const at = (h: number) => new Date(NOW.getTime() - h * 60 * MIN).toISOString();
    const rows = [
      { n: 1, status: 'completed', updated: at(1), priority: 20 },
      { n: 2, status: 'new', updated: at(5), priority: 95 },
      { n: 3, status: 'in_progress', updated: at(1), priority: 60 },
      { n: 4, status: 'dismissed', updated: at(2), priority: 10 },
      { n: 5, status: 'on_hold', updated: at(9), priority: 80 },
      { n: 6, status: 'new', updated: at(3), priority: 70 },
    ].map((a) => ({
      id: uuid('ac000000', a.n),
      brand_id: BRAND,
      action_no: 100 + a.n,
      brand_no: a.n,
      kind: 'visibility_drop',
      category: 'recover',
      status: a.status,
      assignee_id: null,
      due_date: null,
      updated_at: a.updated,
      priority_score: a.priority,
      priority_level: 'high',
      stale_at: null,
      deleted_at: null,
      payload: {},
    }));
    db.tables.actions = rows;
    const order = pageOrderOf('/dashboard/action-center/actions')!;
    expect(order.input.sort).toBe(DEFAULT_ACTION_SORT);
    const chat = (await run(order.tool, {
      brand_id: BRAND,
      ...order.unfiltered,
      ...order.input,
    })) as {
      actions: { id: string }[];
      note: string;
    };
    // The page's own comparator over the same actions.
    const page = rows
      .map((r) => ({ id: r.id, actionNo: r.action_no, updatedAt: r.updated_at }))
      .sort(compareActions(DEFAULT_ACTION_SORT) as never);
    expect(chat.actions.map((a) => a.id)).toEqual(page.map((a) => a.id));
    expect(chat.note).toContain('most recently updated first');
    // The read's own default, for "what should I do first": open ones by priority.
    const first = (await run(order.tool, { brand_id: BRAND })) as { actions: { id: string }[] };
    expect(first.actions.map((a) => a.id)).toEqual([2, 5, 6, 3].map((n) => uuid('ac000000', n)));
  });

  it('reads Content Opportunities as the page opens: newest first', async () => {
    const at = (d: number) => new Date(Date.UTC(2026, 10, 16 - d)).toISOString();
    db.tables.content_opportunities = [
      { n: 1, created: at(3), score: 90 },
      { n: 2, created: at(1), score: 40 },
      { n: 3, created: at(1), score: 70 },
      { n: 4, created: at(6), score: 99 },
    ].map((o) => ({
      id: uuid('0c000000', o.n),
      brand_id: BRAND,
      title: `Opportunity ${o.n}`,
      description: null,
      type: 'owned',
      impact: 'high',
      opportunity_score: o.score,
      status: 'new',
      prompt_id: null,
      created_at: o.created,
      updated_at: o.created,
      brief: null,
    }));
    const order = pageOrderOf('/dashboard/content')!;
    expect(order.input.sort).toBe(DEFAULT_OPPORTUNITY_SORT);
    const chat = (await run(order.tool, { brand_id: BRAND, ...order.input })) as {
      opportunities: { id: string }[];
      note: string;
    };
    // The page's list (server/src/routes/content.js): created_at, newest first, then id.
    expect(chat.opportunities.map((o) => o.id)).toEqual(
      [2, 3, 1, 4].map((n) => uuid('0c000000', n)),
    );
    expect(chat.note).toContain('newest first, as the Content page lists them');
    // Left out: the read's own order, highest score first.
    const own = (await run(order.tool, { brand_id: BRAND })) as { opportunities: { id: string }[] };
    expect(own.opportunities.map((o) => o.id)).toEqual(
      [4, 1, 3, 2].map((n) => uuid('0c000000', n)),
    );
  });

  it("tells the models the page's order, and nothing on a page whose read already has it", () => {
    expect(pageOrderLine('/dashboard/action-center/actions')).toContain(
      'read list_action_center_tasks with status "all" and sort "updated"',
    );
    // Filtered to a status, the page shows that one: its filter fills the read's status.
    expect(pageOrderLine('/dashboard/action-center/actions', ['status'])).toContain(
      'read list_action_center_tasks with sort "updated",',
    );
    expect(pageOrderLine('/dashboard/action-center/actions')).toContain(
      'For "what matters most" or "what should I do first", its own order',
    );
    expect(pageOrderLine('/dashboard/content/')).toContain('sort "newest"');
    expect(pageOrderLine('/dashboard/prompts/tracked')).toContain('sort_by "visibility"');
    expect(pageOrderLine('/dashboard/mentions')).toBeNull();
    expect(pageOrderLine(null)).toBeNull();
  });
});

// ─── The Why read's periods ─────────────────────────────────────────────────

describe("explain_change over the page's period", () => {
  const why = (range: string | null, input: Row = {}) =>
    scopeRead(
      tool('explain_change'),
      { brand_id: BRAND, metric: 'visibility_score', ...input },
      {
        question: 'Why did visibility drop?',
        range: range as never,
        rangeFrom: 'page',
        limits: null,
        planName: 'Growth',
        now: NOW,
      },
    );

  it("compares the page's days, to yesterday, with the days before them, as the page's change", async () => {
    for (const range of ['7d', '30d', '90d'] as const) {
      const read = await why(range);
      if (read.kind !== 'read') throw new Error(read.kind);
      // The page: its days and the window before them (getDateRange, deltaDayWindows).
      const { cur, prev } = deltaDayWindows(getDateRange(range, { from: '', to: '' }, NOW).days!);
      expect(read.input, range).toMatchObject({
        period_a_from: prev.dayFrom,
        period_a_to: prev.dayTo,
        period_b_from: cur.dayFrom,
        period_b_to: '2026-11-15',
      });
      expect(read.used.page).toContain('period');
      // The Why read takes them as they are.
      const periods = whyPeriods(
        {
          periods: {
            a: { from: String(read.input.period_a_from), to: String(read.input.period_a_to) },
            b: { from: String(read.input.period_b_from), to: String(read.input.period_b_to) },
          },
        },
        NOW.getTime(),
      );
      expect(periods.b).toEqual({ from: cur.dayFrom, to: '2026-11-15' });
    }
  });

  it('takes a custom range as picked, and keeps its own window for a day or a named period', async () => {
    const custom = await why('2026-10-01/2026-10-15');
    expect(custom.kind === 'read' && custom.input).toMatchObject({
      period_a_from: '2026-09-16',
      period_a_to: '2026-09-30',
      period_b_from: '2026-10-01',
      period_b_to: '2026-10-15',
    });
    // A range past the Why read's 92 days: its last 92, against the 92 before.
    const long = await why('2026-06-01/2026-10-15');
    expect(long.kind === 'read' && long.input).toMatchObject({
      period_a_from: '2026-04-15',
      period_a_to: '2026-07-15',
      period_b_from: '2026-07-16',
      period_b_to: '2026-10-15',
    });
    // Last 24 hours is too short to tell a change from a day's swing: its own 7 against 7.
    const day = await why('24h');
    expect(day.kind === 'read' && day.input.period_b_from).toBeUndefined();
    // A day or periods the person named stay theirs.
    const around = await why('30d', { around: '2026-11-03' });
    expect(around.kind === 'read' && around.input).not.toHaveProperty('period_b_from');
    const none = await why(null);
    expect(none.kind === 'read' && none.input.period_b_from).toBeUndefined();
  });
});

// ─── A trend's every day ────────────────────────────────────────────────────

describe('a trend by day', () => {
  it('returns every day of 90, as the Overview plots them, within its share of the run', async () => {
    const days = Array.from({ length: 90 }, (_, i) =>
      new Date(Date.UTC(2026, 7, 19) + i * 24 * 60 * MIN).toISOString().slice(0, 10),
    );
    fns.visibility_trend_aggregates = () =>
      days.map((d, i) => ({
        bucket_date: d,
        row_count: 120 + i,
        sum_visibility: 4_800,
        sum_mentions: 30 + (i % 7),
        sum_citations: 12,
        comp_sum_visibility: 380,
        comp_count: 10,
      }));
    fns.visibility_rate_trend = () =>
      days.map((d) => ({
        day: d,
        answers: 120,
        mention_answers: 48,
        citation_answers: 12,
        position_factor: 0.5,
      }));
    const name = 'get_visibility_trend';
    const scoped = await scopeRead(
      tool(name),
      { brand_id: BRAND, granularity: 'day' },
      { question: '', range: '90d', rangeFrom: 'page', limits: null, planName: 'Growth', now: NOW },
    );
    if (scoped.kind !== 'read') throw new Error(scoped.kind);
    const value = (await run(name, scoped.input)) as { buckets: { date: string }[]; note: string };
    const capped = capRows(value as never, scoped.cap);
    const fitted = fitResult(capped.value, resultCharsFor(readBudget(), name));
    const kept = fitted.value as { buckets: { date: string }[]; truncated?: boolean };
    expect(capped.cut).toBe(false);
    expect(fitted.cut).toBe(false);
    expect(kept.buckets.map((b) => b.date)).toEqual(days);
    expect(value.note).toBe(
      `Every day with answers in this period, 90 in all from ${days[0]} to ${days[89]}, oldest first.`,
    );
  });
});
