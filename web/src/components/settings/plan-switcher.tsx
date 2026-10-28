'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, ArrowUp, ArrowDown, Mail, ExternalLink, Repeat, ShoppingCart } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  CONTACT_SALES_URL,
  PLANS,
  PRICING_URL,
  SUBSCRIBABLE_PLANS,
  type PlanId,
} from '@/config/plans';
import {
  FIRST_MONTH_CODE,
  annualSaving,
  periodPrice,
  subscriptionEnded,
  type BillingInterval,
} from '@/lib/billing/plan-purchase';
import { useUserRole } from '@/hooks/use-user-role';
import { useRouter } from '@/i18n/navigation';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CancelSubscriptionDialog } from './cancel-subscription-dialog';
import { aiUsageMultiple, usePlanFeatures, type PlanFeature } from './plan-features';

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
  /** The organization a new subscription is for, once the old one has ended. */
  organizationId?: string | null;
}

export function PlanSwitcher({ subscription, onUpdate, organizationId = null }: PlanSwitcherProps) {
  const t = useTranslations('settings');
  const tCards = useTranslations('settings.planCards');
  const planFeatures = usePlanFeatures();
  // Buying or changing the plan charges the organization's card: admins only,
  // as the subscription route checks.
  const { canAdmin } = useUserRole();
  // A change can unlock a read-only workspace: the layout reads the plan again.
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  // The plan a card's button asked for: bought now during a trial, or changed to.
  const [pending, setPending] = useState<{ planId: PlanId; buy: boolean } | null>(null);
  const [promoCode, setPromoCode] = useState(FIRST_MONTH_CODE);
  // The plan whose Checkout is opening, once the subscription has ended.
  const [checkoutPlan, setCheckoutPlan] = useState<PlanId | null>(null);

  const currentPlanId = subscription.planId as PlanId;
  const currentInterval: BillingInterval = subscription.interval === 'year' ? 'year' : 'month';
  const [period, setPeriod] = useState<BillingInterval>(currentInterval);
  // A trial is bought outright: any plan, either period, paid today.
  const trialing = subscription.status === 'trialing';
  // A canceled or never-started plan: no subscription to change, so a card
  // starts a new one through Stripe Checkout (the workspace is read-only
  // until then).
  const ended = subscriptionEnded(subscription.status);
  const saving = Math.max(0, ...SUBSCRIBABLE_PLANS.map((id) => annualSaving(id) ?? 0));

  async function handleConfirm() {
    if (!pending) return;
    setLoading(true);
    try {
      const res = await fetch('/api/stripe/subscription', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newPlanId: pending.planId,
          interval: period,
          ...(pending.buy
            ? { buyNow: true, ...(period === 'month' ? { promoCode: promoCode.trim() } : {}) }
            : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        // A declined card, or one its bank wants confirmed: the trial carries
        // on, and Stripe's billing page is where the card is changed.
        if (err.code === 'payment_failed') {
          toast.error(err.error || t('paymentFailed'), {
            description: t('paymentFailedHint'),
            action: { label: t('updateCard'), onClick: handleOpenPortal },
          });
          return;
        }
        throw new Error(err.error || 'Failed to change plan');
      }
      const data = await res.json();
      onUpdate(data);
      router.refresh();
      toast.success(
        pending.buy ? t('planBought', { plan: PLANS[pending.planId].name }) : t('planChanged'),
      );
      setPending(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change plan');
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckout(planId: PlanId) {
    if (!organizationId) return;
    setCheckoutPlan(planId);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // A plan that ended starts again now: the trial was the first subscription's.
        body: JSON.stringify({
          planId,
          organizationId,
          interval: period,
          returnTo: 'billing',
          mode: 'buy',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || t('checkoutFailed'));
      window.location.href = data.url;
      // No loading reset — we're navigating away to Stripe.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('checkoutFailed'));
      setCheckoutPlan(null);
    }
  }

  async function handleCancel() {
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
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel');
      return false;
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
      router.refresh();
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

  /**
   * The custom plan's points: its AI usage first, set per customer above
   * Enterprise's floor (2026-10-27), then the pricing page's points.
   */
  function customPlanPoints(): PlanFeature[] {
    const aiUsage = aiUsageMultiple('enterprise');
    return [
      ...(aiUsage
        ? [{ text: tCards('aiUsageCustom', { count: aiUsage }), hint: tCards('aiUsageCustomHint') }]
        : []),
      ...(t.raw('customPlanPoints') as string[]).map((text) => ({ text })),
    ];
  }

  function isUpgrade(targetPlan: PlanId): boolean {
    const order = SUBSCRIBABLE_PLANS;
    return order.indexOf(targetPlan) > order.indexOf(currentPlanId);
  }

  return (
    <div className="space-y-4">
      {!canAdmin && <p className="text-sm text-muted-foreground">{t('planAdminOnly')}</p>}
      {ended && canAdmin && <p className="text-sm text-muted-foreground">{t('planEnded')}</p>}
      {/* Billing period: a year up front saves 20% */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label={t('billingPeriod')}
          className="inline-flex rounded-lg border bg-muted/40 p-0.5"
        >
          {(['month', 'year'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors',
                period === value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {value === 'month' ? t('monthly') : t('annual')}
              {value === 'year' && saving > 0 && (
                <span className="rounded-full bg-emerald-100 px-1.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                  {t('savePercent', { percent: saving })}
                </span>
              )}
            </button>
          ))}
        </div>
        {trialing && period === 'month' && (
          <p className="text-xs text-muted-foreground">
            {t('firstMonthOffer', { code: FIRST_MONTH_CODE })}
          </p>
        )}
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SUBSCRIBABLE_PLANS.map((planId) => {
          const plan = PLANS[planId];
          // An ended plan is no one's current plan any more.
          const isCurrent = !ended && planId === currentPlanId;
          const upgrade = isUpgrade(planId);
          const price = periodPrice(planId, period);
          const fullYear = plan.pricing ? plan.pricing.monthly * 12 : null;
          const planSaving = annualSaving(planId);
          // What its button does: start a new subscription once the old one
          // has ended; buy it now during a trial; otherwise switch the period
          // of the current plan, or change to this one.
          const action = ended
            ? 'subscribe'
            : trialing
              ? 'buy'
              : isCurrent
                ? period === currentInterval
                  ? null
                  : 'period'
                : 'change';

          return (
            <Card key={planId} className={isCurrent ? 'border-primary' : undefined}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{plan.name}</CardTitle>
                    {plan.highlighted && <Badge variant="secondary">{t('popular')}</Badge>}
                  </div>
                  {isCurrent && (
                    <Badge variant="default">
                      <Check className="mr-1 h-3 w-3" />
                      {t('currentPlan')}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{tCards(`${planId}.tagline`)}</p>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {period === 'year' && fullYear != null && price != null && (
                    <span className="text-base text-muted-foreground line-through">
                      <span className="sr-only">{t('regularPrice')} </span>${formatNumber(fullYear)}
                    </span>
                  )}
                  <span>
                    <span className="text-2xl font-bold">
                      {price != null ? `$${formatNumber(price)}` : '—'}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      /{period === 'year' ? t('year') : t('month')}
                    </span>
                  </span>
                  {period === 'year' && planSaving != null && (
                    <Badge
                      variant="outline"
                      className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400"
                    >
                      {t('savePercent', { percent: planSaving })}
                    </Badge>
                  )}
                </div>

                <ul className="mb-4 space-y-1.5 text-sm">
                  {planFeatures(planId).map((feature) => (
                    <li key={feature.text} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span
                        title={feature.hint}
                        className={
                          feature.hint
                            ? 'cursor-help underline decoration-dotted underline-offset-4'
                            : undefined
                        }
                      >
                        {feature.text}
                      </span>
                    </li>
                  ))}
                </ul>

                {action && canAdmin && (
                  <Button
                    className="w-full"
                    variant={
                      action === 'subscribe'
                        ? plan.highlighted
                          ? 'default'
                          : 'outline'
                        : action === 'buy'
                          ? isCurrent
                            ? 'default'
                            : 'outline'
                          : upgrade
                            ? 'default'
                            : 'outline'
                    }
                    disabled={
                      price == null ||
                      (action === 'subscribe' && (!organizationId || checkoutPlan != null))
                    }
                    onClick={() => {
                      if (action === 'subscribe') {
                        void handleCheckout(planId);
                        return;
                      }
                      setPromoCode(FIRST_MONTH_CODE);
                      setPending({ planId, buy: action === 'buy' });
                    }}
                  >
                    {action === 'subscribe' ? (
                      checkoutPlan === planId ? (
                        t('processing')
                      ) : (
                        <>
                          <ShoppingCart className="mr-1 h-4 w-4" />
                          {t('choosePlanFor', { plan: plan.name })}
                        </>
                      )
                    ) : action === 'buy' ? (
                      <>
                        <ShoppingCart className="mr-1 h-4 w-4" />
                        {t('buyPlanNow', { plan: plan.name })}
                      </>
                    ) : action === 'period' ? (
                      <>
                        <Repeat className="mr-1 h-4 w-4" />
                        {period === 'year' ? t('switchToAnnual') : t('switchToMonthly')}
                      </>
                    ) : upgrade ? (
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
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* The cards list the highlights; the pricing page has every feature */}
      <div className="flex justify-center">
        <a
          href={PRICING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          {t('seeAllPlanFeatures')}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {/* Buy now / change confirmation */}
      <Dialog open={pending != null} onOpenChange={(open) => !open && setPending(null)}>
        {pending && (
          <DialogContent className="max-w-md">
            {(() => {
              const plan = PLANS[pending.planId];
              const price = periodPrice(pending.planId, period) ?? 0;
              const halfPrice = price / 2;
              const offer =
                pending.buy &&
                period === 'month' &&
                promoCode.trim().toUpperCase() === FIRST_MONTH_CODE;
              return (
                <>
                  <DialogHeader>
                    <DialogTitle>
                      {pending.buy
                        ? t('buyNowTitle', { plan: plan.name })
                        : pending.planId === currentPlanId
                          ? t('changePeriodTitle', { interval: period })
                          : t('changePlanConfirmTitle', { plan: plan.name })}
                    </DialogTitle>
                    <DialogDescription>
                      {pending.buy
                        ? t('buyNowDescription', {
                            price: formatNumber(price),
                            interval: period,
                          })
                        : pending.planId === currentPlanId
                          ? t('changePeriodDescription', {
                              plan: plan.name,
                              price: formatNumber(price),
                              interval: period,
                            })
                          : t('changePlanConfirmDescription', {
                              plan: plan.name,
                              price: formatNumber(price),
                              interval: period,
                            })}
                    </DialogDescription>
                  </DialogHeader>
                  {pending.buy && period === 'month' && (
                    <div className="space-y-1.5">
                      <label htmlFor="promo-code" className="text-sm font-medium">
                        {t('promoCode')}
                      </label>
                      <Input
                        id="promo-code"
                        value={promoCode}
                        onChange={(e) => setPromoCode(e.target.value)}
                        autoComplete="off"
                        className="uppercase"
                      />
                      {offer && (
                        <p className="text-xs text-emerald-700 dark:text-emerald-400">
                          {t('firstMonthWithCode', {
                            code: FIRST_MONTH_CODE,
                            price: Number.isInteger(halfPrice)
                              ? formatNumber(halfPrice)
                              : halfPrice.toFixed(2),
                          })}
                        </p>
                      )}
                    </div>
                  )}
                  <DialogFooter>
                    <Button onClick={handleConfirm} disabled={loading}>
                      {loading
                        ? t('processing')
                        : pending.buy
                          ? t('buyNowConfirm')
                          : t('changePlanConfirm')}
                    </Button>
                  </DialogFooter>
                </>
              );
            })()}
          </DialogContent>
        )}
      </Dialog>

      {/* Custom plan: what it adds, from the pricing page */}
      <div className="space-y-3 rounded-lg border bg-muted/30 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">{t('needCustomPlan')}</p>
            <p className="text-xs text-muted-foreground">{t('customPlanDescription')}</p>
          </div>
          <a
            href={CONTACT_SALES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center justify-center rounded-md border bg-background px-5 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Mail className="mr-2 h-4 w-4" />
            {t('contactUs')}
          </a>
        </div>
        <ul className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
          {customPlanPoints().map((point) => (
            <li key={point.text} className="flex items-start gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span
                title={point.hint}
                className={
                  point.hint
                    ? 'cursor-help underline decoration-dotted underline-offset-4'
                    : undefined
                }
              >
                {point.text}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Cancel / Reactivate + Stripe billing portal. An ended plan has
          neither: a card above starts a new one. */}
      {subscription.cancelAtPeriodEnd && !ended && (
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
          {canAdmin && (
            <Button variant="outline" size="sm" onClick={handleReactivate} disabled={loading}>
              {t('reactivate')}
            </Button>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-4">
        {/* Cancelling is the admins', as changing the plan is. */}
        {subscription.cancelAtPeriodEnd || !canAdmin || ended ? (
          <span />
        ) : (
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setCancelOpen(true)}
          >
            {t('cancelSubscription')}
          </Button>
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
      {/* Mounted outside the button's branch: it still sends the answer once
          the plan is cancelled. Admins only, as the button is. */}
      {canAdmin && (
        <CancelSubscriptionDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          currentPeriodEnd={subscription.currentPeriodEnd}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}
