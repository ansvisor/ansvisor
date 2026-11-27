// @vitest-environment node
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { couponMismatch, ensureSlotCoupon, slotCouponId } from './slot-coupon';

/** One shared coupon per slots discount rate, made the first time (00564). Stripe is mocked. */

const PRODUCT = 'prod_slots';

const coupon = (over: Partial<Stripe.Coupon> = {}) =>
  ({
    id: 'addon_slots_off_0725',
    valid: true,
    percent_off: 7.25,
    duration: 'forever',
    applies_to: { products: [PRODUCT] },
    ...over,
  }) as unknown as Stripe.Coupon;

const stripeError = (code: string) => Object.assign(new Error(code), { code });

const retrieve = vi.fn();
const create = vi.fn();
const stripe = { coupons: { retrieve, create } } as unknown as Stripe;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('slotCouponId', () => {
  it('names the rate in basis points', () => {
    expect(slotCouponId(7.25)).toBe('addon_slots_off_0725');
    expect(slotCouponId(20)).toBe('addon_slots_off_2000');
    expect(slotCouponId(1.66)).toBe('addon_slots_off_0166');
  });

  it('refuses a rate that is no discount', () => {
    expect(() => slotCouponId(0)).toThrow();
    expect(() => slotCouponId(101)).toThrow();
  });
});

describe('couponMismatch', () => {
  it('accepts the rate on the slots product, forever', () => {
    expect(couponMismatch(coupon(), 7.25, PRODUCT)).toBeNull();
  });

  it('names what is off', () => {
    expect(couponMismatch(coupon({ percent_off: 7 }), 7.25, PRODUCT)).toMatch(/percent_off/);
    expect(couponMismatch(coupon({ duration: 'once' }), 7.25, PRODUCT)).toMatch(/duration/);
    expect(couponMismatch(coupon({ applies_to: undefined }), 7.25, PRODUCT)).toMatch(/everything/);
    expect(couponMismatch(coupon({ valid: false }), 7.25, PRODUCT)).toBe('not valid');
  });
});

describe('ensureSlotCoupon', () => {
  it('needs no coupon without a discount', async () => {
    expect(await ensureSlotCoupon(stripe, 0, PRODUCT)).toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('uses the coupon that is there', async () => {
    retrieve.mockResolvedValue(coupon());
    expect(await ensureSlotCoupon(stripe, 7.25, PRODUCT)).toBe('addon_slots_off_0725');
    expect(retrieve).toHaveBeenCalledWith('addon_slots_off_0725', { expand: ['applies_to'] });
    expect(create).not.toHaveBeenCalled();
  });

  it('makes it the first time, for the slots product only', async () => {
    retrieve.mockRejectedValue(stripeError('resource_missing'));
    create.mockResolvedValue(coupon());
    expect(await ensureSlotCoupon(stripe, 7.25, PRODUCT)).toBe('addon_slots_off_0725');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'addon_slots_off_0725',
        percent_off: 7.25,
        duration: 'forever',
        applies_to: { products: [PRODUCT] },
      }),
    );
  });

  it('uses the one another cart made at the same time', async () => {
    retrieve.mockRejectedValueOnce(stripeError('resource_missing')).mockResolvedValueOnce(coupon());
    create.mockRejectedValue(stripeError('resource_already_exists'));
    expect(await ensureSlotCoupon(stripe, 7.25, PRODUCT)).toBe('addon_slots_off_0725');
  });

  it('refuses a coupon with that id that gives something else', async () => {
    retrieve.mockResolvedValue(coupon({ percent_off: 50 }));
    await expect(ensureSlotCoupon(stripe, 7.25, PRODUCT)).rejects.toThrow(/doesn't fit/);
  });

  it('passes on any other Stripe error', async () => {
    retrieve.mockRejectedValue(stripeError('api_error'));
    await expect(ensureSlotCoupon(stripe, 7.25, PRODUCT)).rejects.toThrow('api_error');
  });
});
