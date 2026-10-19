import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { alignPromptsToPlanForOrg } from '@/lib/plan-engines';
import type Stripe from 'stripe';

/**
 * Run the shared prompt-engine alignment for an org, logging the result
 * and swallowing errors so a single failed update can't blow up the
 * whole webhook handler (Stripe retries on non-2xx). Each call is
 * idempotent — re-running with the same plan is a no-op write.
 */
async function alignPromptsSafe(orgId: string, planId: string, ctx: string) {
  try {
    const result = await alignPromptsToPlanForOrg(orgId, planId);
    console.log(
      `[webhook:${ctx}] Aligned ${result.promptCount} prompt(s) to plan=${planId} (${result.platforms.length} scrapers, ${result.models.length} models) for org ${orgId}`,
    );
  } catch (err) {
    console.error(`[webhook:${ctx}] Plan-engine alignment threw for org ${orgId}:`, err);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error('[stripe/webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId =
          typeof session.customer === 'string' ? session.customer : session.customer?.id;
        const subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;

        if (customerId && subscriptionId) {
          // Fetch the subscription to get metadata
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const orgId = subscription.metadata.organization_id;
          const planId = subscription.metadata.plan_id;
          console.log(
            '[webhook] checkout.session.completed — orgId:',
            orgId,
            'planId:',
            planId,
            'customerId:',
            customerId,
            'subscriptionId:',
            subscriptionId,
          );

          if (orgId) {
            const { error } = await supabaseAdmin
              .from('organizations')
              .update({
                subscription_status: 'trialing',
                plan: planId || 'starter',
                stripe_customer_id: customerId,
                stripe_subscription_id: subscriptionId,
              })
              .eq('id', orgId);
            if (error) {
              console.error('[webhook] DB update error:', error);
            } else {
              console.log('[webhook] DB updated successfully for org:', orgId);
              // Mirror the success-route alignment so checkouts that race
              // ahead of the redirect (or that happen out-of-band entirely)
              // still get prompts in sync. Idempotent.
              await alignPromptsSafe(orgId, planId || 'starter', 'checkout');
            }
          }
        } else {
          console.log(
            '[webhook] checkout.session.completed — missing customerId or subscriptionId:',
            { customerId, subscriptionId },
          );
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === 'string'
            ? subscription.customer
            : subscription.customer?.id;

        if (customerId) {
          // Stripe API 2025-03-31 moved current_period_end to the item level.
          // Read item-level first, fall back to subscription-level for older
          // API versions, and skip the field entirely if neither is present.
          const subItems = subscription as unknown as {
            items?: { data?: Array<{ current_period_end?: number }> };
            current_period_end?: number;
          };
          const epochSeconds =
            subItems.items?.data?.[0]?.current_period_end ?? subItems.current_period_end;

          const updates: Record<string, unknown> = {
            subscription_status: subscription.status,
          };
          if (typeof epochSeconds === 'number') {
            updates.subscription_ends_at = new Date(epochSeconds * 1000).toISOString();
          }

          // Update plan if metadata has plan_id
          const newPlanId = subscription.metadata.plan_id;
          if (newPlanId) {
            updates.plan = newPlanId;
          }

          // Snapshot the pre-update plan so we can detect plan transitions
          // (Starter → Growth, Growth → Starter, etc.) and only re-align
          // prompts when the plan actually changed. Without this, every
          // routine subscription.updated event (renewal, status flip) would
          // re-run the alignment unnecessarily.
          const { data: orgBefore } = await supabaseAdmin
            .from('organizations')
            .select('id, plan')
            .eq('stripe_customer_id', customerId)
            .maybeSingle();

          await supabaseAdmin
            .from('organizations')
            .update(updates)
            .eq('stripe_customer_id', customerId);

          if (orgBefore && newPlanId && newPlanId !== orgBefore.plan) {
            // Plan changed — re-align prompts. Handles both expansion
            // (Starter → Growth: 2 → 8 engines) and contraction
            // (Growth → Starter: 8 → 2 engines). Issue #79.
            await alignPromptsSafe(orgBefore.id, newPlanId, 'subscription.updated');
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === 'string'
            ? subscription.customer
            : subscription.customer?.id;

        if (customerId) {
          // Snapshot to know whether this is an actual downgrade (Growth →
          // Starter) — if they were already on Starter, alignment is a
          // no-op anyway, but skipping the call avoids needless queries.
          const { data: orgBefore } = await supabaseAdmin
            .from('organizations')
            .select('id, plan')
            .eq('stripe_customer_id', customerId)
            .maybeSingle();

          await supabaseAdmin
            .from('organizations')
            .update({
              subscription_status: 'canceled',
              plan: 'starter',
            })
            .eq('stripe_customer_id', customerId);

          if (orgBefore && orgBefore.plan !== 'starter') {
            // Trim prompts back to Starter's 2-engine set so a downgraded
            // org doesn't keep paying scraper cost on engines the plan no
            // longer covers. Issue #79.
            await alignPromptsSafe(orgBefore.id, 'starter', 'subscription.deleted');
          }
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;

        if (customerId) {
          await supabaseAdmin
            .from('organizations')
            .update({ subscription_status: 'active' })
            .eq('stripe_customer_id', customerId);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;

        if (customerId) {
          await supabaseAdmin
            .from('organizations')
            .update({ subscription_status: 'past_due' })
            .eq('stripe_customer_id', customerId);
        }
        break;
      }
    }
  } catch (err) {
    console.error('[stripe/webhook] Error processing event:', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
