'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowUpRight, Check, CreditCard, Loader2, Lock, Mail, Play, Tag, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { aiUsageMultiple, usePlanFeatures } from '@/components/settings/plan-features';
import {
  CONTACT_SALES_URL,
  CUSTOM_PLAN_STARTING_PRICE,
  PLANS,
  PRICING_URL,
  SUBSCRIBABLE_PLANS,
  type PlanId,
} from '@/config/plans';
import { useUserRole } from '@/hooks/use-user-role';
import {
  FIRST_MONTH_CODE,
  annualSaving,
  periodPrice,
  takesPromoCode,
  type BillingInterval,
} from '@/lib/billing/plan-purchase';
import { discountedPrice, type PromoOffer } from '@/lib/billing/promo-code';
import { TRIAL_DAYS } from '@/lib/billing/trial';
import type { DemoOffer } from '@/lib/demo/demo-brand';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Dollars as the cards show them: whole dollars bare, anything else to the cent. */
function money(value: number): string {
  return `$${
    Number.isInteger(value)
      ? formatNumber(value)
      : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }`;
}

/** What a code takes off, for its texts: "50%" or "$10". */
function discountOf(offer: PromoOffer): string {
  return offer.percentOff != null ? `${offer.percentOff}%` : money(offer.amountOff ?? 0);
}

/** The values every promo text reads. */
function offerValues(offer: PromoOffer) {
  return {
    code: offer.code,
    discount: discountOf(offer),
    duration: offer.duration,
    months: offer.durationInMonths ?? 1,
  };
}

type CodeError = { kind: 'invalid'; code: string } | { kind: 'failed' };

/**
 * A promotion code as Stripe has it now (POST /api/stripe/promo-code): what
 * it takes off, 'invalid' when it can't be redeemed, 'failed' when it
 * couldn't be checked.
 */
async function checkPromoCode(code: string): Promise<PromoOffer | 'invalid' | 'failed'> {
  try {
    const res = await fetch('/api/stripe/promo-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) return 'failed';
    if (!data.valid) return 'invalid';
    return {
      code: data.code,
      percentOff: data.percentOff ?? null,
      amountOff: data.amountOff ?? null,
      duration: data.duration,
      durationInMonths: data.durationInMonths ?? null,
    };
  } catch {
    return 'failed';
  }
}

const PROMO_INPUT_ID = 'upgrade-promo-code';
const PROMO_NOTE_ID = 'upgrade-promo-note';

/**
 * "Choose a plan to keep going", for a workspace whose plan ended: Starter
 * and Growth with Billing's own features and prices, monthly or a year up
 * front, and Custom through sales. An admin can apply a promotion code
 * (checked with Stripe, monthly plans only) and opens Stripe Checkout for a
 * new subscription from a card; another member is asked to turn to an admin
 * and sees the plain prices. ×, Escape or a click outside close it.
 *
 * From the demo brand (`demo`), the same plans with the demo's offer: a
 * workspace that never subscribed starts its free trial, then 50% off; one
 * whose plan ended gets 50% off its first month. An admin finds the
 * first-month code already applied; when it doesn't apply, the field is
 * simply left empty.
 */
export function ChoosePlanDialog({
  open,
  onOpenChange,
  action,
  askAdmin,
  organizationId,
  demo = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What was clicked ("Adding prompts needs a plan"); none from the banner. */
  action: string | null;
  /** What a member who isn't an admin is asked to do. */
  askAdmin: string;
  /** The organization the new subscription is for. */
  organizationId: string | null;
  /** Opened from the demo brand: the offer its title and buttons make. */
  demo?: DemoOffer | null;
}) {
  const t = useTranslations('readOnly');
  const tPlans = useTranslations('readOnly.plans');
  const tSettings = useTranslations('settings');
  const tCards = useTranslations('settings.planCards');
  const planFeatures = usePlanFeatures();
  const { canAdmin } = useUserRole();

  const [period, setPeriod] = useState<BillingInterval>('month');
  const [codeInput, setCodeInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [codeError, setCodeError] = useState<CodeError | null>(null);
  // The code Stripe took, with what it takes off. Only an admin enters one.
  const [offer, setOffer] = useState<PromoOffer | null>(null);
  // The plan whose Checkout is opening.
  const [checkoutPlan, setCheckoutPlan] = useState<PlanId | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The demo's code is tried once, the first time the dialog opens.
  const demoCodeTried = useRef(false);

  useEffect(() => {
    if (!open || !demo || !canAdmin || demoCodeTried.current) return;
    demoCodeTried.current = true;
    void checkPromoCode(FIRST_MONTH_CODE).then((found) => {
      // Quietly: a code that doesn't apply leaves the field as it was.
      if (typeof found === 'object') setOffer((current) => current ?? found);
    });
  }, [open, demo, canAdmin]);

  const saving = Math.max(0, ...SUBSCRIBABLE_PLANS.map((id) => annualSaving(id) ?? 0));
  // The code lowers this period's prices: a monthly plan, for an admin.
  const discounted = canAdmin && offer != null && takesPromoCode(period) ? offer : null;

  async function applyCode(event: FormEvent) {
    event.preventDefault();
    const typed = codeInput.trim();
    if (!typed) {
      inputRef.current?.focus();
      return;
    }
    setChecking(true);
    setCodeError(null);
    const found = await checkPromoCode(typed);
    if (found === 'invalid') setCodeError({ kind: 'invalid', code: typed.toUpperCase() });
    else if (found === 'failed') setCodeError({ kind: 'failed' });
    else setOffer(found);
    setChecking(false);
  }

  function removeCode() {
    setOffer(null);
    setCodeInput('');
    // The field is back once the chip is gone.
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function choose(planId: PlanId) {
    if (!organizationId || checkoutPlan) return;
    setCheckoutPlan(planId);
    const promotionCode = discounted?.code;
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId,
          organizationId,
          interval: period,
          returnTo: 'billing',
          ...(promotionCode ? { promotionCode } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        // The code stopped working since it was applied: say so by the field.
        if (data.code === 'invalid_promo_code' && promotionCode) {
          setOffer(null);
          setCodeInput(promotionCode);
          setCodeError({ kind: 'invalid', code: promotionCode.toUpperCase() });
          setCheckoutPlan(null);
          return;
        }
        throw new Error(data.error || tSettings('checkoutFailed'));
      }
      window.location.href = data.url;
      // No reset: the page is leaving for Stripe.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tSettings('checkoutFailed'));
      setCheckoutPlan(null);
    }
  }

  // The line under the controls: the code's word for this period, or why
  // the code typed was refused.
  const note =
    offer && !takesPromoCode(period) ? (
      <p className="flex flex-wrap items-center gap-x-1.5 text-amber-700 dark:text-amber-400">
        {tPlans('promo.monthlyOnly', offerValues(offer))}
        <button
          type="button"
          onClick={() => setPeriod('month')}
          className="rounded-sm text-foreground underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {tPlans('promo.switchToMonthly')}
        </button>
      </p>
    ) : offer ? (
      <p className="text-emerald-700 dark:text-emerald-400">
        {tPlans('promo.appliedNote', offerValues(offer))}
      </p>
    ) : codeError ? (
      <p className="text-destructive">
        {codeError.kind === 'invalid'
          ? tPlans('promo.invalid', { code: codeError.code })
          : tPlans('promo.failed')}
      </p>
    ) : null;

  const aiMultiple = aiUsageMultiple('enterprise');
  const customPoints = tSettings.raw('customPlanPoints') as string[];
  // Custom's list as the pricing page has it: its AI usage after the data points.
  const customFeatures = aiMultiple
    ? [
        ...customPoints.slice(0, 4),
        tPlans('customAiUsage', { count: aiMultiple }),
        ...customPoints.slice(4),
      ]
    : customPoints;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-5 sm:max-w-[min(62.5rem,calc(100%-2rem))] sm:p-7">
        <DialogHeader className="gap-1 pr-8">
          <span
            data-slot="upgrade-action"
            className="mb-2 inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground"
          >
            {demo ? (
              <Play className="size-3" aria-hidden />
            ) : (
              <Lock className="size-3" aria-hidden />
            )}
            {action ?? t('dialog.readOnlyLabel')}
          </span>
          <DialogTitle className="text-xl leading-tight font-bold tracking-tight">
            {demo ? t(`demo.dialog.title.${demo}`, { days: TRIAL_DAYS }) : t('dialog.title.ended')}
          </DialogTitle>
          <DialogDescription className="max-w-2xl">
            {demo ? t('demo.dialog.body') : t('dialog.body.ended')}
          </DialogDescription>
        </DialogHeader>

        {!canAdmin && (
          <p
            data-slot="member-note"
            className="mt-4 flex items-start gap-2 rounded-lg border bg-muted/30 px-3.5 py-2.5 text-sm"
          >
            <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              {t('dialog.memberNote')} {askAdmin}
            </span>
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          {/* Billing period: a year up front saves 20% */}
          <div
            role="group"
            aria-label={tSettings('billingPeriod')}
            className="inline-flex rounded-lg border bg-muted/40 p-0.5"
          >
            {(['month', 'year'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={period === value}
                onClick={() => setPeriod(value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  period === value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {value === 'month' ? tSettings('monthly') : tSettings('annual')}
                {value === 'year' && saving > 0 && (
                  <span className="rounded-full bg-emerald-100 px-1.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                    {tSettings('savePercent', { percent: saving })}
                  </span>
                )}
              </button>
            ))}
          </div>

          {canAdmin &&
            (offer ? (
              <span
                data-slot="promo-applied"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 pr-1 pl-2.5 text-xs font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400"
              >
                <Tag className="size-3.5" aria-hidden />
                {tPlans('promo.applied', offerValues(offer))}
                <button
                  type="button"
                  aria-label={tPlans('promo.remove')}
                  onClick={removeCode}
                  className="grid size-6 place-items-center rounded-full outline-none hover:bg-emerald-100 focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:bg-emerald-900/40"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ) : (
              <form onSubmit={applyCode} autoComplete="off" className="flex items-center gap-2">
                <label htmlFor={PROMO_INPUT_ID} className="text-xs text-muted-foreground">
                  {tSettings('promoCode')}
                </label>
                <Input
                  ref={inputRef}
                  id={PROMO_INPUT_ID}
                  value={codeInput}
                  onChange={(e) => {
                    setCodeInput(e.target.value);
                    if (codeError) setCodeError(null);
                  }}
                  placeholder={FIRST_MONTH_CODE}
                  spellCheck={false}
                  aria-invalid={codeError?.kind === 'invalid' || undefined}
                  aria-describedby={PROMO_NOTE_ID}
                  className="w-32 uppercase"
                />
                <Button type="submit" variant="outline" disabled={checking}>
                  {checking ? tPlans('promo.checking') : tPlans('promo.apply')}
                </Button>
              </form>
            ))}
        </div>
        {/* Always there, so a screen reader hears what the code did. */}
        {canAdmin && (
          <div id={PROMO_NOTE_ID} role="status" aria-live="polite" className="text-xs">
            {note && <div className="mt-2">{note}</div>}
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {SUBSCRIBABLE_PLANS.map((planId) => {
            const plan = PLANS[planId];
            const monthly = periodPrice(planId, 'month');
            const price = periodPrice(planId, period);
            const firstPrice =
              discounted && monthly != null ? discountedPrice(monthly, discounted) : null;
            const opening = checkoutPlan === planId;

            return (
              <section
                key={planId}
                data-plan={planId}
                aria-labelledby={`upgrade-plan-${planId}`}
                className={cn(
                  'relative flex flex-col gap-4 rounded-xl border bg-card p-5',
                  plan.highlighted && 'border-primary ring-1 ring-primary',
                )}
              >
                {plan.highlighted && (
                  <Badge className="absolute -top-2.5 left-5">{tSettings('popular')}</Badge>
                )}
                <div>
                  <h3 id={`upgrade-plan-${planId}`} className="text-base font-semibold">
                    {plan.name}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground lg:min-h-8">
                    {tCards(`${planId}.tagline`)}
                  </p>
                </div>

                <div
                  data-slot="plan-price"
                  className="flex flex-wrap content-end items-baseline gap-x-1.5 lg:min-h-20"
                >
                  {period === 'year' && price != null && monthly != null ? (
                    <>
                      <span className="text-sm text-muted-foreground line-through">
                        <span className="sr-only">{tSettings('regularPrice')} </span>
                        {money(monthly * 12)}
                      </span>
                      <span className="text-3xl font-bold tracking-tight">{money(price)}</span>
                      <span className="text-sm text-muted-foreground">/{tSettings('year')}</span>
                      <span className="w-full text-xs text-muted-foreground">
                        {tPlans('perMonthBilledYearly', {
                          price: money(Math.round((price / 12) * 100) / 100),
                        })}
                      </span>
                    </>
                  ) : discounted && firstPrice != null && monthly != null ? (
                    <>
                      <span className="inline-flex w-full items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        <Check className="size-3" aria-hidden />
                        {tPlans('promo.deal', offerValues(discounted))}
                      </span>
                      <span className="text-sm text-muted-foreground line-through">
                        <span className="sr-only">{tSettings('regularPrice')} </span>
                        {money(monthly)}
                      </span>
                      <span className="text-3xl font-bold tracking-tight">{money(firstPrice)}</span>
                      <span className="text-sm text-muted-foreground">
                        {tPlans('promo.per', offerValues(discounted))}
                      </span>
                      {discounted.duration !== 'forever' && (
                        <span className="w-full text-xs text-muted-foreground">
                          {tPlans('promo.then', { price: money(monthly) })}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="text-3xl font-bold tracking-tight">
                        {price != null ? money(price) : '—'}
                      </span>
                      <span className="text-sm text-muted-foreground">/{tSettings('month')}</span>
                    </>
                  )}
                </div>

                {canAdmin ? (
                  <div className="space-y-2">
                    <Button
                      className="h-9 w-full"
                      variant={plan.highlighted ? 'default' : 'outline'}
                      disabled={price == null || !organizationId || checkoutPlan != null}
                      onClick={() => void choose(planId)}
                    >
                      {opening ? (
                        <>
                          <Loader2 className="animate-spin" aria-hidden />
                          {tPlans('openingCheckout')}
                        </>
                      ) : demo === 'trial' ? (
                        t('demo.dialog.startTrial')
                      ) : firstPrice != null && !demo ? (
                        tPlans('chooseToday', { plan: plan.name, price: money(firstPrice) })
                      ) : (
                        tSettings('choosePlanFor', { plan: plan.name })
                      )}
                    </Button>
                    <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                      <CreditCard className="size-3.5" aria-hidden />
                      {tPlans('payByCard')}
                    </p>
                  </div>
                ) : (
                  <p
                    data-slot="ask-admin"
                    className="flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-center text-xs text-muted-foreground"
                  >
                    <Lock className="size-3.5 shrink-0" aria-hidden />
                    {tPlans('askAdmin')}
                  </p>
                )}

                <ul className="space-y-1.5 text-sm">
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
              </section>
            );
          })}

          {/* Custom: priced with sales, from the pricing page's points */}
          <section
            data-plan="custom"
            aria-labelledby="upgrade-plan-custom"
            className="flex flex-col gap-4 rounded-xl border bg-muted/30 p-5"
          >
            <div>
              <h3 id="upgrade-plan-custom" className="text-base font-semibold">
                {tPlans('customName')}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground lg:min-h-8">
                {tPlans('customTagline')}
              </p>
            </div>
            <div className="flex flex-wrap content-end items-baseline gap-x-1.5 lg:min-h-20">
              <span className="w-full text-sm text-muted-foreground">{tPlans('startingAt')}</span>
              <span className="text-3xl font-bold tracking-tight">
                {money(CUSTOM_PLAN_STARTING_PRICE)}
              </span>
              <span className="text-sm text-muted-foreground">/{tSettings('month')}</span>
            </div>
            <a
              href={CONTACT_SALES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: 'outline' }), 'h-9 w-full')}
            >
              <Mail aria-hidden />
              {tPlans('contactUs')}
            </a>
            <ul className="space-y-1.5 text-sm">
              {customFeatures.map((point) => (
                <li key={point} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{tPlans('pricesInUsd')}</span>
          <a
            href={PRICING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
          >
            {tSettings('seeAllPlanFeatures')}
            <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
