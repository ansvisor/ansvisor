import { z } from 'zod';
import { PLANS, SUBSCRIBABLE_PLANS, type PlanId } from '@/config/plans';

/** How often a subscription bills, as Stripe's `recurring.interval` names it. */
export type BillingInterval = 'month' | 'year';

/**
 * The first-month offer: a Stripe promotion code for a 50% off, once-only
 * coupon on Starter and Growth. Billing fills it in when a trial is bought
 * monthly; Checkout takes it in its own promotion code box.
 */
export const FIRST_MONTH_CODE = 'SAVE50';

/** A plan's price for one billing period, from the config; null when it has none. */
export function periodPrice(planId: PlanId, interval: BillingInterval): number | null {
  const pricing = PLANS[planId].pricing;
  if (!pricing) return null;
  return interval === 'year' ? (pricing.annual ?? null) : pricing.monthly;
}

/** What paying a year up front saves against twelve months, in whole percent. */
export function annualSaving(planId: PlanId): number | null {
  const pricing = PLANS[planId].pricing;
  if (!pricing?.annual) return null;
  return Math.round((1 - pricing.annual / (pricing.monthly * 12)) * 100);
}

/** PATCH /api/stripe/subscription's body. */
export const planRequestSchema = z.object({
  newPlanId: z.enum(['starter', 'growth']).optional(),
  interval: z.enum(['month', 'year']).optional(),
  reactivate: z.boolean().optional(),
  /** End a free trial today on the chosen plan and period; the card on file pays at once. */
  buyNow: z.boolean().optional(),
  promoCode: z.string().trim().max(64).optional(),
});

export type PlanRequest = z.infer<typeof planRequestSchema>;

export type PlanChange =
  | { kind: 'buy_now'; planId: PlanId; interval: BillingInterval; promoCode: string | null }
  | { kind: 'change'; planId: PlanId; interval: BillingInterval }
  | { kind: 'refused'; error: string };

/**
 * What a plan request asks of the organization's subscription.
 *
 *  - buy now: only while it's trialing. The trial ends today on the plan and
 *    period asked for (any of them: a Starter trial can buy Growth, or a
 *    year), and the card added for the trial pays the first period at once.
 *    A promotion code only goes with a monthly plan: a year up front has its
 *    own discount.
 *  - change: another plan or period on the same subscription, prorated. A
 *    trial carries on through it.
 */
export function planChange(
  current: { status: string; planId: string; interval: BillingInterval | null },
  request: Pick<PlanRequest, 'newPlanId' | 'interval' | 'buyNow' | 'promoCode'>,
): PlanChange {
  const planId = (request.newPlanId ?? current.planId) as PlanId;
  const interval = request.interval ?? current.interval ?? 'month';
  if (!SUBSCRIBABLE_PLANS.includes(planId)) return { kind: 'refused', error: 'Invalid plan' };

  if (request.buyNow) {
    if (current.status !== 'trialing') {
      return { kind: 'refused', error: 'Only a free trial can be bought now' };
    }
    const promoCode = interval === 'month' ? request.promoCode || null : null;
    return { kind: 'buy_now', planId, interval, promoCode };
  }

  if (planId === current.planId && interval === (current.interval ?? 'month')) {
    return { kind: 'refused', error: 'Already on this plan' };
  }
  return { kind: 'change', planId, interval };
}
