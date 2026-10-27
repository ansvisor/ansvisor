import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * GET /api/content/usage and GET /api/content/briefs/quota read the content
 * counts as reads (read-only once the plan has ended, 2026-10-27): plan-guard
 * answers a workspace without an active plan with limits of 0 and `noPlan`,
 * not a 402, so the Content page still opens on what was kept.
 */

const getBriefQuotaStatus = vi.fn();
const getContentUsage = vi.fn();
const getOrgIdForUser = vi.fn();
let server;
let baseUrl;

beforeAll(async () => {
  vi.doMock('../lib/plan-guard.js', () => ({
    PlanLimitError: class PlanLimitError extends Error {},
    requireFeature: () => (req, res, next) => next(),
    enforceBriefQuota: vi.fn(),
    getBriefQuotaStatus,
    getContentUsage,
    getOpportunityRequestAllowance: vi.fn(),
    getOrgIdForUser,
  }));
  vi.doMock('../lib/job-manager.js', () => ({ createJob: vi.fn(), getJob: vi.fn() }));
  vi.doMock('../lib/job-runner.js', () => ({ runContentJob: vi.fn() }));
  vi.doMock('../config/supabase.js', () => ({ default: { from: vi.fn(), rpc: vi.fn() } }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
    return { default: logger, logger };
  });

  const { default: router } = await import('./content.js');
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/content', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/content`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const mod of [
    '../lib/plan-guard.js',
    '../lib/job-manager.js',
    '../lib/job-runner.js',
    '../config/supabase.js',
    '../lib/logger.js',
  ]) {
    vi.doUnmock(mod);
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  getOrgIdForUser.mockResolvedValue('o1');
});

const noPlanCount = { used: 2, limit: 0, remaining: 0, noPlan: true };

describe('GET /usage', () => {
  it('reads the counts as a read, so a plan that ended answers 200', async () => {
    const usage = {
      plan: 'starter',
      planName: 'Starter',
      noPlan: true,
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
      opportunities: { ...noPlanCount, perRequest: 0 },
      briefs: noPlanCount,
    };
    getContentUsage.mockResolvedValue(usage);
    const res = await fetch(`${baseUrl}/usage`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(usage);
    expect(getContentUsage).toHaveBeenCalledWith('o1', { readOnly: true });
  });
});

describe('GET /briefs/quota', () => {
  it('reads the quota as a read, so a plan that ended answers 200', async () => {
    getBriefQuotaStatus.mockResolvedValue(noPlanCount);
    const res = await fetch(`${baseUrl}/briefs/quota`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(noPlanCount);
    expect(getBriefQuotaStatus).toHaveBeenCalledWith('o1', { readOnly: true });
  });
});
