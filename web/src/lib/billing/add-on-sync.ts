import type Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isSubscriptionActive } from '@/config/plans';
import { isAddOnPrice, loadStripe, type PriceLike } from './add-ons';

/**
 * Growth's recurring add-ons (00546) live as items on the plan's Stripe
 * subscription: one extra tracking tier, and extra brands by quantity. The
 * organization keeps what they add (add_on_prompts, add_on_brands), and the
 * plan's limits read it (plan-row.ts). Stripe is the truth: each sync reads
 * the subscription afresh and writes the whole state, so the order and the
 * repeats of Stripe's events don't matter.
 */

/** A catalog row the sync reads: what one unit of a recurring add-on adds. */
export interface RecurringAddOnRow {
  kind: 'tracking' | 'brand';
  stripe_price_id: string | null;
  stripe_lookup_key: string | null;
  grant_prompts: number | null;
  grant_brands: number | null;
}

/** A subscription item as the sync reads it. */
export interface AddOnItemLike {
  quantity?: number | null;
  price?: (PriceLike & { id?: string }) | string | null;
}

export interface AddOnTotals {
  prompts: number;
  brands: number;
}

const positive = (value: unknown) => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0;
};

/**
 * What a subscription's add-on items add. The catalog row (by lookup key,
 * or by its resolved price id) says what a unit adds; a price the catalog
 * doesn't know, staff's own in Stripe, falls back on its `addon` / `units`
 * metadata. Items that aren't add-ons (the plan, CHAT-18's storage) add
 * nothing.
 */
export function addOnTotals(
  items: readonly AddOnItemLike[],
  catalog: readonly RecurringAddOnRow[],
): AddOnTotals {
  const totals: AddOnTotals = { prompts: 0, brands: 0 };
  for (const item of items) {
    const price = item.price;
    if (!price || typeof price === 'string' || !isAddOnPrice(price)) continue;
    const quantity = item.quantity == null ? 1 : positive(item.quantity);
    const row = catalog.find(
      (r) =>
        (!!r.stripe_lookup_key && r.stripe_lookup_key === price.lookup_key) ||
        (!!r.stripe_price_id && r.stripe_price_id === price.id),
    );
    const kind = row?.kind ?? price.metadata?.addon;
    if (kind === 'tracking') {
      totals.prompts += quantity * positive(row?.grant_prompts ?? price.metadata?.units);
    } else if (kind === 'brand') {
      totals.brands += quantity * (row ? positive(row.grant_brands) : 1);
    }
  }
  return totals;
}

/**
 * Writes what a subscription's add-ons add on the organization it belongs
 * to (the one whose stripe_subscription_id it is: an older, ended
 * subscription never touches a newer one). A subscription that isn't active
 * or in trial adds nothing. Throws on a failed read or write, so Stripe
 * sends the event again.
 */
export async function syncAddOns(subscriptionId: string): Promise<void> {
  const stripe = await loadStripe();
  if (!stripe) throw new Error('Stripe is not configured');
  const subscription: Stripe.Subscription = await stripe.subscriptions.retrieve(subscriptionId);

  let totals: AddOnTotals = { prompts: 0, brands: 0 };
  if (isSubscriptionActive(subscription.status)) {
    const { data: catalog, error } = await supabaseAdmin
      .from('add_on_products')
      .select('kind, stripe_price_id, stripe_lookup_key, grant_prompts, grant_brands')
      .in('kind', ['tracking', 'brand']);
    if (error) throw new Error(error.message);
    totals = addOnTotals(
      subscription.items.data as AddOnItemLike[],
      (catalog ?? []) as RecurringAddOnRow[],
    );
  }

  const { error } = await supabaseAdmin
    .from('organizations')
    .update({ add_on_prompts: totals.prompts, add_on_brands: totals.brands })
    .eq('stripe_subscription_id', subscription.id);
  if (error) throw new Error(error.message);
}
