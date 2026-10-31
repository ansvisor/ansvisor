import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * The connected Google account's properties and syncs (BRAND-ACCESS spec
 * §5.2): the list is the whole organization's whichever brand asks, so it
 * needs All brands until each brand has its own connection (PR 14); a sync
 * of one brand needs that brand, of every brand All brands. Everyone has All
 * brands until someone is narrowed, so nothing changes for them.
 */

const BRAND = '22222222-2222-2222-2222-222222222222';

const brandAccess = vi.fn();
const allBrands = vi.fn();
const listGscSites = vi.fn(async () => [{ siteUrl: 'https://acme.example/' }]);
const listGaProperties = vi.fn(async () => [{ propertyId: '123', displayName: 'Acme' }]);
const runGscSync = vi.fn(async () => ({ synced: 1 }));
const runGaSync = vi.fn(async () => ({ synced: 1 }));

vi.mock('../config/supabase.js', () => ({
  default: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: { organization_id: 'org-1', role }, error: null }),
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
  getActiveConnection: async () => ({ id: 'acct-1' }),
  deleteConnection: vi.fn(),
  listGscSites: (...args) => listGscSites(...args),
  listGaProperties: (...args) => listGaProperties(...args),
}));
vi.mock('../lib/ga-sync.js', () => ({ runGaSync: (...args) => runGaSync(...args) }));
vi.mock('../lib/gsc-sync.js', () => ({ runGscSync: (...args) => runGscSync(...args) }));
vi.mock('../lib/page-opportunities.js', () => ({ detectPageOpportunitiesInWindow: vi.fn() }));
vi.mock('../lib/access.js', () => ({
  assertBrandAccess: (...args) => brandAccess(...args),
  assertAllBrands: (...args) => allBrands(...args),
}));

let server;
let baseUrl;
let role;

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
  role = 'analyst';
  brandAccess.mockReset().mockResolvedValue({ brand: { id: BRAND }, orgId: 'org-1' });
  allBrands.mockReset().mockResolvedValue({ orgId: 'org-1' });
  listGscSites.mockClear();
  listGaProperties.mockClear();
  runGscSync.mockClear();
  runGaSync.mockClear();
});

const refused = Object.assign(new Error("You don't have access to this brand"), {
  status: 403,
  code: 'no_brand_access',
});

describe.each([
  ['google-search-console', () => listGscSites],
  ['google-analytics', () => listGaProperties],
])('GET /api/integrations/%s/properties', (provider, list) => {
  it('lists them for someone with All brands, as before', async () => {
    const res = await fetch(`${baseUrl}/${provider}/properties`);
    expect(res.status).toBe(200);
    expect((await res.json()).properties).toHaveLength(1);
    expect(allBrands).toHaveBeenCalledWith('u1');
    expect(brandAccess).not.toHaveBeenCalled();
  });

  it('needs All brands even when a brand is named, whose list it would not be', async () => {
    // The demo brand is everyone's: naming it must not open the whole list.
    const res = await fetch(`${baseUrl}/${provider}/properties?brandId=${BRAND}`);
    expect(res.status).toBe(200);
    expect(allBrands).toHaveBeenCalledWith('u1');
    expect(brandAccess).not.toHaveBeenCalled();
  });

  it('refuses Selected brands, with the code, and reads nothing', async () => {
    allBrands.mockRejectedValue(refused);
    for (const path of ['properties', `properties?brandId=${BRAND}`]) {
      const res = await fetch(`${baseUrl}/${provider}/${path}`);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "You don't have access to this brand",
        code: 'no_brand_access',
      });
    }
    expect(list()).not.toHaveBeenCalled();
  });
});

describe.each([
  ['google-search-console', () => runGscSync],
  ['google-analytics', () => runGaSync],
])('POST /api/integrations/%s/sync', (provider, run) => {
  const sync = (body) =>
    fetch(`${baseUrl}/${provider}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    role = 'manager';
  });

  it('syncs every brand for someone with All brands, as before', async () => {
    const res = await sync({});
    expect(res.status).toBe(200);
    expect(allBrands).toHaveBeenCalledWith('u1');
    expect(run()).toHaveBeenCalledWith({ organizationId: 'org-1' });
  });

  it('refuses Selected brands a sync of every brand, with the code, and runs nothing', async () => {
    allBrands.mockRejectedValueOnce(refused);
    const res = await sync({});
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'no_brand_access' });
    expect(run()).not.toHaveBeenCalled();
  });

  it('syncs one brand the caller reaches, and refuses one not granted', async () => {
    const res = await sync({ brandId: BRAND });
    expect(res.status).toBe(202);
    expect(brandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(allBrands).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(run()).toHaveBeenCalledWith({ brandId: BRAND }));

    run().mockClear();
    brandAccess.mockRejectedValueOnce(refused);
    const other = await sync({ brandId: BRAND });
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ code: 'no_brand_access' });
    expect(run()).not.toHaveBeenCalled();
  });
});
