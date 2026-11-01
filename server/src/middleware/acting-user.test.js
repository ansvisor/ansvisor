import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Internal requests acting as a member (Chat's triggered runs): with
 * CHAT_INTERNAL_SECRET and X-Acting-User, on the allowed routes only, the
 * member is known as with a session and checked as one; without the secret
 * the header is ignored, and with it unset the way is closed.
 */

const SECRET = 'internal-secret-for-tests';
const ORG = '0a000000-0000-4000-8000-000000000001';
const OTHER_ORG = '0b000000-0000-4000-8000-000000000002';
const MANAGER = '1a000000-0000-4000-8000-000000000001';
const ANALYST = '1b000000-0000-4000-8000-000000000002';
const NARROWED = '1c000000-0000-4000-8000-000000000003';
const NO_ORG = '1d000000-0000-4000-8000-000000000004';
const BANNED = '1e000000-0000-4000-8000-000000000005';
const STRANGER = '1f000000-0000-4000-8000-000000000006';
const SESSION_USER = '2a000000-0000-4000-8000-000000000007';
const BRAND = '3a000000-0000-4000-8000-000000000001';
const SECOND_BRAND = '3b000000-0000-4000-8000-000000000002';
const OTHER_BRAND = '3c000000-0000-4000-8000-000000000003';
const OPP = '4a000000-0000-4000-8000-000000000001';
const SUGGESTION = '5a000000-0000-4000-8000-000000000001';

const db = vi.hoisted(() => ({ tables: {}, authUsers: {}, sessions: {} }));
const supabase = vi.hoisted(() => ({
  getUser: null,
  getUserById: null,
}));

vi.mock('../config/supabase.js', () => {
  const from = (table) => {
    const where = [];
    const rows = () =>
      (db.tables[table] ?? []).filter((row) =>
        where.every(([column, values]) => values.includes(row[column])),
      );
    const chain = {
      select: () => chain,
      eq: (column, value) => (where.push([column, [value]]), chain),
      in: (column, values) => (where.push([column, values]), chain),
      order: () => chain,
      range: () => chain,
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve, reject) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
    };
    return chain;
  };
  return {
    default: {
      from,
      auth: {
        getUser: (...args) => supabase.getUser(...args),
        admin: { getUserById: (...args) => supabase.getUserById(...args) },
      },
    },
  };
});

const logged = vi.hoisted(() => []);
const logger = vi.hoisted(() => {
  const make = (bindings) => {
    const at =
      (level) =>
      (...args) =>
        logged.push({ level, bindings, args });
    return {
      debug: at('debug'),
      info: at('info'),
      warn: at('warn'),
      error: at('error'),
      child: (more) => make({ ...bindings, ...more }),
    };
  };
  return make({});
});
vi.mock('../lib/logger.js', () => ({ logger, default: logger }));

const { default: Middleware } = await import('./index.js');
const { ACTING_USER_ROUTES } = await import('./acting-user.js');
const { DEMO_GUARDED, clearDemoBrandCache } = await import('./demo-brand.js');
const { apiLimiterKey } = await import('./rate-limiter.js');
const { clearVerifiedTokens, markTokenVerified } = await import('./verified-tokens.js');
const { requestScope } = await import('../lib/request-scope.js');
const { MANAGER_ROLES, assertRole } = await import('../lib/access.js');

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

function makeReq({
  method = 'POST',
  path = '/audits',
  body = { brandId: BRAND, url: 'https://ansvisor.com/' },
  authorization = `Bearer ${SECRET}`,
  actingFor = MANAGER,
} = {}) {
  const headers = {};
  if (authorization) headers.authorization = authorization;
  if (actingFor) headers['x-acting-user'] = actingFor;
  return { method, path, body, query: {}, headers, ip: '203.0.113.9', log: logger };
}

async function run(options) {
  const req = makeReq(options);
  const res = makeRes();
  const next = vi.fn();
  await Middleware.decodeToken(req, res, next);
  return { req, res, next };
}

function expectPassedAs({ req, res, next }, userId) {
  expect(res.status).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledOnce();
  expect(req.user?.id).toBe(userId);
}

function expectRefused({ req, res, next }, status, code) {
  expect(next).not.toHaveBeenCalled();
  expect(req.user).toBeUndefined();
  expect(res.status).toHaveBeenCalledWith(status);
  if (code) expect(res.json.mock.calls[0][0]).toMatchObject({ code });
}

beforeEach(() => {
  vi.stubEnv('CHAT_INTERNAL_SECRET', SECRET);
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  logged.length = 0;
  clearVerifiedTokens();
  clearDemoBrandCache();
  const authUser = (id, extra = {}) => ({ id, email: `${id.slice(0, 2)}@ansvisor.com`, ...extra });
  db.authUsers = {
    [MANAGER]: authUser(MANAGER),
    [ANALYST]: authUser(ANALYST),
    [NARROWED]: authUser(NARROWED),
    [NO_ORG]: authUser(NO_ORG),
    [BANNED]: authUser(BANNED, { banned_until: '2999-01-01T00:00:00Z' }),
    [SESSION_USER]: authUser(SESSION_USER),
  };
  db.sessions = { 'session-token': authUser(SESSION_USER) };
  db.tables = {
    profiles: [
      { id: MANAGER, organization_id: ORG, role: 'manager', brand_scope: 'all' },
      { id: ANALYST, organization_id: ORG, role: 'analyst', brand_scope: 'all' },
      { id: NARROWED, organization_id: ORG, role: 'manager', brand_scope: 'selected' },
      { id: NO_ORG, organization_id: null, role: 'manager', brand_scope: 'all' },
      { id: BANNED, organization_id: ORG, role: 'manager', brand_scope: 'all' },
      { id: SESSION_USER, organization_id: ORG, role: 'admin', brand_scope: 'all' },
    ],
    member_brands: [{ user_id: NARROWED, brand_id: SECOND_BRAND, organization_id: ORG }],
    brands: [
      { id: BRAND, organization_id: ORG, is_demo: false },
      { id: SECOND_BRAND, organization_id: ORG, is_demo: false },
      { id: OTHER_BRAND, organization_id: OTHER_ORG, is_demo: false },
    ],
    content_opportunities: [{ id: OPP, brand_id: BRAND }],
    prompt_suggestions: [{ id: SUGGESTION, brand_id: BRAND }],
  };
  supabase.getUserById = vi.fn(async (id) =>
    db.authUsers[id]
      ? { data: { user: db.authUsers[id] }, error: null }
      : { data: { user: null }, error: { status: 404, message: 'User not found' } },
  );
  supabase.getUser = vi.fn(async (token) =>
    db.sessions[token]
      ? { data: { user: db.sessions[token] }, error: null }
      : { data: { user: null }, error: { status: 401, message: 'invalid JWT' } },
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the internal secret with a member to act for', () => {
  it('sets req.user to the member on an allowed route, as with their session', async () => {
    const result = await run();
    expectPassedAs(result, MANAGER);
    expect(result.req.user).toEqual(db.authUsers[MANAGER]);
    expect(result.req.actingFor).toBe(MANAGER);
    // The secret is never a token for Supabase Auth.
    expect(supabase.getUser).not.toHaveBeenCalled();
  });

  it('takes every allowed route, finding the brand in the body or by the row in the path', async () => {
    const calls = [
      { method: 'PATCH', path: `/content/${OPP}/status`, body: { status: 'in_progress' } },
      { method: 'POST', path: `/prompts/suggestions/${SUGGESTION}/dismiss`, body: {} },
      { path: '/action-center/chat-actions/check', body: { brandId: BRAND } },
      { path: '/action-center/chat-actions', body: { brandId: BRAND } },
      { path: '/audits', body: { brandId: BRAND, url: 'https://ansvisor.com/' } },
      { path: '/audits/bulk', body: { brandId: BRAND, urls: ['https://ansvisor.com/'] } },
      { path: '/reports/summary', body: { brandId: BRAND, snapshot: {} } },
    ];
    expect(calls).toHaveLength(ACTING_USER_ROUTES.length);
    for (const call of calls) expectPassedAs(await run(call), MANAGER);

    // The brand the row names is the one checked: another workspace's is refused.
    db.tables.content_opportunities[0].brand_id = OTHER_BRAND;
    db.tables.prompt_suggestions[0].brand_id = OTHER_BRAND;
    expectRefused(await run(calls[0]), 403, 'not_in_workspace');
    expectRefused(await run(calls[1]), 403, 'not_in_workspace');
  });

  it('names its brand on every allowed route, as the demo brand check reads it', () => {
    const guarded = new Set(DEMO_GUARDED.map((entry) => entry.route));
    for (const route of ACTING_USER_ROUTES) expect(guarded.has(route), route).toBe(true);
  });

  it('refuses a brand of another workspace, or one the member was not given', async () => {
    expectRefused(
      await run({ body: { brandId: OTHER_BRAND, url: 'https://ansvisor.com/' } }),
      403,
      'not_in_workspace',
    );
    // Selected brands: only the granted one.
    expectRefused(await run({ actingFor: NARROWED }), 403, 'no_brand_access');
    expectPassedAs(
      await run({
        actingFor: NARROWED,
        body: { brandId: SECOND_BRAND, url: 'https://ansvisor.com/' },
      }),
      NARROWED,
    );
  });

  it('leaves a row it cannot find to the route, which answers 404 itself', async () => {
    const missing = '6a000000-0000-4000-8000-000000000009';
    expectPassedAs(
      await run({ method: 'PATCH', path: `/content/${missing}/status`, body: {} }),
      MANAGER,
    );
  });

  it('refuses without a member, with one that is not an id, or with one who does not exist', async () => {
    expectRefused(await run({ actingFor: null }), 401);
    expectRefused(await run({ actingFor: 'not-a-uuid' }), 401);
    expectRefused(await run({ actingFor: STRANGER }), 401);
    expectRefused(await run({ actingFor: BANNED }), 401);
    expect(supabase.getUser).not.toHaveBeenCalled();
  });

  it('refuses a member without a workspace, or whose workspace has Chat off', async () => {
    expectRefused(await run({ actingFor: NO_ORG }), 403, 'not_in_workspace');

    vi.stubEnv('CHAT_AGENTIC_ORGS', OTHER_ORG);
    expectRefused(await run(), 403, 'chat_off');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expectRefused(await run(), 403, 'chat_off');
  });

  it('refuses the secret on any other route (401) and never sends it to Supabase Auth', async () => {
    for (const call of [
      { method: 'POST', path: '/tracking/check', body: { brandId: BRAND } },
      { method: 'GET', path: '/prompts', body: {} },
      { method: 'POST', path: `/content/${OPP}/send-webhook`, body: {} },
      { method: 'DELETE', path: '/brands/' + BRAND, body: {} },
    ]) {
      expectRefused(await run(call), 401);
    }
    expect(supabase.getUser).not.toHaveBeenCalled();
    expect(supabase.getUserById).not.toHaveBeenCalled();
  });

  it('logs the member as actingFor, and never the secret', async () => {
    await run();
    await run({ path: '/tracking/check' });
    await run({ actingFor: NO_ORG });
    const acted = logged.find((entry) => entry.level === 'info');
    expect(acted.bindings.actingFor).toBe(MANAGER);
    expect(acted.args.at(-1)).toMatch(/acting for/);
    expect(logged.find((entry) => entry.bindings.actingFor === NO_ORG)).toBeTruthy();
    expect(JSON.stringify(logged)).not.toContain(SECRET);
  });
});

describe('without the internal secret', () => {
  it('ignores X-Acting-User with a session: the session is the person, on any route', async () => {
    for (const path of ['/audits', '/tracking/check']) {
      const result = await run({ path, authorization: 'Bearer session-token', actingFor: MANAGER });
      expectPassedAs(result, SESSION_USER);
      expect(result.req.actingFor).toBeUndefined();
    }
    expect(supabase.getUserById).not.toHaveBeenCalled();
  });

  it('refuses a wrong secret as any token that is not a session', async () => {
    expectRefused(await run({ authorization: 'Bearer not-the-secret' }), 401);
    expectRefused(await run({ authorization: `Bearer ${SECRET}x` }), 401);
    expectRefused(await run({ authorization: null }), 401);
    expect(supabase.getUserById).not.toHaveBeenCalled();
  });

  it('is closed with CHAT_INTERNAL_SECRET unset', async () => {
    vi.stubEnv('CHAT_INTERNAL_SECRET', '');
    expectRefused(await run(), 401);
    expectRefused(await run({ authorization: 'Bearer ' }), 401);
    expect(supabase.getUserById).not.toHaveBeenCalled();
  });
});

describe('rate limits', () => {
  it("counts an acting request in the member's own bucket once the member is checked", async () => {
    const first = makeReq();
    // Before any check: the caller's address, as a session token's first request.
    expect(apiLimiterKey(first)).toBe('ip:203.0.113.9');
    await run();
    expect(apiLimiterKey(makeReq())).toBe(`user:${MANAGER}`);
    // The same bucket as the member's own session.
    markTokenVerified('Bearer manager-session', MANAGER);
    expect(
      apiLimiterKey(makeReq({ authorization: 'Bearer manager-session', actingFor: null })),
    ).toBe(`user:${MANAGER}`);
  });

  it('gives the secret alone, a refused member, or a session naming someone else no bucket of theirs', async () => {
    await run({ actingFor: NO_ORG });
    expect(apiLimiterKey(makeReq({ actingFor: NO_ORG }))).toBe('ip:203.0.113.9');
    expect(apiLimiterKey(makeReq({ actingFor: null }))).toBe('ip:203.0.113.9');

    await run();
    markTokenVerified('Bearer session-token', SESSION_USER);
    expect(
      apiLimiterKey(makeReq({ authorization: 'Bearer session-token', actingFor: MANAGER })),
    ).toBe(`user:${SESSION_USER}`);
  });
});

/**
 * Mounted as server.js mounts decodeToken: the route's own role check runs
 * for the member acting, as for their session.
 */
describe('mounted like the server', () => {
  let server;
  let baseUrl;

  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    const routes = express.Router();
    routes.post('/action-center/chat-actions', async (req, res) => {
      try {
        await assertRole(req.user.id, MANAGER_ROLES, 'Only admins and managers.');
        return res.json({ by: req.user.id });
      } catch (err) {
        return res.status(err.status || 500).json({ code: err.code });
      }
    });
    app.use('/api', requestScope, Middleware.decodeToken.bind(Middleware), routes);
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(() => new Promise((resolve) => server.close(resolve)));

  const post = (actingFor) =>
    fetch(`${baseUrl}/api/action-center/chat-actions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SECRET}`,
        'X-Acting-User': actingFor,
      },
      body: JSON.stringify({ brandId: BRAND }),
    });

  it("passes a manager and refuses an analyst with the route's own role check", async () => {
    const manager = await post(MANAGER);
    expect(manager.status).toBe(200);
    expect(await manager.json()).toEqual({ by: MANAGER });

    const analyst = await post(ANALYST);
    expect(analyst.status).toBe(403);
    expect(await analyst.json()).toEqual({ code: 'forbidden' });
  });
});
