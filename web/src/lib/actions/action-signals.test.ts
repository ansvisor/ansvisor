import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AC-007 reads. The list counts the signals that support an action now (open
 * ones it holds); the drawer lists every signal the action took as evidence,
 * through action_signals, so a closed action keeps the ones that moved on.
 */

type Call = [string, ...unknown[]];
let queries: { table: string; calls: Call[] }[];
let rows: Record<string, unknown[]>;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      const query = { table, calls: [] as Call[] };
      queries.push(query);
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'not', 'order', 'limit']) {
        chain[method] = (...args: unknown[]) => {
          query.calls.push([method, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (value: unknown) => unknown) =>
        resolve({ data: rows[table] ?? [], error: null });
      chain.maybeSingle = async () => ({ data: rows[table]?.[0] ?? null, error: null });
      return chain;
    },
  })),
}));

const { getActionDetail, getActions } = await import('./action-center');

const signalsQuery = () => queries.find((q) => q.table === 'signals')!;

beforeEach(() => {
  queries = [];
  rows = {
    actions: [
      {
        id: 'a1',
        action_no: 9,
        category: 'recover',
        kind: 'recover_lost_citations',
        impact: 'high',
        status: 'new',
        payload: {},
        kpi_keys: [],
        assignee_id: null,
        due_date: null,
        created_at: '2026-10-15T00:00:00Z',
        updated_at: '2026-10-15T00:00:00Z',
        priority_score: 87,
        priority_level: 'high',
        priority_reason: null,
        priority_updated_at: null,
      },
    ],
    signals: [{ action_id: 'a1' }, { action_id: 'a1' }],
  };
});

describe('getActions', () => {
  it('counts only the open signals an action holds', async () => {
    const [action] = await getActions('b1');

    expect(action.signalCount).toBe(2);
    expect(signalsQuery().calls).toContainEqual(['in', 'status', ['new', 'acknowledged']]);
  });
});

describe('getActionDetail', () => {
  it('lists every signal the action took, through action_signals', async () => {
    rows.signals = [];
    await getActionDetail('b1', 'a1');

    const calls = signalsQuery().calls;
    expect(calls[0][1]).toContain('action_signals!inner(action_id)');
    expect(calls).toContainEqual(['eq', 'action_signals.action_id', 'a1']);
    // Not by the signal's current action, which moves to a later cycle.
    expect(calls).not.toContainEqual(['eq', 'action_id', 'a1']);
  });
});
