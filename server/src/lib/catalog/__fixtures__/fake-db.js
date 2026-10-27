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
  const uniqueKey = (table, row) => {
    if (table === 'catalog_categories') return `${row.brand_id}|${row.name}`;
    if (table === 'catalog_source_credentials') return row.source_id;
    if (table === 'catalog_category_pages') return `${row.brand_id}|${row.category}`;
    return `${row.brand_id}|${row.source}|${row.external_id}`;
  };
  // The unique keys' rows, by table, as the database's unique indexes find them.
  const byKey = new Map();
  const keyed = (table) => {
    if (!byKey.has(table)) byKey.set(table, new Map());
    return byKey.get(table);
  };

  function from(table) {
    const state = {
      filters: [],
      range: null,
      op: 'select',
      payload: null,
      returning: null,
      one: null,
    };
    const run = () => {
      const all = rows(table);
      const match = (row) =>
        state.filters.every(([kind, column, value]) => {
          if (kind === 'eq') return row[column] === value;
          if (kind === 'neq') return row[column] !== value;
          if (kind === 'is') return value === null ? row[column] == null : row[column] === value;
          return value.includes(row[column]);
        });
      if (state.op === 'select') {
        const found = all.filter(match).sort((a, b) => (a.id < b.id ? -1 : 1));
        const [start, end] = state.range ?? [0, found.length];
        const data = found.slice(start, end + 1);
        if (state.one) return { data: data[0] ?? null, error: null };
        return { data, error: null };
      }
      writes.push({
        table,
        op: state.op,
        count: Array.isArray(state.payload) ? state.payload.length : 1,
      });
      if (state.op === 'upsert') {
        const out = [];
        for (const values of [state.payload].flat()) {
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
        const added = [state.payload].flat().map((values) => ({ id: randomUUID(), ...values }));
        all.push(...added);
        return { data: state.one ? added[0] : null, error: null };
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
      neq: (column, value) => {
        state.filters.push(['neq', column, value]);
        return builder;
      },
      is: (column, value) => {
        state.filters.push(['is', column, value]);
        return builder;
      },
      single: () => {
        state.one = 'single';
        return builder;
      },
      maybeSingle: () => {
        state.one = 'maybe';
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
