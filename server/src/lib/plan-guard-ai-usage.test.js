import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Billing page's AI usage meter reads the period's spend on the
 * workspace's one AI budget by feature (ai_usage_by_feature, 00242), as
 * shares of the plan's budget; the editor meter reads a page's share.
 */

let org;
let spend;
let rpcCalls;
// The page's ledger rows, and the filters its read used.
let pageRows;
let pageFilters;

function query(table) {
  const builder = {
    select: () => builder,
    eq: (column, value) => {
      if (table === 'prompt_improve_usage') pageFilters.push(['eq', column, value]);
      return builder;
    },
    gte: (column, value) => {
      if (table === 'prompt_improve_usage') pageFilters.push(['gte', column, value]);
      return builder;
    },
    maybeSingle: () => builder,
    single: () => builder,
    then: (resolve) =>
      resolve({
        data: table === 'organizations' ? org : table === 'prompt_improve_usage' ? pageRows : null,
        error: null,
      }),
  };
  return builder;
}

let guard;

beforeEach(async () => {
  vi.resetModules();
  process.env.IS_CLOUD = 'true';
  org = {
    plan: 'starter',
    subscription_status: 'active',
    // Renews on the 20th: the period runs from the 20th of last month.
    subscription_ends_at: '2026-11-20T09:00:00Z',
  };
  spend = [];
  rpcCalls = [];
  pageRows = [];
  pageFilters = [];
  vi.doMock('../config/supabase.js', () => ({
    default: {
      from: (t) => query(t),
      rpc: async (fn, args) => {
        rpcCalls.push({ fn, args });
        return { data: spend, error: null };
      },
    },
  }));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
  guard = await import('./plan-guard.js');
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.IS_CLOUD;
  vi.doUnmock('../config/supabase.js');
});

describe('getAiUsage', () => {
  it('reads the period’s spend by feature as shares of the plan’s budget', async () => {
    // Starter's budget is $1.
    spend = [
      { feature: 'improve', cost_usd: '0.125' },
      { feature: 'content', cost_usd: '0.3004' },
    ];
    const usage = await guard.getAiUsage('o1');
    expect(rpcCalls).toEqual([
      {
        fn: 'ai_usage_by_feature',
        args: { p_organization_id: 'o1', p_since: usage.periodStart },
      },
    ]);
    expect(usage).toMatchObject({
      plan: 'starter',
      unlimited: false,
      percentUsed: 42.5,
      features: [
        { feature: 'improve', percent: 12.5 },
        { feature: 'content', percent: 30 },
        { feature: 'action_center', percent: 0 },
      ],
    });
    // The period follows the subscription: it renews on the 20th.
    expect(usage.periodStart.slice(0, 10)).toBe('2026-10-20');
    expect(usage.periodEnd.slice(0, 10)).toBe('2026-11-20');
  });

  it('reads spend past the budget as all of it, the features scaled to fit', async () => {
    spend = [
      { feature: 'content', cost_usd: '1.5' },
      { feature: 'action_center', cost_usd: '0.5' },
    ];
    const usage = await guard.getAiUsage('o1');
    expect(usage.percentUsed).toBe(100);
    expect(usage.features).toEqual([
      { feature: 'improve', percent: 0 },
      { feature: 'content', percent: 75 },
      { feature: 'action_center', percent: 25 },
    ]);
  });

  it('lists spend it can’t place only when there is some', async () => {
    spend = [{ feature: 'other', cost_usd: '0.05' }];
    expect((await guard.getAiUsage('o1')).features).toContainEqual({
      feature: 'other',
      percent: 5,
    });
    spend = [];
    const empty = await guard.getAiUsage('o1');
    expect(empty.percentUsed).toBe(0);
    expect(empty.features.map((f) => f.feature)).toEqual(['improve', 'content', 'action_center']);
  });

  it('reads just under the budget as just under, and all of it only once spent', async () => {
    spend = [{ feature: 'improve', cost_usd: '0.9996' }];
    expect((await guard.getAiUsage('o1')).percentUsed).toBe(99.9);
    spend = [{ feature: 'improve', cost_usd: '1' }];
    expect((await guard.getAiUsage('o1')).percentUsed).toBe(100);
  });

  it('scales unknown spend with the rest when past the budget', async () => {
    spend = [
      { feature: 'improve', cost_usd: '1.5' },
      { feature: 'other', cost_usd: '0.5' },
    ];
    const usage = await guard.getAiUsage('o1');
    expect(usage.features).toContainEqual({ feature: 'improve', percent: 75 });
    expect(usage.features).toContainEqual({ feature: 'other', percent: 25 });
  });

  it('reads a budget of nothing as used up, as the AI features are', async () => {
    org = { ...org, plan: 'enterprise', plan_overrides: { improveMonthlyBudgetUsd: 0 } };
    spend = [];
    const usage = await guard.getAiUsage('o1');
    expect(usage.percentUsed).toBe(100);
    expect(usage.features.every((f) => f.percent === 0)).toBe(true);
  });

  it('has no meter without an active plan', async () => {
    org = { ...org, subscription_status: 'incomplete' };
    await expect(guard.getAiUsage('o1')).rejects.toMatchObject({ statusCode: 402 });
  });

  it('shows no meter for an unlimited budget', async () => {
    delete process.env.IS_CLOUD;
    vi.resetModules();
    guard = await import('./plan-guard.js');
    const usage = await guard.getAiUsage('o1');
    expect(usage).toMatchObject({ unlimited: true, percentUsed: null, features: [] });
    expect(rpcCalls).toEqual([]);
  });
});

describe('getDraftAiUsage', () => {
  it('reads the page’s spend this period as a share of the budget, from the org’s own rows', async () => {
    // Starter's budget is $1: 0.0371 is 3.7%.
    pageRows = [{ cost_usd: '0.0250' }, { cost_usd: '0.0121' }];
    spend = [{ feature: 'content', cost_usd: '0.2' }];
    expect(await guard.getDraftAiUsage('o1', 'd1')).toEqual({ unlimited: false, percent: 3.7 });
    expect(pageFilters).toEqual([
      ['eq', 'organization_id', 'o1'],
      ['eq', 'content_draft_id', 'd1'],
      // The same period as the month's figure: it renews on the 20th.
      ['gte', 'used_at', '2026-10-20T09:00:00.000Z'],
    ]);
  });

  it('reads a page with no AI calls as 0, and one with a sliver as 0.1', async () => {
    expect(await guard.getDraftAiUsage('o1', 'd1')).toEqual({ unlimited: false, percent: 0 });
    // A small Fix run on a big budget: $0.005 of Enterprise's $10.
    org = { ...org, plan: 'enterprise' };
    pageRows = [{ cost_usd: '0.005' }];
    spend = [{ feature: 'content', cost_usd: '0.005' }];
    expect(await guard.getDraftAiUsage('o1', 'd1')).toEqual({ unlimited: false, percent: 0.1 });
  });

  it('scales the page’s spend to fit once the month’s is past the budget, as the month’s figure', async () => {
    // The last call took the month to $1.07 of Starter's $1, all on this page.
    pageRows = [{ cost_usd: '1.07' }];
    spend = [{ feature: 'content', cost_usd: '1.07' }];
    expect(await guard.getDraftAiUsage('o1', 'd1')).toEqual({ unlimited: false, percent: 100 });
    // Half of it on this page.
    pageRows = [{ cost_usd: '0.535' }];
    expect(await guard.getDraftAiUsage('o1', 'd1')).toEqual({ unlimited: false, percent: 50 });
  });

  it('rejects with plan_limit without an active plan, and shows none for an unlimited budget', async () => {
    org = { ...org, subscription_status: 'incomplete' };
    await expect(guard.getDraftAiUsage('o1', 'd1')).rejects.toMatchObject({ statusCode: 402 });

    delete process.env.IS_CLOUD;
    vi.resetModules();
    guard = await import('./plan-guard.js');
    expect(await guard.getDraftAiUsage('o1', 'd1')).toEqual({ unlimited: true, percent: null });
    expect(pageFilters).toEqual([]);
  });
});
