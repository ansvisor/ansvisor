import type Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { addOnInterval, type AddOnProductRow } from './add-ons';

/**
 * Growth's add-on rows name their Stripe price by lookup key (00546), the
 * same in live and in a sandbox, so no price id is in the repository. The
 * first purchase resolves the key, checks the price against the row, and
 * keeps its id on the row; the webhook's price matching reads it from there.
 */

export type ResolvableRow = Pick<
  AddOnProductRow,
  'id' | 'kind' | 'price_cents' | 'currency' | 'billing' | 'stripe_lookup_key' | 'stripe_price_id'
>;

/** Why a Stripe price doesn't fit its row, or null when it does. */
export function priceMismatch(row: ResolvableRow, price: Stripe.Price): string | null {
  if (!price.active) return 'inactive';
  if (price.unit_amount !== row.price_cents)
    return `amount ${price.unit_amount} ≠ ${row.price_cents}`;
  if (price.currency !== row.currency) return `currency ${price.currency} ≠ ${row.currency}`;
  const interval = addOnInterval(row);
  if ((price.recurring?.interval ?? null) !== interval) {
    return `interval ${price.recurring?.interval ?? 'one-time'} ≠ ${interval ?? 'one-time'}`;
  }
  if (price.metadata?.addon && price.metadata.addon !== row.kind) {
    return `addon ${price.metadata.addon} ≠ ${row.kind}`;
  }
  return null;
}

/**
 * The row's Stripe price id: kept on the row, or found by its lookup key,
 * checked and kept. Null when the key finds no price or one that doesn't
 * fit the row (logged for staff): the add-on is then not sold.
 */
export async function resolveAddOnPrice(
  stripe: Stripe,
  row: ResolvableRow,
): Promise<string | null> {
  if (row.stripe_price_id) return row.stripe_price_id;
  if (!row.stripe_lookup_key) return null;
  const { data } = await stripe.prices.list({
    lookup_keys: [row.stripe_lookup_key],
    active: true,
    limit: 1,
  });
  const price = data[0];
  if (!price) {
    console.error(`[add-ons] No active Stripe price for ${row.stripe_lookup_key}`);
    return null;
  }
  const mismatch = priceMismatch(row, price);
  if (mismatch) {
    console.error(`[add-ons] Stripe price ${price.id} doesn't fit ${row.id}: ${mismatch}`);
    return null;
  }
  // Kept once: a row staff already set keeps theirs.
  const { error } = await supabaseAdmin
    .from('add_on_products')
    .update({ stripe_price_id: price.id })
    .eq('id', row.id)
    .is('stripe_price_id', null);
  if (error) console.error(`[add-ons] Couldn't keep ${row.id}'s price:`, error.message);
  return price.id;
}
