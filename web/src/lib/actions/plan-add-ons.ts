'use server';

import { createHash } from 'node:crypto';
import type Stripe from 'stripe';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getPlan, isCloud } from '@/config/plans';
import { assertWritable, SubscriptionInactiveError } from '@/lib/subscription-guard';
import { getOrgLocationUsage } from '@/lib/prompt-locations';
import { countPlanBrands } from '@/lib/plan-brand-count';
import {
  ADD_ON_PURCHASE_KEY,
  addOnForPlan,
  addOnInterval,
  loadStripe,
  planItemOf,
} from '@/lib/billing/add-ons';
import { addOnTotals, type RecurringAddOnRow } from '@/lib/billing/add-on-sync';
import { resolveAddOnPrice } from '@/lib/billing/add-on-prices';
import {
  currentAddOns,
  itemChanges,
  type CartItem,
  type ItemChange,
} from '@/lib/billing/add-on-cart';

/**
 * Growth's recurring add-ons (00546): an Admin of a Growth workspace picks
 * one extra tracking tier (or none) and a number of extra brands, sees what
 * it costs (previewAddOnChange), and applies it (applyAddOnChange). Both are
 * items on the plan's own Stripe subscription, on the plan's interval:
 * one invoice, one renewal date, and they end with the plan.
 *
 * Applying charges the rest of this period at once to the card on file
 * (always_invoice, error_if_incomplete): nothing changes unless it's paid.
 * A lower tier or fewer brands leave a credit on the customer's balance for
 * the next invoices. The proration date comes from the preview, so the
 * charge is the amount shown.
 *
 * A subscription-level discount (a coupon from the plan's checkout) would
 * discount the add-ons too: when the subscription will hold an add-on, the
 * discount moves onto the plan's item, so it keeps discounting the plan
 * alone.
 *
 * An AI usage top-up (+5x, +10x, +20x) can be in the same cart: one
 * payment, added to this period's AI usage, briefs and opportunities until
 * the plan renews (00546 usage_top_ups), and bought again any time. With a
 * tier or brands it rides on the same update (add_invoice_items), so the
 * cart is one charge; alone, it is a one-line invoice paid at once. Either
 * way a purchase waits as pending and only the webhook grants it once paid.
 *
 * Kept apart from CHAT-18's packs (add-ons.ts): nothing here waits on Chat.
 * Never throws (#1777): every refusal is a reason the page can word.
 *   - not_cloud: billing is Ansvisor Cloud's.
 *   - admin_only: billing is the Admins'.
 *   - not_growth: add-ons are Growth's; `plan` says which plan it is
 *     (Starter: upgrade; Enterprise: its contract).
 *   - trial: the free trial can't buy them ("Start my plan now" first).
 *   - no_plan: the plan isn't active (ended, past due, no subscription).
 *   - ending: the plan is set to end; "Keep my plan" first.
 *   - contact_sales: the tier is sold by sales (+5,000, +10,000).
 *   - unavailable: the tier or the brand isn't on sale here (no Stripe
 *     price that fits it, switched off, no Stripe key).
 *   - below_usage: the new limits are under what's in use; `inUse` and
 *     `limits` carry the numbers ("pause N prompt locations first").
 *   - payment_failed: the card was declined; `message` is Stripe's.
 *   - failed: anything else.
 */

export type AddOnChangeFailure =
  | 'not_cloud'
  | 'admin_only'
  | 'not_growth'
  | 'trial'
  | 'no_plan'
  | 'ending'
  | 'contact_sales'
  | 'unavailable'
  | 'below_usage'
  | 'payment_failed'
  | 'failed';

export interface AddOnLimits {
  prompts: number;
  brands: number;
}

export interface AddOnChangeRefusal {
  ok: false;
  failure: AddOnChangeFailure;
  message?: string;
  plan?: string;
  inUse?: AddOnLimits;
  limits?: AddOnLimits;
}

export interface AddOnChangeInput {
  /** The extra tracking tier's prompt locations; 0 for none. */
  trackingUnits: number;
  /** Extra brands on top of the plan's; 0 for none. */
  extraBrands: number;
  /** The AI usage top-up's multiplier (5, 10 or 20); 0 or none for no top-up. */
  topUp?: number;
  /** The preview's proration date (Unix seconds), so the charge is the amount shown. */
  prorationDate?: number;
}

export type AddOnChangePreview =
  | {
      ok: true;
      changed: boolean;
      /** The plan's limits with these add-ons. */
      limits: AddOnLimits;
      /** Charged now for the rest of this period (a credit when below 0 is kept for later). */
      dueTodayCents: number;
      /** Each period from the next renewal on: the plan and its add-ons. */
      totalCents: number;
      currency: string;
      interval: 'month' | 'year';
      prorationDate: number;
    }
  | AddOnChangeRefusal;

export type AddOnChangeResult =
  | { ok: true; changed: boolean; limits: AddOnLimits }
  | AddOnChangeRefusal;

const inputSchema = z.object({
  trackingUnits: z.number().int().min(0).max(1_000_000),
  extraBrands: z.number().int().min(0).max(1_000),
  topUp: z.number().int().min(0).max(100).optional(),
  prorationDate: z.number().int().positive().optional(),
});

const refuse = (failure: AddOnChangeFailure, extra: Partial<AddOnChangeRefusal> = {}) =>
  ({ ok: false, failure, ...extra }) as AddOnChangeRefusal;

/** What a preview or a change costs, without changing anything. */
export async function previewAddOnChange(input: AddOnChangeInput): Promise<AddOnChangePreview> {
  try {
    const cart = await prepare(input);
    if (!cart.ok) return cart;
    const preview = cart.changes.length
      ? await cart.stripe.invoices.createPreview({
          customer: cart.customerId,
          subscription: cart.subscription.id,
          ...(cart.discountsMove ? { discounts: '' as const } : {}),
          subscription_details: {
            items: cart.items as Stripe.InvoiceCreatePreviewParams.SubscriptionDetails.Item[],
            proration_behavior: 'always_invoice',
            proration_date: cart.prorationDate,
          },
        })
      : null;
    return {
      ok: true,
      changed: cart.changes.length > 0 || !!cart.topUp,
      limits: cart.limits,
      // The rest of this period, and the top-up in full.
      dueTodayCents: (preview?.amount_due ?? 0) + (cart.topUp?.row.price_cents ?? 0),
      totalCents: cart.totalCents,
      currency: cart.currency,
      interval: cart.interval,
      prorationDate: cart.prorationDate,
    };
  } catch (err) {
    console.error('[plan-add-ons] Preview failed:', err);
    return refuse('failed');
  }
}

/** Applies the change and charges it. See above for what it answers. */
export async function applyAddOnChange(input: AddOnChangeInput): Promise<AddOnChangeResult> {
  try {
    await assertWritable();
  } catch (err) {
    if (err instanceof SubscriptionInactiveError) return refuse('no_plan');
    console.error('[plan-add-ons] Plan check failed:', err);
    return refuse('failed');
  }
  try {
    return await apply(input);
  } catch (err) {
    console.error('[plan-add-ons] Change failed:', err);
    return refuse('failed');
  }
}

async function apply(input: AddOnChangeInput): Promise<AddOnChangeResult> {
  const cart = await prepare(input);
  if (!cart.ok) return cart;
  if (!cart.changes.length && !cart.topUp) {
    return { ok: true, changed: false, limits: cart.limits };
  }

  // The top-up's purchase, pending until the webhook hears it was paid.
  const purchaseId = cart.topUp ? await newTopUpPurchase(cart) : null;
  const metadata = purchaseId
    ? { [ADD_ON_PURCHASE_KEY]: purchaseId, organization_id: cart.organizationId }
    : undefined;

  if (!cart.changes.length) {
    const charged = await chargeTopUp(cart, purchaseId as string, metadata ?? {});
    return charged.ok ? { ok: true, changed: true, limits: cart.limits } : charged;
  }

  const key = createHash('sha256')
    .update(JSON.stringify([cart.subscription.id, cart.items, cart.prorationDate, purchaseId]))
    .digest('hex')
    .slice(0, 32);
  let updated: Stripe.Subscription;
  try {
    updated = await cart.stripe.subscriptions.update(
      cart.subscription.id,
      {
        items: cart.items as Stripe.SubscriptionUpdateParams.Item[],
        ...(cart.discountsMove ? { discounts: '' as const } : {}),
        ...(cart.topUp ? { add_invoice_items: [{ price: cart.topUp.priceId, metadata }] } : {}),
        proration_behavior: 'always_invoice',
        proration_date: cart.prorationDate,
        payment_behavior: 'error_if_incomplete',
      },
      { idempotencyKey: `plan-add-ons-${cart.organizationId}-${key}` },
    );
  } catch (err) {
    // Declined or needing the customer: nothing changed, nothing was bought.
    if (declined(err)) {
      if (purchaseId) await markPurchaseFailed(purchaseId);
      return refuse('payment_failed', { message: err.message });
    }
    throw err;
  }

  // What the plan's limits read now; the webhook writes the same from Stripe.
  const totals = addOnTotals(
    updated.items.data as CartItem[],
    cart.catalog.filter((r): r is CatalogRow & RecurringAddOnRow => r.kind !== 'ai_topup'),
  );
  const { error } = await supabaseAdmin
    .from('organizations')
    .update({ add_on_prompts: totals.prompts, add_on_brands: totals.brands })
    .eq('id', cart.organizationId)
    .eq('stripe_subscription_id', cart.subscription.id);
  if (error) console.error('[plan-add-ons] Limits write failed:', error.message);
  return { ok: true, changed: true, limits: cart.limits };
}

/** The top-up's purchase row: pending until paid. */
async function newTopUpPurchase(cart: Cart): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('add_on_purchases')
    .insert({
      organization_id: cart.organizationId,
      product_id: cart.topUp!.row.id,
      bought_by: cart.userId,
      status: 'pending',
      currency: cart.topUp!.row.currency,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'No purchase row');
  return (data as { id: string }).id;
}

async function markPurchaseFailed(purchaseId: string) {
  const { error } = await supabaseAdmin
    .from('add_on_purchases')
    .update({ status: 'failed' })
    .eq('id', purchaseId)
    .eq('status', 'pending');
  if (error) console.error('[plan-add-ons] Purchase not marked failed:', error.message);
}

/**
 * A top-up alone: a one-line invoice on the plan's customer, paid at once
 * from the card on file. Declined, the invoice is voided and nothing is
 * bought; any other failure leaves the purchase pending for the webhook.
 */
async function chargeTopUp(
  cart: Cart,
  purchaseId: string,
  metadata: Record<string, string>,
): Promise<{ ok: true } | AddOnChangeRefusal> {
  const { stripe } = cart;
  const invoice = await stripe.invoices.create(
    {
      customer: cart.customerId,
      collection_method: 'charge_automatically',
      auto_advance: false,
      pending_invoice_items_behavior: 'exclude',
      metadata,
    },
    { idempotencyKey: `add-on-invoice-${purchaseId}` },
  );
  const invoiceId = invoice.id as string;
  await stripe.invoiceItems.create(
    {
      customer: cart.customerId,
      invoice: invoiceId,
      pricing: { price: cart.topUp!.priceId },
      metadata,
    },
    { idempotencyKey: `add-on-item-${purchaseId}` },
  );
  await supabaseAdmin
    .from('add_on_purchases')
    .update({ stripe_invoice_id: invoiceId })
    .eq('id', purchaseId)
    .is('stripe_invoice_id', null);
  await stripe.invoices.finalizeInvoice(invoiceId, { auto_advance: false });
  try {
    await stripe.invoices.pay(invoiceId);
  } catch (err) {
    if (!declined(err)) throw err;
    await stripe.invoices.voidInvoice(invoiceId).catch((voidErr: unknown) => {
      console.error('[plan-add-ons] Declined invoice not voided:', voidErr);
    });
    await markPurchaseFailed(purchaseId);
    return refuse('payment_failed', { message: err.message });
  }
  return { ok: true };
}

function declined(err: unknown): err is { message: string } {
  const e = err as { type?: string; statusCode?: number; message?: unknown } | null;
  return (
    !!e && typeof e.message === 'string' && (e.type === 'StripeCardError' || e.statusCode === 402)
  );
}

type StripeClient = NonNullable<Awaited<ReturnType<typeof loadStripe>>>;

type CatalogRow = Omit<RecurringAddOnRow, 'kind'> & {
  kind: RecurringAddOnRow['kind'] | 'ai_topup';
  multiplier: number | null;
  id: string;
  price_cents: number;
  currency: string;
  billing: 'monthly' | 'yearly' | 'one_time';
  sale: 'self_serve' | 'contact_sales';
  plans: string[] | null;
  active: boolean;
};

interface Cart {
  ok: true;
  stripe: StripeClient;
  userId: string;
  organizationId: string;
  customerId: string;
  subscription: Stripe.Subscription;
  catalog: CatalogRow[];
  changes: ItemChange[];
  /** The items Stripe is sent: the changes, and the plan's item when a discount moves onto it. */
  items: Record<string, unknown>[];
  discountsMove: boolean;
  /** The AI usage top-up in the cart, with its resolved price. */
  topUp: { row: CatalogRow; priceId: string } | null;
  limits: AddOnLimits;
  totalCents: number;
  currency: string;
  interval: 'month' | 'year';
  prorationDate: number;
}

const CATALOG_COLUMNS =
  'id, kind, price_cents, currency, billing, grant_prompts, grant_brands, multiplier, stripe_price_id, stripe_lookup_key, sale, plans, active';

/** A proration date the preview gave, if it's recent; else now. */
function prorationDateOf(asked: number | undefined): number {
  const now = Math.floor(Date.now() / 1000);
  return asked && asked <= now + 60 && asked >= now - 3600 ? asked : now;
}

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === 'string' ? value : (value?.id ?? null);

async function prepare(raw: AddOnChangeInput): Promise<Cart | AddOnChangeRefusal> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return refuse('unavailable');
  const input = parsed.data;
  if (!isCloud()) return refuse('not_cloud');

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
  if (!organizationId) return refuse('failed');
  if (profile?.role !== 'admin') return refuse('admin_only');

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select(
      'plan, subscription_status, cancel_at_period_end, stripe_customer_id, stripe_subscription_id',
    )
    .eq('id', organizationId)
    .maybeSingle();
  if (!org) return refuse('failed');
  const planId = (org.plan as string | null) ?? 'starter';
  if (planId !== 'growth') return refuse('not_growth', { plan: planId });
  if (org.subscription_status === 'trialing') return refuse('trial');
  if (org.subscription_status !== 'active' || !org.stripe_subscription_id) {
    return refuse('no_plan');
  }
  if (org.cancel_at_period_end) return refuse('ending');

  const stripe = await loadStripe();
  if (!stripe) return refuse('unavailable');
  const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id as string);
  if (subscription.status === 'trialing') return refuse('trial');
  if (subscription.status !== 'active') return refuse('no_plan');
  if (subscription.cancel_at_period_end) return refuse('ending');
  const customerId = idOf(subscription.customer);
  const items = subscription.items.data as unknown as (CartItem & Stripe.SubscriptionItem)[];
  const planItem = planItemOf(items);
  const interval = planItem?.price?.recurring?.interval;
  if (!planItem || !customerId || (interval !== 'month' && interval !== 'year')) {
    return refuse('failed');
  }

  const { data: rows, error } = await supabaseAdmin
    .from('add_on_products')
    .select(CATALOG_COLUMNS)
    .in('kind', ['tracking', 'brand', 'ai_topup']);
  if (error) throw new Error(error.message);
  const catalog = (rows ?? []) as CatalogRow[];
  const recurring = catalog.filter(
    (r): r is CatalogRow & RecurringAddOnRow => r.kind === 'tracking' || r.kind === 'brand',
  );
  const forThisPlan = (row: CatalogRow) =>
    row.active && addOnForPlan(row, 'growth') && addOnInterval(row) === interval;

  const current = currentAddOns(items, recurring);
  const base = getPlan('growth').limits;
  const limits: AddOnLimits = {
    prompts: base.maxPrompts + input.trackingUnits,
    brands: base.maxBrands + input.extraBrands,
  };

  // The tier: unchanged needs no sale; a new one must be sold here.
  let tier: CatalogRow | null = null;
  let trackingPriceId: string | null = null;
  if (input.trackingUnits > 0) {
    if (current.tracking?.units === input.trackingUnits) {
      trackingPriceId = idOf(current.tracking.item.price as { id: string } | string);
    } else {
      tier =
        catalog.find(
          (r) => r.kind === 'tracking' && r.grant_prompts === input.trackingUnits && forThisPlan(r),
        ) ?? null;
      if (!tier) return refuse('unavailable');
      if (tier.sale === 'contact_sales') return refuse('contact_sales');
      trackingPriceId = await resolveAddOnPrice(stripe, tier);
      if (!trackingPriceId) return refuse('unavailable');
    }
  }
  const brand = catalog.find((r) => r.kind === 'brand' && forThisPlan(r)) ?? null;
  let brandPriceId = '';
  if (input.extraBrands > 0 && input.extraBrands !== current.brands?.quantity) {
    if (!brand || brand.sale === 'contact_sales') return refuse('unavailable');
    brandPriceId = (await resolveAddOnPrice(stripe, brand)) ?? '';
    if (!brandPriceId) return refuse('unavailable');
  }

  const changes = itemChanges(current, {
    trackingPriceId,
    brandPriceId,
    extraBrands: input.extraBrands,
  });

  // Never below what's in use: a change that lowers a limit under it waits
  // until prompt locations are paused or brands removed.
  const before = addOnTotals(items, recurring);
  const lowers = input.trackingUnits < before.prompts || input.extraBrands < before.brands;
  if (changes.length && lowers) {
    const [usage, brandsInUse] = await Promise.all([
      getOrgLocationUsage(supabase, organizationId),
      countPlanBrands(supabase, organizationId),
    ]);
    const inUse = { prompts: usage.total, brands: brandsInUse };
    if (
      (input.trackingUnits < before.prompts && inUse.prompts > limits.prompts) ||
      (input.extraBrands < before.brands && inUse.brands > limits.brands)
    ) {
      return refuse('below_usage', { inUse, limits });
    }
  }

  // The subscription's own discount moves onto the plan's item once an
  // add-on is there, so the add-ons are charged in full.
  const subscriptionDiscounts = (subscription.discounts ?? [])
    .map((d) => idOf(d as string | { id: string }))
    .filter((d): d is string => !!d);
  const withAddOns = !!trackingPriceId || input.extraBrands > 0;
  const discountsMove = changes.length > 0 && withAddOns && subscriptionDiscounts.length > 0;
  const planItemDiscounts = ((planItem as { discounts?: unknown[] }).discounts ?? [])
    .map((d) => idOf(d as string | { id: string }))
    .filter((d): d is string => !!d);
  const sent: Record<string, unknown>[] = [...changes];
  if (discountsMove) {
    sent.push({
      id: planItem.id,
      discounts: [...new Set([...planItemDiscounts, ...subscriptionDiscounts])].map((discount) => ({
        discount,
      })),
    });
  }

  // The top-up: one payment, bought again any time (no monthly cap).
  let topUp: Cart['topUp'] = null;
  if (input.topUp) {
    const row = catalog.find(
      (r) =>
        r.kind === 'ai_topup' &&
        r.multiplier === input.topUp &&
        r.active &&
        addOnForPlan(r, 'growth'),
    );
    if (!row || row.sale === 'contact_sales') return refuse('unavailable');
    const priceId = await resolveAddOnPrice(stripe, row);
    if (!priceId) return refuse('unavailable');
    topUp = { row, priceId };
  }

  const planCents = (planItem.price?.unit_amount ?? 0) * (planItem.quantity ?? 1);
  const tierCents = tier
    ? tier.price_cents
    : trackingPriceId && current.tracking
      ? ((current.tracking.item.price as { unit_amount?: number | null })?.unit_amount ?? 0)
      : 0;
  const brandCents = input.extraBrands > 0 && brand ? brand.price_cents * input.extraBrands : 0;

  return {
    ok: true,
    stripe,
    userId: user.id,
    organizationId,
    customerId,
    subscription,
    catalog,
    changes,
    items: sent,
    discountsMove,
    topUp,
    limits,
    totalCents: planCents + tierCents + brandCents,
    currency: planItem.price?.currency ?? 'usd',
    interval,
    prorationDate: prorationDateOf(input.prorationDate),
  };
}
