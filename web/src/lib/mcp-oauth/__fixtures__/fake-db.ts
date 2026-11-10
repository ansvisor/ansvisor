import { randomUUID } from 'node:crypto';

/**
 * An in-memory stand-in for the service-role client, for the OAuth tests: the
 * tables of 00510 as arrays, and the few PostgREST calls the code makes
 * (select with one `!inner` embed, insert, update, delete; eq, is, lt, gt;
 * maybeSingle, single, or the rows), plus oauth_rate_hit. Enough to run the
 * endpoints end to end, with the SDK's own client on the other side.
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

const DEFAULTS: Record<string, () => Row> = {
  oauth_clients: () => ({
    id: randomUUID(),
    kind: 'dcr',
    created_at: new Date().toISOString(),
    last_used_at: null,
    metadata: {},
  }),
  oauth_grants: () => ({
    id: randomUUID(),
    created_at: new Date().toISOString(),
    last_used_at: null,
    revoked_at: null,
    revoked_reason: null,
  }),
  oauth_tokens: () => ({
    id: randomUUID(),
    created_at: new Date().toISOString(),
    rotated_at: null,
    revoked_at: null,
  }),
  oauth_codes: () => ({ created_at: new Date().toISOString(), used_at: null, grant_id: null }),
  oauth_authorization_requests: () => ({
    id: randomUUID(),
    created_at: new Date().toISOString(),
    user_id: null,
  }),
  oauth_events: () => ({ created_at: new Date().toISOString() }),
};

/** The embeds the code uses: embedded table → [its table, the foreign key column, the key it names]. */
const EMBEDS: Record<string, [string, string, string]> = {
  oauth_grants: ['oauth_grants', 'grant_id', 'id'],
  oauth_clients: ['oauth_clients', 'client_id', 'client_id'],
};

export function createFakeDb() {
  const tables: Record<string, Row[]> = {};
  const rate = new Map<string, number>();
  const table = (name: string) => (tables[name] ??= []);

  function from(name: string) {
    const filters: Filter[] = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row | Row[] | null = null;
    let embed: string | null = null;

    const run = (): { data: Row[]; error: null } => {
      const rows = table(name);
      if (op === 'insert') {
        const added = (Array.isArray(payload) ? payload : [payload!]).map((row) => ({
          ...(DEFAULTS[name]?.() ?? {}),
          ...row,
        }));
        rows.push(...added);
        return { data: added, error: null };
      }
      const matched = rows.filter((row) => filters.every((filter) => filter(row)));
      if (op === 'update') {
        for (const row of matched) Object.assign(row, payload);
        return { data: matched.map((row) => ({ ...row })), error: null };
      }
      if (op === 'delete') {
        tables[name] = rows.filter((row) => !matched.includes(row));
        return { data: matched, error: null };
      }
      if (!embed) return { data: matched.map((row) => ({ ...row })), error: null };
      const [parent, column, key] = EMBEDS[embed];
      return {
        data: matched
          .map((row) => ({
            ...row,
            [embed!]: table(parent).find((p) => p[key] === row[column]) ?? null,
          }))
          .filter((row) => row[embed!] !== null),
        error: null,
      };
    };

    const query = {
      select(columns?: string) {
        const match = columns?.match(/(\w+)!inner\(/);
        if (match) embed = match[1];
        return query;
      },
      insert(value: Row | Row[]) {
        op = 'insert';
        payload = value;
        return query;
      },
      update(value: Row) {
        op = 'update';
        payload = value;
        return query;
      },
      delete() {
        op = 'delete';
        return query;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return query;
      },
      is(column: string, value: null) {
        filters.push((row) => (row[column] ?? null) === value);
        return query;
      },
      lt(column: string, value: string) {
        filters.push((row) => String(row[column]) < value);
        return query;
      },
      gt(column: string, value: string) {
        filters.push((row) => String(row[column]) > value);
        return query;
      },
      async maybeSingle() {
        const { data } = run();
        return { data: data[0] ?? null, error: null };
      },
      async single() {
        const { data } = run();
        return data.length === 1
          ? { data: data[0], error: null }
          : { data: null, error: { message: `expected one row, got ${data.length}` } };
      },
      then(resolve: (value: unknown) => void, reject?: (reason: unknown) => void) {
        return Promise.resolve()
          .then(() => run())
          .then(resolve, reject);
      },
    };
    return query;
  }

  async function rpc(fn: string, args: Record<string, unknown>) {
    if (fn !== 'oauth_rate_hit') return { data: null, error: { message: `no ${fn}` } };
    const window = Math.floor(Date.now() / 1000 / (args.p_window_seconds as number));
    const key = `${args.p_key}@${window}`;
    const hits = (rate.get(key) ?? 0) + 1;
    rate.set(key, hits);
    return { data: hits <= (args.p_max as number), error: null };
  }

  return { tables, table, client: { from, rpc } };
}
