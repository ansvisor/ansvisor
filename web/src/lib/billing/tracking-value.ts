import { slotDiscount } from '@/lib/billing/slot-discount';
import type { PlanAddOnsView } from '@/lib/actions/plan-add-ons';

/**
 * What a workspace's tracking gives for its price, shown on Settings ›
 * Billing: answers a month (one per slot per day) and the price of 1,000 of
 * them. The price is the plan's and the slots' (after the volume discount),
 * nothing else: brands and AI usage aren't answers. Pure.
 */

/** A month of answers: each slot is checked once a day. */
export const DAYS_PER_MONTH = 30;

/** Slot units per platform, as the Billing cart picks them. */
export type SlotUnitsPick = Record<string, number>;

export interface TrackingValue {
  /** Slots checked each day, over every platform. */
  slotsPerDay: number;
  /** Answers a month, at most: slots a day × 30. */
  answersPerMonth: number;
  /** The plan and slots price of 1,000 answers, in cents (rounded). */
  centsPer1000: number;
}

/**
 * The value of the plan with `units` slot units per platform (what the
 * subscription holds when left out). Null when it can't be told honestly:
 * no slots on sale, no plan price, a platform with no limit, or a retired
 * tracking tier, whose prompts aren't counted in slots.
 */
export function trackingValue(
  view: Pick<PlanAddOnsView, 'slots' | 'planPriceCents' | 'interval' | 'current'>,
  units?: SlotUnitsPick,
): TrackingValue | null {
  const { slots, planPriceCents, interval } = view;
  if (!slots || planPriceCents == null || view.current.trackingUnits > 0) return null;
  if (slots.platforms.some((p) => p.included < 0)) return null;

  const picked = (id: string, held: number) => units?.[id] ?? held;
  const slotsPerDay = slots.platforms.reduce(
    (sum, p) => sum + p.included + picked(p.id, p.units) * p.unitSlots,
    0,
  );
  if (slotsPerDay <= 0) return null;

  const listCents = slots.platforms.reduce(
    (sum, p) => sum + p.unitCents * picked(p.id, p.units),
    0,
  );
  const discount = slotDiscount(listCents, interval);
  const periodCents = planPriceCents + listCents - discount.discountCents;
  const answersPerMonth = slotsPerDay * DAYS_PER_MONTH;
  const months = interval === 'year' ? 12 : 1;
  return {
    slotsPerDay,
    answersPerMonth,
    centsPer1000: Math.round((periodCents / (answersPerMonth * months)) * 1000),
  };
}
