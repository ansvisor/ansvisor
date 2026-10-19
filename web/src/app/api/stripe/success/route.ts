import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { alignPromptsToPlanForOrg } from '@/lib/plan-engines';
import { API_BASE_URL } from '@/config/api';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('session_id');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  if (!sessionId) {
    return NextResponse.redirect(`${appUrl}/dashboard/insights`);
  }

  let trackingJobId: string | null = null;

  try {
    // Retrieve and validate the Stripe checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });

    if (session.payment_status === 'paid' || session.status === 'complete') {
      const customerId =
        typeof session.customer === 'string' ? session.customer : session.customer?.id;

      const subscription =
        typeof session.subscription === 'string'
          ? await stripe.subscriptions.retrieve(session.subscription)
          : session.subscription;

      const subscriptionId = subscription?.id;
      const orgId = (subscription as { metadata?: { organization_id?: string } })?.metadata
        ?.organization_id;
      const planId = (subscription as { metadata?: { plan_id?: string } })?.metadata?.plan_id;

      if (orgId && customerId && subscriptionId) {
        // Update org subscription (resolves webhook race condition)
        const { error: updateError } = await supabaseAdmin
          .from('organizations')
          .update({
            subscription_status: 'trialing',
            plan: planId || 'starter',
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
          })
          .eq('id', orgId);

        if (updateError) {
          console.error('[stripe/success] DB update error:', updateError);
        } else {
          console.log('[stripe/success] DB updated for org:', orgId);

          // Align onboarding-created prompts to the just-confirmed plan's
          // engine set. Onboarding saves prompts at step 4 with the default
          // Starter set (2 scrapers); without this, a user who picks Growth
          // at step 6 still ends up tracking only those 2 engines (#78).
          // The shared helper is also called from the Stripe webhook so
          // upgrades / downgrades of existing orgs stay in sync (#79).
          try {
            const result = await alignPromptsToPlanForOrg(orgId, planId || 'starter');
            console.log(
              `[stripe/success] Aligned ${result.promptCount} prompt(s) to plan=${planId || 'starter'} (${result.platforms.length} scrapers, ${result.models.length} models) for org ${orgId}`,
            );
          } catch (alignErr) {
            console.error('[stripe/success] Plan-engine alignment threw:', alignErr);
          }

          // Find first brand and trigger tracking via aeo-server
          const { data: brand } = await supabaseAdmin
            .from('brands')
            .select('id')
            .eq('organization_id', orgId)
            .order('created_at', { ascending: true })
            .limit(1)
            .single();

          if (brand) {
            const serverUrl = API_BASE_URL;
            const cronSecret = process.env.CRON_SECRET;

            if (cronSecret) {
              try {
                const trackingRes = await fetch(`${serverUrl}/api/internal/trigger-tracking`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${cronSecret}`,
                  },
                  body: JSON.stringify({ brandId: brand.id }),
                });

                if (trackingRes.ok) {
                  const result = await trackingRes.json();
                  trackingJobId = result.jobId;
                  console.log(
                    '[stripe/success] Tracking triggered for brand:',
                    brand.id,
                    'jobId:',
                    trackingJobId,
                  );
                } else {
                  console.error('[stripe/success] Tracking trigger failed:', trackingRes.status);
                }
              } catch (fetchErr) {
                console.error('[stripe/success] Failed to call trigger-tracking:', fetchErr);
              }

              try {
                const volumesRes = await fetch(`${serverUrl}/api/internal/analyze-volumes`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${cronSecret}`,
                  },
                  body: JSON.stringify({ brandId: brand.id }),
                });

                if (volumesRes.ok) {
                  console.log('[stripe/success] Volume analysis triggered for brand:', brand.id);
                } else {
                  console.error(
                    '[stripe/success] Volume analysis trigger failed:',
                    volumesRes.status,
                  );
                }
              } catch (fetchErr) {
                console.error('[stripe/success] Failed to call volume analysis:', fetchErr);
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[stripe/success] Error:', err);
  }

  const redirectUrl = new URL(`${appUrl}/dashboard/insights`);
  if (trackingJobId) {
    redirectUrl.searchParams.set('jobId', trackingJobId);
  }
  return NextResponse.redirect(redirectUrl.toString());
}
