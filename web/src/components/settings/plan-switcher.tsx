'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, ArrowUp, ArrowDown, Mail, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { PLANS, SUBSCRIBABLE_PLANS, type PlanId } from '@/config/plans';
import { ALL_SCRAPERS } from '@/config/prompt-options';

interface SubscriptionData {
  planId: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  priceAmount: number | null;
  interval: string | null;
}

interface PlanSwitcherProps {
  subscription: SubscriptionData;
  onUpdate: (data: SubscriptionData) => void;
}

export function PlanSwitcher({ subscription, onUpdate }: PlanSwitcherProps) {
  const t = useTranslations('settings');
  const [loading, setLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [changePlanOpen, setChangePlanOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(null);

  const currentPlanId = subscription.planId as PlanId;

  async function handleChangePlan() {
    if (!selectedPlan) return;
    setLoading(true);
    try {
      const res = await fetch('/api/stripe/subscription', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPlanId: selectedPlan }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to change plan');
      }
      const data = await res.json();
      onUpdate(data);
      toast.success(t('planChanged'));
      setChangePlanOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change plan');
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    setCancelLoading(true);
    try {
      const res = await fetch('/api/stripe/subscription', { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to cancel');
      }
      const data = await res.json();
      onUpdate({
        ...subscription,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd,
        currentPeriodEnd: data.currentPeriodEnd,
      });
      toast.success(t('subscriptionCanceled'));
      setCancelOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel');
    } finally {
      setCancelLoading(false);
    }
  }

  async function handleReactivate() {
    setLoading(true);
    try {
      const res = await fetch('/api/stripe/subscription', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reactivate: true }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to reactivate');
      }
      const data = await res.json();
      onUpdate({
        ...subscription,
        cancelAtPeriodEnd: false,
        status: data.status,
        currentPeriodEnd: data.currentPeriodEnd,
      });
      toast.success(t('subscriptionReactivated'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reactivate');
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenPortal() {
    setPortalLoading(true);
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to open billing portal');
      }
      const { url } = await res.json();
      window.location.href = url;
      // No loading reset — we're navigating away to Stripe.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open billing portal');
      setPortalLoading(false);
    }
  }

  function isUpgrade(targetPlan: PlanId): boolean {
    const order = SUBSCRIBABLE_PLANS;
    return order.indexOf(targetPlan) > order.indexOf(currentPlanId);
  }

  return (
    <div className="space-y-4">
      {/* Plan cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SUBSCRIBABLE_PLANS.map((planId) => {
          const plan = PLANS[planId];
          const isCurrent = planId === currentPlanId;
          const upgrade = isUpgrade(planId);

          return (
            <Card key={planId} className={isCurrent ? 'border-primary' : undefined}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{plan.name}</CardTitle>
                  {isCurrent && (
                    <Badge variant="default">
                      <Check className="mr-1 h-3 w-3" />
                      {t('currentPlan')}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{plan.tagline}</p>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <span className="text-2xl font-bold">${plan.pricing?.monthly}</span>
                  <span className="text-sm text-muted-foreground">/{t('month')}</span>
                </div>

                <ul className="mb-4 space-y-1 text-sm text-muted-foreground">
                  <li>
                    {plan.limits.maxBrands === -1 ? t('unlimited') : plan.limits.maxBrands}{' '}
                    {t('brands')}
                  </li>
                  <li>
                    {plan.limits.maxPrompts === -1 ? t('unlimited') : plan.limits.maxPrompts}{' '}
                    {t('prompts')}
                  </li>
                  <li>
                    {plan.limits.maxPlatforms} {t('platforms')}
                    {plan.limits.allowedScrapers && plan.limits.allowedScrapers.length > 0 && (
                      <span className="text-xs text-muted-foreground/70">
                        {' '}
                        (
                        {plan.limits.allowedScrapers
                          .map((id) => {
                            const s = ALL_SCRAPERS.find((s) => s.id === id);
                            return s ? s.label.replace(/\s*\(Web\)/i, '') : id;
                          })
                          .join(' & ')}
                        )
                      </span>
                    )}
                  </li>
                  <li>
                    {plan.limits.maxTeamMembers === -1
                      ? t('unlimited')
                      : plan.limits.maxTeamMembers}{' '}
                    {t('teamMembers')}
                  </li>
                </ul>

                {!isCurrent && (
                  <Dialog
                    open={changePlanOpen && selectedPlan === planId}
                    onOpenChange={(open) => {
                      setChangePlanOpen(open);
                      if (open) setSelectedPlan(planId);
                    }}
                  >
                    <DialogTrigger
                      render={
                        <Button className="w-full" variant={upgrade ? 'default' : 'outline'} />
                      }
                    >
                      {upgrade ? (
                        <>
                          <ArrowUp className="mr-1 h-4 w-4" />
                          {t('upgradeTo', { plan: plan.name })}
                        </>
                      ) : (
                        <>
                          <ArrowDown className="mr-1 h-4 w-4" />
                          {t('downgradeTo', { plan: plan.name })}
                        </>
                      )}
                    </DialogTrigger>
                    <DialogContent className="max-w-md">
                      <DialogHeader>
                        <DialogTitle>
                          {t('changePlanConfirmTitle', { plan: plan.name })}
                        </DialogTitle>
                        <DialogDescription>
                          {t('changePlanConfirmDescription', {
                            plan: plan.name,
                            price: String(plan.pricing?.monthly),
                          })}
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button onClick={handleChangePlan} disabled={loading}>
                          {loading ? t('processing') : t('changePlanConfirm')}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Enterprise / Custom Plan CTA */}
      <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-5">
        <div>
          <p className="text-sm font-medium">{t('needCustomPlan')}</p>
          <p className="text-xs text-muted-foreground">{t('customPlanDescription')}</p>
        </div>
        <a
          href="https://www.ansvisor.com/contact-us"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center justify-center rounded-md border bg-background px-5 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Mail className="mr-2 h-4 w-4" />
          {t('contactUs')}
        </a>
      </div>

      {/* Cancel / Reactivate + Stripe billing portal */}
      {subscription.cancelAtPeriodEnd && (
        <div className="flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/5 p-4">
          <div>
            <p className="text-sm font-medium">
              {t('cancelsOn', {
                date: subscription.currentPeriodEnd
                  ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })
                  : '',
              })}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleReactivate} disabled={loading}>
            {t('reactivate')}
          </Button>
        </div>
      )}
      <div className="flex items-center justify-between gap-4">
        {subscription.cancelAtPeriodEnd ? (
          <span />
        ) : (
          <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <DialogTrigger
              render={
                <Button variant="ghost" className="text-destructive hover:text-destructive" />
              }
            >
              {t('cancelSubscription')}
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{t('cancelConfirmTitle')}</DialogTitle>
                <DialogDescription>{t('cancelConfirmDescription')}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="destructive" onClick={handleCancel} disabled={cancelLoading}>
                  {cancelLoading ? t('processing') : t('cancelConfirm')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        <Button
          variant="outline"
          onClick={handleOpenPortal}
          disabled={portalLoading}
          title={t('manageBillingHint')}
        >
          {portalLoading ? t('processing') : t('manageBilling')}
          <ExternalLink className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
