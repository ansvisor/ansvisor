import type Stripe from 'stripe';

/**
 * The Stripe coupon that carries the slots volume discount (00564). There is
 * one per rate, with a fixed id, shared by every subscription at that rate:
 * the cart finds it, or makes it the first time, and puts it on the slot
 * items only, so a plan coupon and the volume discount never mix. It applies
 * to the slots product alone and lasts as long as the items keep it.
 */

/** The coupon id for a rate: `addon_slots_off_0725` is 7.25%. */
export function slotCouponId(percentOff: number): string {
  const basisPoints = Math.round(percentOff * 100);
  if (!Number.isInteger(basisPoints) || basisPoints <= 0 || basisPoints > 10_000) {
    throw new Error(`Not a slots discount rate: ${percentOff}`);
  }
  return `addon_slots_off_${String(basisPoints).padStart(4, '0')}`;
}

/** Why a coupon can't carry this rate on this product, or null when it can. */
export function couponMismatch(
  coupon: Stripe.Coupon,
  percentOff: number,
  productId: string,
): string | null {
  if (!coupon.valid) return 'not valid';
  if (coupon.percent_off !== percentOff) return `percent_off ${coupon.percent_off} ≠ ${percentOff}`;
  if (coupon.duration !== 'forever') return `duration ${coupon.duration}`;
  const products = coupon.applies_to?.products ?? [];
  if (products.length !== 1 || products[0] !== productId) {
    return `applies to ${products.join(', ') || 'everything'}, not ${productId}`;
  }
  return null;
}

const stripeCode = (err: unknown) =>
  err && typeof err === 'object' && 'code' in err ? (err as { code?: unknown }).code : undefined;

async function retrieve(stripe: Stripe, id: string): Promise<Stripe.Coupon | null> {
  try {
    return await stripe.coupons.retrieve(id, { expand: ['applies_to'] });
  } catch (err) {
    if (stripeCode(err) === 'resource_missing') return null;
    throw err;
  }
}

function checked(coupon: Stripe.Coupon, percentOff: number, productId: string): string {
  const mismatch = couponMismatch(coupon, percentOff, productId);
  if (mismatch) {
    // Never sell at a rate the coupon doesn't give: staff fix or delete it.
    console.error(`[add-ons] Stripe coupon ${coupon.id} doesn't fit: ${mismatch}`);
    throw new Error(`The slots discount coupon ${coupon.id} doesn't fit (${mismatch}).`);
  }
  return coupon.id;
}

/**
 * The coupon id for `percentOff` on the slots product (`productId`, from the
 * slot prices), made the first time. Null when there is no discount. Safe to
 * call again, and when two carts make it at once. Throws when a coupon with
 * that id exists but gives something else.
 */
export async function ensureSlotCoupon(
  stripe: Stripe,
  percentOff: number,
  productId: string,
): Promise<string | null> {
  if (percentOff <= 0) return null;
  const id = slotCouponId(percentOff);
  const found = await retrieve(stripe, id);
  if (found) return checked(found, percentOff, productId);
  try {
    const made = await stripe.coupons.create({
      id,
      name: `Tracking slots volume discount ${percentOff}%`,
      percent_off: percentOff,
      duration: 'forever',
      applies_to: { products: [productId] },
      metadata: { addon: 'slots' },
    });
    return made.id;
  } catch (err) {
    if (stripeCode(err) !== 'resource_already_exists') throw err;
    const raced = await retrieve(stripe, id);
    if (!raced) throw err;
    return checked(raced, percentOff, productId);
  }
}
