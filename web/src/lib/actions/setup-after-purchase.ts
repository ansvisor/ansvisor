'use server';

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isCloud, isSubscriptionActive } from '@/config/plans';
import { alignPromptsToPlanForOrg } from '@/lib/plan-engines';
import { hideDemoBrandAfterPurchase } from '@/lib/demo/hide-after-purchase';
import { startFirstRunForBrand } from '@/lib/billing/first-run';
import {
  assertWritable,
  DemoBrandError,
  SubscriptionInactiveError,
} from '@/lib/subscription-guard';
import { canSetUpBrand } from '@/lib/onboarding/setup-after-purchase';

/** Who is asking, in the logs. */
const CTX = 'onboarding/setup-after-purchase';

/**
 * How finishing setup after purchase went:
 * - `no_plan`: the plan isn't active or trialing (any more): the page goes
 *   to the plan step, as onboarding does without a plan;
 * - `forbidden`: no organization, or a role that can't set up a brand;
 * - `not_found`: not a brand of the person's organization, or the demo brand;
 * - `failed`: a read or the last write failed: Finish can be pressed again.
 */
export type FinishSetupResult =
  | { ok: true; jobId: string | null }
  | { ok: false; reason: 'no_plan' | 'forbidden' | 'not_found' | 'failed' };

/**
 * The end of setup after purchase (lib/onboarding/setup-after-purchase.ts):
 * the organization's plan is active or trialing, and the brand just set up is
 * its first own brand. As the Stripe return page does after a purchase, the
 * prompts are aligned to the plan, the demo brand stays hidden and the
 * brand's first tracking run starts; then onboarding is marked completed.
 * Resolves to the run's job id, for the dashboard's progress bar (null when
 * none could be started: the nightly run tracks the brand anyway).
 *
 * The brand id comes from the browser: it must be a brand of the person's
 * organization, never the demo brand, and every service-role read and write
 * is scoped to that organization. Only admins and managers, who can create a
 * brand. Pressed again (a retry), it does the same and hands back the same
 * run: the alignment and the demo's hiding change nothing twice, and the
 * API's one-run-per-purchase guard returns the run already started.
 */
export async function finishSetupAfterPurchase(brandId: string): Promise<FinishSetupResult> {
  try {
    await assertWritable({ brandId });
  } catch (err) {
    if (err instanceof SubscriptionInactiveError) return { ok: false, reason: 'no_plan' };
    if (err instanceof DemoBrandError) return { ok: false, reason: 'not_found' };
    throw err;
  }
  // A self-hosted install has no plan: its setup starts its run itself.
  if (!isCloud()) return { ok: false, reason: 'no_plan' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'forbidden' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .maybeSingle();
  const orgId = profile?.organization_id;
  if (!orgId || !canSetUpBrand(profile?.role)) return { ok: false, reason: 'forbidden' };

  const [orgRead, brandRead] = await Promise.all([
    supabaseAdmin
      .from('organizations')
      .select('plan, subscription_status')
      .eq('id', orgId)
      .maybeSingle(),
    supabaseAdmin
      .from('brands')
      .select('id')
      .eq('id', brandId)
      .eq('organization_id', orgId)
      .eq('is_demo', false)
      .maybeSingle(),
  ]);
  if (orgRead.error || brandRead.error) {
    console.error(`[${CTX}] Could not read the organization or the brand:`, {
      org: orgRead.error,
      brand: brandRead.error,
    });
    return { ok: false, reason: 'failed' };
  }
  const org = orgRead.data;
  if (!org || !isSubscriptionActive(org.subscription_status)) {
    return { ok: false, reason: 'no_plan' };
  }
  if (!brandRead.data) return { ok: false, reason: 'not_found' };

  // The prompts saved in setup, on the plan's engines: as the return page
  // aligns them after a purchase. Idempotent; a failure keeps the prompts.
  const planId = org.plan || 'starter';
  try {
    const result = await alignPromptsToPlanForOrg(orgId, planId);
    console.log(
      `[${CTX}] Aligned ${result.promptCount} prompt(s) to plan=${planId} for org ${orgId}`,
    );
  } catch (err) {
    console.error(`[${CTX}] Plan-engine alignment threw:`, err);
  }

  // The demo brand stays out of the brand list, as after a purchase.
  await hideDemoBrandAfterPurchase(orgId, org.subscription_status, CTX);

  // The return page and the webhook found no brand then and started nothing:
  // the first run starts now, for this brand.
  const jobId = await startFirstRunForBrand({
    orgId,
    brandId: brandRead.data.id,
    subscriptionStatus: org.subscription_status,
    ctx: CTX,
  });

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ onboarding_completed: true })
    .eq('id', user.id);
  if (profileError) {
    console.error(`[${CTX}] Could not mark onboarding completed:`, profileError);
    return { ok: false, reason: 'failed' };
  }
  return { ok: true, jobId };
}
