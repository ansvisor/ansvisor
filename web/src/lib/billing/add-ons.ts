/**
 * Add-on packs (CHAT-18, 00413), behind CHAT_AGENTIC: AI credits and storage
 * a workspace's Admins buy with Stripe when a limit runs out. The same
 * catalog holds Growth's add-ons (00546: extra tracking, extra brands, AI
 * top-ups), which are not sold yet; CHAT-18's paths read only its own kinds.
 *
 *   - AI credits: one payment (a Stripe Checkout in payment mode, its invoice
 *     carrying the pack's line), valid 12 months, adding half its price in
 *     model cost to the AI budget (the server's ai-credits.js draws on it).
 *   - Storage: a monthly item added to the plan's Stripe subscription,
 *     prorated for the current period and charged to the card on file, then
 *     renewed with the plan.
 *
 * Nothing is granted before Stripe says it was paid: only the webhook writes
 * grants (add-on-webhook.ts). Each Stripe object a pack makes carries the
 * purchase's id in its metadata, so the webhook finds it again.
 */

import type Stripe from 'stripe';

/**
 * The Stripe client, loaded only when a pack's purchase or webhook needs it;
 * null without STRIPE_SECRET_KEY (local development, self-hosted). lib/
 * stripe.ts makes its client when it is loaded and throws without the key,
 * so importing it at the top of a module that Settings loads (a server
 * action's bundle) would break every action beside it.
 */
export async function loadStripe(): Promise<Stripe | null> {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return (await import('@/lib/stripe')).stripe;
}

/** The metadata key that names the add_on_purchases row on a pack's Stripe objects. */
export const ADD_ON_PURCHASE_KEY = 'add_on_purchase_id';

/** CHAT-18's packs (00413): AI credits and storage, on Settings › Billing › Add-ons. */
export type AddOnKind = 'ai' | 'storage';

/**
 * Every kind in the catalog: CHAT-18's packs, and Growth's add-ons (00546):
 * an extra tracking tier and extra brands on the plan's subscription, and
 * one-time AI top-ups.
 */
export type AddOnProductKind = AddOnKind | 'tracking' | 'brand' | 'ai_topup';

/** The kinds CHAT-18's card, purchase and history handle; the Growth add-ons have their own. */
export const ADD_ON_PACK_KINDS: readonly AddOnKind[] = ['ai', 'storage'];

/** An add_on_products row: the add-ons on sale, staff-edited. Server only (dollars of model cost). */
export interface AddOnProductRow {
  id: string;
  kind: AddOnProductKind;
  name: string;
  price_cents: number;
  currency: string;
  billing: 'one_time' | 'monthly' | 'yearly';
  grant_ai_usd: number | null;
  grant_bytes: number | null;
  /** Tracking: the prompt locations its tier adds. */
  grant_prompts: number | null;
  /** Brand: the brands one unit adds. */
  grant_brands: number | null;
  /** AI top-up: the briefs and opportunities it adds this period. */
  grant_briefs: number | null;
  grant_opportunities: number | null;
  /** AI top-up: its "+Nx". */
  multiplier: number | null;
  valid_months: number | null;
  /** The Stripe price's lookup key; the server resolves it into stripe_price_id. */
  stripe_lookup_key: string | null;
  stripe_price_id: string | null;
  /** contact_sales: shown with "Contact sales", never sold. */
  sale: 'self_serve' | 'contact_sales';
  /** Who may buy it; null: any paid plan (CHAT-18's packs). */
  plans: string[] | null;
  active: boolean;
  highlight: boolean;
  sort: number;
}

/** A CHAT-18 pack's row. */
export type AddOnPackRow = AddOnProductRow & { kind: AddOnKind };

export const ADD_ON_PRODUCT_COLUMNS =
  'id, kind, name, price_cents, currency, billing, grant_ai_usd, grant_bytes, grant_prompts, grant_brands, grant_briefs, grant_opportunities, multiplier, valid_months, stripe_lookup_key, stripe_price_id, sale, plans, active, highlight, sort';

/**
 * An add-on is sold only while it is active, sold in the product (not
 * "Contact sales") and has its Stripe price on this deployment.
 */
export function addOnOnSale(
  product: Pick<AddOnProductRow, 'active' | 'stripe_price_id' | 'sale'>,
): boolean {
  return product.active && product.sale === 'self_serve' && !!product.stripe_price_id;
}

/** Whether a workspace on `planId` may buy it (null `plans`: any paid plan). */
export function addOnForPlan(product: Pick<AddOnProductRow, 'plans'>, planId: string): boolean {
  return !product.plans || product.plans.includes(planId);
}

/** The Stripe interval a recurring add-on bills on; null for a one-time one. */
export function addOnInterval(product: Pick<AddOnProductRow, 'billing'>): 'month' | 'year' | null {
  if (product.billing === 'monthly') return 'month';
  if (product.billing === 'yearly') return 'year';
  return null;
}

/**
 * The extra tracking tiers on one interval (the plan's: an item must share
 * it), active, smallest first. "Contact sales" tiers stay in the list; they
 * are shown, not sold (`addOnOnSale`).
 */
export function trackingTiers<T extends AddOnProductRow>(
  products: readonly T[],
  interval: 'month' | 'year',
): T[] {
  return products
    .filter(
      (p) => p.kind === 'tracking' && p.active && p.grant_prompts && addOnInterval(p) === interval,
    )
    .sort((a, b) => (a.grant_prompts ?? 0) - (b.grant_prompts ?? 0));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The purchase a Stripe object's metadata names, or null when it isn't a pack's. */
export function purchaseIdOf(metadata: Record<string, string> | null | undefined): string | null {
  const id = metadata?.[ADD_ON_PURCHASE_KEY];
  return typeof id === 'string' && UUID.test(id) ? id : null;
}

/**
 * `months` after `from`, in UTC, on the same day or the month's last when it
 * is shorter (31 January + 1 month = 28 or 29 February).
 */
export function addMonthsUtc(from: Date, months: number): Date {
  const day = from.getUTCDate();
  const shifted = new Date(from.getTime());
  shifted.setUTCDate(1);
  shifted.setUTCMonth(shifted.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
  ).getUTCDate();
  shifted.setUTCDate(Math.min(day, lastDay));
  return shifted;
}

/** The lookup keys of Growth's add-on prices (00546): addon_tracking_…, addon_brand_…, addon_ai_topup_…. */
export const ADD_ON_LOOKUP_PREFIX = 'addon_';

/** The `addon` metadata Growth's add-on prices carry in Stripe. */
const ADD_ON_METADATA = new Set(['tracking', 'brand', 'ai_topup']);

/** A Stripe price as an item or a line carries it. */
export type PriceLike = {
  id?: string;
  lookup_key?: string | null;
  metadata?: Record<string, string> | null;
};

/**
 * Whether a Stripe price is one of Growth's add-ons: its lookup key or its
 * `addon` metadata says so. Read from Stripe, so a price the catalog hasn't
 * resolved yet counts too.
 */
export function isAddOnPrice(price: PriceLike | string | null | undefined): boolean {
  if (!price || typeof price === 'string') return false;
  if (price.lookup_key?.startsWith(ADD_ON_LOOKUP_PREFIX)) return true;
  return ADD_ON_METADATA.has(price.metadata?.addon ?? '');
}

/** A subscription item as the plan's routes read it. */
type SubscriptionItemLike = {
  metadata?: Record<string, string> | null;
  price?: PriceLike | string | null;
};

/**
 * The plan's item on a subscription that may also hold add-ons: the first
 * that is neither a CHAT-18 pack's (its item carries its purchase in its
 * metadata) nor a Growth add-on's (its price says so). A plan change or a
 * price read must never take one of theirs; with no plan's item there is
 * none.
 */
export function planItemOf<T extends SubscriptionItemLike>(items: readonly T[]): T | undefined {
  return items.find((item) => !purchaseIdOf(item.metadata) && !isAddOnPrice(item.price));
}
