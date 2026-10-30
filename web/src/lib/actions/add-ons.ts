'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { stripe } from '@/lib/stripe';
import { isCloud } from '@/config/plans';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import {
  ADD_ON_PRODUCT_COLUMNS,
  ADD_ON_PURCHASE_KEY,
  addOnOnSale,
  planItemOf,
  type AddOnProductRow,
} from '@/lib/billing/add-ons';

/**
 * Buying an add-on pack (CHAT-18 §C–E), behind CHAT_AGENTIC: an Admin of a
 * workspace on a paid, active plan picks a pack, and
 *   - AI credits open a Stripe Checkout (one payment; its invoice has the
 *     pack's line), whose page the browser goes to;
 *   - storage is added to the plan's subscription as a monthly item,
 *     prorated for this period and charged to the card on file at once.
 * Either way a purchase row waits as pending, and only the Stripe webhook
 * grants the pack once it is paid (lib/billing/add-on-webhook.ts): a return
 * from Checkout grants nothing. Chat never starts a purchase.
 *
 * Never throws (#1777): every refusal is a reason the page can word.
 *   - chat_off: Chat is off for the workspace; no pack is on sale.
 *   - admin_only: billing is the Admins' (CHAT-20 §4); others ask one.
 *   - trial: the free trial can't buy packs ("Choose a plan").
 *   - no_plan: the plan isn't active (ended, past due).
 *   - unavailable: the pack isn't on sale here (no Stripe price on this
 *     deployment, switched off), or storage on a plan it can't join (one
 *     billed yearly, or without a Stripe subscription).
 *   - payment_failed: the card on file was declined for storage; `message`
 *     is Stripe's, for the page to show.
 *   - failed: anything else (Stripe or the database didn't answer).
 */

export type AddOnPurchaseFailure =
  | 'chat_off'
  | 'admin_only'
  | 'trial'
  | 'no_plan'
  | 'unavailable'
  | 'payment_failed'
  | 'failed';

export type AddOnPurchaseStart =
  /** AI credits: the browser goes on to Stripe Checkout. */
  | { ok: true; next: 'checkout'; url: string }
  /** Storage: added to the plan; it counts once the webhook hears it was paid. */
  | { ok: true; next: 'added' }
  | { ok: false; failure: AddOnPurchaseFailure; message?: string };

const productIdSchema = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);

const refuse = (failure: AddOnPurchaseFailure, message?: string): AddOnPurchaseStart => ({
  ok: false,
  failure,
  ...(message ? { message } : {}),
});

/** Starts buying the pack `productId`. See above for what it answers. */
export async function startAddOnPurchase(productId: string): Promise<AddOnPurchaseStart> {
  try {
    return await start(productId);
  } catch (err) {
    console.error('[add-ons] Purchase start failed:', err);
    return refuse('failed');
  }
}

interface Buyer {
  userId: string;
  email: string | null;
  organizationId: string;
  customerId: string | null;
  subscriptionId: string | null;
}

async function start(productId: unknown): Promise<AddOnPurchaseStart> {
  const parsed = productIdSchema.safeParse(productId);
  if (!parsed.success) return refuse('unavailable');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return refuse('failed');

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .maybeSingle();
  const organizationId = profile?.organization_id as string | undefined;
  if (!organizationId || !chatAgenticEnabled(organizationId)) return refuse('chat_off');
  if (profile?.role !== 'admin') return refuse('admin_only');
  if (!isCloud()) return refuse('unavailable');

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('subscription_status, stripe_customer_id, stripe_subscription_id')
    .eq('id', organizationId)
    .maybeSingle();
  if (org?.subscription_status === 'trialing') return refuse('trial');
  if (org?.subscription_status !== 'active') return refuse('no_plan');

  const { data: product } = await supabaseAdmin
    .from('add_on_products')
    .select(ADD_ON_PRODUCT_COLUMNS)
    .eq('id', parsed.data)
    .maybeSingle();
  if (!product || !addOnOnSale(product as AddOnProductRow)) return refuse('unavailable');

  const buyer: Buyer = {
    userId: user.id,
    email: user.email ?? null,
    organizationId,
    customerId: (org.stripe_customer_id as string | null) ?? null,
    subscriptionId: (org.stripe_subscription_id as string | null) ?? null,
  };
  const pack = product as AddOnProductRow;
  return pack.kind === 'ai' ? startAiCheckout(buyer, pack) : addStorageItem(buyer, pack);
}

/** The purchase's row, pending until the webhook hears it was paid. */
async function newPurchase(buyer: Buyer, pack: AddOnProductRow): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('add_on_purchases')
    .insert({
      organization_id: buyer.organizationId,
      product_id: pack.id,
      bought_by: buyer.userId,
      status: 'pending',
      currency: pack.currency,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Purchase not written');
  return data.id as string;
}

/** What every Stripe object of the purchase carries, for the webhook to find it by. */
const metadataOf = (purchaseId: string, buyer: Buyer, pack: AddOnProductRow) => ({
  [ADD_ON_PURCHASE_KEY]: purchaseId,
  organization_id: buyer.organizationId,
  product_id: pack.id,
});

/** The workspace's Stripe customer; one is made for a workspace without (Enterprise set up by hand). */
async function customerOf(buyer: Buyer): Promise<string> {
  if (buyer.customerId) return buyer.customerId;
  const customer = await stripe.customers.create({
    ...(buyer.email ? { email: buyer.email } : {}),
    metadata: { organization_id: buyer.organizationId, supabase_user_id: buyer.userId },
  });
  await supabaseAdmin
    .from('organizations')
    .update({ stripe_customer_id: customer.id })
    .eq('id', buyer.organizationId);
  return customer.id;
}

/**
 * AI credits: a Checkout in payment mode, its invoice made by Stripe with the
 * pack's line (the Stripe product's name, "AI credits · $50"). The purchase,
 * the payment and the invoice all name the purchase.
 */
async function startAiCheckout(buyer: Buyer, pack: AddOnProductRow): Promise<AddOnPurchaseStart> {
  const customer = await customerOf(buyer);
  const purchaseId = await newPurchase(buyer, pack);
  const metadata = metadataOf(purchaseId, buyer, pack);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      customer,
      client_reference_id: buyer.organizationId,
      line_items: [{ price: pack.stripe_price_id as string, quantity: 1 }],
      metadata,
      payment_intent_data: { metadata },
      invoice_creation: { enabled: true, invoice_data: { metadata } },
      success_url: `${appUrl}/dashboard/settings/billing?add_on=paid#add-ons`,
      cancel_url: `${appUrl}/dashboard/settings/billing#add-ons`,
    },
    // One Checkout per purchase, however often the call is retried.
    { idempotencyKey: `add-on-${purchaseId}` },
  );
  await supabaseAdmin
    .from('add_on_purchases')
    .update({ stripe_checkout_session_id: session.id })
    .eq('id', purchaseId);
  return session.url ? { ok: true, next: 'checkout', url: session.url } : refuse('failed');
}

/** A card declined, or one its bank wants confirmed: Stripe's 402. */
function declined(err: unknown): err is { message: string } {
  const e = err as { type?: string; statusCode?: number; message?: unknown } | null;
  return (
    !!e && typeof e.message === 'string' && (e.type === 'StripeCardError' || e.statusCode === 402)
  );
}

/**
 * Storage: a monthly item on the plan's subscription (CHAT-18 item 15),
 * invoiced at once for the rest of this period and charged to the card on
 * file. Nothing changes unless it's paid: a declined card is an error and
 * the purchase fails. A plan billed yearly can't take a monthly item.
 */
async function addStorageItem(buyer: Buyer, pack: AddOnProductRow): Promise<AddOnPurchaseStart> {
  if (!buyer.subscriptionId) return refuse('unavailable');
  const subscription = await stripe.subscriptions.retrieve(buyer.subscriptionId);
  if (planItemOf(subscription.items.data)?.price?.recurring?.interval !== 'month') {
    return refuse('unavailable');
  }
  const purchaseId = await newPurchase(buyer, pack);
  let itemId: string;
  try {
    const item = await stripe.subscriptionItems.create(
      {
        subscription: subscription.id,
        price: pack.stripe_price_id as string,
        quantity: 1,
        proration_behavior: 'always_invoice',
        payment_behavior: 'error_if_incomplete',
        metadata: metadataOf(purchaseId, buyer, pack),
      },
      { idempotencyKey: `add-on-${purchaseId}` },
    );
    itemId = item.id;
  } catch (err) {
    // Declined: nothing was added. Any other error may have reached Stripe,
    // so the purchase stays pending for the webhook to settle.
    if (!declined(err)) throw err;
    await supabaseAdmin
      .from('add_on_purchases')
      .update({ status: 'failed' })
      .eq('id', purchaseId)
      .eq('status', 'pending');
    return refuse('payment_failed', err.message);
  }
  // The webhook may have written it first, from the invoice.
  await supabaseAdmin
    .from('add_on_purchases')
    .update({ stripe_subscription_item_id: itemId })
    .eq('id', purchaseId)
    .is('stripe_subscription_item_id', null);
  return { ok: true, next: 'added' };
}
