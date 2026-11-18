import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Growth's AI top-ups (00546): what a paid top-up adds counts in the quota
 * window it was paid in, on the AI budget, briefs and opportunities, until
 * the plan renews; a refunded one counts no more. A read that fails counts
 * none and never stops the plan from being read.
 */

let org;
let topUps;
let topUpError;
let filters;

function query(table) {
  const builder = {
    select: () => builder,
    eq: (col, val) => (table === 'usage_top_ups' && filters.push(['eq', col, val]), builder),
    gte: (col, val) => (table === 'usage_top_ups' && filters.push(['gte', col, val]), builder),
    is: (col, val) => (table === 'usage_top_ups' && filters.push(['is', col, val]), builder),
    or: () => builder,
    order: () => builder,
    limit: () => builder,
    single: () => builder,
    maybeSingle: () => builder,
    then: (resolve) => {
      if (table === 'organizations') return resolve({ data: org, error: null });
      if (table === 'usage_top_ups') return resolve({ data: topUps, error: topUpError });
      // brief_usage: none used this period.
      return resolve({ data: [], count: 0, error: null });
    },
  };
  return builder;
}

let guard;
let logger;

beforeEach(async () => {
  vi.resetModules();
  process.env.IS_CLOUD = 'true';
  org = {
    plan: 'growth',
    subscription_status: 'active',
    plan_overrides: null,
    // Renews on the 29th: this window began 2026-10-29.
    subscription_ends_at: '2026-11-29T10:00:00.000Z',
  };
  topUps = [];
  topUpError = null;
  filters = [];
  logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  vi.doMock('../config/supabase.js', () => ({ default: { from: (t) => query(t) } }));
  vi.doMock('./logger.js', () => ({ logger }));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-18T12:00:00Z'));
  guard = await import('./plan-guard.js');
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.IS_CLOUD;
});

describe('applyTopUps', () => {
  const plan = {
    id: 'growth',
    limits: { improveMonthlyBudgetUsd: 25, maxBriefGenerations: 50, maxOpportunitiesPerMonth: 50 },
  };

  it('adds what was bought to the AI budget, briefs and opportunities', () => {
    const topped = guard.applyTopUps(plan, {
      aiUsd: 50,
      briefs: 100,
      opportunities: 100,
      multiplier: 10,
    });
    expect(topped.limits).toMatchObject({
      improveMonthlyBudgetUsd: 75,
      maxBriefGenerations: 150,
      maxOpportunitiesPerMonth: 150,
    });
    expect(topped.topUp).toEqual({ multiplier: 10 });
  });

  it('leaves an unlimited limit unlimited, and a plan without top-ups as it is', () => {
    const unlimited = { id: 'x', limits: { ...plan.limits, maxBriefGenerations: -1 } };
    expect(
      guard.applyTopUps(unlimited, { aiUsd: 25, briefs: 50, opportunities: 50, multiplier: 5 })
        .limits.maxBriefGenerations,
    ).toBe(-1);
    expect(guard.applyTopUps(plan, null)).toBe(plan);
  });
});

describe('the plan read with top-ups', () => {
  it('counts the unrefunded top-ups paid since this window began', async () => {
    topUps = [
      { ai_usd: '50.00', briefs: 100, opportunities: 100, multiplier: 10 },
      { ai_usd: '25.00', briefs: 50, opportunities: 50, multiplier: 5 },
    ];
    await expect(guard.getBriefQuotaStatus('org1')).resolves.toMatchObject({ limit: 200 });
    expect(filters).toEqual([
      ['eq', 'organization_id', 'org1'],
      ['gte', 'paid_at', '2026-10-29T10:00:00.000Z'],
      ['is', 'refunded_at', null],
    ]);
  });

  it('reads the plan alone without any', async () => {
    await expect(guard.getBriefQuotaStatus('org1')).resolves.toMatchObject({ limit: 50 });
  });

  it('counts none when the read fails, and says so in the log', async () => {
    topUpError = { message: 'relation "usage_top_ups" does not exist' };
    await expect(guard.getBriefQuotaStatus('org1')).resolves.toMatchObject({ limit: 50 });
    expect(logger.error).toHaveBeenCalled();
  });

  it('starts the window on the calendar month without a period end', async () => {
    org.subscription_ends_at = null;
    await guard.getBriefQuotaStatus('org1');
    expect(filters).toContainEqual(['gte', 'paid_at', '2026-11-01T00:00:00.000Z']);
  });
});
