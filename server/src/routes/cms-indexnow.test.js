import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * /api/cms/brands/:brandId/indexnow (#2142, part B; 00491): members read a
 * brand's IndexNow; admins and managers turn it on (a new key on the brand's
 * primary domain), check the key's file, and turn it off. A CMS that can't
 * put a file at the site's root keeps it off.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const KEY = '0123456789abcdef0123456789abcdef';
let role;
let state;
const written = [];
const assertBrandAccess = vi.fn();
const checkKeyFile = vi.fn();

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => ({
      update: (fields) => ({
        eq: async (_col, id) => {
          written.push({ table, id, fields });
          Object.assign(state, {
            key: 'indexnow_key' in fields ? fields.indexnow_key : state.key,
            host: 'indexnow_host' in fields ? fields.indexnow_host : state.host,
            verifiedAt:
              'indexnow_verified_at' in fields ? fields.indexnow_verified_at : state.verifiedAt,
          });
          return { error: null };
        },
      }),
    }),
  },
}));
vi.mock('../lib/access.js', () => ({
  MANAGER_ROLES: ['admin', 'manager'],
  assertBrandAccess: (...args) => assertBrandAccess(...args),
  assertRole: async (_userId, roles, message) => {
    if (!roles.includes(role))
      throw Object.assign(new Error(message), { status: 403, code: 'forbidden' });
    return role;
  },
}));
vi.mock('../lib/indexnow.js', () => ({
  newIndexNowKey: () => KEY,
  checkKeyFile: (...args) => checkKeyFile(...args),
  readIndexNow: async () => ({ ...state }),
}));
vi.mock('../middleware/rate-limiter.js', () => ({ cmsLimiter: (_req, _res, next) => next() }));
vi.mock('./cms.js', () => ({
  brandOf: (req, res) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.brandId)) {
      res.status(400).json({ code: 'invalid' });
      return null;
    }
    return req.params.brandId;
  },
}));

const { default: router } = await import('./cms-indexnow.js');

let server;
let base;
beforeEach(async () => {
  role = 'manager';
  written.length = 0;
  state = {
    key: null,
    host: null,
    verifiedAt: null,
    blockedBy: null,
    domainHost: 'www.acme.example',
  };
  assertBrandAccess.mockReset().mockResolvedValue({ orgId: 'o1' });
  checkKeyFile.mockReset().mockResolvedValue({ state: 'ok', host: 'www.acme.example' });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/cms', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/cms/brands/${BRAND}/indexnow`;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

const call = (method, path = '') => fetch(`${base}${path}`, { method });

describe('a brand’s IndexNow', () => {
  it('is read by any member of the brand', async () => {
    role = 'analyst';
    const res = await call('GET');
    expect(res.status).toBe(200);
    expect((await res.json()).indexnow).toMatchObject({
      key: null,
      domainHost: 'www.acme.example',
    });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
  });

  it('is turned on by an admin or a manager: a new key on the primary domain, not checked yet', async () => {
    const res = await call('POST');
    expect(res.status).toBe(200);
    expect(written).toEqual([
      {
        table: 'brands',
        id: BRAND,
        fields: {
          indexnow_key: KEY,
          indexnow_host: 'www.acme.example',
          indexnow_verified_at: null,
        },
      },
    ]);
  });

  it('refuses an analyst or an agency partner every change, writing nothing', async () => {
    for (const refused of ['analyst', 'agency_partner']) {
      role = refused;
      for (const [method, path] of [
        ['POST', ''],
        ['POST', '/check'],
        ['DELETE', ''],
      ]) {
        const res = await call(method, path);
        expect(res.status, `${method} ${path}`).toBe(403);
        expect((await res.json()).error).toBe('Only admins and managers can set up IndexNow.');
      }
    }
    expect(written).toEqual([]);
    expect(checkKeyFile).not.toHaveBeenCalled();
  });

  it('stays off where the CMS can’t put a file at the root, or with no domain', async () => {
    state.blockedBy = 'webflow';
    let res = await call('POST');
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('no_root_files');
    state.blockedBy = null;
    state.domainHost = null;
    res = await call('POST');
    expect((await res.json()).code).toBe('no_domain');
    expect(written).toEqual([]);
  });

  it('is checked once its file is at its address, and says what it found otherwise', async () => {
    Object.assign(state, { key: KEY, host: 'www.acme.example' });
    checkKeyFile.mockResolvedValueOnce({ state: 'not_found', host: 'www.acme.example' });
    let res = await call('POST', '/check');
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('not_found');
    expect(written).toEqual([]);

    res = await call('POST', '/check');
    expect(res.status).toBe(200);
    expect(checkKeyFile).toHaveBeenLastCalledWith('www.acme.example', KEY);
    expect(written[0].fields.indexnow_verified_at).toEqual(expect.any(String));
    expect(written[0].fields.indexnow_host).toBe('www.acme.example');
  });

  it('keeps the host the file loaded from, so pages on www are announced', async () => {
    Object.assign(state, { key: KEY, host: 'acme.example' });
    checkKeyFile.mockResolvedValueOnce({ state: 'ok', host: 'www.acme.example' });
    const res = await call('POST', '/check');
    expect(res.status).toBe(200);
    expect(written[0].fields.indexnow_host).toBe('www.acme.example');
  });

  it('can’t be checked before it is on, and turns off with its key', async () => {
    let res = await call('POST', '/check');
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('off');
    res = await call('DELETE');
    expect(res.status).toBe(200);
    expect(written).toEqual([
      {
        table: 'brands',
        id: BRAND,
        fields: { indexnow_key: null, indexnow_host: null, indexnow_verified_at: null },
      },
    ]);
  });
});
