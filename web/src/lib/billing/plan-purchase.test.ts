import { describe, expect, it } from 'vitest';
import { annualSaving, periodPrice, planChange, planRequestSchema } from './plan-purchase';

describe('plan prices', () => {
  it('reads a month or a year up front from the config', () => {
    expect(periodPrice('starter', 'month')).toBe(49);
    expect(periodPrice('starter', 'year')).toBe(470);
    expect(periodPrice('growth', 'month')).toBe(249);
    expect(periodPrice('growth', 'year')).toBe(2390);
    expect(periodPrice('enterprise', 'month')).toBeNull();
  });

  it('saves 20% on a year against twelve months', () => {
    expect(annualSaving('starter')).toBe(20);
    expect(annualSaving('growth')).toBe(20);
    expect(annualSaving('enterprise')).toBeNull();
  });
});

describe('planChange', () => {
  const trial = { status: 'trialing', planId: 'starter', interval: 'month' as const };
  const paid = { status: 'active', planId: 'starter', interval: 'month' as const };

  it('buys a trial now on any plan and period', () => {
    expect(planChange(trial, { buyNow: true })).toEqual({
      kind: 'buy_now',
      planId: 'starter',
      interval: 'month',
      promoCode: null,
    });
    expect(
      planChange(trial, { buyNow: true, newPlanId: 'growth', interval: 'year', promoCode: 'X' }),
    ).toEqual({ kind: 'buy_now', planId: 'growth', interval: 'year', promoCode: null });
  });

  it('takes a promo code only with a monthly plan', () => {
    expect(
      planChange(trial, {
        buyNow: true,
        newPlanId: 'growth',
        interval: 'month',
        promoCode: 'SAVE50',
      }),
    ).toMatchObject({ kind: 'buy_now', promoCode: 'SAVE50' });
  });

  it('buys nothing now once the trial is over', () => {
    expect(planChange(paid, { buyNow: true, newPlanId: 'growth' })).toEqual({
      kind: 'refused',
      error: 'Only a free trial can be bought now',
    });
  });

  it('changes the plan, the period or both on a paid plan', () => {
    expect(planChange(paid, { newPlanId: 'growth' })).toEqual({
      kind: 'change',
      planId: 'growth',
      interval: 'month',
    });
    expect(planChange(paid, { interval: 'year' })).toEqual({
      kind: 'change',
      planId: 'starter',
      interval: 'year',
    });
    expect(planChange(paid, { newPlanId: 'starter', interval: 'month' })).toEqual({
      kind: 'refused',
      error: 'Already on this plan',
    });
  });

  it('refuses a plan that is not for sale', () => {
    expect(planChange({ ...paid, planId: 'enterprise' }, { interval: 'year' })).toEqual({
      kind: 'refused',
      error: 'Invalid plan',
    });
    expect(planRequestSchema.safeParse({ newPlanId: 'enterprise' }).success).toBe(false);
    expect(planRequestSchema.safeParse({ interval: 'week' }).success).toBe(false);
  });
});
