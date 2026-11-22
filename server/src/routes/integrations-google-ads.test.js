import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Google Ads (Ads Phase 1, G1) is one more Composio provider, so the shared
 * /api/integrations/:provider routes would serve it. It exists only with Ads
 * (ADS_ENABLED), as every /api/ads path does: off, it is not found, and
 * Composio is never asked.
 */

const isComposioConfigured = vi.fn(() => false);
vi.mock('../config/supabase.js', () => ({ default: {} }));
vi.mock('../lib/composio.js', () => ({
  PROVIDERS: { 'google-ads': { label: 'Google Ads' } },
  entityIdFor: (orgId) => `org_${orgId}`,
  isKnownProvider: (provider) => provider === 'google-ads',
  isComposioConfigured: (...args) => isComposioConfigured(...args),
  isSlackConfigured: () => false,
}));
vi.mock('../lib/ga-sync.js', () => ({ runGaSync: vi.fn() }));
vi.mock('../lib/gsc-sync.js', () => ({ runGscSync: vi.fn() }));
vi.mock('../lib/page-opportunities.js', () => ({ detectPageOpportunitiesInWindow: vi.fn() }));
vi.mock('../lib/access.js', () => ({ assertBrandAccess: vi.fn(), assertAllBrands: vi.fn() }));

let server;
let baseUrl;

beforeAll(async () => {
  const { default: router } = await import('./integrations.js');
  const app = express();
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
afterEach(() => {
  vi.unstubAllEnvs();
  isComposioConfigured.mockClear();
});

describe('/api/integrations/google-ads', () => {
  it('is not found while Ads is off, and never reaches Composio', async () => {
    vi.stubEnv('ADS_ENABLED', '');
    const res = await fetch(`${baseUrl}/google-ads/status`);
    expect(res.status).toBe(404);
    expect(isComposioConfigured).not.toHaveBeenCalled();
  });

  it('is served like any provider with Ads on (here: not configured)', async () => {
    vi.stubEnv('ADS_ENABLED', 'true');
    const res = await fetch(`${baseUrl}/google-ads/status`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ configured: false, status: 'not_configured' });
    expect(isComposioConfigured).toHaveBeenCalledWith('google-ads');
  });
});
