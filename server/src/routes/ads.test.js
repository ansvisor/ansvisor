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
const notifyMe = vi.fn();
const ads = {
  readOpportunities: vi.fn(),
  setDecision: vi.fn(),
  isDemoPrompt: vi.fn(),
  readsEveryOpportunity: vi.fn(),
  readAdsSettings: vi.fn(),
  saveAdsSettings: vi.fn(),
};
const PROMPT = '44444444-4444-4444-4444-444444444444';
let role;
/** The workspace, for the real plan check (readsEveryOpportunity). */
let org;

vi.mock('../config/supabase.js', () => ({
  default: {
    auth: {
      getUser: async (token) =>
        token === SESSION
          ? { data: { user: { id: 'u1' } }, error: null }
          : { data: { user: null }, error: { message: 'invalid JWT' } },
    },
    // The caller's profile, for the real assertRole; the workspace, for the real plan check.
    from: (table) => {
      const data = () => (table === 'organizations' ? org : { role });
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: data() }) };
      return q;
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
  logNotifyMe: (...args) => notifyMe(...args),
}));
const readOverview = vi.fn();
vi.mock('../lib/ads/overview.js', () => ({ readOverview: (...a) => readOverview(...a) }));
const sendEarn = vi.fn();
vi.mock('../lib/ads/earn.js', () => ({ sendEarn: (...a) => sendEarn(...a) }));
const createAdDrafts = vi.fn();
vi.mock('../lib/ads/drafts.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createAdDrafts: (...a) => createAdDrafts(...a),
}));
const exporter = { exportEditor: vi.fn(), exportOpportunity: vi.fn() };
vi.mock('../lib/ads/export.js', () => ({
  exportEditor: (...a) => exporter.exportEditor(...a),
  exportOpportunity: (...a) => exporter.exportOpportunity(...a),
}));
const readOpportunity = vi.fn();
vi.mock('../lib/ads/opportunity.js', () => ({
  readOpportunity: (...a) => readOpportunity(...a),
}));
vi.mock('../lib/ads/opportunities.js', async (importOriginal) => ({
  ...(await importOriginal()),
  ...Object.fromEntries(Object.keys(ads).map((name) => [name, (...a) => ads[name](...a)])),
}));

const { default: Middleware } = await import('../middleware/index.js');
const { default: router } = await import('./ads.js');
const actual = await vi.importActual('../lib/ads/opportunities.js');
const { AdDraftsError } = await import('../lib/ads/drafts.js');
const { PlanLimitError } = await import('../lib/plan-guard.js');

let server;
let baseUrl;
beforeEach(async () => {
  vi.stubEnv('ADS_ENABLED', 'true');
  logError.mockReset();
  assertBrandAccess.mockReset().mockResolvedValue({ brand: { id: BRAND }, orgId: 'o1' });
  brandAccessOf.mockReset().mockResolvedValue({ orgId: 'o1', role: 'admin' });
  readAdsActivity.mockReset().mockResolvedValue({ entries: [], next: null });
  readOpportunity.mockReset();
  sendEarn.mockReset();
  createAdDrafts.mockReset();
  notifyMe.mockReset();
  for (const fn of [...Object.values(ads), ...Object.values(exporter)]) fn.mockReset();
  ads.readsEveryOpportunity.mockResolvedValue(true);
  ads.isDemoPrompt.mockResolvedValue(false);
  role = 'manager';
  org = { id: 'o1', plan: 'growth', subscription_status: 'active' };
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
  ['GET', `/opportunities?brandId=${BRAND}`],
  ['GET', `/overview?brandId=${BRAND}`],
  ['PATCH', `/opportunities/${PROMPT}/decision`],
  ['GET', '/settings'],
  ['GET', `/activity?brandId=${BRAND}`],
  ['POST', '/opportunities/x/earn'],
  ['POST', `/opportunities/${PROMPT}/drafts`],
  ['PATCH', '/settings'],
  ['GET', `/export/editor?brandId=${BRAND}`],
  ['GET', `/export/opportunity/${PROMPT}?brandId=${BRAND}`],
  ['POST', '/connections/notify'],
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
      expect(readOpportunity).not.toHaveBeenCalled();
      expect(createAdDrafts).not.toHaveBeenCalled();
      expect(notifyMe).not.toHaveBeenCalled();
      for (const fn of [...Object.values(ads), ...Object.values(exporter)]) {
        expect(fn).not.toHaveBeenCalled();
      }
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

describe('opportunities, decisions and settings while ADS_ENABLED is on', () => {
  const decide = (body, prompt = PROMPT) =>
    send(`/opportunities/${prompt}/decision`, { method: 'PATCH', body });

  it('reads the opportunities of a brand the person can reach, over the period', async () => {
    ads.readOpportunities.mockResolvedValue({ rows: [], locked: 0 });
    expect((await send(`/opportunities?brandId=${BRAND}`)).status).toBe(200);
    expect(ads.readOpportunities).toHaveBeenLastCalledWith({
      brand: { id: BRAND },
      orgId: 'o1',
      period: '30d',
      compareWeeks: true,
    });
    expect((await send(`/opportunities?brandId=${BRAND}&period=7d`)).status).toBe(200);
    expect(ads.readOpportunities.mock.lastCall[0].period).toBe('7d');
    expect((await send(`/opportunities?brandId=${BRAND}&period=1y`)).status).toBe(400);
    assertBrandAccess.mockRejectedValue(
      Object.assign(new Error("This brand isn't in your workspace"), { status: 403 }),
    );
    expect((await send(`/opportunities?brandId=${BRAND}`)).status).toBe(403);
    expect(ads.readOpportunities).toHaveBeenCalledTimes(2);
  });

  it("reads one prompt's drawer within the brand; another's is not found, a locked one the plan's", async () => {
    const path = (q = `brandId=${BRAND}`) => `/opportunities/${PROMPT}?${q}`;
    readOpportunity.mockResolvedValue({ promptId: PROMPT, answers: [] });
    let res = await send(path(`brandId=${BRAND}&period=7d`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ promptId: PROMPT, answers: [] });
    expect(readOpportunity).toHaveBeenLastCalledWith({
      brand: { id: BRAND },
      orgId: 'o1',
      promptId: PROMPT,
      period: '7d',
    });
    expect(assertBrandAccess).toHaveBeenLastCalledWith(BRAND, 'u1');

    readOpportunity.mockRejectedValue(
      Object.assign(new Error('Prompt not found'), { status: 404 }),
    );
    res = await send(path());
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('not_found');

    readOpportunity.mockResolvedValue(null);
    res = await send(path());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'plan_limit',
      code: 'plan_limit',
      feature: 'ads_read',
    });

    for (const bad of [
      path('brandId=nope'),
      path(`brandId=${BRAND}&period=1y`),
      '/opportunities/x?brandId=' + BRAND,
    ]) {
      expect((await send(bad)).status, bad).toBe(400);
    }
    assertBrandAccess.mockRejectedValue(
      Object.assign(new Error("This brand isn't in your workspace"), { status: 403 }),
    );
    expect((await send(path())).status).toBe(403);
    expect(readOpportunity).toHaveBeenCalledTimes(3);
  });

  it('reads the Overview of a brand the person can reach, over the period, on every plan', async () => {
    readOverview.mockReset().mockResolvedValue({ total: 0, locked: 0 });
    ads.readsEveryOpportunity.mockResolvedValue(false);
    const res = await send(`/overview?brandId=${BRAND}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 0, locked: 0 });
    expect(readOverview).toHaveBeenLastCalledWith({
      brand: { id: BRAND },
      orgId: 'o1',
      period: '30d',
    });
    expect((await send(`/overview?brandId=${BRAND}&period=90d`)).status).toBe(200);
    expect(readOverview.mock.lastCall[0].period).toBe('90d');
    expect((await send(`/overview?brandId=${BRAND}&period=1y`)).status).toBe(400);
    expect((await send('/overview?brandId=nope')).status).toBe(400);
    assertBrandAccess.mockRejectedValue(
      Object.assign(new Error("This brand isn't in your workspace"), { status: 403 }),
    );
    expect((await send(`/overview?brandId=${BRAND}`)).status).toBe(403);
    expect(readOverview).toHaveBeenCalledTimes(2);
  });

  it('lets admins and managers set a decision, and no one else', async () => {
    for (role of ['analyst', 'agency_partner']) {
      const res = await decide({ brandId: BRAND, decision: 'pay' });
      expect(res.status, role).toBe(403);
      expect((await res.json()).code).toBe('forbidden');
    }
    expect(ads.setDecision).not.toHaveBeenCalled();
    ads.setDecision.mockResolvedValue({ decision: 'pay', setBy: 'u1', setAt: 'T' });
    for (role of ['manager', 'admin']) {
      const res = await decide({ brandId: BRAND, decision: 'pay' });
      expect(res.status, role).toBe(200);
      expect(await res.json()).toEqual({
        promptId: PROMPT,
        override: {
          decision: 'pay',
          setBy: 'u1',
          setAt: 'T',
        },
      });
    }
    expect(ads.setDecision).toHaveBeenLastCalledWith({
      orgId: 'o1',
      brandId: BRAND,
      promptId: PROMPT,
      decision: 'pay',
      userId: 'u1',
    });
    await decide({ brandId: BRAND, decision: null });
    expect(ads.setDecision.mock.lastCall[0].decision).toBeNull();
  });

  it("refuses a decision past the plan's rows, on a prompt not found, or malformed", async () => {
    ads.readsEveryOpportunity.mockResolvedValue(false);
    let res = await decide({ brandId: BRAND, decision: 'earn' });
    expect([res.status, (await res.json()).code]).toEqual([403, 'plan_limit']);
    ads.readsEveryOpportunity.mockResolvedValue(true);
    ads.setDecision.mockRejectedValue(
      Object.assign(new Error('Prompt not found'), { status: 404 }),
    );
    res = await decide({ brandId: BRAND, decision: 'earn' });
    expect([res.status, (await res.json()).code]).toEqual([404, 'not_found']);
    for (const [body, prompt] of [
      [{ brandId: BRAND, decision: 'overlap' }, PROMPT],
      [{ brandId: BRAND }, PROMPT],
      [{ decision: 'pay' }, PROMPT],
      [{ brandId: BRAND, decision: 'pay' }, 'nope'],
    ]) {
      expect((await decide(body, prompt)).status, JSON.stringify(body)).toBe(400);
    }
    assertBrandAccess.mockRejectedValue(
      Object.assign(new Error('Brand not found'), { status: 404 }),
    );
    expect((await decide({ brandId: BRAND, decision: 'pay' })).status).toBe(404);
    expect(ads.setDecision).toHaveBeenCalledOnce();
  });

  it('refuses the demo brand, named or by its prompt, on any plan and role (402 demo_brand)', async () => {
    const refused = async (what) => {
      const res = await decide({ brandId: BRAND, decision: 'pay' });
      expect(res.status, what).toBe(402);
      expect(await res.json(), what).toMatchObject({ error: 'plan_limit', code: 'demo_brand' });
    };
    // readsEveryOpportunity reads a demo brand as Growth, so it must not be what stops it.
    for (role of ['admin', 'manager', 'analyst']) {
      assertBrandAccess.mockResolvedValue({ brand: { id: BRAND, is_demo: true }, orgId: 'o1' });
      await refused(`demo brand, ${role}`);
      // A real brand named, with the demo's prompt.
      assertBrandAccess.mockResolvedValue({ brand: { id: BRAND, is_demo: false }, orgId: 'o1' });
      ads.isDemoPrompt.mockResolvedValue(true);
      await refused(`demo prompt, ${role}`);
      ads.isDemoPrompt.mockResolvedValue(false);
    }
    expect(ads.isDemoPrompt).toHaveBeenLastCalledWith('o1', PROMPT);
    expect(ads.readsEveryOpportunity).not.toHaveBeenCalled();
    expect(ads.setDecision).not.toHaveBeenCalled();

    // A real brand and its own prompt go on as before.
    role = 'manager';
    ads.setDecision.mockResolvedValue(null);
    expect((await decide({ brandId: BRAND, decision: null })).status).toBe(200);
    expect(ads.setDecision).toHaveBeenCalledOnce();
  });

  it('keeps the thresholds to Admins, and checks what they are set to', async () => {
    brandAccessOf.mockResolvedValue({ orgId: 'o1', role: 'manager' });
    expect((await send('/settings')).status).toBe(403);
    const change = { thresholds: { minPaidVolume: 2000, leadPosition: null } };
    expect((await send('/settings', { method: 'PATCH', body: change })).status).toBe(403);
    expect(ads.readAdsSettings).not.toHaveBeenCalled();
    expect(ads.saveAdsSettings).not.toHaveBeenCalled();

    brandAccessOf.mockResolvedValue({ orgId: 'o1', role: 'admin' });
    const saved = { thresholds: { minPaidVolume: 2000 }, updatedBy: 'u1', updatedAt: 'T' };
    ads.readAdsSettings.mockResolvedValue(saved);
    ads.saveAdsSettings.mockResolvedValue(saved);
    const res = await send('/settings');
    expect(await res.json()).toEqual({
      saved: { minPaidVolume: 2000 },
      thresholds: { minIntentWeight: 0.85, leadPosition: 1, minPaidVolume: 2000 },
      defaults: { minIntentWeight: 0.85, leadPosition: 1, minPaidVolume: 1000 },
      updatedBy: 'u1',
      updatedAt: 'T',
    });
    expect((await send('/settings', { method: 'PATCH', body: change })).status).toBe(200);
    expect(ads.readsEveryOpportunity).toHaveBeenCalledWith('o1');
    expect(ads.saveAdsSettings).toHaveBeenCalledWith('o1', 'u1', change.thresholds);
    for (const body of [
      {},
      { thresholds: {} },
      { thresholds: { minPaidVolume: -1 } },
      { thresholds: { minIntentWeight: 2 } },
      { thresholds: { leadPosition: '1' } },
      { thresholds: { budget: 5 } },
    ]) {
      expect(
        (await send('/settings', { method: 'PATCH', body })).status,
        JSON.stringify(body),
      ).toBe(400);
    }
    expect(ads.saveAdsSettings).toHaveBeenCalledOnce();
  });

  it('lets Starter and the trial read the thresholds, and change them on Growth only', async () => {
    vi.stubEnv('IS_CLOUD', 'true');
    ads.readsEveryOpportunity.mockImplementation(actual.readsEveryOpportunity);
    const saved = { thresholds: {}, updatedBy: null, updatedAt: null };
    ads.readAdsSettings.mockResolvedValue(saved);
    ads.saveAdsSettings.mockResolvedValue(saved);
    const change = { method: 'PATCH', body: { thresholds: { minPaidVolume: 2000 } } };
    for (const plan of [
      { plan: 'starter', subscription_status: 'active' },
      { plan: 'growth', subscription_status: 'trialing' },
      { plan: 'starter', subscription_status: 'canceled' },
    ]) {
      org = { id: 'o1', ...plan };
      expect((await send('/settings')).status, JSON.stringify(plan)).toBe(200);
      const res = await send('/settings', change);
      expect(res.status, JSON.stringify(plan)).toBe(403);
      expect(await res.json()).toEqual({
        error: 'plan_limit',
        code: 'plan_limit',
        feature: 'ads_read',
      });
    }
    expect(ads.saveAdsSettings).not.toHaveBeenCalled();
    for (const plan of [
      { plan: 'growth', subscription_status: 'active' },
      { plan: 'enterprise', subscription_status: 'trialing' },
    ]) {
      org = { id: 'o1', ...plan };
      expect((await send('/settings', change)).status, JSON.stringify(plan)).toBe(200);
    }
    expect(ads.saveAdsSettings).toHaveBeenCalledTimes(2);
  });
});

describe('POST /api/ads/opportunities/:promptId/earn while ADS_ENABLED is on', () => {
  const KEY = 'key-0001';
  const earn = (body = { brandId: BRAND, idempotencyKey: KEY }, prompt = PROMPT) =>
    send(`/opportunities/${prompt}/earn`, { method: 'POST', body });
  const sent = { promptId: PROMPT, action: { id: 'a1', no: 1300 }, created: true, covered: false };

  it('lets admins and managers send the fix (201), or answers the action covering it (200)', async () => {
    sendEarn.mockResolvedValue(sent);
    for (role of ['manager', 'admin']) {
      const res = await earn();
      expect(res.status, role).toBe(201);
      expect(await res.json()).toEqual(sent);
    }
    expect(sendEarn).toHaveBeenLastCalledWith({
      brand: { id: BRAND },
      orgId: 'o1',
      promptId: PROMPT,
      userId: 'u1',
      idempotencyKey: KEY,
    });
    sendEarn.mockResolvedValue({ ...sent, created: false, covered: true });
    const res = await earn();
    expect([res.status, (await res.json()).covered]).toEqual([200, true]);
  });

  it('refuses analysts (403), the demo brand or its prompt (402), and Starter or the trial (403)', async () => {
    for (role of ['analyst', 'agency_partner']) {
      const res = await earn();
      expect([res.status, (await res.json()).code], role).toEqual([403, 'forbidden']);
    }
    role = 'admin';
    assertBrandAccess.mockResolvedValueOnce({ brand: { id: BRAND, is_demo: true }, orgId: 'o1' });
    for (const what of ['demo brand', 'demo prompt']) {
      const res = await earn();
      expect(res.status, what).toBe(402);
      expect(await res.json(), what).toMatchObject({ code: 'demo_brand' });
      ads.isDemoPrompt.mockResolvedValue(true);
    }
    ads.isDemoPrompt.mockResolvedValue(false);
    // A locked prompt or an open one: writes are Growth's, as a decision.
    ads.readsEveryOpportunity.mockResolvedValue(false);
    const res = await earn();
    expect([res.status, (await res.json()).code]).toEqual([403, 'plan_limit']);
    expect(sendEarn).not.toHaveBeenCalled();
  });

  it("answers another brand's or workspace's prompt as not found, a cancelled send as a conflict", async () => {
    sendEarn.mockRejectedValueOnce(Object.assign(new Error('Prompt not found'), { status: 404 }));
    let res = await earn();
    expect([res.status, (await res.json()).code]).toEqual([404, 'not_found']);
    sendEarn.mockRejectedValueOnce(
      Object.assign(new Error('The action this approval made was cancelled.'), { status: 409 }),
    );
    res = await earn();
    expect([res.status, (await res.json()).code]).toEqual([409, 'conflict']);
    assertBrandAccess.mockRejectedValue(
      Object.assign(new Error('Brand not found'), { status: 404 }),
    );
    expect((await earn()).status).toBe(404);
    for (const [body, prompt] of [
      [{ brandId: BRAND }, PROMPT],
      [{ brandId: BRAND, idempotencyKey: 'short' }, PROMPT],
      [{ idempotencyKey: KEY }, PROMPT],
      [{ brandId: BRAND, idempotencyKey: KEY }, 'nope'],
    ]) {
      expect((await earn(body, prompt)).status, JSON.stringify(body)).toBe(400);
    }
    expect(sendEarn).toHaveBeenCalledTimes(2);
  });
});

describe('POST /api/ads/opportunities/:promptId/drafts while ADS_ENABLED is on', () => {
  const KEY = 'key-0001';
  const draft = (body = { brandId: BRAND, idempotencyKey: KEY }, prompt = PROMPT) =>
    send(`/opportunities/${prompt}/drafts`, { method: 'POST', body });
  const READ = { promptId: PROMPT, text: 'best crm', answers: [], fanOuts: [], keywords: [] };
  const made = {
    promptId: PROMPT,
    created: true,
    drafts: [{ id: 'd1', channel: 'chatgpt' }],
    rejected: [{ channel: 'google', failures: [{ code: 'competitor_named' }] }],
    gate: { limits: 'unconfirmed', competitors: 'blocked' },
  };
  beforeEach(() => readOpportunity.mockResolvedValue(READ));

  it('lets admins and managers write them (201) from the drawer’s read, the same key again 200', async () => {
    createAdDrafts.mockResolvedValue(made);
    for (role of ['manager', 'admin']) {
      const res = await draft();
      expect(res.status, role).toBe(201);
      expect(await res.json()).toEqual(made);
    }
    expect(assertBrandAccess).toHaveBeenLastCalledWith(BRAND, 'u1', { columns: 'name' });
    expect(readOpportunity).toHaveBeenLastCalledWith({
      brand: { id: BRAND },
      orgId: 'o1',
      promptId: PROMPT,
      period: '30d',
    });
    expect(createAdDrafts).toHaveBeenLastCalledWith({
      brand: { id: BRAND },
      orgId: 'o1',
      opportunity: READ,
      userId: 'u1',
      idempotencyKey: KEY,
      source: 'drawer',
    });
    createAdDrafts.mockResolvedValue({ ...made, created: false });
    expect((await draft()).status).toBe(200);
    await draft({ brandId: BRAND });
    expect(createAdDrafts.mock.calls.at(-1)[0].idempotencyKey).toBeNull();
  });

  it('refuses analysts (403), the demo brand or its prompt (402 demo_brand), and Starter or the trial (403 plan_limit)', async () => {
    for (role of ['analyst', 'agency_partner']) {
      const res = await draft();
      expect([res.status, (await res.json()).code], role).toEqual([403, 'forbidden']);
    }
    role = 'admin';
    assertBrandAccess.mockResolvedValueOnce({ brand: { id: BRAND, is_demo: true }, orgId: 'o1' });
    for (const what of ['demo brand', 'demo prompt']) {
      const res = await draft();
      expect(res.status, what).toBe(402);
      expect(await res.json(), what).toMatchObject({ code: 'demo_brand' });
      ads.isDemoPrompt.mockResolvedValue(true);
    }
    ads.isDemoPrompt.mockResolvedValue(false);
    // The plan's own check, as the decision's and the Earn card's.
    vi.stubEnv('IS_CLOUD', 'true');
    ads.readsEveryOpportunity.mockImplementation(actual.readsEveryOpportunity);
    for (const plan of [
      { plan: 'starter', subscription_status: 'active' },
      { plan: 'growth', subscription_status: 'trialing' },
    ]) {
      org = { id: 'o1', ...plan };
      const res = await draft();
      expect([res.status, (await res.json()).code], plan.plan).toEqual([403, 'plan_limit']);
    }
    expect(readOpportunity).not.toHaveBeenCalled();
    expect(createAdDrafts).not.toHaveBeenCalled();
  });

  it("answers another brand's prompt as not found, and each refusal of the drafts as its own", async () => {
    readOpportunity.mockRejectedValueOnce(
      Object.assign(new Error('Prompt not found'), { status: 404 }),
    );
    let res = await draft();
    expect([res.status, (await res.json()).code]).toEqual([404, 'not_found']);
    readOpportunity.mockResolvedValueOnce(null);
    res = await draft();
    expect([res.status, (await res.json()).code]).toEqual([403, 'plan_limit']);
    for (const [err, status, code] of [
      [
        new AdDraftsError('facts_needed', 'Approve your brand facts first.', 409, { why: 'none' }),
        409,
        'facts_needed',
      ],
      [
        new AdDraftsError('gate_failed', 'No draft passed.', 422, { rejected: [] }),
        422,
        'gate_failed',
      ],
      [new AdDraftsError('model_failed', 'Not written.', 502), 502, 'model_failed'],
      [new PlanLimitError('The budget is used up.', 429), 429, 'ai_budget'],
      [new PlanLimitError('No plan.', 402), 402, 'no_subscription'],
    ]) {
      createAdDrafts.mockRejectedValueOnce(err);
      res = await draft();
      expect([res.status, (await res.json()).code], code).toEqual([status, code]);
    }
    createAdDrafts.mockRejectedValueOnce(
      new AdDraftsError('facts_needed', 'Approve your brand facts first.', 409, { why: 'off' }),
    );
    expect(await (await draft()).json()).toEqual({
      error: 'Approve your brand facts first.',
      code: 'facts_needed',
      why: 'off',
    });
    for (const [body, prompt] of [
      [{ brandId: BRAND, idempotencyKey: 'short' }, PROMPT],
      [{ idempotencyKey: KEY }, PROMPT],
      [{ brandId: BRAND }, 'nope'],
    ]) {
      expect((await draft(body, prompt)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('gates copy given in Chat as it is (source chat), one draft a channel', async () => {
    createAdDrafts.mockResolvedValue(made);
    const copy = { channel: 'google', headlines: ['Pro'], descriptions: ['Plain.'] };
    const claims = [{ text: 'Pro', factId: PROMPT }];
    expect((await draft({ brandId: BRAND, drafts: [{ ...copy, claims }] })).status).toBe(201);
    expect(createAdDrafts.mock.calls.at(-1)[0]).toMatchObject({
      source: 'chat',
      given: [{ ...copy, contextHint: null, keywords: [], claims }],
    });
    for (const drafts of [
      [copy, copy],
      [{ ...copy, channel: 'chatgpt', headlines: ['Pro', 'Plain'] }],
      [{ ...copy, claims: [{ text: 'Pro', factId: 'F1' }] }],
      [],
    ]) {
      expect((await draft({ brandId: BRAND, drafts })).status, JSON.stringify(drafts)).toBe(400);
    }
  });
});

describe('GET /api/ads/export/* while ADS_ENABLED is on', () => {
  const FILE = { fileName: 'google-ads-editor-pay-2026-11-14.csv', csv: 'Campaign', rowCount: 0 };
  const editor = (query = `brandId=${BRAND}&decision=pay&period=7d`) =>
    send(`/export/editor?${query}`);
  const one = (prompt = PROMPT) => send(`/export/opportunity/${prompt}?brandId=${BRAND}`);
  beforeEach(() => {
    exporter.exportEditor.mockResolvedValue(FILE);
    exporter.exportOpportunity.mockResolvedValue(FILE);
  });

  it('gives admins and managers the file of the filter, or of one prompt, as JSON', async () => {
    for (role of ['manager', 'admin']) {
      const res = await editor();
      expect(res.status, role).toBe(200);
      expect(await res.json()).toEqual(FILE);
    }
    expect(assertBrandAccess).toHaveBeenLastCalledWith(BRAND, 'u1', { columns: 'name' });
    expect(exporter.exportEditor).toHaveBeenLastCalledWith({
      brand: { id: BRAND },
      orgId: 'o1',
      userId: 'u1',
      decision: 'pay',
      period: '7d',
    });
    await editor(`brandId=${BRAND}`);
    expect(exporter.exportEditor.mock.calls.at(-1)[0]).toMatchObject({
      decision: 'all',
      period: '30d',
    });
    expect((await one()).status).toBe(200);
    expect(exporter.exportOpportunity).toHaveBeenLastCalledWith({
      brand: { id: BRAND },
      orgId: 'o1',
      userId: 'u1',
      promptId: PROMPT,
      period: '30d',
    });
  });

  it('refuses analysts (403), the demo brand or its prompt (402), and Starter or the trial (403 plan_limit)', async () => {
    for (role of ['analyst', 'agency_partner']) {
      for (const res of [await editor(), await one()]) {
        expect([res.status, (await res.json()).code], role).toEqual([403, 'forbidden']);
      }
    }
    role = 'admin';
    assertBrandAccess.mockResolvedValueOnce({ brand: { id: BRAND, is_demo: true }, orgId: 'o1' });
    expect(await (await editor()).json()).toMatchObject({ code: 'demo_brand' });
    ads.isDemoPrompt.mockResolvedValue(true);
    const demo = await one();
    expect([demo.status, (await demo.json()).code]).toEqual([402, 'demo_brand']);
    ads.isDemoPrompt.mockResolvedValue(false);
    vi.stubEnv('IS_CLOUD', 'true');
    ads.readsEveryOpportunity.mockImplementation(actual.readsEveryOpportunity);
    for (const plan of [
      { plan: 'starter', subscription_status: 'active' },
      { plan: 'growth', subscription_status: 'trialing' },
    ]) {
      org = { id: 'o1', ...plan };
      for (const res of [await editor(), await one()]) {
        expect([res.status, (await res.json()).code], plan.plan).toEqual([403, 'plan_limit']);
      }
    }
    expect(exporter.exportEditor).not.toHaveBeenCalled();
    expect(exporter.exportOpportunity).not.toHaveBeenCalled();
  });

  it("answers another brand's prompt as not found, and a malformed query as invalid", async () => {
    exporter.exportOpportunity.mockRejectedValueOnce(
      Object.assign(new Error('Prompt not found'), { status: 404 }),
    );
    const res = await one();
    expect([res.status, (await res.json()).code]).toEqual([404, 'not_found']);
    for (const res of [
      await editor(`brandId=${BRAND}&decision=overlap`),
      await editor('decision=pay'),
      await one('nope'),
    ]) {
      expect(res.status).toBe(400);
    }
    exporter.exportEditor.mockRejectedValueOnce(new Error('ads activity write failed: x'));
    const failed = await editor();
    expect([failed.status, (await failed.json()).code]).toEqual([500, 'failed']);
  });
});

describe('POST /api/ads/connections/notify while ADS_ENABLED is on', () => {
  const notify = (body = { brandId: BRAND, platform: 'meta' }) =>
    send('/connections/notify', { method: 'POST', body });

  it('logs Notify me for any member, on any plan (201), and once: asked again, 200', async () => {
    org = { id: 'o1', plan: 'starter', subscription_status: 'trialing' };
    notifyMe.mockResolvedValue(true);
    for (role of ['analyst', 'agency_partner', 'manager', 'admin']) {
      const res = await notify();
      expect([res.status, await res.json()], role).toEqual([
        201,
        { platform: 'meta', logged: true },
      ]);
    }
    expect(notifyMe).toHaveBeenLastCalledWith({
      orgId: 'o1',
      brandId: BRAND,
      userId: 'u1',
      platform: 'meta',
    });
    notifyMe.mockResolvedValue(false);
    const again = await notify();
    expect([again.status, (await again.json()).logged]).toEqual([200, false]);
  });

  it('refuses the demo brand (402), and a brand of another workspace, before logging', async () => {
    assertBrandAccess.mockResolvedValueOnce({ brand: { id: BRAND, is_demo: true }, orgId: 'o1' });
    const demo = await notify();
    expect([demo.status, (await demo.json()).code]).toEqual([402, 'demo_brand']);
    assertBrandAccess.mockRejectedValueOnce(
      Object.assign(new Error('Brand not found'), { status: 404 }),
    );
    const other = await notify();
    expect([other.status, (await other.json()).code]).toEqual([404, 'not_found']);
    expect(notifyMe).not.toHaveBeenCalled();
  });

  it('refuses a platform that has no Notify me, or a malformed brand', async () => {
    for (const body of [
      { brandId: BRAND, platform: 'google' },
      { brandId: BRAND },
      { brandId: 'b1', platform: 'meta' },
    ]) {
      expect((await notify(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(assertBrandAccess).not.toHaveBeenCalled();
    expect(notifyMe).not.toHaveBeenCalled();
  });
});

describe('mounting', () => {
  it('is mounted under /api/ads, behind the session check', () => {
    const index = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
    expect(index).toMatch(/import adsRoutes from '\.\/ads\.js';/);
    expect(index).toMatch(/router\.use\('\/ads', adsRoutes\);/);
  });
});
