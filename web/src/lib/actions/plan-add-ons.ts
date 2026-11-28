'use server';

import { createHash } from 'node:crypto';
import type Stripe from 'stripe';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getPlan, isCloud } from '@/config/plans';
import { assertWritable, SubscriptionInactiveError } from '@/lib/subscription-guard';
import { getOrgLocationUsage, getOrgSlotUsage } from '@/lib/prompt-locations';
import { SLOT_PLATFORMS, slotPlatform, type SlotGroup } from '@/config/tracking-slots';
import { ORG_PLAN_COLUMNS, planFromOrgRow, boughtSlots } from '@/lib/guards/plan-row';
import { slotDiscount } from '@/lib/billing/slot-discount';
import { ensureSlotCoupon } from '@/lib/billing/slot-coupon';
import { movedDiscount, type MovedDiscount } from '@/lib/billing/plan-coupon-move';
import { countPlanBrands } from '@/lib/plan-brand-count';
import {
  ADD_ON_PURCHASE_KEY,
  addOnForPlan,
  addOnInterval,
  loadStripe,
  planItemOf,
} from '@/lib/billing/add-ons';
import {
  addOnTotals,
  RECURRING_ADD_ON_KINDS,
  type RecurringAddOnRow,
} from '@/lib/billing/add-on-sync';
import { resolveAddOnPrice } from '@/lib/billing/add-on-prices';
import {
  currentAddOns,
  currentSlotItems,
  itemChanges,
  slotItemChanges,
  type CartItem,
  type SlotTarget,
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
 * discount moves onto the plan's item as its coupon (a copy for the months
 * left, when it runs for some months), so it keeps discounting the plan
 * alone.
 *
 * An AI usage top-up (+5x, +10x, +20x) can be in the same cart: one
 * payment, added to this period's AI usage, briefs and opportunities until
 * the plan renews (00546 usage_top_ups), and bought again any time. With a
 * tier or brands it rides on the same update (add_invoice_items), so the
 * cart is one charge; alone, it is a one-line invoice paid at once. Either
 * way a purchase waits as pending and only the webhook grants it once paid.
 *
 * Tracking slots per platform (00564) are items on the same subscription, on
 * Growth and on Enterprise (whose other add-ons are its contract's): units
 * of 100 slots per platform, on the plan's interval only (a monthly plan
 * buys monthly slots). Their volume discount is a percent coupon on the slot
 * items alone (slot-discount.ts, slot-coupon.ts), never on the
 * subscription, and the plan's own coupon moves onto the plan's item as
 * above, so neither discounts the other's items.
 *
 * Kept apart from CHAT-18's packs (add-ons.ts): nothing here waits on Chat.
 * Never throws (#1777): every refusal is a reason the page can word.
 *   - not_cloud: billing is Ansvisor Cloud's.
 *   - admin_only: billing is the Admins'.
 *   - not_growth: add-ons are Growth's; `plan` says which plan it is
 *     (Starter: upgrade; Enterprise: its contract, except tracking slots).
 *   - trial: the free trial can't buy them ("Start my plan now" first).
 *   - no_plan: the plan isn't active (ended, past due, no subscription).
 *   - ending: the plan is set to end; "Keep my plan" first.
 *   - contact_sales: the tier is sold by sales (+5,000, +10,000).
 *   - unavailable: the tier or the brand isn't on sale here (no Stripe
 *     price that fits it, switched off, no Stripe key, or the plan's brands
 *     are unlimited: an Enterprise contract's, 00548).
 *   - below_usage: the new limits are under what's in use; `inUse` and
 *     `limits` carry the numbers ("pause N prompt locations first").
 *     Tracking slots aren't refused below use: the newest prompt locations
 *     past a platform's slots wait (00564), and the preview's `slotsWaiting`
 *     says how many, for Review and pay.
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

/** A platform whose slots a change puts under what its prompts use: the newest locations past them wait. */
export interface SlotsOver {
  platform: string;
  inUse: number;
  limit: number;
}

/** The volume discount on the slots in the cart, per period. */
export interface SlotsPrice {
  listCents: number;
  percentOff: number;
  discountCents: number;
  /** The next discount step and the list price still to go before it; null at the top. */
  next: { percent: number; remainingCents: number } | null;
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
  /**
   * Only the top-up: the subscription keeps the tracking and brands it has
   * in Stripe now, whatever trackingUnits / extraBrands say. The Get more
   * window sends it, so a snapshot read before a change in another tab (or
   * before the webhook) never reverts or adds an add-on.
   */
  topUpOnly?: boolean;
  /**
   * Tracking slots: units of 100 per platform ({"claude-web": 2}); a
   * platform at 0 or left out has none. Leave it out to keep the slots the
   * subscription has.
   */
  slots?: Record<string, number>;
}

export type AddOnChangePreview =
  | {
      ok: true;
      changed: boolean;
      /** The plan's limits with these add-ons. */
      limits: AddOnLimits;
      /** Tracking slots per platform with these add-ons: the plan's and the bought ones. */
      slots: Record<string, number>;
      /** The bought slots' price and volume discount per period. */
      slotsPrice: SlotsPrice;
      /** Platforms this change puts under their use: the newest locations past the slots wait. */
      slotsWaiting: SlotsOver[];
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
  topUpOnly: z.boolean().optional(),
  slots: z.record(z.string(), z.number().int().min(0).max(100_000)).optional(),
});

const refuse = (failure: AddOnChangeFailure, extra: Partial<AddOnChangeRefusal> = {}) =>
  ({ ok: false, failure, ...extra }) as AddOnChangeRefusal;

/** A plan's own limits before add-ons: Enterprise's contract overrides merged. */
function ownLimits(planId: string, overrides: unknown) {
  const limits = getPlan(planId as Parameters<typeof getPlan>[0]).limits;
  if (planId !== 'enterprise' || !overrides || typeof overrides !== 'object') return limits;
  return { ...limits, ...(overrides as Partial<typeof limits>) };
}

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
      slots: cart.slots,
      slotsPrice: cart.slotsPrice,
      slotsWaiting: cart.slotsWaiting,
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
    .update({
      add_on_prompts: totals.prompts,
      add_on_brands: totals.brands,
      add_on_slots: totals.slots,
    })
    .eq('id', cart.organizationId)
    .eq('stripe_subscription_id', cart.subscription.id);
  if (error) console.error('[plan-add-ons] Limits write failed:', error.message);
  // Fewer slots: the newest prompt locations past them wait now, as the
  // webhook's sync would do (logged, never thrown: the change is paid).
  if (cart.slotsChange) {
    try {
      const { settleSlots } = await import('@/lib/prompt-capacity');
      await settleSlots(cart.organizationId, cart.slots);
    } catch (err) {
      console.error('[plan-add-ons] Prompts past the slots not set waiting:', err);
    }
  }
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
  changes: Record<string, unknown>[];
  /** The items Stripe is sent: the changes, and the plan's item when a discount moves onto it. */
  items: Record<string, unknown>[];
  discountsMove: boolean;
  /** The AI usage top-up in the cart, with its resolved price. */
  topUp: { row: CatalogRow; priceId: string } | null;
  limits: AddOnLimits;
  slots: Record<string, number>;
  slotsPrice: SlotsPrice;
  slotsWaiting: SlotsOver[];
  /** The slot units change: prompts past the new slots are settled once paid. */
  slotsChange: boolean;
  totalCents: number;
  currency: string;
  interval: 'month' | 'year';
  prorationDate: number;
}

const CATALOG_COLUMNS =
  'id, kind, price_cents, currency, billing, grant_prompts, grant_brands, platform, grant_slots, multiplier, stripe_price_id, stripe_lookup_key, sale, plans, active';

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
  let input = parsed.data;
  if (!isCloud()) return refuse('not_cloud');
  if (input.topUpOnly && !input.topUp) return refuse('unavailable');

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
    .select(`${ORG_PLAN_COLUMNS}, cancel_at_period_end, stripe_customer_id, stripe_subscription_id`)
    .eq('id', organizationId)
    .maybeSingle();
  if (!org) return refuse('failed');
  const planId = (org.plan as string | null) ?? 'starter';
  // Enterprise buys tracking slots, extra brands and AI top-ups here (00564,
  // 00566); the retired tracking tiers are Growth's.
  const enterprise = planId === 'enterprise';
  if (planId !== 'growth' && !enterprise) return refuse('not_growth', { plan: planId });
  if (enterprise && input.trackingUnits > 0) {
    return refuse('not_growth', { plan: planId });
  }
  if (input.slots && Object.keys(input.slots).some((id) => !slotPlatform(id))) {
    return refuse('unavailable');
  }
  if (org.subscription_status === 'trialing') return refuse('trial');
  if (org.subscription_status !== 'active' || !org.stripe_subscription_id) {
    return refuse('no_plan');
  }
  if (org.cancel_at_period_end) return refuse('ending');

  const stripe = await loadStripe();
  if (!stripe) return refuse('unavailable');
  // Its discounts with their coupons: a discount moving onto the plan's item
  // goes as a coupon (plan-coupon-move.ts).
  const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id as string, {
    expand: ['discounts.source.coupon'],
  });
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
    .in('kind', [...RECURRING_ADD_ON_KINDS, 'ai_topup']);
  if (error) throw new Error(error.message);
  const catalog = (rows ?? []) as CatalogRow[];
  const recurring = catalog.filter(
    (r): r is CatalogRow & RecurringAddOnRow => r.kind !== 'ai_topup',
  );
  // Only the plan's own interval: a monthly plan's add-ons are monthly.
  const forThisPlan = (row: CatalogRow) =>
    row.active && addOnForPlan(row, planId) && addOnInterval(row) === interval;

  const current = currentAddOns(items, recurring);
  const currentSlots = currentSlotItems(items, recurring);
  const keptSlots = Object.fromEntries([...currentSlots].map(([id, s]) => [id, s.units]));
  if (input.topUpOnly) {
    input = {
      ...input,
      trackingUnits: current.tracking?.units ?? 0,
      extraBrands: current.brands?.quantity ?? 0,
      slots: keptSlots,
    };
  }
  if (enterprise && current.tracking) return refuse('not_growth', { plan: planId });
  const slotUnits = input.slots ?? keptSlots;
  const base = ownLimits(planId, org.plan_overrides);
  // Unlimited brands (an Enterprise contract, 00548): an extra brand adds
  // nothing, so none is sold; removing ones bought before stays open.
  const unlimitedBrands = base.maxBrands < 0;
  if (
    unlimitedBrands &&
    input.extraBrands > 0 &&
    input.extraBrands !== (current.brands?.quantity ?? 0)
  ) {
    return refuse('unavailable');
  }
  const limits: AddOnLimits = {
    prompts: base.maxPrompts < 0 ? -1 : base.maxPrompts + input.trackingUnits,
    brands: unlimitedBrands ? -1 : base.maxBrands + input.extraBrands,
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

  // Tracking slots: an unchanged platform keeps its price; a new or
  // changed one must be sold on the plan's interval.
  const slotTargets = new Map<string, SlotTarget>();
  let slotListCents = 0;
  let slotProduct: string | null = null;
  for (const [platform, units] of Object.entries(slotUnits)) {
    if (units <= 0) continue;
    const held = currentSlots.get(platform);
    const heldPrice = held?.item.price as Stripe.Price | string | undefined;
    const row = catalog.find(
      (r) => r.kind === 'slots' && r.platform === platform && forThisPlan(r),
    );
    if (held && held.units === units && heldPrice && typeof heldPrice !== 'string') {
      slotTargets.set(platform, { priceId: heldPrice.id, units });
      slotListCents += (heldPrice.unit_amount ?? 0) * units;
      slotProduct ??= idOf(heldPrice.product as string | { id: string });
      continue;
    }
    if (!row || row.sale === 'contact_sales') return refuse('unavailable');
    const priceId =
      held && typeof heldPrice !== 'string' && heldPrice?.lookup_key === row.stripe_lookup_key
        ? heldPrice.id
        : await resolveAddOnPrice(stripe, row);
    if (!priceId) return refuse('unavailable');
    slotTargets.set(platform, { priceId, units });
    slotListCents += row.price_cents * units;
  }
  const discount = slotDiscount(slotListCents, interval);
  const slotsPrice: SlotsPrice = {
    listCents: discount.listCents,
    percentOff: discount.percentOff,
    discountCents: discount.discountCents,
    next: discount.next
      ? { percent: discount.next.step.percent, remainingCents: discount.next.remainingCents }
      : null,
  };

  // The slots each platform would have: the plan's own and the bought ones.
  const plan = planFromOrgRow(org);
  const held = boughtSlots((org as { add_on_slots?: unknown }).add_on_slots);
  const slots: Record<string, number> = {};
  const unitSlots = (platform: string) =>
    catalog.find((r) => r.kind === 'slots' && r.platform === platform)?.grant_slots ?? 100;
  for (const platform of new Set([...Object.keys(plan.slots ?? {}), ...Object.keys(slotUnits)])) {
    const before = plan.slots?.[platform] ?? 0;
    if (before < 0) {
      slots[platform] = -1;
      continue;
    }
    const bought = (slotUnits[platform] ?? 0) * unitSlots(platform);
    slots[platform] = Math.max(0, before - (held[platform] ?? 0)) + bought;
  }

  const slotUnitsChange =
    slotTargets.size !== currentSlots.size ||
    [...slotTargets].some(([platform, t]) => currentSlots.get(platform)?.units !== t.units);
  let couponId: string | null = null;
  if (slotUnitsChange && slotsPrice.percentOff > 0) {
    if (!slotProduct) {
      const first = [...slotTargets.values()][0];
      const price = await stripe.prices.retrieve(first.priceId);
      slotProduct = idOf(price.product as string | { id: string });
    }
    if (!slotProduct) return refuse('unavailable');
    couponId = await ensureSlotCoupon(stripe, slotsPrice.percentOff, slotProduct);
  }

  const changes = [
    ...itemChanges(current, {
      trackingPriceId,
      brandPriceId,
      extraBrands: input.extraBrands,
    }),
    ...slotItemChanges(currentSlots, slotTargets, couponId),
  ];

  // A platform's slots can go under what its prompts use: the newest
  // locations past them wait, and Review and pay says how many.
  const lowered = [...currentSlots].filter(
    ([platform, s]) => (slotTargets.get(platform)?.units ?? 0) < s.units,
  );
  let slotsWaiting: SlotsOver[] = [];
  if (changes.length && lowered.length) {
    const used = await getOrgSlotUsage(supabase, organizationId);
    slotsWaiting = lowered
      .map(([platform]) => ({ platform, inUse: used.get(platform) ?? 0, limit: slots[platform] }))
      .filter((o) => o.limit >= 0 && o.inUse > o.limit);
  }

  // Never below what's in use: a change that lowers a limit under it waits
  // until prompt locations are paused or brands removed.
  const before = addOnTotals(items, recurring);
  const fewerPrompts = input.trackingUnits < before.prompts && limits.prompts >= 0;
  const fewerBrands = input.extraBrands < before.brands && !unlimitedBrands;
  if (changes.length && (fewerPrompts || fewerBrands)) {
    const [usage, brandsInUse] = await Promise.all([
      getOrgLocationUsage(supabase, organizationId),
      countPlanBrands(supabase, organizationId),
    ]);
    const inUse = { prompts: usage.total, brands: brandsInUse };
    if (
      (fewerPrompts && inUse.prompts > limits.prompts) ||
      (fewerBrands && inUse.brands > limits.brands)
    ) {
      return refuse('below_usage', { inUse, limits });
    }
  }

  // The subscription's own discount moves onto the plan's item once an
  // add-on is there, so the add-ons are charged in full. Stripe only takes a
  // new discount on an item, so it goes as its coupon, for the months it
  // had left (plan-coupon-move.ts).
  const subscriptionDiscounts = (subscription.discounts ?? []).filter(
    (d): d is Stripe.Discount => typeof d === 'object' && d != null,
  );
  const withAddOns = !!trackingPriceId || input.extraBrands > 0 || slotTargets.size > 0;
  const discountsMove = changes.length > 0 && withAddOns && subscriptionDiscounts.length > 0;
  const planItemDiscounts = ((planItem as { discounts?: unknown[] }).discounts ?? [])
    .map((d) => idOf(d as string | { id: string }))
    .filter((d): d is string => !!d);
  const sent: Record<string, unknown>[] = [...changes];
  if (discountsMove) {
    const now = Math.floor(Date.now() / 1000);
    const moved = (
      await Promise.all(subscriptionDiscounts.map((d) => movedDiscount(stripe, d, now)))
    ).filter((d): d is MovedDiscount => d != null);
    sent.push({
      id: planItem.id,
      discounts: [...[...new Set(planItemDiscounts)].map((discount) => ({ discount })), ...moved],
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
        addOnForPlan(r, planId),
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
    slots,
    slotsPrice,
    slotsWaiting,
    slotsChange: slotUnitsChange,
    totalCents:
      planCents + tierCents + brandCents + slotsPrice.listCents - slotsPrice.discountCents,
    currency: planItem.price?.currency ?? 'usd',
    interval,
    prorationDate: prorationDateOf(input.prorationDate),
  };
}

// ─── Settings › Billing: what the card shows ───────────────────────────────

/** Why the workspace can't change its add-ons now, or `open` when it can. */
export type PlanAddOnsState =
  | 'open'
  | 'not_admin'
  | 'starter'
  | 'enterprise'
  | 'trial'
  | 'no_plan'
  | 'ending';

export interface PlanAddOnsView {
  state: PlanAddOnsState;
  /** The plan's billing period: add-on prices follow it. */
  interval: 'month' | 'year';
  currency: string;
  /** What the plan includes. */
  base: AddOnLimits;
  /** What the subscription adds now. */
  current: { trackingUnits: number; extraBrands: number };
  /** The tracking tiers on the plan's period, smallest first. */
  tiers: { units: number; priceCents: number; contactSales: boolean }[];
  /** One extra brand on the plan's period; null when not on sale. */
  brandPriceCents: number | null;
  /** The AI usage top-ups. */
  topUps: { multiplier: number; priceCents: number; briefs: number; opportunities: number }[];
  /** When the plan renews: a top-up lasts until then. */
  renewsOn: string | null;
  /** How far an active plan lets this person buy, whatever the plan (Enterprise's state is 'enterprise'). */
  buyState: PlanSlotsView['state'];
  /** The organization's plan, for the cart's first line. */
  planId: string;
  /** The plan's price on its period, in cents; null when it couldn't be read. */
  planPriceCents: number | null;
  /** Tracking slots per platform (00564); null when the plan doesn't sell them or none is on sale. */
  slots: PlanSlotsView | null;
}

/** Settings › Billing's tracking slots: Growth and Enterprise. */
export interface PlanSlotsView {
  /** Why the workspace can't change its slots now, or `open` when it can. */
  state: Exclude<PlanAddOnsState, 'starter' | 'enterprise'>;
  /** Each platform on sale on the plan's period, in the config's order. */
  platforms: {
    id: string;
    group: SlotGroup;
    /** One unit's price on the plan's period, in cents. */
    unitCents: number;
    /** The slots one unit adds (100). */
    unitSlots: number;
    /** The slots the plan includes on it; -1 is no limit. */
    included: number;
    /** The units bought now. */
    units: number;
    /** Slots its prompts use now. */
    inUse: number;
  }[];
}

export type PlanAddOnsRead =
  | { ok: true; addOns: PlanAddOnsView }
  | { ok: false; failure: 'not_cloud' | 'failed' };

interface ViewRow {
  kind: 'tracking' | 'brand' | 'ai_topup' | 'slots';
  platform: string | null;
  grant_slots: number | null;
  price_cents: number;
  currency: string;
  billing: 'monthly' | 'yearly' | 'one_time';
  grant_prompts: number | null;
  grant_briefs: number | null;
  grant_opportunities: number | null;
  multiplier: number | null;
  sale: 'self_serve' | 'contact_sales';
  plans: string[] | null;
  active: boolean;
}

/** What Settings › Billing shows of Growth's add-ons. Never throws. */
export async function readPlanAddOns(): Promise<PlanAddOnsRead> {
  try {
    if (!isCloud()) return { ok: false, failure: 'not_cloud' };
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, failure: 'failed' };
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .maybeSingle();
    const organizationId = profile?.organization_id as string | undefined;
    if (!organizationId) return { ok: false, failure: 'failed' };

    const [{ data: org }, { data: rows, error }] = await Promise.all([
      supabaseAdmin
        .from('organizations')
        .select(
          `${ORG_PLAN_COLUMNS}, cancel_at_period_end, subscription_ends_at, stripe_subscription_id`,
        )
        .eq('id', organizationId)
        .maybeSingle(),
      supabaseAdmin
        .from('add_on_products')
        .select(
          'kind, price_cents, currency, billing, grant_prompts, grant_briefs, grant_opportunities, multiplier, platform, grant_slots, sale, plans, active',
        )
        .in('kind', ['tracking', 'brand', 'ai_topup', 'slots']),
    ]);
    if (error || !org) return { ok: false, failure: 'failed' };

    const planId = (org.plan as string | null) ?? 'starter';
    const status = org.subscription_status as string | null;
    // How far an active plan lets this person buy (Growth's add-ons, and
    // Growth's and Enterprise's slots).
    const running: PlanSlotsView['state'] =
      status === 'trialing'
        ? 'trial'
        : status !== 'active' || !org.stripe_subscription_id
          ? 'no_plan'
          : org.cancel_at_period_end
            ? 'ending'
            : profile?.role !== 'admin'
              ? 'not_admin'
              : 'open';
    const state: PlanAddOnsState =
      planId === 'enterprise' ? 'enterprise' : planId !== 'growth' ? 'starter' : running;
    const sellsSlots = planId === 'growth' || planId === 'enterprise';

    // The plan's period, from its Stripe item, whatever the state (a trial
    // on a yearly plan sees yearly prices); monthly when there's no
    // subscription or it can't be read.
    let interval: 'month' | 'year' = 'month';
    // The plan's own price, for the cart's first line; null when unread.
    let planPriceCents: number | null = null;
    if (sellsSlots && org.stripe_subscription_id) {
      try {
        const stripe = await loadStripe();
        if (stripe) {
          const sub = await stripe.subscriptions.retrieve(org.stripe_subscription_id as string);
          const item = planItemOf(sub.items.data);
          const found = item?.price?.recurring?.interval;
          if (found === 'year') interval = 'year';
          if (item?.price?.unit_amount != null) {
            planPriceCents = item.price.unit_amount * (item.quantity ?? 1);
          }
        }
      } catch (err) {
        if (running === 'open' || running === 'not_admin') throw err;
        console.error('[plan-add-ons] Plan period not read; monthly shown:', err);
      }
    }

    // The add-ons the plan sells: Growth's all, Enterprise's brands (and slots below).
    const catalog = ((rows ?? []) as ViewRow[]).filter(
      (r) => r.active && addOnForPlan(r, planId === 'enterprise' ? 'enterprise' : 'growth'),
    );
    const slots = sellsSlots
      ? await slotsView(
          ((rows ?? []) as ViewRow[]).filter(
            (r) =>
              r.kind === 'slots' &&
              r.active &&
              r.sale === 'self_serve' &&
              addOnForPlan(r, planId) &&
              addOnInterval(r) === interval,
          ),
          org,
          running,
          () => getOrgSlotUsage(supabase, organizationId),
        )
      : null;
    const onPeriod = (r: ViewRow) => addOnInterval(r) === interval;
    const tiers = catalog
      .filter((r) => r.kind === 'tracking' && onPeriod(r) && r.grant_prompts)
      .sort((a, b) => (a.grant_prompts ?? 0) - (b.grant_prompts ?? 0))
      .map((r) => ({
        units: r.grant_prompts as number,
        priceCents: r.price_cents,
        contactSales: r.sale === 'contact_sales',
      }));
    const brand = catalog.find((r) => r.kind === 'brand' && onPeriod(r) && r.sale === 'self_serve');
    const topUps = catalog
      .filter((r) => r.kind === 'ai_topup' && r.multiplier && r.sale === 'self_serve')
      .sort((a, b) => (a.multiplier ?? 0) - (b.multiplier ?? 0))
      .map((r) => ({
        multiplier: r.multiplier as number,
        priceCents: r.price_cents,
        briefs: r.grant_briefs ?? 0,
        opportunities: r.grant_opportunities ?? 0,
      }));
    const base = ownLimits(planId === 'enterprise' ? 'enterprise' : 'growth', org.plan_overrides);
    const count = (v: unknown) => (typeof v === 'number' && v > 0 ? v : 0);

    return {
      ok: true,
      addOns: {
        state,
        interval,
        currency: catalog[0]?.currency ?? 'usd',
        base: { prompts: base.maxPrompts, brands: base.maxBrands },
        current: {
          trackingUnits: count(org.add_on_prompts),
          extraBrands: count(org.add_on_brands),
        },
        tiers,
        // Unlimited brands (00548): an extra one adds nothing, so none is offered.
        brandPriceCents: base.maxBrands < 0 ? null : (brand?.price_cents ?? null),
        topUps,
        renewsOn: (org.subscription_ends_at as string | null) ?? null,
        buyState: running,
        planId,
        planPriceCents,
        slots,
      },
    };
  } catch (err) {
    console.error('[plan-add-ons] Read failed:', err);
    return { ok: false, failure: 'failed' };
  }
}

/** The slots on sale on the plan's period, with what the plan includes, what was bought and what is used. */
async function slotsView(
  rows: ViewRow[],
  org: Parameters<typeof planFromOrgRow>[0] & { add_on_slots?: unknown },
  state: PlanSlotsView['state'],
  usage: () => Promise<Map<string, number>>,
): Promise<PlanSlotsView | null> {
  if (!rows.length) return null;
  const plan = planFromOrgRow(org);
  const bought = boughtSlots(org.add_on_slots);
  let used = new Map<string, number>();
  try {
    used = await usage();
  } catch (err) {
    console.error('[plan-add-ons] Slot usage not read:', err);
  }
  const platforms: PlanSlotsView['platforms'] = [];
  for (const config of SLOT_PLATFORMS) {
    const row = rows.find((r) => r.platform === config.id);
    if (!row) continue;
    const unitSlots = row.grant_slots ?? 100;
    const total = plan.slots?.[config.id] ?? 0;
    platforms.push({
      id: config.id,
      group: config.group,
      unitCents: row.price_cents,
      unitSlots,
      included: total < 0 ? -1 : Math.max(0, total - (bought[config.id] ?? 0)),
      units: Math.floor((bought[config.id] ?? 0) / unitSlots),
      inUse: used.get(config.id) ?? 0,
    });
  }
  return platforms.length ? { state, platforms } : null;
}
