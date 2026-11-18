import type { AddOnItemLike, RecurringAddOnRow } from './add-on-sync';
import { isAddOnPrice } from './add-ons';

/**
 * What changes on the plan's Stripe subscription when a Growth workspace
 * picks its add-ons (00546): one extra tracking tier, and extra brands by
 * quantity. Pure: the actions read the subscription and the catalog, and
 * send what this answers.
 */

/** A subscription item as the cart reads it. */
export type CartItem = AddOnItemLike & { id: string };

/** The subscription's add-on items now. */
export interface CurrentAddOns {
  tracking: { item: CartItem; units: number } | null;
  brands: { item: CartItem; quantity: number } | null;
}

/** What the workspace picked: the tier's price (null for none) and how many extra brands. */
export interface AddOnTarget {
  trackingPriceId: string | null;
  brandPriceId: string;
  extraBrands: number;
}

/** One change to the subscription's items, as Stripe's update takes it. */
export type ItemChange =
  | { price: string; quantity?: number }
  | { id: string; price: string }
  | { id: string; quantity: number }
  | { id: string; deleted: true };

const priceIdOf = (item: AddOnItemLike) =>
  typeof item.price === 'string' ? item.price : (item.price?.id ?? null);

const rowOf = (item: AddOnItemLike, catalog: readonly RecurringAddOnRow[]) => {
  const price = item.price;
  if (!price || typeof price === 'string') return undefined;
  return catalog.find(
    (r) =>
      (!!r.stripe_lookup_key && r.stripe_lookup_key === price.lookup_key) ||
      (!!r.stripe_price_id && r.stripe_price_id === price.id),
  );
};

/** The subscription's tracking and brand items: the first of each (one of each is all a cart makes). */
export function currentAddOns(
  items: readonly CartItem[],
  catalog: readonly RecurringAddOnRow[],
): CurrentAddOns {
  const current: CurrentAddOns = { tracking: null, brands: null };
  for (const item of items) {
    if (!isAddOnPrice(typeof item.price === 'string' ? null : item.price)) continue;
    const row = rowOf(item, catalog);
    const kind =
      row?.kind ?? (typeof item.price === 'string' ? undefined : item.price?.metadata?.addon);
    if (kind === 'tracking' && !current.tracking) {
      const units =
        row?.grant_prompts ??
        Number((typeof item.price === 'string' ? null : item.price?.metadata?.units) ?? 0);
      current.tracking = { item, units: Number.isInteger(units) && units > 0 ? units : 0 };
    } else if (kind === 'brand' && !current.brands) {
      current.brands = { item, quantity: item.quantity ?? 1 };
    }
  }
  return current;
}

/**
 * The item changes that take the subscription from `current` to `target`:
 * a tier added, swapped (the same item, a new price) or removed; brands
 * added, set to a new quantity or removed at 0. Nothing when nothing changes.
 */
export function itemChanges(current: CurrentAddOns, target: AddOnTarget): ItemChange[] {
  const changes: ItemChange[] = [];
  const tier = current.tracking;
  if (target.trackingPriceId && !tier) {
    changes.push({ price: target.trackingPriceId });
  } else if (target.trackingPriceId && tier && priceIdOf(tier.item) !== target.trackingPriceId) {
    changes.push({ id: tier.item.id, price: target.trackingPriceId });
  } else if (!target.trackingPriceId && tier) {
    changes.push({ id: tier.item.id, deleted: true });
  }

  const brands = current.brands;
  if (target.extraBrands > 0 && !brands) {
    changes.push({ price: target.brandPriceId, quantity: target.extraBrands });
  } else if (target.extraBrands > 0 && brands && brands.quantity !== target.extraBrands) {
    changes.push({ id: brands.item.id, quantity: target.extraBrands });
  } else if (target.extraBrands === 0 && brands) {
    changes.push({ id: brands.item.id, deleted: true });
  }
  return changes;
}

/** A catalog row as a plan change reads it: which tier or brand price, on which interval. */
export type PeriodRow = RecurringAddOnRow & {
  id: string;
  billing: 'monthly' | 'yearly' | 'one_time';
  active: boolean;
};

/** What a plan change does to the subscription's Growth add-on items. */
export interface PlanChangeAddOns {
  /** Items that end with the plan (Growth → Starter): unused time is credited. */
  removals: string[];
  /** Items that move to the other interval's price (monthly ↔ yearly). */
  swaps: { itemId: string; row: PeriodRow }[];
  /** Items with no price on the new interval: the change can't go ahead. */
  missing: string[];
}

/**
 * The Growth add-ons through a plan change: kept on Growth (on the new
 * interval's price, the same tier or the brand), ended on any other plan.
 */
export function addOnsThroughPlanChange(
  items: readonly CartItem[],
  catalog: readonly PeriodRow[],
  target: { planId: string; interval: 'month' | 'year' },
): PlanChangeAddOns {
  const result: PlanChangeAddOns = { removals: [], swaps: [], missing: [] };
  const intervalOf = (row: PeriodRow) =>
    row.billing === 'monthly' ? 'month' : row.billing === 'yearly' ? 'year' : null;
  for (const item of items) {
    if (!isAddOnPrice(typeof item.price === 'string' ? null : item.price)) continue;
    if (target.planId !== 'growth') {
      result.removals.push(item.id);
      continue;
    }
    const row = rowOf(item, catalog) as PeriodRow | undefined;
    const price = item.price as { recurring?: { interval?: string } | null } | null | undefined;
    // Already on the new interval (a staff price the catalog doesn't hold too).
    if (
      row ? intervalOf(row) === target.interval : price?.recurring?.interval === target.interval
    ) {
      continue;
    }
    const counterpart = row
      ? catalog.find(
          (r) =>
            r.kind === row.kind &&
            r.grant_prompts === row.grant_prompts &&
            r.active &&
            intervalOf(r) === target.interval,
        )
      : undefined;
    if (counterpart) result.swaps.push({ itemId: item.id, row: counterpart });
    else result.missing.push(item.id);
  }
  return result;
}
