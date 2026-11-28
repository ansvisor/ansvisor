import { isSubscriptionActive } from '@/config/plans';
import type { StartChoice } from '@/lib/billing/plan-purchase';

/**
 * Onboarding's new order on the cloud, "card first" (PR 2 of 3; the owner's
 * decision of 2026-11-16): a new admin starts on the choice, the plan step's
 * cards moved to the front. The 7-day free trial (or a plan bought) takes
 * the card first, in Stripe Checkout; then setup after purchase
 * (setup-after-purchase.ts) sets up the brand and starts its first run. The
 * sample brand opens the demo at once, with no setup; buying from it leads
 * to the same setup.
 *
 * A plain module: the onboarding page decides with it, and its analytics
 * read it. A self-hosted install keeps its setup steps, with no choice.
 */

export interface StartChoiceFacts {
  /** Ansvisor Cloud (isCloud()). */
  cloud: boolean;
  /** The person's profile has an organization already. */
  hasOrganization: boolean;
  /** The person's role (a new account's creator is its admin). */
  role: string | null | undefined;
  /** The organization's Stripe subscription status. */
  subscriptionStatus?: string | null;
  /** The organization ever had a subscription (its stripe_subscription_id). */
  everSubscribed?: boolean;
  /**
   * The organization's own brands, the demo brand left out; null when they
   * couldn't be read, which decides nothing.
   */
  ownBrands?: number | null;
}

/**
 * Whether onboarding opens on the choice: on the cloud, for an admin (only
 * an admin buys a plan), with no organization yet, or with one that never
 * had a plan and has no brand of its own (the choice screen made it, the
 * person came back from a canceled Checkout, or explored the sample brand
 * and came back). Someone who set up a brand under the old order keeps the
 * plan step after setup, with their brand; a plan active goes to setup.
 */
export function opensOnStartChoice({
  cloud,
  hasOrganization,
  role,
  subscriptionStatus = null,
  everSubscribed = false,
  ownBrands = null,
}: StartChoiceFacts): boolean {
  if (!cloud || role !== 'admin') return false;
  if (!hasOrganization) return true;
  return !isSubscriptionActive(subscriptionStatus) && !everSubscribed && ownBrands === 0;
}

/** The choice made, as analytics names it. */
export type StartChoiceName = 'trial' | 'monthly' | 'yearly' | 'demo';

const CHOICE_NAMES: Record<StartChoice | 'demo', StartChoiceName> = {
  trial: 'trial',
  month: 'monthly',
  year: 'yearly',
  demo: 'demo',
};

/** The choice made on the plan step, wherever it stands, as analytics names it. */
export function startChoiceName(choice: StartChoice | 'demo'): StartChoiceName {
  return CHOICE_NAMES[choice];
}

/**
 * The plan step's analytics where it is onboarding's first screen: today's
 * events and step name ('plan'), with `position: 'first'`. Nothing is added
 * where it comes last.
 */
export function startPositionProps(first: boolean): { position?: 'first' } {
  return first ? { position: 'first' } : {};
}

/**
 * The name a workspace made on the choice screen takes once its first brand
 * is set up: the brand's, as a workspace made with its brand has had, while
 * it still has the name it was made with (`placeholder`). Null leaves it as
 * it is (renamed in Settings since, or no brand name).
 */
export function workspaceNameFromBrand({
  current,
  placeholder,
  brandName,
}: {
  current: string | null | undefined;
  placeholder: string;
  brandName: string;
}): string | null {
  const name = brandName.trim();
  if (!name || current == null) return null;
  return current.trim() === placeholder.trim() ? name : null;
}
