/**
 * The volume discount on bought tracking slots (00564). It is marginal: each
 * step's rate applies only to the part of the monthly list price above that
 * step, so buying more never costs less. Yearly prices are ten months, and
 * their steps are read on a month (the yearly price ÷ 10). Pure.
 *
 * Stripe takes it as one `percent_off` coupon on the slot items: the
 * effective rate, rounded down to two decimals so the discount is never more
 * than the steps give.
 */

/** A step: from this monthly list price (in cents) up, the rate on the part above it. */
export interface SlotDiscountStep {
  fromCents: number;
  percent: number;
}

/** $0–500 0%, $500–1k 5%, $1k–2k 10%, $2k–4k 15%, above $4k 20%. */
export const SLOT_DISCOUNT_STEPS: readonly SlotDiscountStep[] = Object.freeze([
  { fromCents: 0, percent: 0 },
  { fromCents: 50_000, percent: 5 },
  { fromCents: 100_000, percent: 10 },
  { fromCents: 200_000, percent: 15 },
  { fromCents: 400_000, percent: 20 },
]);

export type SlotInterval = 'month' | 'year';

const MONTHS: Record<SlotInterval, number> = { month: 1, year: 10 };

/** The marginal discount on a monthly list price, in cents (not rounded). */
function marginalCents(monthlyCents: number): number {
  let off = 0;
  SLOT_DISCOUNT_STEPS.forEach((step, i) => {
    const next = SLOT_DISCOUNT_STEPS[i + 1]?.fromCents ?? Infinity;
    const part = Math.min(monthlyCents, next) - step.fromCents;
    if (part > 0) off += (part * step.percent) / 100;
  });
  return off;
}

/** The discount on a slots list price for one billing period. */
export interface SlotDiscount {
  /** The slots' list price for the period, in cents. */
  listCents: number;
  /** The coupon's rate: the effective rate, rounded down to two decimals; 0 for none. */
  percentOff: number;
  /** What the rate takes off the period's list price, in cents. */
  discountCents: number;
  /** The step reached: its rate applies to the part above it. */
  step: SlotDiscountStep;
  /** The next step and the list price still to go before it, per period; null at the top. */
  next: { step: SlotDiscountStep; remainingCents: number } | null;
}

/** The volume discount on `listCents` of slots billed per `interval`. */
export function slotDiscount(listCents: number, interval: SlotInterval): SlotDiscount {
  const months = MONTHS[interval];
  const list = Math.max(0, Math.round(listCents));
  const monthly = list / months;
  const exact = marginalCents(monthly) * months;
  // Floor on the integer basis points, nudged so 5.25 isn't read as 5.2499….
  const percentOff = list > 0 ? Math.floor((exact / list) * 10_000 + 1e-9) / 100 : 0;
  const reached = SLOT_DISCOUNT_STEPS.filter((s) => monthly >= s.fromCents);
  const step = reached[reached.length - 1] ?? SLOT_DISCOUNT_STEPS[0];
  const upcoming = SLOT_DISCOUNT_STEPS.find((s) => s.fromCents > monthly);
  return {
    listCents: list,
    percentOff,
    discountCents: Math.round((list * percentOff) / 100),
    step,
    next: upcoming
      ? { step: upcoming, remainingCents: Math.ceil((upcoming.fromCents - monthly) * months) }
      : null,
  };
}
