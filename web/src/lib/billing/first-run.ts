import { supabaseAdmin } from '@/lib/supabase/admin';
import { API_BASE_URL } from '@/config/api';
import { isSubscriptionActive } from '@/config/plans';

/** Each call to the API gets this long, so a slow server never holds up a webhook. */
const API_TIMEOUT_MS = 5_000;

/**
 * The organization's first brand that is not paused: the one onboarding
 * created. Never the demo brand (00380): it is sample data and never tracked.
 */
async function firstBrandId(orgId: string): Promise<string | null> {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .eq('is_demo', false)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return brand?.id ?? null;
}

async function callApi(path: string, body: Record<string, unknown>, cronSecret: string) {
  return fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
}

/**
 * Ask the API for the brand's first run (one per purchase: it hands back the
 * run that already covers `since`). Resolves to the run's job id, or null.
 * Never throws.
 */
async function requestFirstRun(
  brandId: string,
  since: string | undefined,
  cronSecret: string,
  ctx: string,
): Promise<string | null> {
  try {
    const res = await callApi('/api/internal/trigger-tracking', { brandId, since }, cronSecret);
    if (!res.ok) {
      console.error(`[${ctx}] First run trigger failed:`, res.status);
      return null;
    }
    const { jobId, created } = (await res.json()) as { jobId?: string; created?: boolean };
    console.log(
      `[${ctx}] First run ${created === false ? 'already started' : 'started'} for brand:`,
      brandId,
      'jobId:',
      jobId,
    );
    return jobId ?? null;
  } catch (err) {
    console.error(`[${ctx}] Failed to start the first run:`, err);
    return null;
  }
}

/**
 * Start an organization's first tracking run after a purchase, from the
 * Stripe return page or the webhook, whichever comes first: the person may
 * close the tab before the return page loads, and the prompts saved in
 * onboarding would then wait for the nightly run. The webhook also starts it
 * when a delayed payment (SEPA, for one) goes through later. The API starts
 * one run per purchase (server/src/lib/first-run.js), so the second caller
 * gets the first one's job back; the API also starts the volume analysis
 * with the run it starts.
 *
 * Only for a subscription that is active or trialing: an incomplete one (a
 * payment not made) gets nothing. Resolves to the run's job id, for the
 * dashboard's progress bar, or null. Never throws: the payment is done
 * whatever happens here, and the nightly run tracks the brand anyway.
 */
export async function startFirstTrackingRun({
  orgId,
  subscriptionStatus,
  purchaseStarted,
  ctx,
}: {
  orgId: string;
  subscriptionStatus: string | null | undefined;
  /**
   * When the purchase began, in Stripe's Unix seconds: the Checkout
   * Session's `created`, or the subscription's.
   */
  purchaseStarted?: number | null;
  /** Who is asking, for the logs. */
  ctx: string;
}): Promise<string | null> {
  if (!isSubscriptionActive(subscriptionStatus)) {
    console.log(`[${ctx}] No first run: subscription is ${subscriptionStatus ?? 'missing'}`);
    return null;
  }
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return null;

  try {
    const brandId = await firstBrandId(orgId);
    if (!brandId) return null;

    const since = purchaseStarted ? new Date(purchaseStarted * 1000).toISOString() : undefined;
    return await requestFirstRun(brandId, since, cronSecret, ctx);
  } catch (err) {
    console.error(`[${ctx}] Failed to start the first run:`, err);
    return null;
  }
}

/**
 * Start the first tracking run of a brand set up after the purchase
 * (onboarding's setup after purchase): the return page and the webhook found
 * no brand then, so they started nothing, and the run starts when setup ends.
 *
 * The brand must be the organization's own: active, not the demo brand, and
 * of this organization (an id from the browser is never trusted). The API's
 * one-run-per-purchase guard is asked from the brand's creation: a run of
 * the brand waiting, running, or finished since it was made covers it, so a
 * second call (Finish pressed twice, a retry, a late webhook) gets the same
 * run back and never starts another. Only for a subscription that is active
 * or trialing. Resolves to the run's job id, or null. Never throws.
 */
export async function startFirstRunForBrand({
  orgId,
  brandId,
  subscriptionStatus,
  ctx,
}: {
  orgId: string;
  brandId: string;
  subscriptionStatus: string | null | undefined;
  /** Who is asking, for the logs. */
  ctx: string;
}): Promise<string | null> {
  if (!isSubscriptionActive(subscriptionStatus)) {
    console.log(`[${ctx}] No first run: subscription is ${subscriptionStatus ?? 'missing'}`);
    return null;
  }
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return null;

  try {
    const { data: brand, error } = await supabaseAdmin
      .from('brands')
      .select('id, created_at')
      .eq('id', brandId)
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .eq('is_demo', false)
      .maybeSingle();
    if (error) {
      console.error(`[${ctx}] Could not read the brand for its first run:`, error);
      return null;
    }
    if (!brand) {
      console.log(`[${ctx}] No first run: brand ${brandId} is not an active own brand of ${orgId}`);
      return null;
    }
    const made = Date.parse(brand.created_at);
    const since = Number.isNaN(made) ? undefined : new Date(made).toISOString();
    return await requestFirstRun(brand.id, since, cronSecret, ctx);
  } catch (err) {
    console.error(`[${ctx}] Failed to start the first run:`, err);
    return null;
  }
}
