import { isSubscriptionActive } from '@/config/plans';
import { withJobId } from '@/config/home';
import { countPlanBrands } from '@/lib/plan-brand-count';

/**
 * Setup after purchase (onboarding's new order, PR 1 of 3; the owner's
 * decision of 2026-11-16): an organization whose plan is active or trialing
 * but that has no brand of its own goes through onboarding's setup steps
 * (website, market, topics, prompts, competitors), never its plan step. When
 * setup ends, the prompts are aligned to the plan and the new brand's first
 * tracking run starts at once (lib/actions/setup-after-purchase.ts).
 *
 * Whether setup is due, or resumes, is read from the organization's data
 * (readSetupProgress), never from onboarding_completed, which setup after
 * purchase leaves as it is. A plan that lapsed after a subscription never
 * opens setup: the dashboard opens read-only, Billing included (planLapsed).
 *
 * A plain module: the dashboard's layout, the onboarding layout and the
 * onboarding page all decide with it, so none of them sends the person back
 * to where the other came from.
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
 * today, whether setup is due or was started and left (readSetupProgress).
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
 * A plan that lapsed after the organization had one: Stripe gave it a
 * subscription (its stripe_subscription_id stays once given), which is now
 * past_due, unpaid, canceled, incomplete_expired or anything else but active
 * or trialing. On the cloud, the dashboard opens read-only for it, Billing
 * included, whether onboarding was finished or not: never onboarding, whose
 * writes such a plan refuses (assertWritable), so an admin can always pay.
 */
export function planLapsed({
  cloud,
  subscriptionStatus,
  everSubscribed,
}: {
  cloud: boolean;
  subscriptionStatus: string | null | undefined;
  /** The organization has a Stripe subscription id. */
  everSubscribed: boolean;
}): boolean {
  return cloud && everSubscribed && !isSubscriptionActive(subscriptionStatus);
}

/**
 * The organization's own brands among these: every one but the demo brand
 * (sample data, 00380), a paused one too. A paused brand means the
 * organization had one, so it is never sent to setup.
 */
export function ownBrandCount(brands: readonly { isDemo?: boolean | null }[]): number {
  return brands.filter((brand) => !brand.isDemo).length;
}

/**
 * Where the organization's setup after purchase stands (readSetupProgress):
 * - `due`: no brand of its own at all (a paused one counts, the demo brand
 *   doesn't): setup opens at its first step;
 * - `unfinished`: its one brand was set up part-way and left before Finish
 *   (no competitor, which Finish saves first, and never tracked): setup
 *   resumes on it, where it stopped;
 * - null: neither, or it couldn't be read, which decides nothing.
 */
export type SetupProgress = 'due' | 'unfinished' | null;

export interface SetupAfterPurchaseGate {
  /** Ansvisor Cloud (isCloud()); a self-hosted install has no plan. */
  cloud: boolean;
  /** The organization's Stripe subscription status. */
  subscriptionStatus: string | null | undefined;
  /** The person's role in the organization. */
  role: string | null | undefined;
  /**
   * The setup-deferred cookie is set (isSetupDeferredValue). The dashboard
   * passes it; the onboarding page doesn't, so setup still opens there.
   */
  deferred?: boolean;
}

export interface SetupAfterPurchaseFacts extends SetupAfterPurchaseGate {
  /** Where setup stands, from the organization's data (readSetupProgress). */
  progress: SetupProgress;
}

/**
 * Whether setup after purchase may open for the person, before anything is
 * read: on the cloud, the plan active or trialing, someone who can set up a
 * brand, and not put off (isSetupDeferred). A plan that isn't active never
 * opens it: a lapsed one opens the dashboard read-only (planLapsed).
 */
export function setupAfterPurchaseMayOpen({
  cloud,
  subscriptionStatus,
  role,
  deferred = false,
}: SetupAfterPurchaseGate): boolean {
  return (
    cloud &&
    isSubscriptionActive(subscriptionStatus) &&
    canSetUpBrand(role) &&
    !isSetupDeferred({ cloud, subscriptionStatus, role, deferred })
  );
}

/**
 * Whether the person goes to setup after purchase: it may open for them
 * (setupAfterPurchaseMayOpen), and the organization's data says it is due or
 * was left unfinished (readSetupProgress). Everyone else keeps the way they
 * go today.
 */
export function needsSetupAfterPurchase({ progress, ...gate }: SetupAfterPurchaseFacts): boolean {
  return setupAfterPurchaseMayOpen(gate) && progress !== null;
}

/** The reads readSetupProgress makes: the person's own session, browser or server. */
type SetupReader = Parameters<typeof countPlanBrands>[0];

/** A brand as the reads have it: the demo brand and a paused one told apart. */
interface ProgressBrand {
  id: string;
  isDemo?: boolean | null;
  isActive?: boolean | null;
}

/** Whether a read of a brand's rows found any; null when it failed. */
async function hasAny(
  read: PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<boolean | null> {
  const { data, error } = await read;
  if (error) return null;
  return (data?.length ?? 0) > 0;
}

/**
 * Where the organization's setup after purchase stands (SetupProgress), from
 * its data, through the person's own session: the dashboard's layout and the
 * onboarding page read it the same way, so one never sends the person back to
 * the other.
 *
 * `brands`: the brands the person sees, when read already (the layout's);
 * else they are read here. With none of its own in sight, the organization's
 * count has the last word (a Selected-brands manager may see none): 0 is
 * `due`. With exactly one, active, in sight: setup was left unfinished when
 * that brand has no competitor (Finish saves them before anything else),
 * was never tracked (no run in its ledger, tracking_runs, kept for good) and
 * is the organization's only one. Cheapest first: an established brand stops
 * at its competitors. Never throws: a failed read is null.
 */
export async function readSetupProgress(
  supabase: SetupReader,
  organizationId: string,
  brands?: readonly ProgressBrand[],
): Promise<SetupProgress> {
  try {
    let seen = brands;
    if (!seen) {
      const { data, error } = await supabase
        .from('brands')
        .select('id, is_active')
        .eq('organization_id', organizationId)
        .eq('is_demo', false)
        .limit(2);
      if (error) return null;
      seen = (data ?? []).map((row) => ({ id: row.id, isActive: row.is_active }));
    }
    const own = seen.filter((brand) => !brand.isDemo);
    if (own.length === 0) {
      return (await countPlanBrands(supabase, organizationId)) === 0 ? 'due' : null;
    }
    if (own.length > 1 || own[0].isActive === false) return null;
    const brandId = own[0].id;

    const competitors = await hasAny(
      supabase.from('competitors').select('id').eq('brand_id', brandId).limit(1),
    );
    if (competitors !== false) return null;
    const tracked = await hasAny(
      supabase.from('tracking_runs').select('id').eq('brand_id', brandId).limit(1),
    );
    if (tracked !== false) return null;
    return (await countPlanBrands(supabase, organizationId)) === 1 ? 'unfinished' : null;
  } catch {
    return null;
  }
}

/**
 * Onboarding's analytics in setup after purchase: today's events and step
 * names, with this property. Nothing is added to today's flow.
 */
export function setupFlowProps(afterPurchase: boolean): { setup_after_purchase?: true } {
  return afterPurchase ? { setup_after_purchase: true } : {};
}

/**
 * Where setup after purchase lands: /dashboard, with the first run's job,
 * which opens the person's home with it (config/home.ts: Prompts › Tracked
 * Prompts, or Action Center › Today when Prompts is off their menu), as the
 * Stripe return page lands. TrackingJobHandoff keeps the job for the
 * progress bar, and the page's first-run line reads the run.
 */
export function setupLanding(jobId: string | null): string {
  return withJobId('/dashboard', jobId);
}
