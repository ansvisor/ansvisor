import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { stripe, PRICE_IDS } from '@/lib/stripe';
import { SUBSCRIBABLE_PLANS } from '@/config/plans';
import { alignPromptsToPlanForOrg } from '@/lib/plan-engines';

type SubscriptionItem = {
  id: string;
  current_period_end?: number;
  price: {
    unit_amount: number | null;
    recurring: { interval: string } | null;
  };
};

type SubscriptionRaw = {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  metadata: Record<string, string>;
  items: { data: SubscriptionItem[] };
  // Some older API versions still return this on the subscription itself.
  // Newer versions (2025-03-31+) moved it to subscription items.
  current_period_end?: number;
};

/**
 * Stripe API 2025-03-31 moved `current_period_end` from the subscription
 * onto each subscription item. Read item-level first, fall back to the
 * subscription-level for older API versions, and return null if neither is
 * present (so callers can skip emitting an Invalid Date).
 */
function getCurrentPeriodEndIso(sub: SubscriptionRaw): string | null {
  const itemEnd = sub.items?.data?.[0]?.current_period_end;
  const subEnd = sub.current_period_end;
  const epochSeconds =
    typeof itemEnd === 'number' ? itemEnd : typeof subEnd === 'number' ? subEnd : null;
  if (epochSeconds == null) return null;
  return new Date(epochSeconds * 1000).toISOString();
}

async function getOrgStripeIds() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!profile?.organization_id) return null;

  const { data: org } = await supabase
    .from('organizations')
    .select(
      'id, plan, subscription_status, stripe_customer_id, stripe_subscription_id, subscription_ends_at',
    )
    .eq('id', profile.organization_id)
    .single();

  return org;
}

/** GET — current subscription details */
export async function GET() {
  try {
    const org = await getOrgStripeIds();
    if (!org) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!org.stripe_subscription_id) {
      return NextResponse.json({
        planId: org.plan ?? 'starter',
        status: org.subscription_status ?? 'inactive',
        currentPeriodEnd: org.subscription_ends_at,
        cancelAtPeriodEnd: false,
        priceAmount: null,
        interval: null,
      });
    }

    const sub = (await stripe.subscriptions.retrieve(
      org.stripe_subscription_id as string,
    )) as unknown as SubscriptionRaw;

    const item = sub.items.data[0];
    const price = item?.price;

    return NextResponse.json({
      planId: org.plan ?? 'starter',
      status: sub.status,
      currentPeriodEnd: getCurrentPeriodEndIso(sub),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      priceAmount: price?.unit_amount ? price.unit_amount / 100 : null,
      interval: price?.recurring?.interval ?? null,
    });
  } catch (err) {
    console.error('[stripe/subscription] GET error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

/** PATCH — change plan (upgrade/downgrade) or reactivate */
export async function PATCH(req: NextRequest) {
  try {
    const org = await getOrgStripeIds();
    if (!org) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!org.stripe_subscription_id) {
      return NextResponse.json({ error: 'No active subscription' }, { status: 400 });
    }

    const body = await req.json();
    const { newPlanId, reactivate } = body as {
      newPlanId?: 'starter' | 'growth';
      reactivate?: boolean;
    };

    const subscriptionId = org.stripe_subscription_id as string;

    // Reactivate a canceled-at-period-end subscription
    if (reactivate) {
      const updated = (await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
      })) as unknown as SubscriptionRaw;
      return NextResponse.json({
        status: updated.status,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: getCurrentPeriodEndIso(updated),
      });
    }

    // Plan change
    if (!newPlanId || !SUBSCRIBABLE_PLANS.includes(newPlanId)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }

    if (newPlanId === org.plan) {
      return NextResponse.json({ error: 'Already on this plan' }, { status: 400 });
    }

    const priceId = PRICE_IDS[newPlanId]?.monthly;
    if (!priceId) {
      return NextResponse.json({ error: 'Price not configured' }, { status: 400 });
    }

    const currentSub = (await stripe.subscriptions.retrieve(
      subscriptionId,
    )) as unknown as SubscriptionRaw;
    const itemId = currentSub.items.data[0]?.id;

    if (!itemId) {
      return NextResponse.json({ error: 'Subscription item not found' }, { status: 400 });
    }

    const updated = (await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: itemId, price: priceId }],
      metadata: { plan_id: newPlanId, organization_id: org.id },
      proration_behavior: 'create_prorations',
    })) as unknown as SubscriptionRaw;

    // Optimistic DB update. Stripe has already accepted the plan change, so
    // this is the server mirroring its own decision, not the caller writing
    // their own plan — hence the service role, same as the webhook.
    await supabaseAdmin.from('organizations').update({ plan: newPlanId }).eq('id', org.id);

    // Align prompts to the new plan's engine set so an upgrade actually
    // expands (Starter → Growth: 2 → 8 engines) or trims (Growth → Starter:
    // 8 → 2) the tracked engines. Same helper used by the Stripe success
    // route (#78) and the webhook (#79). We do it here too because PATCH
    // performs the optimistic plan write itself — by the time the matching
    // `subscription.updated` webhook arrives, the snapshot guard there
    // would see "plan unchanged" and skip alignment.
    try {
      const result = await alignPromptsToPlanForOrg(org.id, newPlanId);
      console.log(
        `[stripe/subscription] Aligned ${result.promptCount} prompt(s) to plan=${newPlanId} (${result.platforms.length} scrapers, ${result.models.length} models) for org ${org.id}`,
      );
    } catch (alignErr) {
      console.error('[stripe/subscription] Plan-engine alignment threw:', alignErr);
    }

    const newPrice = updated.items.data[0]?.price;

    return NextResponse.json({
      planId: newPlanId,
      status: updated.status,
      currentPeriodEnd: getCurrentPeriodEndIso(updated),
      cancelAtPeriodEnd: updated.cancel_at_period_end,
      priceAmount: newPrice?.unit_amount ? newPrice.unit_amount / 100 : null,
      interval: newPrice?.recurring?.interval ?? null,
    });
  } catch (err) {
    console.error('[stripe/subscription] PATCH error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

/** DELETE — cancel subscription at period end */
export async function DELETE() {
  try {
    const org = await getOrgStripeIds();
    if (!org) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!org.stripe_subscription_id) {
      return NextResponse.json({ error: 'No active subscription' }, { status: 400 });
    }

    const updated = (await stripe.subscriptions.update(org.stripe_subscription_id as string, {
      cancel_at_period_end: true,
    })) as unknown as SubscriptionRaw;

    return NextResponse.json({
      cancelAtPeriodEnd: true,
      currentPeriodEnd: getCurrentPeriodEndIso(updated),
    });
  } catch (err) {
    console.error('[stripe/subscription] DELETE error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
