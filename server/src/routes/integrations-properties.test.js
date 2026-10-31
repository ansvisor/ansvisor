import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * The connected Google account's properties (BRAND-ACCESS spec §5.2): the
 * list is the whole organization's, so with `?brandId=` the caller must
 * reach that brand, and without one have All brands. Everyone has All
 * brands until someone is narrowed, so nothing changes for them.
 */

const BRAND = '22222222-2222-2222-2222-222222222222';

const brandAccess = vi.fn();
const allBrands = vi.fn();
const listGscSites = vi.fn(async () => [{ siteUrl: 'https://acme.example/' }]);
const listGaProperties = vi.fn(async () => [{ propertyId: '123', displayName: 'Acme' }]);

vi.mock('../config/supabase.js', () => ({
  default: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: { organization_id: 'org-1', role: 'analyst' }, error: null }),
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
vi.mock('../lib/ga-sync.js', () => ({ runGaSync: vi.fn() }));
vi.mock('../lib/gsc-sync.js', () => ({ runGscSync: vi.fn() }));
vi.mock('../lib/page-opportunities.js', () => ({ detectPageOpportunitiesInWindow: vi.fn() }));
vi.mock('../lib/access.js', () => ({
  assertBrandAccess: (...args) => brandAccess(...args),
  assertAllBrands: (...args) => allBrands(...args),
}));

let server;
let baseUrl;

beforeAll(async () => {
  const { default: router } = await import('./integrations.js');
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn() };
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
  brandAccess.mockReset().mockResolvedValue({ brand: { id: BRAND }, orgId: 'org-1' });
  allBrands.mockReset().mockResolvedValue({ orgId: 'org-1' });
  listGscSites.mockClear();
  listGaProperties.mockClear();
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

  it('checks the brand named, and lists them for one the caller reaches', async () => {
    const res = await fetch(`${baseUrl}/${provider}/properties?brandId=${BRAND}`);
    expect(res.status).toBe(200);
    expect(brandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(allBrands).not.toHaveBeenCalled();
  });

  it('refuses Selected brands without a brand, or a brand not granted, and reads nothing', async () => {
    allBrands.mockRejectedValueOnce(refused);
    const bare = await fetch(`${baseUrl}/${provider}/properties`);
    expect(bare.status).toBe(403);
    brandAccess.mockRejectedValueOnce(refused);
    const other = await fetch(`${baseUrl}/${provider}/properties?brandId=${BRAND}`);
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ error: "You don't have access to this brand" });
    expect(list()).not.toHaveBeenCalled();
  });
});
