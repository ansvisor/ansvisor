import { beforeAll, describe, expect, it } from 'vitest';

let applyPlanOverrides;

beforeAll(async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  ({ applyPlanOverrides } = await import('./plan-guard.js'));
});

const plan = {
  id: 'enterprise',
  name: 'Enterprise',
  limits: { maxBrands: -1, maxPrompts: -1, allowedModels: [] },
};

describe('applyPlanOverrides', () => {
  it('merges enterprise overrides without mutating the plan', () => {
    const result = applyPlanOverrides(plan, {
      plan: 'enterprise',
      plan_overrides: { maxPrompts: 500, allowedModels: ['claude-sonnet-5'] },
    });

    expect(result).not.toBe(plan);
    expect(result.limits).not.toBe(plan.limits);
    expect(result.limits.maxPrompts).toBe(500);
    expect(result.limits.allowedModels).toEqual(['claude-sonnet-5']);
    expect(plan).toEqual({
      id: 'enterprise',
      name: 'Enterprise',
      limits: { maxBrands: -1, maxPrompts: -1, allowedModels: [] },
    });
  });

  it('ignores non-enterprise and invalid overrides', () => {
    expect(
      applyPlanOverrides(plan, {
        plan: 'growth',
        plan_overrides: { maxPrompts: 500 },
      }),
    ).toEqual(plan);
    expect(applyPlanOverrides(plan, { plan: 'enterprise', plan_overrides: null })).toEqual(plan);
    expect(applyPlanOverrides(plan, { plan: 'enterprise', plan_overrides: 'invalid' })).toEqual(
      plan,
    );
    expect(applyPlanOverrides(plan, { plan: 'enterprise', plan_overrides: [] })).toEqual(plan);
  });
});

describe('applyPlanOverrides — Improve budget from the contract value', () => {
  const enterprise = {
    id: 'enterprise',
    name: 'Enterprise',
    limits: { maxPrompts: -1, improveMonthlyBudgetUsd: 4.99 },
  };
  const budget = (plan_overrides) =>
    applyPlanOverrides(enterprise, { plan: 'enterprise', plan_overrides }).limits
      .improveMonthlyBudgetUsd;

  it('is 1% of the monthly contract', () => {
    expect(budget({ contractMonthlyUsd: 1000 })).toBe(10);
    expect(budget({ contractMonthlyUsd: 2000 })).toBe(20);
    expect(budget({ contractMonthlyUsd: 1234 })).toBe(12.34);
  });

  it('never drops below the plan default', () => {
    expect(budget({ contractMonthlyUsd: 300 })).toBe(4.99);
  });

  it('an explicit improveMonthlyBudgetUsd wins over the contract value', () => {
    expect(budget({ contractMonthlyUsd: 2000, improveMonthlyBudgetUsd: 7 })).toBe(7);
  });

  it('keeps the default without a usable contract value', () => {
    expect(budget({ maxPrompts: 900 })).toBe(4.99);
    expect(budget({ contractMonthlyUsd: 'n/a' })).toBe(4.99);
  });
});
