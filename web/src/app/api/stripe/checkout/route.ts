import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { stripe, PRICE_IDS } from '@/lib/stripe';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { planId, organizationId } = body as {
      planId: 'starter' | 'growth';
      organizationId: string;
    };

    if (!planId || !organizationId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const priceId = PRICE_IDS[planId]?.monthly;
    if (!priceId) {
      console.error(
        '[stripe/checkout] Missing price ID for plan:',
        planId,
        'PRICE_IDS:',
        PRICE_IDS,
      );
      return NextResponse.json({ error: 'Price not configured for this plan' }, { status: 400 });
    }

    // Fetch org to check for existing Stripe customer
    const { data: org } = await supabase
      .from('organizations')
      .select('stripe_customer_id')
      .eq('id', organizationId)
      .single();

    let customerId = org?.stripe_customer_id as string | null;

    // Create Stripe customer if none exists
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          organization_id: organizationId,
          supabase_user_id: user.id,
        },
      });
      customerId = customer.id;

      await supabase
        .from('organizations')
        .update({ stripe_customer_id: customerId })
        .eq('id', organizationId);
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { organization_id: organizationId, plan_id: planId },
      },
      success_url: `${appUrl}/api/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/dashboard/onboarding`,
      allow_promotion_codes: true,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('[stripe/checkout]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
