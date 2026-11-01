import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stale actions: New for staleAfterDays with no one's event. Marked, never
// closed; cleared once someone touches the action or it leaves New.

let db;
let writes;

function table(name) {
  const q = { op: 'select', filters: [], payload: null };
  const rows = () => (db[name] ?? []).filter((row) => q.filters.every((test) => test(row)));
  const run = () => {
    if (q.op === 'select') return { data: rows(), error: null };
    const matched = rows();
    writes.push({ table: name, ids: matched.map((r) => r.id), payload: q.payload });
    for (const row of matched) Object.assign(row, q.payload);
    return { data: null, error: null };
  };
  const chain = {
    select: () => chain,
    eq: (col, value) => (q.filters.push((row) => row[col] === value), chain),
    in: (col, values) => (q.filters.push((row) => values.includes(row[col])), chain),
    is: (col, value) => (q.filters.push((row) => (row[col] ?? null) === value), chain),
    not: (col, op, value) => (q.filters.push((row) => (row[col] ?? null) !== value), chain),
    gte: (col, value) => (q.filters.push((row) => row[col] >= value), chain),
    or: (expr) => {
      // 'status.eq.new,stale_at.not.is.null'
      expect(expr).toBe('status.eq.new,stale_at.not.is.null');
      q.filters.push((row) => row.status === 'new' || row.stale_at != null);
      return chain;
    },
    order: () => chain,
    limit: (n) => ((db.limits ??= []).push(n), chain),
    update: (payload) => ((q.op = 'update'), (q.payload = payload), chain),
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  };
  return chain;
}

vi.mock('../../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));

const { STALE_CHECKS_PER_BRAND, staleChanges, sweepStaleActions } = await import('./stale.js');

const NOW = new Date('2026-10-31T03:00:00Z');
const action = (over) => ({
  brand_id: 'b1',
  status: 'new',
  created_at: '2026-09-01T00:00:00Z',
  stale_at: null,
  deleted_at: null,
  ...over,
});

beforeEach(() => {
  writes = [];
  db = {
    actions: [
      action({ id: 'quiet' }),
      action({ id: 'touched' }),
      action({ id: 'young', created_at: '2026-10-20T00:00:00Z' }),
      action({ id: 'moved-on', status: 'in_progress', stale_at: '2026-10-01T00:00:00Z' }),
      action({ id: 'still-quiet', stale_at: '2026-10-01T00:00:00Z' }),
      action({ id: 'deleted', deleted_at: '2026-10-02T00:00:00Z' }),
      action({ id: 'other-brand', brand_id: 'b2' }),
    ],
    action_events: [
      // Someone assigned it last week.
      { action_id: 'touched', actor_id: 'u1', created_at: '2026-10-24T00:00:00Z' },
      // The engine's own line counts for nothing.
      { action_id: 'quiet', actor_id: null, created_at: '2026-10-30T00:00:00Z' },
      // Someone's, but before the window.
      { action_id: 'quiet', actor_id: 'u1', created_at: '2026-09-02T00:00:00Z' },
    ],
  };
});

describe('staleChanges', () => {
  it('marks quiet New actions past the age, and clears the rest that were stale', () => {
    const since = new Date('2026-10-01T03:00:00Z');
    expect(
      staleChanges(
        [
          action({ id: 'a' }),
          action({ id: 'b', stale_at: '2026-10-01T00:00:00Z' }),
          action({ id: 'c', status: 'on_hold', stale_at: '2026-10-01T00:00:00Z' }),
          action({ id: 'd', created_at: '2026-10-15T00:00:00Z' }),
          action({ id: 'e' }),
        ],
        new Set(['e']),
        since,
      ),
    ).toEqual({ mark: ['a'], clear: ['c'] });
  });
});

describe('sweepStaleActions', () => {
  it("marks the brand's quiet New actions and clears the ones no longer stale", async () => {
    expect(await sweepStaleActions('b1', { now: NOW })).toEqual({ marked: 1, cleared: 1 });
    const byId = Object.fromEntries(db.actions.map((a) => [a.id, a]));
    expect(byId.quiet.stale_at).toBe(NOW.toISOString());
    // Never closed: it stays New.
    expect(byId.quiet.status).toBe('new');
    expect(byId['moved-on'].stale_at).toBeNull();
    expect(byId['still-quiet'].stale_at).toBe('2026-10-01T00:00:00Z');
    for (const id of ['touched', 'young', 'deleted', 'other-brand']) {
      expect(byId[id].stale_at).toBeNull();
    }
  });

  it('writes nothing on a second night', async () => {
    await sweepStaleActions('b1', { now: NOW });
    writes = [];
    expect(await sweepStaleActions('b1', { now: NOW })).toEqual({ marked: 0, cleared: 0 });
    expect(writes).toEqual([]);
  });

  it('looks at a bounded number of actions per brand', async () => {
    await sweepStaleActions('b1', { now: NOW });
    expect(db.limits).toEqual([STALE_CHECKS_PER_BRAND]);
  });
});
