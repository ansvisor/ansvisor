import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { monthsLeft, movedCouponId, movedDiscount } from './plan-coupon-move';

const at = (iso: string) => Date.parse(iso) / 1000;

describe('monthsLeft', () => {
  it('counts the whole months a new discount can run and still end by the old end', () => {
    expect(monthsLeft(at('2026-11-28T12:00:00Z'), at('2027-01-10T00:00:00Z'))).toBe(1);
    expect(monthsLeft(at('2026-11-28T12:00:00Z'), at('2027-02-28T12:00:00Z'))).toBe(3);
    expect(monthsLeft(at('2026-11-28T12:00:00Z'), at('2026-12-20T00:00:00Z'))).toBe(0);
  });

  it('never reaches a renewal on the old end date', () => {
    // Started Oct 10 for 3 months: renewals Nov 10, Dec 10 discounted, Jan 10 not.
    const months = monthsLeft(at('2026-11-15T00:00:00Z'), at('2027-01-10T00:00:00Z'));
    expect(months).toBe(1); // ends Dec 15: Dec 10 discounted, Jan 10 not
  });

  it('keeps every renewal of a coupon that just started', () => {
    // 3 months from Nov 28 ends Feb 28; bought 5 s later, the copy runs 2 months
    // (to Jan 28 + 5 s), so the Dec 28 and Jan 28 renewals stay discounted, Feb 28 doesn't.
    const start = at('2026-11-28T12:00:00Z');
    expect(monthsLeft(start + 5, at('2027-02-28T12:00:00Z'))).toBe(2);
  });

  it('handles month ends', () => {
    expect(monthsLeft(at('2027-01-31T00:00:00Z'), at('2027-02-28T00:00:00Z'))).toBe(1);
  });
});

describe('movedDiscount', () => {
  const stripe = (existing: Record<string, unknown> = {}) => {
    const create = vi.fn(async (params: { id: string }) => params);
    return {
      create,
      api: {
        coupons: {
          retrieve: vi.fn(async (id: string) => {
            if (existing[id]) return existing[id];
            throw { code: 'resource_missing' };
          }),
          create,
        },
      } as unknown as Stripe,
    };
  };
  const discount = (coupon: unknown, end: number | null = null) =>
    ({ id: 'di_1', end, source: { type: 'coupon', coupon } }) as unknown as Stripe.Discount;
  const now = at('2026-11-28T12:00:00Z');

  it('sends a forever coupon as itself', async () => {
    const { api, create } = stripe();
    await expect(
      movedDiscount(api, discount({ id: 'TEKNO', duration: 'forever', valid: true }), now),
    ).resolves.toEqual({ coupon: 'TEKNO' });
    expect(create).not.toHaveBeenCalled();
  });

  it('copies a forever coupon that can no longer be redeemed', async () => {
    const { api, create } = stripe();
    await expect(
      movedDiscount(
        api,
        discount({
          id: 'OLD',
          duration: 'forever',
          valid: false,
          amount_off: 1000,
          currency: 'usd',
        }),
        now,
      ),
    ).resolves.toEqual({ coupon: 'OLD_plan' });
    expect(create).toHaveBeenCalledWith({
      id: 'OLD_plan',
      amount_off: 1000,
      currency: 'usd',
      duration: 'forever',
      metadata: { moved_from: 'OLD' },
    });
  });

  it('reuses a copy made before, keeping its product limit', async () => {
    const { api, create } = stripe({ [movedCouponId('SAVE50', 2)]: { id: 'SAVE50_plan_2m' } });
    await expect(
      movedDiscount(
        api,
        discount(
          { id: 'SAVE50', duration: 'repeating', valid: true, percent_off: 50 },
          at('2027-02-10T00:00:00Z'),
        ),
        now,
      ),
    ).resolves.toEqual({ coupon: 'SAVE50_plan_2m' });
    expect(create).not.toHaveBeenCalled();
  });

  it('drops a coupon whose months end before the next renewal', async () => {
    const { api } = stripe();
    await expect(
      movedDiscount(
        api,
        discount(
          { id: 'SAVE50', duration: 'repeating', valid: true, percent_off: 50 },
          at('2026-12-10T00:00:00Z'),
        ),
        now,
      ),
    ).resolves.toBeNull();
  });

  it('retrieves the coupon when it is not expanded', async () => {
    const { api } = stripe({ TEKNO: { id: 'TEKNO', duration: 'forever', valid: true } });
    await expect(movedDiscount(api, discount('TEKNO'), now)).resolves.toEqual({ coupon: 'TEKNO' });
  });
});
