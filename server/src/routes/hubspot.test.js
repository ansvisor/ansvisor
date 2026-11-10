import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * HubSpot per brand (#2140), under /api/hubspot: anyone who can access the
 * brand reads it; an admin or manager connects it with the plan's
 * crm_integrations, after choosing what Ansvisor may write, uses another
 * brand's HubSpot account, changes the writes and disconnects (on any plan).
 * Nothing is set up in HubSpot without consent; no Composio id leaves.
 */

const BRAND = '22222222-2222-4222-8222-222222222222';
const OTHER = '44444444-4444-4444-8444-444444444444';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const NEW_ACCOUNT = '55555555-5555-4555-8555-555555555555';

const access = vi.fn();
const reach = vi.fn();
const plan = vi.hoisted(() => ({ allowed: true }));
const lib = {
  usableAccounts: vi.fn(),
  useAccountForBrand: vi.fn(),
  startBrandAccount: vi.fn(),
  activateBrandAccount: vi.fn(),
  removeBrandAccount: vi.fn(),
};
const conn = {
  hubspotConnection: vi.fn(),
  writeHubspotSettings: vi.fn(),
  labelSignIn: vi.fn(),
  markSignInRefused: vi.fn(),
};
const setup = { readPortal: vi.fn(), ensureProperties: vi.fn() };
const composio = {
  isHubspotConfigured: vi.fn(() => true),
  linkHubspot: vi.fn(async () => ({
    redirectUrl: 'https://hs.test/x',
    connectedAccountId: 'ca_n',
  })),
};

vi.mock('../config/supabase.js', () => ({
  default: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { full_name: 'Ayşe Demir' }, error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('../lib/access.js', () => ({
  MANAGER_ROLES: ['admin', 'manager'],
  assertBrandAccess: (...args) => access(...args),
}));
vi.mock('../lib/brand-integration-reach.js', () => ({
  assertSignInReach: (...args) => reach(...args),
  reachableBrandIds: async () => [BRAND, OTHER],
}));
vi.mock('../lib/brand-integrations.js', () =>
  Object.fromEntries(Object.entries(lib).map(([k, fn]) => [k, (...a) => fn(...a)])),
);
vi.mock('../lib/composio.js', () => ({
  connectedAccountStatus: vi.fn(),
  deleteConnection: vi.fn(),
  entityIdFor: (orgId) => `org_${orgId}`,
  isHubspotConfigured: (...a) => composio.isHubspotConfigured(...a),
  linkHubspot: (...a) => composio.linkHubspot(...a),
}));
const blogs = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../lib/cms/hubspot-blog.js', () => ({ listBlogs: (...a) => blogs.list(...a) }));
vi.mock('../lib/hubspot/connection.js', async (importOriginal) => ({
  ...(await importOriginal()),
  ...Object.fromEntries(Object.entries(conn).map(([k, fn]) => [k, (...a) => fn(...a)])),
}));
vi.mock('../lib/hubspot/setup.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readPortal: (...a) => setup.readPortal(...a),
  ensureProperties: (...a) => setup.ensureProperties(...a),
}));
vi.mock('../lib/hubspot/client.js', async (importOriginal) => ({
  ...(await importOriginal()),
  hubspotClient: (accountId) => ({ accountId }),
}));
const pipeline = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../lib/hubspot/pipeline-sync.js', () => ({
  runHubspotPipelineSync: (...a) => pipeline.run(...a),
}));
vi.mock('../lib/plan-guard.js', () => {
  class PlanLimitError extends Error {
    constructor(message, statusCode = 403) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    PlanLimitError,
    enforceFeature: async () => {
      if (!plan.allowed) throw new PlanLimitError('Your Starter plan does not include it.');
    },
    requireFeature: () => (_req, res, next) =>
      plan.allowed
        ? next()
        : res.status(403).json({ success: false, error: 'plan_limit', message: 'Upgrade.' }),
  };
});

const { HubspotError } = await import('../lib/hubspot/client.js');
const { AI_SOURCES_VERSION } = await import('../lib/ai-sources.js');
const { PROPERTIES_VERSION } = await import('../lib/hubspot/properties.js');

let server;
let baseUrl;

beforeAll(async () => {
  const { default: router } = await import('./hubspot.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/hubspot', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/hubspot/brands/${BRAND}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const brand = (over = {}) => ({ id: BRAND, organization_id: 'org-1', is_demo: false, ...over });
const READY = {
  version: PROPERTIES_VERSION,
  sourcesVersion: AI_SOURCES_VERSION,
  at: '2026-11-10T09:00:00.000Z',
  error: null,
};
const connected = (settings = {}) => ({
  brandId: BRAND,
  provider: 'hubspot',
  accountId: ACCOUNT,
  organizationId: 'org-1',
  entityId: 'org_org-1',
  composioAccountId: 'ca_secret',
  label: 'Hub ID 4412893',
  status: 'connected',
  connected: true,
  settings: {
    consent: { contacts: true, pages: false, by: 'u1', at: '2026-11-09T10:00:00.000Z' },
    portal: { id: 4412893, currency: 'USD', timeZone: 'Europe/Istanbul', uiDomain: 'app.x' },
    properties: READY,
    ...settings,
  },
});
const CONSENT = { contacts: true, pages: false };

beforeEach(() => {
  for (const fn of [...Object.values(lib), ...Object.values(conn), ...Object.values(setup)]) {
    fn.mockReset();
  }
  plan.allowed = true;
  composio.isHubspotConfigured.mockReset().mockReturnValue(true);
  composio.linkHubspot.mockClear();
  reach.mockReset().mockResolvedValue({ orgId: 'org-1' });
  access.mockReset().mockResolvedValue({ brand: brand(), role: 'manager' });
  conn.hubspotConnection.mockResolvedValue(connected());
  lib.usableAccounts.mockResolvedValue([
    { accountId: ACCOUNT, label: 'Hub ID 4412893', brandIds: [BRAND, OTHER] },
    { accountId: NEW_ACCOUNT, label: 'Hub ID 7', brandIds: [OTHER] },
  ]);
  lib.startBrandAccount.mockResolvedValue({ redirectUrl: 'https://hs.test/x', accountId: ACCOUNT });
  setup.readPortal.mockResolvedValue({
    id: 4412893,
    currency: 'USD',
    timeZone: 'Europe/Istanbul',
    uiDomain: 'app-eu1.hubspot.com',
  });
  setup.ensureProperties.mockResolvedValue({ group: true, created: [], updated: [] });
});

const send = (method, path, body) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

/** The settings the last write stored. */
const stored = () => conn.writeHubspotSettings.mock.calls.at(-1)?.[1];

describe('GET /api/hubspot/brands/:brandId', () => {
  it('reads the brand’s HubSpot for any member, with no Composio id', async () => {
    access.mockResolvedValue({ brand: brand(), role: 'member' });
    const res = await send('GET', '');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      brandId: BRAND,
      configured: true,
      allowed: true,
      connection: {
        accountId: ACCOUNT,
        label: 'Hub ID 4412893',
        status: 'connected',
        connected: true,
        portal: { id: 4412893, currency: 'USD', uiDomain: 'app.x' },
        sharedWith: [OTHER],
        consent: {
          contacts: true,
          pages: false,
          by: 'Ayşe Demir',
          at: '2026-11-09T10:00:00.000Z',
        },
        blog: null,
        properties: { ready: true, at: READY.at, error: null },
        sync: null,
        syncing: false,
      },
      usable: [{ accountId: NEW_ACCOUNT, label: 'Hub ID 7', brandIds: [OTHER] }],
    });
    expect(JSON.stringify(body)).not.toMatch(/ca_secret|org_org-1/);
  });

  it('says when the plan has no HubSpot: a kept connection is paused', async () => {
    plan.allowed = false;
    const body = await (await send('GET', '')).json();
    expect(body.allowed).toBe(false);
    expect(body.connection.connected).toBe(true);
  });

  it('reads no connection as none, and a server without the keys as not configured', async () => {
    conn.hubspotConnection.mockResolvedValue(null);
    composio.isHubspotConfigured.mockReturnValue(false);
    const body = await (await send('GET', '')).json();
    expect(body).toMatchObject({ configured: false, connection: null });
    expect(body.usable).toHaveLength(2);
  });

  it('answers a brand the person can’t reach as access.js refuses it', async () => {
    access.mockRejectedValue(
      Object.assign(new Error('No access'), { status: 403, code: 'no_brand_access' }),
    );
    const res = await send('GET', '');
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('no_brand_access');
  });
});

describe('the blog Send to CMS writes to (00522)', () => {
  const BLOGS = [
    { id: '1234567890', name: 'Acme blog', url: 'https://www.acme.test/blog' },
    { id: '2233445566', name: 'Acme news', url: null },
  ];
  const pagesAllowed = (over = {}) =>
    connected({ consent: { contacts: false, pages: true, by: 'u1', at: 'x' }, ...over });

  beforeEach(() => {
    blogs.list.mockReset().mockResolvedValue(BLOGS);
    conn.hubspotConnection.mockResolvedValue(pagesAllowed());
  });

  it('lists the HubSpot account’s blogs for an admin or manager who reaches its brands', async () => {
    const res = await send('GET', '/blogs');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ blogs: BLOGS, picked: null });
    expect(reach).toHaveBeenCalledWith('u1', { accountId: ACCOUNT });
  });

  it('keeps the blog picked, with its name', async () => {
    const res = await send('PUT', '/blog', { blogId: '2233445566' });
    expect(res.status).toBe(200);
    expect(stored().blog).toEqual({ id: '2233445566', name: 'Acme news' });
    // Not one of the account's: refused.
    const other = await send('PUT', '/blog', { blogId: '999' });
    expect(other.status).toBe(404);
    expect((await other.json()).code).toBe('blog_not_found');
    expect((await send('PUT', '/blog', { blogId: 'not-an-id' })).status).toBe(400);
  });

  it('needs consent to send pages, and says when the content scope is missing', async () => {
    conn.hubspotConnection.mockResolvedValue(connected());
    let res = await send('GET', '/blogs');
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('consent_required');

    conn.hubspotConnection.mockResolvedValue(pagesAllowed());
    blogs.list.mockRejectedValue(new HubspotError('scopes', '403'));
    res = await send('GET', '/blogs');
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('scopes');

    blogs.list.mockRejectedValue(new HubspotError('auth', '401'));
    res = await send('PUT', '/blog', { blogId: '1234567890' });
    expect((await res.json()).code).toBe('refused');
    expect(conn.markSignInRefused).toHaveBeenCalledWith(ACCOUNT);
  });

  it('is for admins and managers, on the plan', async () => {
    access.mockResolvedValue({ brand: brand(), role: 'member' });
    expect((await send('GET', '/blogs')).status).toBe(403);
    access.mockResolvedValue({ brand: brand(), role: 'manager' });
    plan.allowed = false;
    expect((await send('PUT', '/blog', { blogId: '1234567890' })).status).toBe(403);
    expect(blogs.list).not.toHaveBeenCalled();
  });
});

describe('POST /api/hubspot/brands/:brandId/connect', () => {
  const body = { callbackUrl: 'https://app.test/dashboard/settings', consent: CONSENT };

  it('starts HubSpot’s sign-in for the brand, under the Account’s entity', async () => {
    const res = await send('POST', '/connect', body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirectUrl: 'https://hs.test/x', accountId: ACCOUNT });
    const [args, deps] = lib.startBrandAccount.mock.calls[0];
    expect(args).toMatchObject({ provider: 'hubspot', userId: 'u1', entityId: 'org_org-1' });
    await deps.initiate('org_org-1');
    expect(composio.linkHubspot).toHaveBeenCalledWith(
      'org_org-1',
      'https://app.test/dashboard/settings',
    );
  });

  it('asks for consent first: one write allowed at least', async () => {
    const res = await send('POST', '/connect', {
      ...body,
      consent: { contacts: false, pages: false },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('consent_required');
    expect((await send('POST', '/connect', { callbackUrl: body.callbackUrl })).status).toBe(400);
    expect(lib.startBrandAccount).not.toHaveBeenCalled();
  });

  it('needs the plan’s HubSpot, an admin or manager, a real brand and a set-up server', async () => {
    plan.allowed = false;
    let res = await send('POST', '/connect', body);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('plan_limit');

    plan.allowed = true;
    access.mockResolvedValue({ brand: brand(), role: 'member' });
    res = await send('POST', '/connect', body);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden');

    access.mockResolvedValue({ brand: brand({ is_demo: true }), role: 'admin' });
    expect((await send('POST', '/connect', body)).status).toBe(409);

    access.mockResolvedValue({ brand: brand(), role: 'admin' });
    composio.isHubspotConfigured.mockReturnValue(false);
    res = await send('POST', '/connect', body);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('not_configured');
    expect(lib.startBrandAccount).not.toHaveBeenCalled();
  });

  it('sends the person back to the app only', async () => {
    vi.stubEnv('PUBLIC_APP_URL', 'https://app.test');
    const res = await send('POST', '/connect', { ...body, callbackUrl: 'https://evil.test/x' });
    vi.unstubAllEnvs();
    expect(res.status).toBe(400);
    expect(lib.startBrandAccount).not.toHaveBeenCalled();
  });
});

describe('POST /api/hubspot/brands/:brandId/activate', () => {
  it('waits while HubSpot’s sign-in isn’t done, setting nothing up', async () => {
    lib.activateBrandAccount.mockResolvedValue('pending');
    const res = await send('POST', '/activate', { accountId: ACCOUNT, consent: CONSENT });
    expect(await res.json()).toEqual({ status: 'pending' });
    expect(setup.ensureProperties).not.toHaveBeenCalled();
    expect(conn.writeHubspotSettings).not.toHaveBeenCalled();
  });

  it('once done: keeps the consent, names the account and makes the Ansvisor properties', async () => {
    lib.activateBrandAccount.mockResolvedValue('connected');
    conn.hubspotConnection.mockResolvedValue(
      connected({ consent: {}, portal: null, properties: null }),
    );
    const res = await send('POST', '/activate', { accountId: ACCOUNT, consent: CONSENT });
    expect(await res.json()).toEqual({ status: 'connected' });
    expect(lib.activateBrandAccount.mock.calls[0][0]).toMatchObject({
      provider: 'hubspot',
      accountId: ACCOUNT,
      userId: 'u1',
    });
    expect(conn.labelSignIn).toHaveBeenCalledWith(ACCOUNT, 'Hub ID 4412893');
    expect(setup.ensureProperties).toHaveBeenCalledOnce();
    expect(stored()).toMatchObject({
      consent: { contacts: true, pages: false, by: 'u1' },
      portal: { id: 4412893, currency: 'USD' },
      properties: { version: PROPERTIES_VERSION, sourcesVersion: AI_SOURCES_VERSION, error: null },
    });
  });

  it('makes no properties when only draft pages are allowed', async () => {
    lib.activateBrandAccount.mockResolvedValue('connected');
    await send('POST', '/activate', {
      accountId: ACCOUNT,
      consent: { contacts: false, pages: true },
    });
    expect(setup.ensureProperties).not.toHaveBeenCalled();
    expect(stored()).toMatchObject({
      consent: { contacts: false, pages: true },
      properties: null,
    });
  });

  it('keeps HubSpot’s refusal for Try again, and marks a refused sign-in', async () => {
    lib.activateBrandAccount.mockResolvedValue('connected');
    setup.ensureProperties.mockRejectedValue(new HubspotError('scopes', '403'));
    await send('POST', '/activate', { accountId: ACCOUNT, consent: CONSENT });
    expect(stored().properties).toMatchObject({ error: 'scopes' });
    expect(conn.markSignInRefused).not.toHaveBeenCalled();

    setup.readPortal.mockRejectedValue(new HubspotError('auth', '401'));
    setup.ensureProperties.mockRejectedValue(new HubspotError('auth', '401'));
    await send('POST', '/activate', { accountId: ACCOUNT, consent: CONSENT });
    expect(conn.markSignInRefused).toHaveBeenCalledWith(ACCOUNT);
    expect(stored().properties.error).toBe('auth');
  });

  it('needs consent and the plan', async () => {
    expect(
      (
        await send('POST', '/activate', {
          accountId: ACCOUNT,
          consent: { contacts: false, pages: false },
        })
      ).status,
    ).toBe(400);
    plan.allowed = false;
    expect((await send('POST', '/activate', { accountId: ACCOUNT, consent: CONSENT })).status).toBe(
      403,
    );
    expect(lib.activateBrandAccount).not.toHaveBeenCalled();
  });
});

describe('POST /api/hubspot/brands/:brandId/use', () => {
  it('uses the HubSpot account another brand uses, with the consent given now', async () => {
    const res = await send('POST', '/use', { accountId: NEW_ACCOUNT, consent: CONSENT });
    expect(res.status).toBe(200);
    // Reading through the account reads every brand's on it.
    expect(reach).toHaveBeenCalledWith('u1', { accountId: NEW_ACCOUNT });
    expect(lib.useAccountForBrand.mock.calls[0][0]).toMatchObject({
      provider: 'hubspot',
      accountId: NEW_ACCOUNT,
      brandIds: [BRAND, OTHER],
    });
    expect(stored().consent).toMatchObject({ contacts: true, by: 'u1' });
    expect(setup.ensureProperties).toHaveBeenCalledOnce();
  });

  it('refuses an account of a brand the person can’t see', async () => {
    reach.mockRejectedValue(Object.assign(new Error('No access'), { status: 403 }));
    expect((await send('POST', '/use', { accountId: NEW_ACCOUNT, consent: CONSENT })).status).toBe(
      403,
    );
    expect(lib.useAccountForBrand).not.toHaveBeenCalled();
  });
});

describe('PUT /api/hubspot/brands/:brandId/settings', () => {
  it('stops a write at once, keeping who allowed it', async () => {
    const res = await send('PUT', '/settings', { consent: { contacts: false, pages: false } });
    expect(res.status).toBe(200);
    expect(stored().consent).toEqual({
      contacts: false,
      pages: false,
      by: 'u1',
      at: '2026-11-09T10:00:00.000Z',
    });
    expect(setup.ensureProperties).not.toHaveBeenCalled();
  });

  it('makes the properties when marking contacts is turned on and they aren’t ready', async () => {
    conn.hubspotConnection.mockResolvedValue(
      connected({ consent: { contacts: false, pages: true }, properties: null }),
    );
    await send('PUT', '/settings', { consent: { contacts: true, pages: true } });
    expect(setup.ensureProperties).toHaveBeenCalledOnce();
    expect(setup.readPortal).not.toHaveBeenCalled();
    expect(stored().consent).toMatchObject({ contacts: true, pages: true, by: 'u1' });
  });

  it('needs a connection and an admin or manager', async () => {
    conn.hubspotConnection.mockResolvedValue(null);
    expect((await send('PUT', '/settings', { consent: CONSENT })).status).toBe(409);
    access.mockResolvedValue({ brand: brand(), role: 'member' });
    expect((await send('PUT', '/settings', { consent: CONSENT })).status).toBe(403);
  });
});

describe('POST /api/hubspot/brands/:brandId/setup', () => {
  it('tries the setup again on a connected account', async () => {
    conn.hubspotConnection.mockResolvedValue(connected({ properties: { error: 'scopes' } }));
    const res = await send('POST', '/setup');
    expect(res.status).toBe(200);
    expect(setup.readPortal).toHaveBeenCalledOnce();
    expect(setup.ensureProperties).toHaveBeenCalledOnce();
    expect(stored().properties.error).toBeNull();
  });

  it('needs a connected account', async () => {
    conn.hubspotConnection.mockResolvedValue({ ...connected(), connected: false });
    expect((await send('POST', '/setup')).status).toBe(409);
  });
});

describe('DELETE /api/hubspot/brands/:brandId', () => {
  it('disconnects on any plan: the brand uses no HubSpot account any more', async () => {
    plan.allowed = false;
    const res = await send('DELETE', '');
    expect(res.status).toBe(200);
    expect(lib.removeBrandAccount.mock.calls[0][0]).toMatchObject({
      provider: 'hubspot',
      brand: { id: BRAND },
    });
  });

  it('is for admins and managers, never on the demo brand', async () => {
    access.mockResolvedValue({ brand: brand(), role: 'member' });
    expect((await send('DELETE', '')).status).toBe(403);
    access.mockResolvedValue({ brand: brand({ is_demo: true }), role: 'admin' });
    expect((await send('DELETE', '')).status).toBe(409);
    expect(lib.removeBrandAccount).not.toHaveBeenCalled();
  });
});

describe('POST /api/hubspot/brands/:brandId/sync', () => {
  const OTHER_BRAND = '66666666-6666-4666-8666-666666666666';

  it('reads the pipeline again in the background, once every few minutes a brand', async () => {
    let finish;
    pipeline.run.mockReset().mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const res = await send('POST', '/sync');
    expect(res.status).toBe(202);
    expect(pipeline.run).toHaveBeenCalledWith({ brandId: BRAND });
    // While it runs, the card says so.
    expect((await (await send('GET', '')).json()).connection.syncing).toBe(true);
    finish({ synced: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const again = await send('POST', '/sync');
    expect(again.status).toBe(429);
    expect((await again.json()).code).toBe('busy');
    expect(pipeline.run).toHaveBeenCalledOnce();
  });

  it('needs a live connection with consent to mark contacts, and an admin or manager', async () => {
    access.mockResolvedValue({ brand: brand({ id: OTHER_BRAND }), role: 'manager' });
    conn.hubspotConnection.mockResolvedValue(
      connected({ consent: { contacts: false, pages: true } }),
    );
    let res = await send('POST', '/sync');
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('consent_required');
    conn.hubspotConnection.mockResolvedValue({ ...connected(), connected: false });
    expect((await send('POST', '/sync')).status).toBe(409);
    access.mockResolvedValue({ brand: brand({ id: OTHER_BRAND }), role: 'member' });
    expect((await send('POST', '/sync')).status).toBe(403);
    plan.allowed = false;
    expect((await send('POST', '/sync')).status).toBe(403);
  });
});
