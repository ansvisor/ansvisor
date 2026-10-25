import { randomUUID } from 'node:crypto';

/**
 * An in-memory stand-in for the tables the catalog writes, with PostgREST's
 * calls as the sync and the sources make them, counting every write.
 */
export function fakeDb() {
  const tables = new Map();
  const rows = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };
  const writes = [];
  const uniqueKey = (table, row) =>
    table === 'catalog_categories'
      ? `${row.brand_id}|${row.name}`
      : `${row.brand_id}|${row.source}|${row.external_id}`;
  // The unique keys' rows, by table, as the database's unique indexes find them.
  const byKey = new Map();
  const keyed = (table) => {
    if (!byKey.has(table)) byKey.set(table, new Map());
    return byKey.get(table);
  };

  function from(table) {
    const state = { filters: [], range: null, op: 'select', payload: null, returning: null };
    const run = () => {
      const all = rows(table);
      const match = (row) =>
        state.filters.every(([kind, column, value]) =>
          kind === 'eq' ? row[column] === value : value.includes(row[column]),
        );
      if (state.op === 'select') {
        const found = all.filter(match).sort((a, b) => (a.id < b.id ? -1 : 1));
        const [start, end] = state.range ?? [0, found.length];
        return { data: found.slice(start, end + 1), error: null };
      }
      writes.push({
        table,
        op: state.op,
        count: Array.isArray(state.payload) ? state.payload.length : 1,
      });
      if (state.op === 'upsert') {
        const out = [];
        for (const values of state.payload) {
          const key = uniqueKey(table, values);
          let row = keyed(table).get(key);
          if (row) Object.assign(row, values);
          else {
            row = { id: randomUUID(), removed_at: null, ...values };
            all.push(row);
            keyed(table).set(key, row);
          }
          out.push(row);
        }
        return { data: out, error: null };
      }
      if (state.op === 'insert') {
        for (const values of state.payload) all.push({ id: randomUUID(), ...values });
        return { data: null, error: null };
      }
      if (state.op === 'update') {
        for (const row of all.filter(match)) Object.assign(row, state.payload);
        return { data: null, error: null };
      }
      if (state.op === 'delete') {
        tables.set(
          table,
          all.filter((row) => !match(row)),
        );
        return { data: null, error: null };
      }
      throw new Error(`unexpected ${state.op}`);
    };
    const builder = {
      select: () => builder,
      eq: (column, value) => {
        state.filters.push(['eq', column, value]);
        return builder;
      },
      in: (column, values) => {
        state.filters.push(['in', column, values]);
        return builder;
      },
      order: () => builder,
      // The sweep's due filter: the tests' rows are all due.
      or: () => builder,
      limit: (n) => {
        state.range = [0, n - 1];
        return builder;
      },
      range: (start, end) => {
        state.range = [start, end];
        return builder;
      },
      upsert: (payload) => {
        state.op = 'upsert';
        state.payload = payload;
        return builder;
      },
      insert: (payload) => {
        state.op = 'insert';
        state.payload = payload;
        return builder;
      },
      update: (payload) => {
        state.op = 'update';
        state.payload = payload;
        return builder;
      },
      delete: () => {
        state.op = 'delete';
        return builder;
      },
      then: (onFulfilled, onRejected) => Promise.resolve(run()).then(onFulfilled, onRejected),
    };
    return builder;
  }
  return { db: { from }, rows, writes };
}
