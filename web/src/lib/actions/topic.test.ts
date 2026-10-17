import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Topics overview over the page's date range (00156): the window's
 * figures, the change against the window just before, and a trend point per
 * whole day; the fixed 30-day overview without a window, or where the
 * database doesn't have the windowed function yet.
 */

const DAY = 24 * 60 * 60 * 1000;
let calls: { fn: string; args: Record<string, unknown> }[] = [];
let windowRows: Record<string, unknown>[] | 'missing' = [];
let fixedRows: Record<string, unknown>[] = [];

const tables: Record<string, unknown[]> = {
  topics: [{ id: 't1', name: 'Espresso', created_at: '2026-01-01T00:00:00Z' }],
  prompt_sets: [{ id: 's1' }],
  prompts: [
    { id: 'p1', topic_id: 't1' },
    { id: 'p2', topic_id: 't1' },
  ],
};

/** A query builder whose every call chains, resolving to the table's rows. */
function query(table: string): unknown {
  const result = { data: tables[table] ?? [], error: null };
  const builder: unknown = new Proxy(
    {},
    {
      get: (_, prop) =>
        prop === 'then' ? (resolve: (value: unknown) => void) => resolve(result) : () => builder,
    },
  );
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => query(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === 'topics_overview_window') {
        return windowRows === 'missing'
          ? { data: null, error: { code: 'PGRST202', message: 'not found' } }
          : { data: windowRows, error: null };
      }
      return { data: fixedRows, error: null };
    },
  })),
}));

const { getTopicsOverview } = await import('./topic');

const counts = (prefix: string, answers: number, mentions: number) => ({
  [`${prefix}answers`]: answers,
  [`${prefix}mention_answers`]: mentions,
  [`${prefix}citation_answers`]: 0,
  [`${prefix}pos_sum`]: 0,
  [`${prefix}pos_n`]: 0,
});

const shared = {
  topic_id: 't1',
  total_mentions: 6,
  total_citations: 2,
  comp_mentions: 4,
  active_prompts: 2,
  visible_prompts: 1,
  last_run_at: '2026-10-16T14:28:00Z',
  competitors: { c1: { name: 'Crema Club', sov: 4 } },
};

beforeEach(() => {
  calls = [];
  const today = new Date().toISOString().slice(0, 10);
  windowRows = [
    {
      ...shared,
      ...counts('', 10, 6),
      ...counts('prev_', 10, 2),
      daily: { [today]: { visible: 3, count: 4 } },
    },
  ];
  fixedRows = [
    {
      ...shared,
      ...counts('', 30, 9),
      ...counts('cur_', 10, 6),
      ...counts('prev_', 10, 2),
      daily: {},
    },
  ];
});

describe('getTopicsOverview', () => {
  it('reads the window and compares it with the window of the same length before it', async () => {
    const from = new Date(Date.now() - 7 * DAY).toISOString();
    const summary = await getTopicsOverview('b1', { from });

    expect(calls.map((c) => c.fn)).toEqual(['topics_overview_window']);
    expect(calls[0].args).toMatchObject({ p_brand_id: 'b1', p_date_from: from });
    const [row] = summary.topics;
    expect(row.promptCount).toBe(2);
    expect(row.totalMentions).toBe(6);
    // 6 mentions of 10 against 2 of 10: up.
    expect(row.visibilityChange).toBeGreaterThan(0);
    expect(row.shareOfVoice).toBe(60);
    // Seven whole days, today last, today's share drawn.
    expect(summary.trendDays).toHaveLength(7);
    expect(row.trendSparkline).toHaveLength(7);
    expect(row.trendSparkline.at(-1)).toBe(75);
  });

  it('draws no trend for a 24-hour window, only the change', async () => {
    const summary = await getTopicsOverview('b1', {
      from: new Date(Date.now() - DAY).toISOString(),
    });
    expect(summary.trendDays).toEqual([]);
    expect(summary.topics[0].trendSparkline).toEqual([]);
    expect(summary.topics[0].visibilityChange).not.toBeNull();
  });

  it('falls back to the fixed overview where the database has no windowed function yet', async () => {
    windowRows = 'missing';
    const summary = await getTopicsOverview('b1', {
      from: new Date(Date.now() - DAY).toISOString(),
    });
    expect(calls.map((c) => c.fn)).toEqual([
      'topics_overview_window',
      'topics_overview_aggregates',
    ]);
    expect(summary.trendDays).toHaveLength(14);
    expect(summary.topics[0].totalMentions).toBe(6);
  });

  it('reads the fixed 30-day overview without a window', async () => {
    const summary = await getTopicsOverview('b1');
    expect(calls.map((c) => c.fn)).toEqual(['topics_overview_aggregates']);
    expect(summary.trendDays).toHaveLength(14);
  });
});
