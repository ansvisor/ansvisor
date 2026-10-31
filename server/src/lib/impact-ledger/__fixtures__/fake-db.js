import { randomUUID } from 'node:crypto';

/**
 * An in-memory stand-in for the tables the impact ledger reads and writes,
 * with the PostgREST calls it makes. A read gives at most `maxRows` rows
 * (PostgREST's max_rows, 1000 in supabase/config.toml), the rest dropped
 * without an error, so a reader that doesn't page loses rows as it would
 * live. Every call is recorded ({ table, op }); `fail(table, op)` returning
 * true answers that call with a database error.
 */

/** A row's value at a column, or at an embedded table's column (`prompt_sets.brand_id`). */
function valueAt(row, column) {
  if (column in row || !column.includes('.')) return row[column];
  return column.split('.').reduce((value, key) => value?.[key], row);
}

/** PostgreSQL's order: ascending puts nulls last. */
function compareBy(orders) {
  return (a, b) => {
    for (const { column, ascending = true } of orders) {
      const x = valueAt(a, column) ?? null;
      const y = valueAt(b, column) ?? null;
      if (x === y) continue;
      if (x === null) return ascending ? 1 : -1;
      if (y === null) return ascending ? -1 : 1;
      return (x < y ? -1 : 1) * (ascending ? 1 : -1);
    }
    return 0;
  };
}

/** The unique keys an upsert's onConflict names, by table. */
const UNIQUE = {
  impact_measurements: ['ship_event_id'],
  impact_control_sets: ['impact_measurement_id', 'checkpoint'],
};

export function fakeDb(seed = {}, { maxRows = 1000, now = () => new Date().toISOString() } = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }));
  const calls = [];
  const db = {
    tables,
    calls,
    maxRead: 0,
    fail: null,
    from(table) {
      tables[table] ??= [];
      const state = {
        op: 'select',
        filters: [],
        order: [],
        range: null,
        one: false,
        payload: null,
      };
      let returning = false;
      let options = null;
      const match = (row) => state.filters.every((test) => test(row));
      const run = () => {
        calls.push({ table, op: state.op });
        if (db.fail?.(table, state.op)) {
          return { data: null, error: { code: '57014', message: 'canceling statement' } };
        }
        const rows = tables[table];
        const stamp = now();
        if (state.op === 'insert' || state.op === 'upsert') {
          const key = UNIQUE[table];
          const out = [];
          for (const values of [state.payload].flat()) {
            const taken = key && rows.find((row) => key.every((k) => row[k] === values[k]));
            if (taken) {
              if (state.op === 'upsert' && !options?.ignoreDuplicates) {
                Object.assign(taken, values, { updated_at: stamp });
                out.push({ ...taken });
              }
              continue;
            }
            const row = { id: randomUUID(), created_at: stamp, updated_at: stamp, ...values };
            rows.push(row);
            out.push({ ...row });
          }
          return { data: returning ? out : null, error: null };
        }
        if (state.op === 'update') {
          const changed = rows.filter(match);
          for (const row of changed) Object.assign(row, state.payload, { updated_at: stamp });
          return { data: returning ? changed.map((row) => ({ ...row })) : null, error: null };
        }
        const found = rows.filter(match).sort(compareBy(state.order));
        const [start, end] = state.range ?? [0, found.length - 1];
        const data = found
          .slice(start, end + 1)
          .slice(0, maxRows)
          .map((row) => ({ ...row }));
        db.maxRead = Math.max(db.maxRead, data.length);
        if (state.one) return { data: data[0] ?? null, error: null };
        return { data, error: null };
      };
      const chain = {
        select: () => {
          if (state.op !== 'select') returning = true;
          return chain;
        },
        insert: (payload) => ((state.op = 'insert'), (state.payload = payload), chain),
        upsert: (payload, opts) => (
          (state.op = 'upsert'),
          (state.payload = payload),
          (options = opts),
          chain
        ),
        update: (payload) => ((state.op = 'update'), (state.payload = payload), chain),
        eq: (column, value) => (state.filters.push((row) => valueAt(row, column) === value), chain),
        in: (column, values) => (
          state.filters.push((row) => values.includes(valueAt(row, column))),
          chain
        ),
        is: (column, value) => (
          state.filters.push((row) => (valueAt(row, column) ?? null) === value),
          chain
        ),
        gte: (column, value) => (
          state.filters.push(
            (row) => valueAt(row, column) != null && valueAt(row, column) >= value,
          ),
          chain
        ),
        lte: (column, value) => (
          state.filters.push(
            (row) => valueAt(row, column) != null && valueAt(row, column) <= value,
          ),
          chain
        ),
        lt: (column, value) => (
          state.filters.push((row) => valueAt(row, column) != null && valueAt(row, column) < value),
          chain
        ),
        order: (column, opts = {}) => (state.order.push({ column, ...opts }), chain),
        range: (from, to) => ((state.range = [from, to]), chain),
        limit: (n) => ((state.range = [0, n - 1]), chain),
        maybeSingle: () => ((state.one = true), chain),
        then(resolve, reject) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return db;
}
