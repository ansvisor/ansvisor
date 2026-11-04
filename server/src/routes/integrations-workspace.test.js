import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Settings › Integrations' own Google connection: status and disconnect
 * find the workspace's account by the id its integration_connections row
 * names. Brands' own logins (BRAND-ACCESS PR 15) are connected accounts
 * under the same Composio entity, so the entity alone could answer with one
 * of theirs, and disconnecting the workspace would delete a brand's login.
 */

let workspaceRow;
let ownLogins;
const upserts = [];
const getActiveConnection = vi.fn();
const listActiveConnections = vi.fn();
const deleteConnection = vi.fn();

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const chain = {
        select: () => chain,
        upsert: (payload) => (upserts.push(payload), chain),
        delete: () => chain,
        eq: () => chain,
        is: () => chain,
        single: async () => ({ data: { organization_id: 'org-1', role: 'admin' }, error: null }),
        maybeSingle: async () => ({ data: workspaceRow, error: null }),
        then: (resolve) =>
          resolve(
            table === 'integration_accounts' ? { data: ownLogins, error: null } : { error: null },
          ),
      };
      return chain;
    },
  },
}));
vi.mock('../lib/composio.js', () => ({
  PROVIDERS: {},
  entityIdFor: (orgId) => `org_${orgId}`,
  isKnownProvider: () => true,
  isComposioConfigured: () => true,
  initiateConnection: vi.fn(),
  getActiveConnection: (...args) => getActiveConnection(...args),
  listActiveConnections: (...args) => listActiveConnections(...args),
  deleteConnection: (...args) => deleteConnection(...args),
  connectedAccountStatus: vi.fn(),
  listGscSites: vi.fn(),
  listGaProperties: vi.fn(),
}));
vi.mock('../lib/brand-integrations.js', () => ({
  BRAND_GOOGLE_PROVIDERS: ['google-search-console', 'google-analytics'],
}));
vi.mock('../lib/ga-sync.js', () => ({ runGaSync: vi.fn() }));
vi.mock('../lib/gsc-sync.js', () => ({ runGscSync: vi.fn() }));
vi.mock('../lib/page-opportunities.js', () => ({ detectPageOpportunitiesInWindow: vi.fn() }));
vi.mock('../lib/access.js', () => ({
  assertBrandAccess: vi.fn(),
  assertAllBrands: vi.fn(),
  assertEveryBrand: vi.fn(),
  brandAccessOf: vi.fn(),
}));

let server;
let baseUrl;

beforeAll(async () => {
  const { default: router } = await import('./integrations.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/integrations', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/integrations`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  workspaceRow = { composio_account_id: 'ca-workspace' };
  ownLogins = [{ composio_account_id: 'ca-brand' }];
  upserts.length = 0;
  // The entity holds a brand's own login first, then the workspace's.
  listActiveConnections.mockReset().mockResolvedValue([{ id: 'ca-brand' }, { id: 'ca-workspace' }]);
  getActiveConnection
    .mockReset()
    .mockImplementation(async (_p, _e, id) => (id === 'ca-workspace' ? { id } : null));
  deleteConnection.mockReset();
});

describe('GET /api/integrations/:provider/status', () => {
  it('reads the account the workspace row names', async () => {
    const res = await fetch(`${baseUrl}/google-analytics/status`);
    expect(await res.json()).toEqual({
      configured: true,
      status: 'connected',
      accountId: 'ca-workspace',
    });
    expect(getActiveConnection).toHaveBeenCalledWith(
      'google-analytics',
      'org_org-1',
      'ca-workspace',
    );
  });

  it('never takes a brand’s own login for the workspace’s when the row names none', async () => {
    workspaceRow = { composio_account_id: null };
    listActiveConnections.mockResolvedValue([{ id: 'ca-brand' }]);
    const res = await fetch(`${baseUrl}/google-analytics/status`);
    expect(await res.json()).toEqual({ configured: true, status: 'not_connected' });
    expect(upserts.some((u) => u.composio_account_id === 'ca-brand')).toBe(false);
  });
});

describe('DELETE /api/integrations/:provider', () => {
  it('deletes the workspace’s account, never a brand’s own login', async () => {
    const res = await fetch(`${baseUrl}/google-search-console`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(deleteConnection).toHaveBeenCalledWith('ca-workspace');
    expect(deleteConnection).not.toHaveBeenCalledWith('ca-brand');
  });

  it('deletes nothing on Composio when only brands’ logins are active', async () => {
    workspaceRow = null;
    listActiveConnections.mockResolvedValue([{ id: 'ca-brand' }]);
    const res = await fetch(`${baseUrl}/google-search-console`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(deleteConnection).not.toHaveBeenCalled();
  });
});
