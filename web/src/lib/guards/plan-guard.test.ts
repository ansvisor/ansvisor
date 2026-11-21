import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

const { planFromOrgRow, usagePlanFromOrgRow } = await import('./plan-guard');

/** The plan an organization's usage is shown against, while it's on one and once it has ended. */

afterEach(() => vi.unstubAllEnvs());

describe('usagePlanFromOrgRow', () => {
  it('is the plan it is entitled to while its subscription is active or in trial', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    for (const status of ['active', 'trialing']) {
      const { plan, ended } = usagePlanFromOrgRow({ plan: 'growth', subscription_status: status });
      expect([plan.id, ended]).toEqual(['growth', false]);
    }
  });

  it('is the plan it was on once that has ended, marked ended, where entitlement reads Starter', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    const org = {
      plan: 'enterprise',
      subscription_status: 'canceled',
      plan_overrides: { maxPrompts: 1000 },
    };
    expect(planFromOrgRow(org).id).toBe('starter');
    const { plan, ended } = usagePlanFromOrgRow(org);
    expect([plan.id, plan.limits.maxPrompts, ended]).toEqual(['enterprise', 1000, true]);
  });

  it('never ends on a self-hosted install', () => {
    const { plan, ended } = usagePlanFromOrgRow({ plan: 'growth', subscription_status: null });
    expect([plan.id, ended]).toEqual(['self_hosted', false]);
  });
});

/** Growth's extra tracking and brands (00546), bought on the plan's subscription. */
describe('add-ons in the plan’s limits', () => {
  const limits = (org: Parameters<typeof planFromOrgRow>[0]) => {
    const { maxPrompts, maxBrands } = planFromOrgRow(org).limits;
    return [maxPrompts, maxBrands];
  };

  it('raise Growth’s prompt locations and brands, in its trial too', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    for (const subscription_status of ['active', 'trialing']) {
      expect(
        limits({ plan: 'growth', subscription_status, add_on_prompts: 1000, add_on_brands: 3 }),
      ).toEqual([1250, 7]);
    }
    expect(limits({ plan: 'growth', subscription_status: 'active' })).toEqual([250, 4]);
  });

  it('count only on Growth: Starter and Enterprise keep their own limits', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    const extra = { add_on_prompts: 100, add_on_brands: 1 };
    expect(limits({ plan: 'starter', subscription_status: 'active', ...extra })).toEqual([50, 1]);
    expect(
      limits({
        plan: 'enterprise',
        subscription_status: 'active',
        plan_overrides: { maxPrompts: 3000, maxBrands: 2 },
        ...extra,
      }),
    ).toEqual([3000, 2]);
  });

  it('end with the plan: an ended Growth shows its own limits', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    const org = {
      plan: 'growth',
      subscription_status: 'canceled',
      add_on_prompts: 500,
      add_on_brands: 2,
    };
    expect(limits(org)).toEqual([50, 1]);
    const { plan, ended } = usagePlanFromOrgRow(org);
    expect([plan.limits.maxPrompts, plan.limits.maxBrands, ended]).toEqual([250, 4, true]);
  });

  it('ignore what isn’t a whole count above 0, and a self-hosted install', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    for (const bad of [-5, 0, 2.5, '100', null]) {
      expect(
        limits({ plan: 'growth', subscription_status: 'active', add_on_prompts: bad }),
      ).toEqual([250, 4]);
    }
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(limits({ plan: 'growth', subscription_status: 'active', add_on_prompts: 100 })).toEqual([
      -1, -1,
    ]);
  });
});
