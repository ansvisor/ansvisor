import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * ChatGPT Business Hub numbers (00526): every member reads and enters them,
 * admins and managers delete them; not found while BUSINESS_HUB_ENABLED is
 * off; nothing written for the demo brand.
 */

// Seeded brands' ids aren't RFC 4122 versions; the routes must still take them.
const BRAND = '33333333-3333-3333-3333-333333333333';
const DEMO = '44444444-4444-4444-4444-444444444444';
const OTHER = '55555555-5555-5555-5555-555555555555';
const ENTRY = '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a29';

let role;
let table;
const logError = vi.fn();
const assertBrandAccess = vi.fn();
const afterBusinessHubSave = vi.fn();

/** The table, with the calls the routes make, keyed as its unique index is. */
function from(name) {
  expect(name).toBe('business_hub_snapshots');
  const state = { filters: [], payload: null, op: 'select', one: false, limit: null };
  const run = () => {
    const match = (row) => state.filters.every((f) => f(row));
    if (state.op === 'upsert') {
      const out = state.payload.map((values) => {
        const at = table.find(
          (r) =>
            r.brand_id === values.brand_id &&
            r.period_days === values.period_days &&
            r.period_end === values.period_end,
        );
        if (at) return Object.assign(at, values);
        const row = { id: `s${table.length + 1}`, created_at: values.updated_at, ...values };
        table.push(row);
        return row;
      });
      return { data: out, error: null };
    }
    if (state.op === 'delete') {
      table = table.filter((row) => !match(row));
      return { data: null, error: null };
    }
    const found = table
      .filter(match)
      .sort((a, b) => b.period_end.localeCompare(a.period_end))
      .slice(0, state.limit ?? undefined);
    return { data: state.one ? (found[0] ?? null) : found, error: null };
  };
  const builder = {
    select: () => builder,
    eq: (column, value) => {
      state.filters.push((row) => row[column] === value);
      return builder;
    },
    in: (column, values) => {
      state.filters.push((row) => values.includes(row[column]));
      return builder;
    },
    order: () => builder,
    limit: (n) => {
      state.limit = n;
      return builder;
    },
    maybeSingle: () => {
      state.one = true;
      return builder;
    },
    upsert: (payload) => {
      state.op = 'upsert';
      state.payload = payload;
      return builder;
    },
    delete: () => {
      state.op = 'delete';
      return builder;
    },
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  };
  return builder;
}

vi.mock('../config/supabase.js', () => ({ default: { from: (name) => from(name) } }));
vi.mock('../lib/access.js', () => ({
  assertBrandAccess: (...args) => assertBrandAccess(...args),
  MANAGER_ROLES: ['admin', 'manager'],
  // The role rule itself is access.js's (run-roles.test.js); here, the caller's.
  assertRole: vi.fn(async (_userId, roles, message) => {
    if (!roles.includes(role)) {
      const err = new Error(message);
      err.status = 403;
      throw err;
    }
    return role;
  }),
}));
vi.mock('../lib/business-hub/snapshots.js', async (importOriginal) => ({
  ...(await importOriginal()),
  afterBusinessHubSave: (...args) => afterBusinessHubSave(...args),
}));

const { default: router } = await import('./business-hub.js');

let server;
let baseUrl;
beforeEach(async () => {
  vi.stubEnv('BUSINESS_HUB_ENABLED', 'true');
  role = 'analyst';
  table = [];
  logError.mockReset();
  afterBusinessHubSave.mockReset().mockResolvedValue(null);
  assertBrandAccess.mockReset().mockImplementation(async (brandId) => {
    if (brandId === OTHER) {
      const err = new Error("This brand isn't in your workspace");
      err.status = 403;
      throw err;
    }
    return { brand: { id: brandId, is_demo: brandId === DEMO }, orgId: 'o1', role };
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: logError };
    next();
  });
  app.use('/api/business-hub', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/business-hub`;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

const call = (method, path, body) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** A week's entry, ending a few days ago. */
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const entry = (over = {}) => ({
  periodDays: 7,
  periodEnd: daysAgo(2),
  mentions: 53,
  websiteClicks: 19,
  profileViews: null,
  topics: ['Coffee subscriptions', ' coffee subscriptions ', 'Espresso beans'],
  ...over,
});

describe('/api/business-hub with BUSINESS_HUB_ENABLED off', () => {
  it('is not found, whatever the path and method', async () => {
    vi.stubEnv('BUSINESS_HUB_ENABLED', '');
    for (const [method, path] of [
      ['GET', `/${BRAND}/snapshots`],
      ['PUT', `/${BRAND}/snapshots`],
      ['POST', `/${BRAND}/snapshots/import`],
      ['DELETE', `/snapshots/${ENTRY}`],
      ['GET', '/anything'],
    ]) {
      const res = await call(method, path, method === 'GET' ? undefined : {});
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await res.json()).toEqual({ error: 'Not available', code: 'off' });
    }
    expect(assertBrandAccess).not.toHaveBeenCalled();
    expect(table).toEqual([]);
  });
});

describe('PUT /api/business-hub/:brandId/snapshots', () => {
  it('lets every member enter numbers, cleaned, and says who entered them', async () => {
    const res = await call('PUT', `/${BRAND}/snapshots`, entry());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.replaced).toBe(false);
    expect(body.snapshot).toMatchObject({
      periodDays: 7,
      periodEnd: daysAgo(2),
      mentions: 53,
      websiteClicks: 19,
      profileViews: null,
      topics: ['Coffee subscriptions', 'Espresso beans'],
      source: 'manual',
      enteredBy: 'u1',
    });
    expect(table).toHaveLength(1);
    expect(afterBusinessHubSave).toHaveBeenCalledWith(BRAND);
  });

  it('replaces the entry of the same length and last day', async () => {
    await call('PUT', `/${BRAND}/snapshots`, entry());
    const res = await call('PUT', `/${BRAND}/snapshots`, entry({ mentions: 60, topics: [] }));
    expect((await res.json()).replaced).toBe(true);
    expect(table).toHaveLength(1);
    expect(table[0]).toMatchObject({ mentions: 60, discovery_topics: [] });
    // Another length on the same day is another entry.
    await call('PUT', `/${BRAND}/snapshots`, entry({ periodDays: 28 }));
    expect(table).toHaveLength(2);
  });

  it('refuses a bad entry with the field and why, and saves nothing', async () => {
    for (const [over, field, reason] of [
      [{ periodDays: 14 }, 'periodDays', 'invalid'],
      [{ mentions: -3 }, 'mentions', 'invalid'],
      [{ websiteClicks: 2.5 }, 'websiteClicks', 'invalid'],
      [{ periodEnd: daysAgo(-3) }, 'periodEnd', 'future'],
      [{ periodEnd: daysAgo(800) }, 'periodEnd', 'too_old'],
      [{ topics: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'topics', 'too_many'],
      [{ mentions: null, websiteClicks: null, profileViews: null, topics: [] }, 'entry', 'empty'],
    ]) {
      const res = await call('PUT', `/${BRAND}/snapshots`, entry(over));
      expect(res.status, JSON.stringify(over)).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'invalid', field, reason });
    }
    expect(table).toEqual([]);
    expect(afterBusinessHubSave).not.toHaveBeenCalled();
  });

  it('keeps a save when what follows it fails', async () => {
    afterBusinessHubSave.mockRejectedValue(new Error('actions read: timeout'));
    const res = await call('PUT', `/${BRAND}/snapshots`, entry());
    expect(res.status).toBe(200);
    expect(table).toHaveLength(1);
    expect(logError).toHaveBeenCalled();
  });

  it('refuses the demo brand, and a brand of another workspace', async () => {
    const demo = await call('PUT', `/${DEMO}/snapshots`, entry());
    expect(demo.status).toBe(402);
    expect((await demo.json()).code).toBe('demo_brand');
    const other = await call('PUT', `/${OTHER}/snapshots`, entry());
    expect(other.status).toBe(403);
    expect(table).toEqual([]);
  });
});

describe('POST /api/business-hub/:brandId/snapshots/import', () => {
  it('saves every row from the template, as csv, and counts the ones it replaced', async () => {
    await call('PUT', `/${BRAND}/snapshots`, entry({ periodEnd: daysAgo(9) }));
    const res = await call('POST', `/${BRAND}/snapshots/import`, {
      rows: [entry({ periodEnd: daysAgo(2) }), entry({ periodEnd: daysAgo(9), mentions: 41 })],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ saved: 2, replaced: 1 });
    expect(table).toHaveLength(2);
    expect(table.every((row) => row.source === 'csv')).toBe(true);
    expect(afterBusinessHubSave).toHaveBeenCalledTimes(2);
  });

  it('saves nothing when one row is bad, and names the row', async () => {
    const res = await call('POST', `/${BRAND}/snapshots/import`, {
      rows: [entry({ periodEnd: daysAgo(2) }), entry({ periodEnd: daysAgo(9), mentions: -1 })],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'mentions', reason: 'invalid', row: 1 });
    expect(table).toEqual([]);
  });

  it('refuses the same length and last day twice in one file', async () => {
    const res = await call('POST', `/${BRAND}/snapshots/import`, {
      rows: [entry(), entry({ mentions: 1 })],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'periodEnd', reason: 'duplicate', row: 1 });
    expect(table).toEqual([]);
  });

  it('takes 1 to 104 rows', async () => {
    expect((await call('POST', `/${BRAND}/snapshots/import`, { rows: [] })).status).toBe(400);
    const many = Array.from({ length: 105 }, (_, i) => entry({ periodEnd: daysAgo(2 + i) }));
    expect((await call('POST', `/${BRAND}/snapshots/import`, { rows: many })).status).toBe(400);
    expect(table).toEqual([]);
  });

  it('refuses the demo brand', async () => {
    const res = await call('POST', `/${DEMO}/snapshots/import`, { rows: [entry()] });
    expect(res.status).toBe(402);
    expect(table).toEqual([]);
  });
});

describe('GET /api/business-hub/:brandId/snapshots', () => {
  it('lists the brand’s entries, newest first, for any member', async () => {
    table = [
      { id: 'a', brand_id: BRAND, period_days: 7, period_end: '2026-10-27', mentions: 40 },
      { id: 'b', brand_id: BRAND, period_days: 7, period_end: '2026-11-03', mentions: 44 },
      { id: 'c', brand_id: OTHER, period_days: 7, period_end: '2026-11-03', mentions: 1 },
    ];
    const res = await call('GET', `/${BRAND}/snapshots`);
    expect(res.status).toBe(200);
    const { snapshots } = await res.json();
    expect(snapshots.map((s) => s.id)).toEqual(['b', 'a']);
    expect(snapshots[0]).toMatchObject({ periodDays: 7, periodEnd: '2026-11-03', topics: [] });
  });

  it('refuses a brand the person can’t reach, and a bad id', async () => {
    expect((await call('GET', `/${OTHER}/snapshots`)).status).toBe(403);
    expect((await call('GET', '/not-an-id/snapshots')).status).toBe(400);
  });
});

describe('DELETE /api/business-hub/snapshots/:id', () => {
  beforeEach(() => {
    table = [{ id: ENTRY, brand_id: BRAND, period_days: 7, period_end: '2026-11-03' }];
  });

  it('is refused to an analyst and an agency partner', async () => {
    for (role of ['analyst', 'agency_partner']) {
      const res = await call('DELETE', `/snapshots/${ENTRY}`);
      expect(res.status, role).toBe(403);
      expect((await res.json()).code).toBe('forbidden');
    }
    expect(table).toHaveLength(1);
  });

  it('deletes the entry for an admin or a manager', async () => {
    role = 'manager';
    const res = await call('DELETE', `/snapshots/${ENTRY}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(table).toEqual([]);
  });

  it('answers not found for an entry that isn’t there, and refuses the demo brand’s', async () => {
    role = 'admin';
    expect((await call('DELETE', '/snapshots/6f1c7d0e-1111-4222-8333-944455556666')).status).toBe(
      404,
    );
    table = [{ id: ENTRY, brand_id: DEMO, period_days: 7, period_end: '2026-11-03' }];
    expect((await call('DELETE', `/snapshots/${ENTRY}`)).status).toBe(402);
    expect(table).toHaveLength(1);
  });
});
