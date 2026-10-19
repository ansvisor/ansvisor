import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Route-level tests for "Suggest content" from the prompts table (PROMPT-006).
 *
 * The helpers are tested on their own; what only shows up here is the order
 * the route checks things in, which decides whether a click spends the
 * month's quota and whether the same opportunity can be written twice: a
 * repeated request, a job still running for the prompt and an open
 * opportunity all come before the quota, and only then is a job started.
 */

class PlanLimitError extends Error {
  constructor(message, statusCode = 403) {
    super(message);
    this.name = 'PlanLimitError';
    this.statusCode = statusCode;
  }
}

const assertPromptAccess = vi.fn();
const assertBrandAccess = vi.fn();
const getOpportunityRequestAllowance = vi.fn();
const createJob = vi.fn();
const runContentJob = vi.fn();
const openOpportunityForPrompt = vi.fn();
const runningSuggestionJob = vi.fn();
let previousJob = null;

let server;
let baseUrl;

async function startApp() {
  vi.resetModules();
  vi.doMock('../lib/plan-guard.js', () => ({
    PlanLimitError,
    requireFeature: () => (req, res, next) => next(),
    enforceBriefQuota: vi.fn(),
    getBriefQuotaStatus: vi.fn(),
    getContentUsage: vi.fn(),
    getOpportunityRequestAllowance,
    getOrgIdForUser: vi.fn(),
  }));
  vi.doMock('../lib/access.js', () => ({
    assertBrandAccess,
    assertOpportunitiesAccess: vi.fn(),
    assertOpportunityAccess: vi.fn(),
    assertPromptAccess,
  }));
  vi.doMock('../lib/job-manager.js', () => ({ createJob, getJob: vi.fn() }));
  vi.doMock('../lib/job-runner.js', () => ({ runContentJob }));
  vi.doMock('../lib/prompt-content-suggestion.js', async () => {
    const actual = await vi.importActual('../lib/prompt-content-suggestion.js');
    return { ...actual, openOpportunityForPrompt, runningSuggestionJob };
  });
  // The idempotency lookup (startedJob) is the only table the route reads.
  vi.doMock('../config/supabase.js', () => {
    const chain = new Proxy(
      {},
      {
        get: (_t, op) =>
          op === 'maybeSingle' ? async () => ({ data: previousJob, error: null }) : () => chain,
      },
    );
    return { default: { from: () => chain } };
  });
  vi.doMock('../lib/prompt-clusters.js', () => ({ loadClusters: vi.fn() }));
  vi.doMock('../lib/action-center/from-opportunity.js', () => ({ sendToActionCenter: vi.fn() }));
  vi.doMock('../lib/ai-provider.js', () => ({ resolveModel: vi.fn() }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
    return { default: logger, logger };
  });

  const { default: router } = await import('./content.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.set('io', null);
  app.use('/api/content', router);

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/content`;
}

const suggest = () =>
  fetch(`${baseUrl}/prompts/p1/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idempotencyKey: 'key-123456' }),
  });

const allowance = (max) => ({ perRequest: 3, remaining: max, max, periodEnd: null, planId: 'x' });

beforeEach(async () => {
  vi.clearAllMocks();
  previousJob = null;
  assertPromptAccess.mockResolvedValue([
    { id: 'p1', prompt_sets: { brand_id: 'b1', brands: { organization_id: 'org1' } } },
  ]);
  assertBrandAccess.mockResolvedValue({ orgId: 'org1' });
  runningSuggestionJob.mockResolvedValue(null);
  openOpportunityForPrompt.mockResolvedValue(null);
  getOpportunityRequestAllowance.mockResolvedValue(allowance(3));
  createJob.mockResolvedValue({ id: 'job-new' });
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('POST /prompts/:promptId/suggest', () => {
  it('starts one prompt-tagged opportunity against the quota', async () => {
    const res = await suggest();

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: 'job-new' });
    expect(getOpportunityRequestAllowance).toHaveBeenCalledWith('org1');
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'content',
        brandId: 'b1',
        data: expect.objectContaining({
          request: expect.objectContaining({
            count: 1,
            promptId: 'p1',
            explicit: true,
            source: 'prompt',
          }),
        }),
      }),
    );
    expect(runContentJob).toHaveBeenCalledWith('job-new', null);
  });

  it('offers the open opportunity even when the quota is used up', async () => {
    openOpportunityForPrompt.mockResolvedValue('opp-1');
    getOpportunityRequestAllowance.mockResolvedValue(allowance(0));

    const res = await suggest();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ existingId: 'opp-1' });
    expect(getOpportunityRequestAllowance).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it('follows a job still running for the prompt instead of starting another', async () => {
    runningSuggestionJob.mockResolvedValue('job-running');

    const res = await suggest();

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: 'job-running' });
    expect(openOpportunityForPrompt).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it('returns the job a repeated request already started', async () => {
    previousJob = { id: 'job-before', data: {} };

    const res = await suggest();

    expect(await res.json()).toEqual({ jobId: 'job-before' });
    expect(runningSuggestionJob).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it('refuses with quota_exhausted when nothing is left and nothing is open', async () => {
    getOpportunityRequestAllowance.mockResolvedValue(allowance(0));

    const res = await suggest();

    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'quota_exhausted' });
    expect(createJob).not.toHaveBeenCalled();
  });

  it("stops at the access check for someone else's prompt", async () => {
    assertPromptAccess.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 403 }));

    const res = await suggest();

    expect(res.status).toBe(403);
    expect(createJob).not.toHaveBeenCalled();
  });
});

describe('GET /prompts/:promptId/suggestion', () => {
  it("names the prompt's open opportunity", async () => {
    openOpportunityForPrompt.mockResolvedValue('opp-1');

    const res = await fetch(`${baseUrl}/prompts/p1/suggestion`);

    expect(await res.json()).toEqual({ existingId: 'opp-1' });
    expect(openOpportunityForPrompt).toHaveBeenCalledWith('b1', 'p1');
  });
});

describe('POST /opportunities/generate for one page (AT-006 part B3)', () => {
  const BRAND = '33333333-3333-3333-3333-333333333333';
  const generate = (body) =>
    fetch(`${baseUrl}/opportunities/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandId: BRAND, idempotencyKey: 'key-page-1', ...body }),
    });

  it("starts one opportunity for the page, whatever count it's sent with", async () => {
    const res = await generate({ count: 3, pagePath: '/gifts' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: 'job-new', count: 1 });
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        brandId: BRAND,
        data: expect.objectContaining({
          request: expect.objectContaining({ count: 1, pagePath: '/gifts' }),
        }),
      }),
    );
  });

  it('takes a path, not a URL, and spends nothing when the month is used up', async () => {
    expect((await generate({ count: 1, pagePath: 'https://acme.example/gifts' })).status).toBe(400);
    getOpportunityRequestAllowance.mockResolvedValue(allowance(0));
    expect((await generate({ count: 1, pagePath: '/gifts' })).status).toBe(429);
    expect(createJob).not.toHaveBeenCalled();
  });
});
