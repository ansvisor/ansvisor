'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { PlanSwitcher } from '@/components/settings/plan-switcher';
import { InvoiceList } from '@/components/settings/invoice-list';
import { usePlanContext } from '@/components/providers/plan-provider';
import { createClient } from '@/lib/supabase/client';
import { PLANS, type PlanId } from '@/config/plans';

interface SubscriptionData {
  planId: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  priceAmount: number | null;
  interval: string | null;
}

function statusVariant(status: string) {
  switch (status) {
    case 'active':
      return 'default' as const;
    case 'trialing':
      return 'secondary' as const;
    case 'past_due':
      return 'destructive' as const;
    case 'canceled':
      return 'destructive' as const;
    default:
      return 'outline' as const;
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'active':
      return 'Active';
    case 'trialing':
      return 'Trial';
    case 'past_due':
      return 'Past Due';
    case 'canceled':
      return 'Canceled';
    default:
      return status;
  }
}

export function BillingSection() {
  const t = useTranslations('settings');
  const { planId: contextPlanId } = usePlanContext();
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSubscription() {
      try {
        // First: load org data directly from Supabase (reliable, no API route auth issues)
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('organization_id')
          .eq('id', user.id)
          .single();

        if (!profile?.organization_id) return;

        const { data: org } = await supabase
          .from('organizations')
          .select('plan, subscription_status, subscription_ends_at')
          .eq('id', profile.organization_id)
          .single();

        if (!org) return;

        const plan = PLANS[(org.plan as PlanId) ?? 'starter'] ?? PLANS.starter;

        setSubscription({
          planId: org.plan ?? 'starter',
          status: (org.subscription_status as string) ?? 'active',
          currentPeriodEnd: (org.subscription_ends_at as string) ?? null,
          cancelAtPeriodEnd: false,
          priceAmount: plan.pricing?.monthly ?? null,
          interval: 'month',
        });

        // Then: try to enrich with live Stripe data (cancel status etc.)
        const res = await fetch('/api/stripe/subscription');
        if (res.ok) {
          const stripeData = await res.json();
          if (stripeData && !stripeData.error) {
            setSubscription(stripeData);
          }
        }
      } catch {
        // If everything fails, use context planId as last resort
        const plan = PLANS[contextPlanId] ?? PLANS.starter;
        setSubscription({
          planId: contextPlanId,
          status: 'active',
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          priceAmount: plan.pricing?.monthly ?? null,
          interval: 'month',
        });
      } finally {
        setLoading(false);
      }
    }

    loadSubscription();
  }, [contextPlanId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!subscription) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('billing')}</CardTitle>
          <CardDescription>{t('billingDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('noSubscription')}</p>
        </CardContent>
      </Card>
    );
  }

  const plan = PLANS[subscription.planId as PlanId] ?? PLANS.starter;

  return (
    <div className="space-y-6">
      {/* Current Plan */}
      <Card>
        <CardHeader>
          <CardTitle>{t('currentPlan')}</CardTitle>
          <CardDescription>{t('billingDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold">{plan.name}</span>
            <Badge variant={statusVariant(subscription.status)}>
              {statusLabel(subscription.status)}
            </Badge>
          </div>

          {subscription.priceAmount != null && (
            <p className="text-sm text-muted-foreground">
              ${subscription.priceAmount}/
              {subscription.interval === 'year' ? t('year') : t('month')}
            </p>
          )}

          {subscription.currentPeriodEnd && !subscription.cancelAtPeriodEnd && (
            <p className="text-sm text-muted-foreground">
              {t(subscription.status === 'trialing' ? 'trialEndsOn' : 'renewsOn', {
                date: new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                }),
              })}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Plan Switcher */}
      <Card>
        <CardHeader>
          <CardTitle>{t('changePlan')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PlanSwitcher
            subscription={subscription}
            onUpdate={(data) => setSubscription({ ...subscription, ...data })}
          />
        </CardContent>
      </Card>

      <Separator />

      {/* Invoices */}
      <Card>
        <CardHeader>
          <CardTitle>{t('invoices')}</CardTitle>
        </CardHeader>
        <CardContent>
          <InvoiceList />
        </CardContent>
      </Card>
    </div>
  );
}
