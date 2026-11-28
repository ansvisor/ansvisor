import type Stripe from 'stripe';

/**
 * Moving a subscription's own discount (a coupon from the plan's checkout,
 * e.g. SAVE50) onto the plan's item once the subscription holds add-ons, so
 * it keeps discounting the plan alone (plan-add-ons.ts).
 *
 * Stripe can't move a discount (`di_…`) onto an item: an item only takes a
 * discount it already has. So the plan's item gets a new discount from a
 * coupon instead. A coupon that runs for some months would start again from
 * today, so it gets a copy that runs only for the whole months left: the
 * renewals the old discount would still have reached, never one more. The
 * copy keeps the coupon's name, so the invoice reads the same.
 */

/** What the plan's item is sent for a moved discount. */
export type MovedDiscount = { coupon: string };

/** The months from `from` to `months` later, in UTC: the date Stripe counts a coupon's months to. */
function addMonths(from: Date, months: number): Date {
  const date = new Date(from.getTime());
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date;
}

/**
 * The whole months a new discount can run from `nowSec` and still end by
 * `endSec`: the most N with now + N months ≤ end. A renewal on the old end
 * date isn't discounted, so neither is it after the move. Pure.
 */
export function monthsLeft(nowSec: number, endSec: number): number {
  const now = new Date(nowSec * 1000);
  let months = 0;
  while (addMonths(now, months + 1).getTime() <= endSec * 1000) months += 1;
  return months;
}

/** The id of the copy of `couponId` that runs `months` months (or forever, when null). */
export function movedCouponId(couponId: string, months: number | null): string {
  return months == null ? `${couponId}_plan` : `${couponId}_plan_${months}m`;
}

const stripeCode = (err: unknown) =>
  err && typeof err === 'object' && 'code' in err ? (err as { code?: unknown }).code : undefined;

async function retrieveCoupon(stripe: Stripe, id: string): Promise<Stripe.Coupon | null> {
  try {
    return await stripe.coupons.retrieve(id, { expand: ['applies_to'] });
  } catch (err) {
    if (stripeCode(err) === 'resource_missing') return null;
    throw err;
  }
}

/** The copy of `coupon` with this duration, found or made; safe when two carts make it at once. */
async function ensureCopy(
  stripe: Stripe,
  coupon: Stripe.Coupon,
  months: number | null,
): Promise<string> {
  const id = movedCouponId(coupon.id, months);
  if (await retrieveCoupon(stripe, id)) return id;
  const products = coupon.applies_to?.products ?? [];
  try {
    await stripe.coupons.create({
      id,
      ...(coupon.name ? { name: coupon.name } : {}),
      ...(coupon.percent_off != null
        ? { percent_off: coupon.percent_off }
        : { amount_off: coupon.amount_off ?? 0, currency: coupon.currency ?? 'usd' }),
      ...(months == null
        ? { duration: coupon.duration === 'once' ? 'once' : 'forever' }
        : { duration: 'repeating', duration_in_months: months }),
      ...(products.length ? { applies_to: { products } } : {}),
      metadata: { moved_from: coupon.id },
    });
  } catch (err) {
    if (stripeCode(err) !== 'resource_already_exists') throw err;
  }
  return id;
}

/**
 * What the plan's item is sent for one of the subscription's discounts, or
 * null when nothing is left of it (a coupon whose months end before the next
 * renewal). Needs the discount with its coupon expanded
 * (`discounts.source.coupon`), or retrieves the coupon.
 */
export async function movedDiscount(
  stripe: Stripe,
  discount: Stripe.Discount,
  nowSec: number,
): Promise<MovedDiscount | null> {
  const source = discount.source?.coupon;
  if (!source) return null;
  const coupon =
    typeof source === 'string' ? await retrieveCoupon(stripe, source) : (source as Stripe.Coupon);
  if (!coupon) return null;

  if (coupon.duration === 'repeating' && discount.end != null) {
    const months = monthsLeft(nowSec, discount.end);
    return months > 0 ? { coupon: await ensureCopy(stripe, coupon, months) } : null;
  }
  // Forever (or once, not used yet): the coupon itself, while it can still be redeemed.
  if (coupon.valid) return { coupon: coupon.id };
  return { coupon: await ensureCopy(stripe, coupon, null) };
}
