import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Who may spend the plan's tracking, search volumes and models, delete an
 * audit, stop a tracking run or approve brand facts (2026-11-03): admins and
 * managers. An analyst or an agency partner is refused before anything runs,
 * is queued, bought or deleted. Running a Site Audit, reading volumes and
 * the Fan-out tab's intents stay open (their own routes).
 */

let role;
let server;
let baseUrl;
const deleted = [];
const createJob = vi.fn(async () => ({ id: 'j1' }));
const cancelJob = vi.fn();
const getJob = vi.fn(async () => ({ id: 'j1', brand_id: 'b1' }));
const generateObject = vi.fn();
const webResearch = vi.fn();
const fetchAndSaveVolumes = vi.fn();
const analyzeBrandVolumes = vi.fn();
const refreshBrandVolumes = vi.fn(async () => []);
const enforceVolumeQuota = vi.fn(async () => ({ remaining: 100, orgId: 'o1' }));
const enforceOnDemandTrackingQuota = vi.fn();
const readBrandFacts = vi.fn(async () => ({ facts: [] }));
const setFactStatus = vi.fn(async () => ({}));
const assertBrandAccess = vi.fn();
const assertPromptAccess = vi.fn();

const BRAND = '11111111-1111-4111-8111-111111111111';
const FACT = '22222222-2222-4222-8222-222222222222';

/** Every row is the caller's organization's; the caller is `role`. */
function query(table) {
  const q = { op: 'select' };
  const answer = () => {
    if (q.op === 'delete') {
      deleted.push(table);
      return { data: null, error: null };
    }
    if (table === 'profiles') return { data: { organization_id: 'o1', role }, error: null };
    if (table === 'site_audits') return { data: { id: 'a1', brand_id: 'b1' }, error: null };
    if (table === 'brand_facts') {
      return { data: { id: FACT, brand_id: 'b1', kind: 'price', slot: 'plan' }, error: null };
    }
    return { data: [], error: null };
  };
  const chain = new Proxy(
    {},
    {
      get: (_t, op) => {
        if (op === 'then')
          return (resolve, reject) => Promise.resolve(answer()).then(resolve, reject);
        if (op === 'maybeSingle' || op === 'single') return async () => answer();
        if (op === 'delete') {
          return () => {
            q.op = 'delete';
            return chain;
          };
        }
        return () => chain;
      },
    },
  );
  return chain;
}

async function startApp() {
  vi.resetModules();
  vi.doMock('../config/supabase.js', () => ({
    default: { from: (table) => query(table), rpc: async () => ({ data: [], error: null }) },
  }));
  vi.doMock('../lib/plan-guard.js', async (importOriginal) => ({
    ...(await importOriginal()),
    requireFeature: () => (req, res, next) => next(),
    enforceVolumeQuota,
    getVolumeQuotaStatus: vi.fn(),
  }));
  // The real role check, on the profile above; the organization checks pass.
  vi.doMock('../lib/access.js', async (importOriginal) => ({
    ...(await importOriginal()),
    assertBrandAccess,
    assertPromptAccess,
  }));
  vi.doMock('../lib/job-manager.js', () => ({ createJob, getJob, cancelJob }));
  vi.doMock('../lib/job-runner.js', () => ({ runTrackingJob: vi.fn() }));
  vi.doMock('../lib/tracking-quota.js', () => ({
    enforceOnDemandTrackingQuota,
    TrackingQuotaError: class extends Error {},
  }));
  vi.doMock('../lib/volume-analysis.js', () => ({
    mapVolumeRow: vi.fn(),
    fetchAndSaveVolumes,
    analyzeBrandVolumes,
    refreshBrandVolumes,
    getVolumeProgress: vi.fn(),
  }));
  vi.doMock('ai', () => ({ generateObject, NoObjectGeneratedError: class extends Error {} }));
  vi.doMock('../lib/ai-provider.js', () => ({ resolveModel: vi.fn() }));
  vi.doMock('../lib/web-research.js', () => ({ webResearch }));
  vi.doMock('../lib/brand-facts.js', () => ({ readBrandFacts, setFactStatus }));
  vi.doMock('../lib/content-quality.js', async (importOriginal) => ({
    ...(await importOriginal()),
    qualityPhase: () => 3,
  }));
  vi.doMock('../middleware/rate-limiter.js', async (importOriginal) => ({
    ...(await importOriginal()),
    brandFactsLimiter: (req, res, next) => next(),
  }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
    return { default: logger, logger };
  });

  const { default: tracking } = await import('./tracking.js');
  const { default: audits } = await import('./audits.js');
  const { default: volumes } = await import('./volumes.js');
  const { default: competitors } = await import('./competitors.js');
  const { default: brandFacts } = await import('./brand-facts.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use('/api/tracking', tracking);
  app.use('/api/audits', audits);
  app.use('/api/volumes', volumes);
  app.use('/api/competitors', competitors);
  app.use('/api/brand-facts', brandFacts);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
}

const setup = { brandName: 'Acme', industry: 'Coffee', description: 'Office coffee.' };

/** Each route, how it is called, and what a refused caller reads. */
const ROUTES = [
  ['POST', '/tracking/check', { brandId: 'b1' }, 'Only admins and managers can run tracking.'],
  [
    'POST',
    '/tracking/analyze-new',
    { brandId: 'b1' },
    'Only admins and managers can run tracking.',
  ],
  ['DELETE', '/tracking/job/j1', null, 'Only admins and managers can stop a tracking run.'],
  ['DELETE', '/audits/a1', null, 'Only admins and managers can delete an audit.'],
  [
    'POST',
    '/volumes/analyze',
    { promptId: 'p1', promptText: 'best office coffee' },
    'Only admins and managers can analyze search volumes.',
  ],
  [
    'POST',
    '/volumes/analyze-batch',
    { brandId: 'b1' },
    'Only admins and managers can analyze search volumes.',
  ],
  [
    'POST',
    '/volumes/bootstrap',
    { brandId: 'b1' },
    'Only admins and managers can analyze search volumes.',
  ],
  [
    'POST',
    '/volumes/refresh',
    { brandId: 'b1' },
    'Only admins and managers can analyze search volumes.',
  ],
  ['POST', '/competitors/suggest', setup, 'Only admins and managers can suggest competitors.'],
  [
    'POST',
    '/brand-facts/fetch',
    { brandId: BRAND },
    'Only admins and managers can read the brand facts again.',
  ],
  [
    'PATCH',
    `/brand-facts/${FACT}`,
    { status: 'approved' },
    'Only admins and managers can approve or reject brand facts.',
  ],
];

const call = (method, path, body) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

beforeEach(async () => {
  vi.clearAllMocks();
  deleted.length = 0;
  assertBrandAccess.mockResolvedValue({
    brand: { id: 'b1', organization_id: 'o1', is_active: true },
    orgId: 'o1',
  });
  assertPromptAccess.mockResolvedValue([
    { id: 'p1', prompt_sets: { brand_id: 'b1', brands: { organization_id: 'o1' } } },
  ]);
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('the routes that spend, delete or decide', () => {
  for (const refused of ['analyst', 'agency_partner']) {
    it(`refuse an ${refused}, before anything runs, is queued, bought or deleted`, async () => {
      role = refused;
      for (const [method, path, body, message] of ROUTES) {
        const res = await call(method, path, body);
        expect(res.status, path).toBe(403);
        const answer = await res.json();
        expect(answer.error ?? answer.message, path).toBe(message);
      }
      for (const done of [
        createJob,
        cancelJob,
        generateObject,
        webResearch,
        fetchAndSaveVolumes,
        analyzeBrandVolumes,
        refreshBrandVolumes,
        readBrandFacts,
        setFactStatus,
      ]) {
        expect(done).not.toHaveBeenCalled();
      }
      expect(deleted).toEqual([]);
    });
  }

  it('let a manager past the role check', async () => {
    role = 'manager';
    for (const [method, path, body, message] of ROUTES) {
      const res = await call(method, path, body);
      expect(res.status, path).not.toBe(403);
      expect(JSON.stringify(await res.json().catch(() => null)), path).not.toContain(message);
    }
    expect(cancelJob).toHaveBeenCalled();
    expect(setFactStatus).toHaveBeenCalled();
  });
});
