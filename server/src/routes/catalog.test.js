import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * A brand's catalog sources (#1263): a feed synced now, a file uploaded;
 * admins and managers only, a brand of their own workspace only.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const SOURCE = '0b8d6a1e-2a3c-4d5e-8f90-123456789abc';
let role;
let sources;
let inserted;
const assertBrandAccess = vi.fn();
const syncSource = vi.fn();

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const filters = {};
      const chain = {
        select: () => chain,
        eq: (column, value) => {
          filters[column] = value;
          return chain;
        },
        single: async () =>
          table === 'profiles'
            ? { data: { role }, error: null }
            : { data: inserted, error: inserted ? null : { message: 'no' } },
        maybeSingle: async () => ({
          data: sources.find((s) => Object.entries(filters).every(([k, v]) => s[k] === v)) ?? null,
          error: null,
        }),
        insert: (row) => {
          inserted = { id: 'new-upload', url: null, ...row };
          sources.push(inserted);
          return chain;
        },
        update: (values) => {
          chain.then = (onFulfilled) => {
            const row = sources.find((s) => s.id === filters.id);
            if (row) Object.assign(row, values);
            return Promise.resolve({ error: null }).then(onFulfilled);
          };
          return chain;
        },
      };
      return chain;
    },
  },
}));
vi.mock('../lib/access.js', () => ({
  assertBrandAccess: (...args) => assertBrandAccess(...args),
}));
vi.mock('../lib/catalog/sources.js', () => ({
  syncSource: (...args) => syncSource(...args),
}));

const { default: router } = await import('./catalog.js');

let server;
let base;
beforeEach(async () => {
  role = 'admin';
  inserted = null;
  sources = [
    {
      id: SOURCE,
      brand_id: BRAND,
      kind: 'feed_url',
      format: 'auto',
      url: 'https://shop.example/feed.xml',
      last_synced_at: null,
    },
  ];
  assertBrandAccess.mockReset().mockResolvedValue({ orgId: 'org-1' });
  syncSource.mockReset().mockResolvedValue({ status: 'ok', counts: { items: 4 } });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-1' };
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/api/catalog', router);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/catalog`;
});
afterEach(() => new Promise((resolve) => server.close(resolve)));

const sync = (id = SOURCE) => fetch(`${base}/sources/${id}/sync`, { method: 'POST' });
const upload = (body, query = `brandId=${BRAND}`) =>
  fetch(`${base}/upload?${query}`, {
    method: 'POST',
    headers: { 'content-type': 'text/csv' },
    body,
  });

describe('POST /api/catalog/sources/:id/sync', () => {
  it("syncs a feed for an admin or a manager of the brand's workspace", async () => {
    const res = await sync();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', error: null, counts: { items: 4 } });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'user-1');
    expect(syncSource).toHaveBeenCalledWith(expect.objectContaining({ id: SOURCE }));
  });

  it('refuses an analyst, another workspace, an upload source and a bad id', async () => {
    role = 'analyst';
    expect((await sync()).status).toBe(403);
    role = 'manager';
    assertBrandAccess.mockRejectedValueOnce(
      Object.assign(new Error("This brand isn't in your workspace"), {
        status: 403,
        code: 'not_in_workspace',
      }),
    );
    const other = await sync();
    expect(other.status).toBe(403);
    expect((await other.json()).code).toBe('not_in_workspace');
    sources[0].kind = 'upload';
    expect((await sync()).status).toBe(404);
    expect((await sync('nope')).status).toBe(400);
    expect(syncSource).not.toHaveBeenCalled();
  });

  it('says a feed synced a moment ago is fresh, without reading it again', async () => {
    sources[0].last_synced_at = new Date(Date.now() - 30_000).toISOString();
    const res = await sync();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('recent');
    expect(syncSource).not.toHaveBeenCalled();
  });
});

describe('POST /api/catalog/upload', () => {
  it("makes the brand's upload source on its first upload, and imports the file's text", async () => {
    const res = await upload('id,title\n1,Boot');
    expect(res.status).toBe(200);
    expect(inserted).toMatchObject({
      brand_id: BRAND,
      kind: 'upload',
      format: 'auto',
      created_by: 'user-1',
    });
    expect(syncSource).toHaveBeenCalledWith(expect.objectContaining({ kind: 'upload' }), {
      text: 'id,title\n1,Boot',
    });
  });

  it('keeps one upload source a brand, with the format asked for', async () => {
    sources.push({ id: 'up-1', brand_id: BRAND, kind: 'upload', format: 'auto', url: null });
    await upload('<rss/>', `brandId=${BRAND}&format=google_xml`);
    expect(inserted).toBeNull();
    expect(sources.find((s) => s.id === 'up-1').format).toBe('google_xml');
    expect(syncSource).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'up-1', format: 'google_xml' }),
      { text: '<rss/>' },
    );
  });

  it('refuses an analyst, an empty body, a bad brand or format, and a file over 4 MB', async () => {
    role = 'analyst';
    expect((await upload('id\n1')).status).toBe(403);
    role = 'admin';
    expect((await upload('  ')).status).toBe(400);
    expect((await upload('id\n1', 'brandId=nope')).status).toBe(400);
    expect((await upload('id\n1', `brandId=${BRAND}&format=xlsx`)).status).toBe(400);
    const big = await upload('x'.repeat(4 * 1024 * 1024 + 10));
    expect(big.status).toBe(413);
    expect((await big.json()).code).toBe('too_large');
    expect(syncSource).not.toHaveBeenCalled();
  });
});
