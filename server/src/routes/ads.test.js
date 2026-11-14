import { readFileSync } from 'node:fs';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /api/ads (ADS-01, in development): every path not found while the server's
 * ADS_ENABLED is off; on, the status for a signed-in person who can reach the
 * brand. Mounted as server.js mounts /api: the session check first.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const SESSION = 'session-token';
const logError = vi.fn();
const assertBrandAccess = vi.fn();
const brandAccessOf = vi.fn();
const readAdsActivity = vi.fn();

vi.mock('../config/supabase.js', () => ({
  default: {
    auth: {
      getUser: async (token) =>
        token === SESSION
          ? { data: { user: { id: 'u1' } }, error: null }
          : { data: { user: null }, error: { message: 'invalid JWT' } },
    },
  },
}));
vi.mock('../lib/access.js', async (importOriginal) => ({
  ...(await importOriginal()),
  assertBrandAccess: (...args) => assertBrandAccess(...args),
  brandAccessOf: (...args) => brandAccessOf(...args),
}));
vi.mock('../lib/ads/activity.js', () => ({
  readAdsActivity: (...args) => readAdsActivity(...args),
}));

const { default: Middleware } = await import('../middleware/index.js');
const { default: router } = await import('./ads.js');

let server;
let baseUrl;
beforeEach(async () => {
  vi.stubEnv('ADS_ENABLED', 'true');
  logError.mockReset();
  assertBrandAccess.mockReset().mockResolvedValue({ brand: { id: BRAND }, orgId: 'o1' });
  brandAccessOf.mockReset().mockResolvedValue({ orgId: 'o1', role: 'admin' });
  readAdsActivity.mockReset().mockResolvedValue({ entries: [], next: null });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error: logError, warn: vi.fn() };
    next();
  });
  app.use('/api/ads', Middleware.decodeToken.bind(Middleware), router);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/ads`;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

const send = (path, { method = 'GET', token = SESSION, body } = {}) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

const PATHS = [
  ['GET', `/status?brandId=${BRAND}`],
  ['GET', '/status'],
  ['GET', ''],
  ['GET', '/'],
  ['GET', '/opportunities'],
  ['GET', `/opportunities/${BRAND}`],
  ['GET', '/activity'],
  ['GET', `/activity?brandId=${BRAND}`],
  ['POST', '/opportunities/x/earn'],
  ['PATCH', '/settings'],
  ['DELETE', '/anything/at/all'],
];

describe('/api/ads while ADS_ENABLED is off', () => {
  for (const value of [undefined, '', 'false', '1', 'TRUE', ' true']) {
    it(`answers 404 off on every path and method (ADS_ENABLED=${JSON.stringify(value)})`, async () => {
      vi.stubEnv('ADS_ENABLED', value);
      for (const [method, path] of PATHS) {
        const res = await send(path, { method, body: method === 'GET' ? undefined : {} });
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(await res.json(), `${method} ${path}`).toEqual({
          error: 'Not available',
          code: 'off',
        });
      }
      expect(assertBrandAccess).not.toHaveBeenCalled();
      expect(readAdsActivity).not.toHaveBeenCalled();
    });
  }

  it('still asks for a session first, as every /api path does', async () => {
    vi.stubEnv('ADS_ENABLED', undefined);
    expect((await send('/status', { token: null })).status).toBe(401);
    expect((await send('/status', { token: 'forged' })).status).toBe(401);
  });

  it('reads the variable on each request, not when loaded', async () => {
    vi.stubEnv('ADS_ENABLED', 'false');
    expect((await send(`/status?brandId=${BRAND}`)).status).toBe(404);
    vi.stubEnv('ADS_ENABLED', 'true');
    expect((await send(`/status?brandId=${BRAND}`)).status).toBe(200);
  });
});

describe('GET /api/ads/status while ADS_ENABLED is on', () => {
  it('says Ads is on, for a person who can reach the brand', async () => {
    const res = await send(`/status?brandId=${BRAND}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
  });

  it('gives nothing without a session', async () => {
    for (const token of [null, 'forged']) {
      const res = await send(`/status?brandId=${BRAND}`, { token });
      expect(res.status).toBe(401);
      expect(JSON.stringify(await res.json())).not.toMatch(/enabled/);
    }
    expect(assertBrandAccess).not.toHaveBeenCalled();
  });

  it('refuses a brand of another workspace, or one the person was not given', async () => {
    assertBrandAccess.mockRejectedValue(
      Object.assign(new Error("This brand isn't in your workspace"), { status: 403 }),
    );
    let res = await send(`/status?brandId=${BRAND}`);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden');

    assertBrandAccess.mockRejectedValue(
      Object.assign(new Error('Brand not found'), { status: 404 }),
    );
    res = await send(`/status?brandId=${BRAND}`);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('not_found');
  });

  it('refuses a missing or malformed brand id before reading anything', async () => {
    for (const path of ['/status', '/status?brandId=nope', `/status?brandId=${BRAND}x`]) {
      const res = await send(path);
      expect(res.status, path).toBe(400);
      expect((await res.json()).code).toBe('invalid');
    }
    expect(assertBrandAccess).not.toHaveBeenCalled();
  });

  it('answers a failed read as a failure, without its message', async () => {
    assertBrandAccess.mockRejectedValue(new Error('connection reset by peer'));
    const res = await send(`/status?brandId=${BRAND}`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to read Ads', code: 'failed' });
    expect(logError).toHaveBeenCalledOnce();
  });
});

describe('GET /api/ads/activity while ADS_ENABLED is on', () => {
  it("gives an Admin the workspace's log, of one brand or all", async () => {
    readAdsActivity.mockResolvedValue({ entries: [{ id: 'a1' }], next: null });
    let res = await send('/activity?limit=20&before=2026-11-13T10:00:00Z');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [{ id: 'a1' }], next: null });
    expect(brandAccessOf).toHaveBeenCalledWith('u1');
    expect(readAdsActivity).toHaveBeenLastCalledWith({
      orgId: 'o1',
      brandId: undefined,
      before: '2026-11-13T10:00:00Z',
      limit: 20,
    });

    assertBrandAccess.mockResolvedValue({ brand: { id: BRAND }, orgId: 'o1', role: 'admin' });
    res = await send(`/activity?brandId=${BRAND}`);
    expect(res.status).toBe(200);
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(readAdsActivity).toHaveBeenLastCalledWith({
      orgId: 'o1',
      brandId: BRAND,
      before: undefined,
      limit: 50,
    });
  });

  it('refuses everyone but an Admin, and a person with no workspace', async () => {
    for (const access of [
      { orgId: 'o1', role: 'manager' },
      { orgId: 'o1', role: 'analyst' },
      { orgId: 'o1', role: 'agency_partner' },
      { orgId: null, role: 'admin' },
    ]) {
      brandAccessOf.mockResolvedValue(access);
      const res = await send('/activity');
      expect(res.status, JSON.stringify(access)).toBe(403);
      expect((await res.json()).code).toBe('forbidden');
    }
    assertBrandAccess.mockResolvedValue({ brand: { id: BRAND }, orgId: 'o1', role: 'analyst' });
    expect((await send(`/activity?brandId=${BRAND}`)).status).toBe(403);
    expect(readAdsActivity).not.toHaveBeenCalled();
  });

  it("refuses another workspace's brand, and a malformed query", async () => {
    assertBrandAccess.mockRejectedValue(
      Object.assign(new Error("This brand isn't in your workspace"), { status: 403 }),
    );
    expect((await send(`/activity?brandId=${BRAND}`)).status).toBe(403);
    for (const query of ['brandId=nope', 'limit=0', 'limit=101', 'before=yesterday']) {
      expect((await send(`/activity?${query}`)).status, query).toBe(400);
    }
    expect(readAdsActivity).not.toHaveBeenCalled();
  });
});

describe('mounting', () => {
  it('is mounted under /api/ads, behind the session check', () => {
    const index = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
    expect(index).toMatch(/import adsRoutes from '\.\/ads\.js';/);
    expect(index).toMatch(/router\.use\('\/ads', adsRoutes\);/);
  });
});
