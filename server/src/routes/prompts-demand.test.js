import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * GET /api/prompts/:promptId/demand (PROMPT-014): what the nightly sweep
 * read for the prompt's Demand card. Only for a person of the brand's
 * organization; a read, so a workspace whose plan has ended still gets it.
 */

let demand;
let profileOrg;

function table(name) {
  const result = () => {
    if (name === 'prompts') {
      return { data: { id: 'p1', text: 'best crm', prompt_sets: { brand_id: 'b1' } }, error: null };
    }
    if (name === 'brands') return { data: { id: 'b1', organization_id: 'o1' }, error: null };
    if (name === 'profiles') return { data: { organization_id: profileOrg }, error: null };
    if (name === 'prompt_demand') return { data: demand, error: null };
    if (name === 'prompt_volumes') {
      return {
        data: {
          google_volumes: { 'best crm': 9900, 'crm software': 2400 },
          location_code: 2840,
          language_code: 'en',
          fetched_at: '2026-10-20T00:00:00.000Z',
        },
        error: null,
      };
    }
    return { data: [], error: null };
  };
  const chain = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'then') {
          return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
        }
        if (prop === 'single' || prop === 'maybeSingle') return async () => result();
        return () => chain;
      },
    },
  );
  return chain;
}

vi.mock('../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));
vi.mock('../lib/plan-guard.js', () => ({
  PlanLimitError: class extends Error {},
  enforceFeature: vi.fn(),
  reserveAiBudget: vi.fn(),
  getImproveQuotaStatus: vi.fn(),
  requireFeature: () => (_req, _res, next) => next(),
  reserveRelevanceAllowance: vi.fn(),
  settleRelevanceUsage: vi.fn(),
}));
vi.mock('../lib/action-center/from-prompt-improve.js', () => ({
  liveImproveSends: vi.fn(),
  sendImproveToActionCenter: vi.fn(),
}));

const { default: router } = await import('./prompts.js');

let server;
let baseUrl;

beforeEach(async () => {
  demand = null;
  profileOrg = 'o1';
  vi.stubEnv('DEMAND_SIGNALS', 'false');
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/prompts', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/prompts`;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

describe('GET /api/prompts/:promptId/demand', () => {
  it('answers the signals read and the level', async () => {
    demand = {
      prompt_id: 'p1',
      brand_id: 'b1',
      keyword: 'best crm',
      location_code: 2840,
      language_code: 'en',
      gsc: { impressions: 4120, clicks: 96, queries: 7, top: null, at: '2026-10-28T06:00:00Z' },
      trends: { trend: 'rising', change: 64, points: [25, 41], at: '2026-10-27T07:00:00Z' },
      paa: null,
      youtube: null,
      tasks: { posted_at: '2026-10-27T06:00:00Z', paa: 's1', youtube: 'y1' },
      level: 'high',
      signals: 2,
      updated_at: '2026-10-28T06:00:00Z',
    };
    const res = await fetch(`${baseUrl}/p1/demand`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.demand).toMatchObject({
      level: 'high',
      signals: 2,
      keyword: 'best crm',
      gsc: { impressions: 4120, clicks: 96, queries: 7 },
      trends: { trend: 'rising', change: 64 },
      pending: { trends: false, paa: true, youtube: true },
      hasVolume: true,
      hasKeyword: true,
      paidSignals: false,
    });
  });

  it('answers an empty card for a prompt nothing was read for', async () => {
    const res = await fetch(`${baseUrl}/p1/demand`);
    expect(res.status).toBe(200);
    expect((await res.json()).demand).toMatchObject({
      level: null,
      signals: 0,
      keyword: 'best crm',
      gsc: null,
      hasVolume: true,
      hasKeyword: true,
    });
  });

  it('refuses a person from another organization', async () => {
    profileOrg = 'o2';
    const res = await fetch(`${baseUrl}/p1/demand`);
    expect(res.status).toBe(403);
  });
});
