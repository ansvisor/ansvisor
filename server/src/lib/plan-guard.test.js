import { describe, expect, it } from 'vitest';

const plan = {
  id: 'enterprise',
  name: 'Enterprise',
  limits: { maxBrands: -1, maxPrompts: -1, allowedModels: [] },
};

describe('applyPlanOverrides', () => {
  it('merges enterprise overrides without mutating the plan', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    const { applyPlanOverrides } = await import('./plan-guard.js');

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

  it('ignores non-enterprise and invalid overrides', async () => {
    const { applyPlanOverrides } = await import('./plan-guard.js');
    expect(
      applyPlanOverrides(plan, {
        plan: 'growth',
        plan_overrides: { maxPrompts: 500 },
      }),
    ).toEqual(plan);
    expect(applyPlanOverrides(plan, { plan: 'enterprise', plan_overrides: null })).toEqual(plan);
    expect(
      applyPlanOverrides(plan, { plan: 'enterprise', plan_overrides: 'invalid' }),
    ).toEqual(plan);
    expect(applyPlanOverrides(plan, { plan: 'enterprise', plan_overrides: [] })).toEqual(plan);
  });
});
