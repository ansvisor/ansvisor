import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Time to first AI crawl (#2142): the page's key as the bot logs keep it,
 * how long after it went live, and the reads of the brand's own logs.
 */

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  /** Each read: its table and filters, in order. */
  reads: [] as { table: string; filters: [string, string, unknown][] }[],
  fail: null as string | null,
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      const filters: [string, string, unknown][] = [];
      db.reads.push({ table, filters });
      const rows = () =>
        (db.tables[table] ?? []).filter((row) =>
          filters.every(([op, col, value]) =>
            op === 'eq'
              ? row[col] === value
              : op === 'is'
                ? row[col] === value
                : op === 'gte'
                  ? String(row[col]) >= String(value)
                  : true,
          ),
        );
      const answer = (one: boolean) => {
        if (db.fail === table) return { data: null, error: { message: 'down' } };
        const found = rows();
        return { data: one ? (found[0] ?? null) : found, error: null };
      };
      const chain = {
        select: () => chain,
        eq: (col: string, value: unknown) => (filters.push(['eq', col, value]), chain),
        is: (col: string, value: unknown) => (filters.push(['is', col, value]), chain),
        gte: (col: string, value: unknown) => (filters.push(['gte', col, value]), chain),
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => answer(true),
        then: (resolve: (value: unknown) => void) => resolve(answer(false)),
      };
      return chain;
    },
  }),
}));

const { botPageKey, crawlDelay, readFirstAiCrawls } = await import('./first-ai-crawl');

const BRAND = 'brand-1';
const NOW = new Date('2026-11-06T12:00:00Z');
const page = (at: string, url = 'https://acme.example/Blog/Churn/') => ({ draftId: 'd1', url, at });

beforeEach(() => {
  db.reads = [];
  db.fail = null;
  db.tables = {
    ai_bot_connections: [{ id: 'c1', brand_id: BRAND, revoked_at: null }],
    ai_bot_events: [],
    ai_bot_daily: [],
  };
});

describe('a page’s key in the bot logs', () => {
  it('is lower(normalize_page_path(url)): no host, query, fragment or trailing slash', () => {
    expect(botPageKey('https://acme.example/Blog/Churn/?utm_source=x#top')).toBe('/blog/churn');
    expect(botPageKey('https://acme.example')).toBe('/');
    expect(botPageKey('https://acme.example/caf%C3%A9')).toBe('/café');
    // An escape that isn't one is kept as written.
    expect(botPageKey('https://acme.example/100%')).toBe('/100%');
  });
});

describe('how long after it went live', () => {
  it('reads in minutes, then hours, then days', () => {
    expect(crawlDelay('2026-10-24T11:00:00Z', '2026-10-24T11:40:00Z')).toEqual({
      unit: 'minutes',
      count: 40,
    });
    expect(crawlDelay('2026-10-24T11:00:00Z', '2026-10-24T17:00:00Z')).toEqual({
      unit: 'hours',
      count: 6,
    });
    expect(crawlDelay('2026-10-24T11:00:00Z', '2026-10-27T11:00:00Z')).toEqual({
      unit: 'days',
      count: 3,
    });
  });
});

describe('the first AI crawl of a page that went live', () => {
  it('reads nothing for a brand that sends no AI bot logs', async () => {
    db.tables.ai_bot_connections = [{ id: 'c1', brand_id: BRAND, revoked_at: '2026-11-01' }];
    const crawls = await readFirstAiCrawls(BRAND, [page('2026-11-01T10:00:00Z')], NOW);
    expect(crawls).toEqual({ logs: false, byDraft: new Map() });
    expect(db.reads.map((read) => read.table)).toEqual(['ai_bot_connections']);
  });

  it('is the brand’s first verified visit to that page after it went live', async () => {
    db.tables.ai_bot_events = [
      {
        brand_id: 'other-brand',
        page: '/blog/churn',
        bot: 'ClaudeBot',
        occurred_at: '2026-11-01T11:00:00Z',
      },
      { brand_id: BRAND, page: '/blog/churn', bot: 'GPTBot', occurred_at: '2026-11-01T16:00:00Z' },
    ];
    const crawls = await readFirstAiCrawls(BRAND, [page('2026-11-01T10:00:00Z')], NOW);
    expect(crawls.byDraft.get('d1')).toEqual({
      bot: 'GPTBot',
      at: '2026-11-01T16:00:00Z',
      dayOnly: false,
    });
    const events = db.reads.find((read) => read.table === 'ai_bot_events')!;
    expect(events.filters).toEqual([
      ['eq', 'brand_id', BRAND],
      ['eq', 'page', '/blog/churn'],
      ['gte', 'occurred_at', '2026-11-01T10:00:00Z'],
    ]);
  });

  it('says none came yet for a recent page, and reads the day counters for one older than 90 days', async () => {
    expect(
      (await readFirstAiCrawls(BRAND, [page('2026-11-01T10:00:00Z')], NOW)).byDraft.get('d1'),
    ).toBeNull();
    expect(db.reads.some((read) => read.table === 'ai_bot_daily')).toBe(false);

    db.tables.ai_bot_daily = [
      { brand_id: BRAND, page: '/blog/churn', bot: 'PerplexityBot', day: '2026-07-02' },
    ];
    const old = await readFirstAiCrawls(BRAND, [page('2026-07-01T10:00:00Z')], NOW);
    expect(old.byDraft.get('d1')).toEqual({
      bot: 'PerplexityBot',
      at: '2026-07-02',
      dayOnly: true,
    });
  });

  it('leaves a page out when its read fails, and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.fail = 'ai_bot_events';
    const crawls = await readFirstAiCrawls(BRAND, [page('2026-11-01T10:00:00Z')], NOW);
    expect(crawls.logs).toBe(true);
    expect(crawls.byDraft.has('d1')).toBe(false);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
