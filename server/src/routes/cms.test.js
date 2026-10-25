import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * /api/cms/brands/:brandId/webflow (Send to CMS, #1331 phase 2, 00283): a
 * brand's Webflow connection. Members read it; admins and managers connect a
 * site token, map a collection and disconnect; the token is never kept,
 * logged or sent back.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const TOKEN = 'wf_site_token_0123456789abcdef';

let role;
let rows;
const assertBrandAccess = vi.fn();
const composio = {
  isWebflowConfigured: vi.fn(),
  connectWebflowToken: vi.fn(),
  deleteConnection: vi.fn(),
};
const webflow = { listSites: vi.fn(), listCollections: vi.fn(), getCollection: vi.fn() };

/** brand_cms_connections in memory: the queries the route makes. */
function table() {
  let filters = [];
  let write = null;
  const matches = (row) => filters.every(([col, value]) => row[col] === value);
  const run = () => {
    if (write?.kind === 'upsert') {
      const at = rows.findIndex(
        (r) => r.brand_id === write.row.brand_id && r.provider === write.row.provider,
      );
      const row = {
        created_at: '2026-10-25T10:00:00Z',
        ...(at >= 0 ? rows[at] : {}),
        ...write.row,
      };
      if (at >= 0) rows[at] = row;
      else rows.push(row);
      return [row];
    }
    if (write?.kind === 'update') {
      const hit = rows.filter(matches);
      for (const row of hit) Object.assign(row, write.fields);
      return hit;
    }
    if (write?.kind === 'delete') {
      const hit = rows.filter(matches);
      rows = rows.filter((r) => !matches(r));
      return hit;
    }
    return rows.filter(matches);
  };
  const chain = {
    select: () => chain,
    eq: (col, value) => {
      filters.push([col, value]);
      return chain;
    },
    upsert: (row) => {
      write = { kind: 'upsert', row };
      return chain;
    },
    update: (fields) => {
      write = { kind: 'update', fields };
      return chain;
    },
    delete: () => {
      write = { kind: 'delete' };
      return chain;
    },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    single: async () => ({ data: run()[0] ?? null, error: null }),
    then: (resolve) => resolve({ data: run(), error: null }),
  };
  return chain;
}

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (name) => {
      if (name === 'profiles') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          single: async () => ({ data: { role } }),
        };
        return chain;
      }
      return table();
    },
  },
}));
vi.mock('../lib/access.js', () => ({ assertBrandAccess: (...args) => assertBrandAccess(...args) }));
vi.mock('../lib/composio.js', () => ({
  isWebflowConfigured: () => composio.isWebflowConfigured(),
  connectWebflowToken: (...args) => composio.connectWebflowToken(...args),
  deleteConnection: (...args) => composio.deleteConnection(...args),
}));
vi.mock('../lib/cms/webflow.js', async (importOriginal) => ({
  ...(await importOriginal()),
  listSites: (...args) => webflow.listSites(...args),
  listCollections: (...args) => webflow.listCollections(...args),
  getCollection: (...args) => webflow.getCollection(...args),
}));
vi.mock('../middleware/rate-limiter.js', () => ({ cmsLimiter: (_req, _res, next) => next() }));

const { default: router } = await import('./cms.js');
const { WebflowError } = await import('../lib/cms/webflow.js');

const fields = [
  { slug: 'name', name: 'Name', type: 'PlainText', required: true },
  { slug: 'slug', name: 'Slug', type: 'PlainText', required: true },
  { slug: 'post-body', name: 'Post Body', type: 'RichText', required: false },
  { slug: 'post-summary', name: 'Post Summary', type: 'PlainText', required: false },
];

let server;
let base;
let logged;

beforeEach(async () => {
  role = 'manager';
  rows = [];
  logged = [];
  assertBrandAccess.mockReset().mockResolvedValue({ orgId: 'o1' });
  composio.isWebflowConfigured.mockReset().mockReturnValue(true);
  composio.connectWebflowToken.mockReset().mockResolvedValue('ca_new');
  composio.deleteConnection.mockReset().mockResolvedValue(undefined);
  webflow.listSites.mockReset().mockResolvedValue([{ id: 's1', name: 'Ansvisor' }]);
  webflow.listCollections
    .mockReset()
    .mockResolvedValue([{ id: 'c1', name: 'Blog Posts', slug: 'post' }]);
  webflow.getCollection.mockReset().mockResolvedValue({ id: 'c1', name: 'Blog Posts', fields });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    const log = (...args) => logged.push(JSON.stringify(args));
    req.log = { error: log, warn: log, info: log };
    next();
  });
  app.use('/api/cms', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/cms/brands/${BRAND}/webflow`;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

const call = (method, path = '', body) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const connectedRow = (extra = {}) => ({
  brand_id: BRAND,
  provider: 'webflow',
  composio_account_id: 'ca_old',
  composio_entity_id: `brand_${BRAND}`,
  status: 'connected',
  site_id: 's1',
  site_name: 'Ansvisor',
  collection_id: 'c1',
  collection_name: 'Blog Posts',
  field_map: { body: 'post-body' },
  created_at: '2026-10-20T10:00:00Z',
  updated_at: '2026-10-20T10:00:00Z',
  ...extra,
});

describe('GET the connection', () => {
  it('shows a member the brand’s connection, without Composio’s ids', async () => {
    role = 'member';
    expect(await (await call('GET')).json()).toEqual({ configured: true, connection: null });
    rows.push(connectedRow());
    const body = await (await call('GET')).json();
    expect(body.connection).toEqual({
      status: 'connected',
      siteId: 's1',
      siteName: 'Ansvisor',
      collectionId: 'c1',
      collectionName: 'Blog Posts',
      fieldMap: { body: 'post-body' },
      connectedAt: '2026-10-20T10:00:00Z',
      updatedAt: '2026-10-20T10:00:00Z',
    });
    expect(JSON.stringify(body)).not.toMatch(/ca_old|brand_/);
  });

  it('refuses a brand of another workspace, and a malformed id', async () => {
    assertBrandAccess.mockRejectedValueOnce(
      Object.assign(new Error('nope'), { status: 403, code: 'not_in_workspace' }),
    );
    const res = await call('GET');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'not_in_workspace' });
    const bad = await fetch(base.replace(BRAND, 'not-a-brand'));
    expect(bad.status).toBe(400);
  });
});

describe('POST connect', () => {
  it('connects a token Webflow takes, keeping its one site, and never the token', async () => {
    const res = await call('POST', '', { token: ` ${TOKEN} ` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sites).toEqual([{ id: 's1', name: 'Ansvisor' }]);
    expect(body.connection).toMatchObject({
      status: 'connected',
      siteId: 's1',
      collectionId: null,
    });
    expect(composio.connectWebflowToken).toHaveBeenCalledWith(`brand_${BRAND}`, TOKEN);
    expect(webflow.listSites).toHaveBeenCalledWith({
      entityId: `brand_${BRAND}`,
      accountId: 'ca_new',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ composio_account_id: 'ca_new', connected_by: 'u1' });
    expect(JSON.stringify([rows, body, logged])).not.toContain(TOKEN);
  });

  it('keeps where pages go for a new token of the same site, and forgets the old account', async () => {
    rows.push(connectedRow());
    const body = await (await call('POST', '', { token: TOKEN })).json();
    expect(body.connection).toMatchObject({ collectionId: 'c1', fieldMap: { body: 'post-body' } });
    expect(composio.deleteConnection).toHaveBeenCalledWith('ca_old');
    expect(composio.deleteConnection).not.toHaveBeenCalledWith('ca_new');
  });

  it('starts over for a token of another site', async () => {
    rows.push(connectedRow());
    webflow.listSites.mockResolvedValueOnce([{ id: 's2', name: 'Acme' }]);
    const body = await (await call('POST', '', { token: TOKEN })).json();
    expect(body.connection).toMatchObject({ siteId: 's2', collectionId: null, fieldMap: {} });
  });

  it('keeps no account for a token Webflow refuses, or one that reaches no site', async () => {
    webflow.listSites.mockRejectedValueOnce(
      new WebflowError('auth_failed', 'Webflow refused the site token'),
    );
    const refused = await call('POST', '', { token: TOKEN });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'auth_failed' });
    expect(composio.deleteConnection).toHaveBeenCalledWith('ca_new');
    expect(rows).toEqual([]);

    webflow.listSites.mockResolvedValueOnce([]);
    const none = await call('POST', '', { token: TOKEN });
    expect(await none.json()).toMatchObject({ code: 'no_site' });
    expect(rows).toEqual([]);
  });

  it('doesn’t mark a working connection refused when a new token is', async () => {
    rows.push(connectedRow());
    webflow.listSites.mockRejectedValueOnce(
      new WebflowError('auth_failed', 'Webflow refused the site token'),
    );
    await call('POST', '', { token: TOKEN });
    expect(rows[0]).toMatchObject({ status: 'connected', composio_account_id: 'ca_old' });
  });

  it('is for admins and managers, on a server Webflow is set up on, with a token', async () => {
    role = 'member';
    expect((await call('POST', '', { token: TOKEN })).status).toBe(403);
    role = 'admin';
    composio.isWebflowConfigured.mockReturnValueOnce(false);
    const off = await call('POST', '', { token: TOKEN });
    expect(off.status).toBe(503);
    expect(await off.json()).toMatchObject({ code: 'not_configured' });
    expect((await call('POST', '', { token: 'has a space in it 1234567' })).status).toBe(400);
    expect(composio.connectWebflowToken).not.toHaveBeenCalled();
  });

  it('logs a Composio failure by its name only', async () => {
    composio.connectWebflowToken.mockRejectedValueOnce(new Error(`bad key ${TOKEN}`));
    const res = await call('POST', '', { token: TOKEN });
    expect(res.status).toBe(502);
    expect(logged.join('')).not.toContain(TOKEN);
  });
});

describe('collections and their fields', () => {
  it('asks for a connection first', async () => {
    const res = await call('GET', '/collections');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'not_connected' });
  });

  it('lists the site’s collections, and a collection’s fields with the map they suggest', async () => {
    rows.push(connectedRow({ collection_id: null, field_map: {} }));
    expect(await (await call('GET', '/collections')).json()).toEqual({
      sites: [{ id: 's1', name: 'Ansvisor' }],
      siteId: 's1',
      collections: [{ id: 'c1', name: 'Blog Posts', slug: 'post' }],
    });
    // A site the token doesn't reach lists nothing.
    expect(await (await call('GET', '/collections?siteId=s9')).json()).toMatchObject({
      siteId: null,
      collections: [],
    });
    expect(await (await call('GET', '/collections/c1')).json()).toEqual({
      id: 'c1',
      name: 'Blog Posts',
      fields,
      suggested: { body: 'post-body', metaDescription: 'post-summary' },
    });
  });

  it('marks the connection refused when Webflow no longer takes its token', async () => {
    rows.push(connectedRow());
    webflow.listSites.mockRejectedValueOnce(
      new WebflowError('auth_failed', 'Webflow refused the site token'),
    );
    const res = await call('GET', '/collections');
    expect(await res.json()).toMatchObject({ code: 'auth_failed' });
    expect(rows[0].status).toBe('auth_failed');
  });
});

describe('PUT where pages go', () => {
  it('keeps a field map that fits the site’s collection', async () => {
    rows.push(connectedRow({ collection_id: null, collection_name: null, field_map: {} }));
    const res = await call('PUT', '', {
      collectionId: 'c1',
      fieldMap: { body: 'post-body', metaDescription: 'post-summary' },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).connection).toMatchObject({
      collectionId: 'c1',
      collectionName: 'Blog Posts',
      fieldMap: { body: 'post-body', metaDescription: 'post-summary' },
    });
  });

  it('refuses a collection of another site, and a map that doesn’t fit', async () => {
    rows.push(connectedRow());
    const elsewhere = await call('PUT', '', {
      collectionId: 'c9',
      fieldMap: { body: 'post-body' },
    });
    expect(elsewhere.status).toBe(404);
    const bad = await call('PUT', '', { collectionId: 'c1', fieldMap: { body: 'post-summary' } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      code: 'invalid_map',
      problems: ['body: Post Summary is PlainText, not RichText'],
    });
    expect(rows[0].field_map).toEqual({ body: 'post-body' });
  });
});

describe('DELETE disconnect', () => {
  it('removes the account at Composio and the brand’s connection', async () => {
    rows.push(connectedRow());
    const res = await call('DELETE');
    expect(await res.json()).toEqual({ success: true });
    expect(composio.deleteConnection).toHaveBeenCalledWith('ca_old');
    expect(rows).toEqual([]);
  });

  it('removes the connection even when Composio can’t, and is for admins and managers', async () => {
    rows.push(connectedRow());
    role = 'member';
    expect((await call('DELETE')).status).toBe(403);
    role = 'admin';
    composio.deleteConnection.mockRejectedValueOnce(new Error('down'));
    expect((await call('DELETE')).status).toBe(200);
    expect(rows).toEqual([]);
  });
});
