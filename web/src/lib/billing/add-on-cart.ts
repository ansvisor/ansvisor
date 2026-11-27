import type { AddOnItemLike, RecurringAddOnRow } from './add-on-sync';
import { isAddOnPrice, type PriceLike } from './add-ons';
import { slotPlatform, slotPlatformFromStripe } from '@/config/tracking-slots';

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

// ─── Tracking slots (00564) ─────────────────────────────────────────────────

/**
 * The platform a slots item is for: its catalog row's, else its price's
 * `platform` metadata (the platform id, or its Stripe form chatgpt_web).
 */
export function slotItemPlatform(
  row: Pick<RecurringAddOnRow, 'platform'> | undefined,
  price: PriceLike,
): string | null {
  if (row?.platform) return row.platform;
  const named = price.metadata?.platform ?? '';
  return (slotPlatform(named) ?? slotPlatformFromStripe(named))?.id ?? null;
}

/** The plans that keep tracking slots: Growth and Enterprise. */
export const SLOT_ADD_ON_PLANS: readonly string[] = ['growth', 'enterprise'];

/** The subscription's slot items, by platform, with their units (quantity). */
export function currentSlotItems(
  items: readonly CartItem[],
  catalog: readonly RecurringAddOnRow[],
): Map<string, { item: CartItem; units: number }> {
  const slots = new Map<string, { item: CartItem; units: number }>();
  for (const item of items) {
    const price = item.price;
    if (!price || typeof price === 'string' || !isAddOnPrice(price)) continue;
    const row = rowOf(item, catalog);
    if ((row?.kind ?? price.metadata?.addon) !== 'slots') continue;
    const platform = slotItemPlatform(row, price);
    if (!platform || slots.has(platform)) continue;
    slots.set(platform, { item, units: item.quantity ?? 1 });
  }
  return slots;
}

/** A platform's slots as the cart wants them: its price on the plan's period and how many units. */
export interface SlotTarget {
  priceId: string;
  units: number;
}

/**
 * The item changes that take the slot items to `target` (units per
 * platform; a platform left out or at 0 has none), each slot item kept
 * carrying the volume discount coupon (none when null). The coupon sits on
 * the slot items alone, never on the subscription, so a plan's coupon and
 * the volume discount don't mix. Nothing when no platform's units change.
 */
export function slotItemChanges(
  current: ReadonlyMap<string, { item: CartItem; units: number }>,
  target: ReadonlyMap<string, SlotTarget>,
  couponId: string | null,
): Record<string, unknown>[] {
  const want = new Map([...target].filter(([, t]) => t.units > 0));
  const same =
    want.size === current.size &&
    [...want].every(([platform, t]) => current.get(platform)?.units === t.units);
  if (same) return [];
  const discounts = couponId ? [{ coupon: couponId }] : ('' as const);
  const changes: Record<string, unknown>[] = [];
  for (const [platform, { item }] of current) {
    const t = want.get(platform);
    if (!t) changes.push({ id: item.id, deleted: true });
    else if (priceIdOf(item) !== t.priceId) {
      changes.push({ id: item.id, price: t.priceId, quantity: t.units, discounts });
    } else changes.push({ id: item.id, quantity: t.units, discounts });
  }
  for (const [platform, t] of want) {
    if (!current.has(platform)) changes.push({ price: t.priceId, quantity: t.units, discounts });
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
 * The add-ons through a plan change: kept on Growth (on the new interval's
 * price, the same tier or the brand), ended on any other plan. Tracking
 * slots are kept on Growth and Enterprise (00564), on the same platform's
 * price for the new interval; their item keeps its volume discount, whose
 * rate is the same on either interval.
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
    const row = rowOf(item, catalog) as PeriodRow | undefined;
    const kind =
      row?.kind ??
      (item.price as { metadata?: Record<string, string> | null } | null)?.metadata?.addon;
    const keeps =
      kind === 'slots' ? SLOT_ADD_ON_PLANS.includes(target.planId) : target.planId === 'growth';
    if (!keeps) {
      result.removals.push(item.id);
      continue;
    }
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
            (r.platform ?? null) === (row.platform ?? null) &&
            r.active &&
            intervalOf(r) === target.interval,
        )
      : undefined;
    if (counterpart) result.swaps.push({ itemId: item.id, row: counterpart });
    else result.missing.push(item.id);
  }
  return result;
}
