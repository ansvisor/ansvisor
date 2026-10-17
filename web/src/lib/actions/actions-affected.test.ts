import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The actions list's Export CSV (AC-005): each action's affected count and
 * names, read for many actions at once, page by page, as the drawer's
 * Affected tab reads one.
 */

type Call = [string, ...unknown[]];
type Row = Record<string, unknown>;
let queries: { table: string; calls: Call[] }[];
let rows: Record<string, Row[]>;

/** What PostgREST would answer: the `in` filters, embedded ones included, then the range. */
function answer(table: string, calls: Call[]): Row[] {
  let out = rows[table] ?? [];
  for (const [method, column, values] of calls) {
    if (method !== 'in') continue;
    const wanted = values as string[];
    if (column === 'action_signals.action_id') {
      out = out
        .map((row) => ({
          ...row,
          action_signals: (row.action_signals as { action_id: string }[]).filter((link) =>
            wanted.includes(link.action_id),
          ),
        }))
        .filter((row) => row.action_signals.length > 0);
    } else {
      out = out.filter((row) => wanted.includes(row[column as string] as string));
    }
  }
  const range = calls.find(([method]) => method === 'range');
  return range ? out.slice(range[1] as number, (range[2] as number) + 1) : out;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      const query = { table, calls: [] as Call[] };
      queries.push(query);
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'order', 'range']) {
        chain[method] = (...args: unknown[]) => {
          query.calls.push([method, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (value: unknown) => unknown) =>
        resolve({ data: answer(table, query.calls), error: null });
      return chain;
    },
  })),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));

const { getActionsAffected } = await import('./action-center');

const lost = (id: string, promptId: string, promptText: string, actions: string[]): Row => ({
  id,
  category: 'citation',
  kind: 'lost_citations',
  impact: 'high',
  status: 'new',
  source: ['ai_results'],
  detected_at: '2026-10-09T00:00:00Z',
  last_detected_at: '2026-10-09T00:00:00Z',
  resolved_at: null,
  previous_value: null,
  current_value: null,
  change_value: null,
  payload: { promptId, promptText },
  kpi_keys: [],
  action_id: actions[0],
  action_signals: actions.map((action_id) => ({ action_id })),
});

beforeEach(() => {
  queries = [];
  rows = {
    actions: [
      { id: 'a1', payload: {} },
      { id: 'a2', payload: {} },
      // Sent from the Improve tab: no signals, so what it was sent about.
      { id: 'a3', payload: { promptId: 'p9', promptText: 'Is Acme any good?' } },
    ],
    signals: [
      lost('s1', 'p1', 'Best coffee subscription?', ['a1']),
      lost('s2', 'p2', 'Coffee delivery near me', ['a1', 'a2']),
      // A second finding on the same prompt: one item.
      lost('s3', 'p1', 'Best coffee subscription?', ['a1']),
    ],
  };
});

describe('getActionsAffected', () => {
  it("gives each action the Affected tab's count and names", async () => {
    expect(await getActionsAffected('b1', ['a1', 'a2', 'a3'])).toEqual({
      a1: { count: 2, items: ['Best coffee subscription?', 'Coffee delivery near me'] },
      // A signal two actions took counts for both.
      a2: { count: 1, items: ['Coffee delivery near me'] },
      a3: { count: 1, items: ['Is Acme any good?'] },
    });
  });

  it("reads past one response's rows, a page at a time", async () => {
    rows.signals = Array.from({ length: 1001 }, (_, i) =>
      lost(`s${i}`, `p${i}`, `Prompt ${i}`, ['a1']),
    );
    const result = await getActionsAffected('b1', ['a1']);

    expect(result.a1.count).toBe(1001);
    const ranges = queries
      .filter((q) => q.table === 'signals')
      .map((q) => q.calls.find(([method]) => method === 'range'));
    expect(ranges).toEqual([
      ['range', 0, 999],
      ['range', 1000, 1999],
    ]);
  });

  it('asks for at most 100 actions a request, so the URL stays short', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `x${i}`);
    await getActionsAffected('b1', ids);

    const sizes = queries
      .filter((q) => q.table === 'signals')
      .map((q) => (q.calls.find(([method]) => method === 'in')![2] as string[]).length);
    expect(sizes).toEqual([100, 50]);
  });

  it('reads nothing for no actions', async () => {
    expect(await getActionsAffected('b1', [])).toEqual({});
    expect(queries).toEqual([]);
  });
});
