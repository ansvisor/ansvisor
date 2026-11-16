import { isSubscriptionActive } from '@/config/plans';
import { DASHBOARD_HOME } from '@/config/home';

/**
 * Setup after purchase (onboarding's new order, PR 1 of 3; the owner's
 * decision of 2026-11-16): an organization whose plan is active or trialing
 * but that has no brand of its own goes through onboarding's setup steps
 * (website, market, topics, prompts, competitors), never its plan step. When
 * setup ends, the prompts are aligned to the plan and the new brand's first
 * tracking run starts at once (lib/actions/setup-after-purchase.ts).
 *
 * A plain module: the dashboard's layout and the onboarding page both decide
 * with it.
 */

/**
 * Whether someone may set up a brand: the people who can create one, admins
 * and managers (the brands insert policy, 00380; the Brands page's Add Brand).
 * An invited analyst or agency partner is never sent to setup.
 */
export function canSetUpBrand(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'manager';
}

/**
 * Whether someone manages the plan: admins only, as Billing lets only them
 * change or cancel it (/api/stripe/subscription). They are the ones offered
 * "Manage your plan" on the setup screens.
 */
export function canManagePlan(role: string | null | undefined): boolean {
  return role === 'admin';
}

/**
 * Setup after purchase put off for a while: "Manage your plan" on the setup
 * screens sets this cookie and opens Billing, so an admin can change or
 * cancel the plan (a trial, say) before setting up a brand. While it lasts,
 * the dashboard doesn't send them back to setup; the onboarding page ignores
 * it, so setup still opens there.
 */
export const SETUP_DEFERRED_COOKIE = 'ansvisor_setup_deferred';

/** How long setup stays put off, in seconds: half an hour. */
export const SETUP_DEFERRED_MAX_AGE = 30 * 60;

/** Settings › Billing, where the plan is changed or cancelled. */
export const SETUP_BILLING_HREF = '/dashboard/settings/billing';

/** The cookie that puts setup off, as document.cookie takes it. */
export function setupDeferredCookie({ secure }: { secure: boolean }): string {
  return `${SETUP_DEFERRED_COOKIE}=1; path=/; max-age=${SETUP_DEFERRED_MAX_AGE}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** Whether the cookie's value says setup is put off. */
export function isSetupDeferredValue(value: string | null | undefined): boolean {
  return value === '1';
}

/**
 * Whether setup after purchase is put off for this person: the cookie set, on
 * the cloud, with the plan active or trialing, for an admin (who manages the
 * plan). Then the dashboard opens for them, as for a workspace with no brand
 * today, whether setup is due or was started and left (onboarding open).
 */
export function isSetupDeferred({
  cloud,
  subscriptionStatus,
  role,
  deferred,
}: {
  cloud: boolean;
  subscriptionStatus: string | null | undefined;
  role: string | null | undefined;
  /** The cookie is set (isSetupDeferredValue). */
  deferred: boolean;
}): boolean {
  return deferred && cloud && isSubscriptionActive(subscriptionStatus) && canManagePlan(role);
}

/**
 * The organization's own brands among these: every one but the demo brand
 * (sample data, 00380), a paused one too. A paused brand means the
 * organization had one, so it is never sent to setup.
 */
export function ownBrandCount(brands: readonly { isDemo?: boolean | null }[]): number {
  return brands.filter((brand) => !brand.isDemo).length;
}

export interface SetupAfterPurchaseFacts {
  /** Ansvisor Cloud (isCloud()); a self-hosted install has no plan. */
  cloud: boolean;
  /** The organization's Stripe subscription status. */
  subscriptionStatus: string | null | undefined;
  /** The person's role in the organization. */
  role: string | null | undefined;
  /**
   * The organization's own brands, active or paused, the demo brand left
   * out (org_brand_count); null when it couldn't be read, which decides
   * nothing.
   */
  ownBrands: number | null;
  /**
   * The setup-deferred cookie is set (isSetupDeferredValue). The dashboard
   * passes it; the onboarding page doesn't, so setup still opens there.
   */
  deferred?: boolean;
}

/**
 * Whether the person goes to setup after purchase: on the cloud, the plan
 * active or trialing, no brand of the organization's own at all, and someone
 * who can set one up, unless they put it off (isSetupDeferred). Everyone else
 * keeps the way they go today.
 */
export function needsSetupAfterPurchase({
  cloud,
  subscriptionStatus,
  role,
  ownBrands,
  deferred = false,
}: SetupAfterPurchaseFacts): boolean {
  return (
    cloud &&
    isSubscriptionActive(subscriptionStatus) &&
    canSetUpBrand(role) &&
    ownBrands === 0 &&
    !isSetupDeferred({ cloud, subscriptionStatus, role, deferred })
  );
}

/**
 * Onboarding's analytics in setup after purchase: today's events and step
 * names, with this property. Nothing is added to today's flow.
 */
export function setupFlowProps(afterPurchase: boolean): { setup_after_purchase?: true } {
  return afterPurchase ? { setup_after_purchase: true } : {};
}

/**
 * Where setup after purchase lands: the dashboard's home, with the first
 * run's job, as the Stripe return page lands (TrackingJobHandoff keeps it for
 * the progress bar).
 */
export function setupLanding(jobId: string | null): string {
  return jobId ? `${DASHBOARD_HOME}?jobId=${encodeURIComponent(jobId)}` : DASHBOARD_HOME;
}
