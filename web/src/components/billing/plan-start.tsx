'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FIRST_MONTH_OFFER, PLANS, firstMonthOfferOn, type PlanId } from '@/config/plans';
import {
  FIRST_MONTH_CODE,
  periodPrice,
  type BillingInterval,
  type CheckoutMode,
} from '@/lib/billing/plan-purchase';
import { discountedPrice, type PromoOffer } from '@/lib/billing/promo-code';
import { TRIAL_DAYS } from '@/lib/billing/trial';
import { formatNumber } from '@/lib/format';

/**
 * How a plan starts, the same on the plan dialog (ChoosePlanDialog) and on
 * Settings › Billing while no plan is active: the plan's price, with the
 * first-month offer on a monthly plan, and its two ways to start, each
 * through Stripe Checkout with a card. Buy now: the full plan from day one.
 * The free trial: for a workspace that never had a plan, with limited AI
 * usage and no offer.
 */

/** Dollars as the cards show them: whole dollars bare, anything else to the cent. */
export function money(value: number): string {
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
export function offerValues(offer: PromoOffer) {
  return {
    code: offer.code,
    discount: discountOf(offer),
    duration: offer.duration,
    months: offer.durationInMonths ?? 1,
  };
}

/**
 * A promotion code as Stripe has it now (POST /api/stripe/promo-code): what
 * it takes off, 'invalid' when it can't be redeemed, 'failed' when it
 * couldn't be checked.
 */
export async function checkPromoCode(code: string): Promise<PromoOffer | 'invalid' | 'failed'> {
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

/**
 * Tries the first-month offer's code once, the first time `enabled` holds
 * (an admin, while the offer is on), and gives it to `setOffer` unless a
 * code is there already. Quietly: a code that doesn't apply leaves the offer
 * as it was. One that couldn't be checked (Stripe unreachable, or not set up
 * on a local server) still shows the offer as configured; Checkout applies
 * the code and says so if Stripe turns it down.
 */
export function useFirstMonthOffer(
  enabled: boolean,
  setOffer: Dispatch<SetStateAction<PromoOffer | null>>,
) {
  const tried = useRef(false);
  useEffect(() => {
    if (!enabled || tried.current) return;
    tried.current = true;
    void checkPromoCode(FIRST_MONTH_CODE).then((found) => {
      const shown =
        found === 'failed'
          ? {
              code: FIRST_MONTH_CODE,
              percentOff: FIRST_MONTH_OFFER.percentOff,
              amountOff: null,
              duration: 'once' as const,
              durationInMonths: null,
            }
          : found;
      if (typeof shown === 'object') setOffer((current) => current ?? shown);
    });
  }, [enabled, setOffer]);
}

/**
 * Opens Stripe Checkout for a new subscription: a plan, in `period`, bought
 * now (with `promotionCode`, if any) or as the free trial. A code Stripe
 * turned down since it was applied goes to `onCodeRefused`, so the page can
 * say so by its field; any other failure is a toast. `checkout` is the plan
 * whose Checkout is opening, and how it starts.
 */
export function useStartCheckout({
  organizationId,
  period,
  onCodeRefused,
}: {
  organizationId: string | null;
  period: BillingInterval;
  onCodeRefused?: (code: string) => void;
}) {
  const tSettings = useTranslations('settings');
  const tOffer = useTranslations('planOffer');
  const [checkout, setCheckout] = useState<{ planId: PlanId; mode: CheckoutMode } | null>(null);

  async function start(planId: PlanId, mode: CheckoutMode, promotionCode?: string) {
    if (!organizationId || checkout) return;
    setCheckout({ planId, mode });
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId,
          organizationId,
          interval: period,
          returnTo: 'billing',
          mode,
          ...(promotionCode ? { promotionCode } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        if (data.code === 'invalid_promo_code' && promotionCode && onCodeRefused) {
          onCodeRefused(promotionCode);
          setCheckout(null);
          return;
        }
        if (data.code === 'trial_unavailable') throw new Error(tOffer('trialUsed'));
        throw new Error(data.error || tSettings('checkoutFailed'));
      }
      window.location.href = data.url;
      // No reset: the page is leaving for Stripe.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tSettings('checkoutFailed'));
      setCheckout(null);
    }
  }

  return { checkout, start };
}

/**
 * A plan's price on its card: a year up front against twelve months; with a
 * code on a monthly plan (`discounted`), the first month's price, marked
 * Limited offer for the first-month offer's code; otherwise its monthly price.
 */
export function PlanPrice({
  planId,
  period,
  discounted,
}: {
  planId: PlanId;
  period: BillingInterval;
  /** The code that lowers this period's price: a monthly plan, for an admin. */
  discounted: PromoOffer | null;
}) {
  const tSettings = useTranslations('settings');
  const tPlans = useTranslations('readOnly.plans');
  const tOffer = useTranslations('planOffer');
  const monthly = periodPrice(planId, 'month');
  const price = periodPrice(planId, period);
  const firstPrice = discounted && monthly != null ? discountedPrice(monthly, discounted) : null;

  return (
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
          <span className="inline-flex w-full flex-wrap items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            {firstMonthOfferOn() && discounted.code.toUpperCase() === FIRST_MONTH_CODE ? (
              <Badge
                data-slot="limited-offer"
                variant="outline"
                className="h-5 border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-700 dark:text-emerald-400"
              >
                {tOffer('limitedOffer')}
              </Badge>
            ) : (
              <Check className="size-3" aria-hidden />
            )}
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
  );
}

/**
 * A plan's ways to start, for an admin: Buy now (Choose {plan} without a
 * code), and the free trial when `trialOffered`, each with its terms below.
 */
export function PlanStartButtons({
  planId,
  period,
  discounted,
  trialOffered,
  opening,
  disabled,
  onStart,
}: {
  planId: PlanId;
  period: BillingInterval;
  /** The code that lowers this period's price, as PlanPrice has it. */
  discounted: PromoOffer | null;
  /** The workspace never had a plan: the free trial is offered too. */
  trialOffered: boolean;
  /** How this plan's Checkout is opening, if it is. */
  opening: CheckoutMode | null;
  disabled: boolean;
  onStart: (mode: CheckoutMode) => void;
}) {
  const tSettings = useTranslations('settings');
  const tPlans = useTranslations('readOnly.plans');
  const tOffer = useTranslations('planOffer');
  const plan = PLANS[planId];
  const price = periodPrice(planId, period);
  const openingCheckout = (
    <>
      <Loader2 className="animate-spin" aria-hidden />
      {tPlans('openingCheckout')}
    </>
  );

  return (
    <div className="space-y-2">
      {/* Buy now: the full plan today, the first-month offer on a monthly plan. */}
      <Button
        data-mode="buy"
        className="h-9 w-full"
        variant={plan.highlighted ? 'default' : 'outline'}
        disabled={disabled}
        onClick={() => onStart('buy')}
      >
        {opening === 'buy'
          ? openingCheckout
          : discounted
            ? tOffer('buyNow')
            : tSettings('choosePlanFor', { plan: plan.name })}
      </Button>
      {/* The first month's price is the card's own, above: not again here. */}
      {trialOffered && (
        <p data-slot="buy-terms" className="text-center text-xs text-muted-foreground">
          {tOffer('fullPlan')}
        </p>
      )}
      {trialOffered && (
        <>
          <Button
            data-mode="trial"
            className="h-9 w-full"
            variant="outline"
            disabled={disabled}
            onClick={() => onStart('trial')}
          >
            {opening === 'trial' ? openingCheckout : tOffer('startTrial', { days: TRIAL_DAYS })}
          </Button>
          <p data-slot="trial-terms" className="text-center text-xs text-muted-foreground">
            {tOffer('trialPrice', {
              days: TRIAL_DAYS,
              price: price != null ? money(price) : '—',
              period,
            })}
            <span className="block">{tOffer('limitedAi', { days: TRIAL_DAYS })}</span>
          </p>
        </>
      )}
    </div>
  );
}
