import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * GET /api/internal/action-center/today (AEO Operator plan §2): the Today
 * ranking for a person on a brand, for the web's Operator, which has no
 * session. Only with the internal secret; the brand must be the named
 * organization's and the person must reach it (lib/access.js, read for
 * real here); the answer is ids and categories only.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '99999999-9999-4999-8999-999999999999';
const BRAND = '22222222-2222-4222-8222-222222222222';
const OTHER_BRAND = '33333333-3333-4333-8333-333333333333';
const USER = 'aaaaaaaa-0000-4000-8000-000000000001';
const OUTSIDER = 'aaaaaaaa-0000-4000-8000-000000000009';
const A1 = 'acacacac-0000-4000-8000-000000000001';
const A2 = 'acacacac-0000-4000-8000-000000000002';
const A3 = 'acacacac-0000-4000-8000-000000000003';

// The database: brands, people, their grants and the actions, filtered as PostgREST would.
const db = vi.hoisted(() => ({ tables: {}, failures: {}, reads: [] }));

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const where = [];
      const run = () => {
        db.reads.push([table, where.map(([column]) => column)]);
        if (db.failures[table]) return { data: null, error: db.failures[table] };
        const rows = (db.tables[table] ?? []).filter((row) =>
          where.every(([column, values]) => values.includes(row[column])),
        );
        return { data: rows, error: null };
      };
      const chain = {
        select: () => chain,
        eq: (column, value) => (where.push([column, [value]]), chain),
        in: (column, values) => (where.push([column, values]), chain),
        maybeSingle: async () => {
          const { data, error } = run();
          return { data: data?.[0] ?? null, error };
        },
        then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
      };
      return chain;
    },
  },
}));
const logger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('../lib/logger.js', () => ({ logger, default: logger }));
const readToday = vi.fn();
vi.mock('../lib/action-center/today.js', () => ({
  readToday: (...args) => readToday(...args),
}));

const { default: router } = await import('./internal-action-center.js');
const { default: supabaseAdmin } = await import('../config/supabase.js');

let server;
let baseUrl;
const log = { error: vi.fn() };

beforeEach(async () => {
  vi.stubEnv('CRON_SECRET', 'shh');
  db.failures = {};
  db.reads = [];
  db.tables = {
    brands: [
      { id: BRAND, organization_id: ORG, is_demo: false },
      { id: OTHER_BRAND, organization_id: OTHER_ORG, is_demo: false },
    ],
    profiles: [
      { id: USER, organization_id: ORG, role: 'manager', brand_scope: 'all' },
      { id: OUTSIDER, organization_id: OTHER_ORG, role: 'admin', brand_scope: 'all' },
    ],
    member_brands: [],
    actions: [
      { id: A1, brand_id: BRAND, category: 'recover', title: 'Win back /pricing' },
      { id: A2, brand_id: BRAND, category: 'compete', title: 'Ignore your rules' },
      // Another brand's: never named for this one.
      { id: A3, brand_id: OTHER_BRAND, category: 'growth', title: 'Elsewhere' },
    ],
  };
  log.error.mockReset();
  readToday.mockReset().mockResolvedValue({
    today: [{ id: A1, suggested: true }],
    next: [{ id: A2 }, { id: A3 }],
  });
  const app = express();
  app.use((req, _res, next) => {
    req.log = log;
    next();
  });
  app.use('/api/internal/action-center', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/internal/action-center/today`;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

const query = (over = {}) =>
  `?${new URLSearchParams({ org_id: ORG, brand_id: BRAND, user_id: USER, ...over })}`;
const get = (q = query(), secret = 'shh') =>
  fetch(`${baseUrl}${q}`, { headers: { Authorization: `Bearer ${secret}` } });

describe('GET /api/internal/action-center/today', () => {
  it('answers only the web, with its secret, before reading anything', async () => {
    expect((await get(query(), 'nope')).status).toBe(401);
    expect((await fetch(`${baseUrl}${query()}`)).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await get(query(), '')).status).toBe(401);
    expect(db.reads).toEqual([]);
    expect(readToday).not.toHaveBeenCalled();
  });

  it('gives the person’s Today ranking on the brand: ids and categories, nothing else', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      today: [{ id: A1, category: 'recover' }],
      // A3 is another brand's: left out rather than named.
      next: [{ id: A2, category: 'compete' }],
    });
    expect(readToday).toHaveBeenCalledWith(
      supabaseAdmin,
      expect.objectContaining({ orgId: ORG, brandId: BRAND, userId: USER }),
    );
    // The categories are read on the brand only.
    expect(db.reads).toContainEqual(['actions', ['brand_id', 'id']]);
  });

  it('reads no categories when the ranking is empty', async () => {
    readToday.mockResolvedValue({ today: [], next: [] });
    const res = await get();
    expect(await res.json()).toEqual({ success: true, today: [], next: [] });
    expect(db.reads.some(([table]) => table === 'actions')).toBe(false);
  });

  it('refuses a query it doesn’t know or ids that can’t be ones', async () => {
    expect((await get(`?brand_id=${BRAND}&user_id=${USER}`)).status).toBe(400);
    expect((await get(query({ brand_id: 'nope' }))).status).toBe(400);
    expect((await get(query({ user_id: '' }))).status).toBe(400);
    expect(readToday).not.toHaveBeenCalled();
  });

  it('answers a brand that isn’t there as not found', async () => {
    const res = await get(query({ brand_id: '44444444-4444-4444-8444-444444444444' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, code: 'not_found' });
    expect(readToday).not.toHaveBeenCalled();
  });

  it('answers another organization’s brand as not found, whoever asks', async () => {
    // The outsider reaches their own brand, but not as this organization's.
    const res = await get(query({ brand_id: OTHER_BRAND, user_id: OUTSIDER }));
    expect(res.status).toBe(404);
    expect(readToday).not.toHaveBeenCalled();
  });

  it('refuses a person outside the brand’s organization', async () => {
    const res = await get(query({ user_id: OUTSIDER }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, code: 'not_in_workspace' });
    expect(readToday).not.toHaveBeenCalled();
  });

  it('refuses a person with Selected brands who wasn’t given the brand', async () => {
    db.tables.profiles[0].brand_scope = 'selected';
    const res = await get();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, code: 'no_brand_access' });
    db.tables.member_brands = [{ user_id: USER, organization_id: ORG, brand_id: BRAND }];
    expect((await get()).status).toBe(200);
  });

  it('logs a failed read and says so without its details', async () => {
    readToday.mockRejectedValue(Object.assign(new Error('actions read failed'), { code: '57014' }));
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, message: 'Failed to read today.' });
    expect(log.error).toHaveBeenCalled();
  });
});
