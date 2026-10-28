'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUpRight, Check, CreditCard, Lock, Mail, Play, Tag, X } from 'lucide-react';
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
  firstMonthOfferOn,
} from '@/config/plans';
import { useUserRole } from '@/hooks/use-user-role';
import {
  FIRST_MONTH_CODE,
  annualSaving,
  periodPrice,
  takesPromoCode,
  type BillingInterval,
} from '@/lib/billing/plan-purchase';
import type { PromoOffer } from '@/lib/billing/promo-code';
import type { DemoOffer } from '@/lib/demo/demo-brand';
import { cn } from '@/lib/utils';
import {
  PlanPrice,
  PlanStartButtons,
  checkPromoCode,
  money,
  offerValues,
  useFirstMonthOffer,
  useStartCheckout,
} from './plan-start';

type CodeError = { kind: 'invalid'; code: string } | { kind: 'failed' };

/**
 * The offer the dialog makes with its plans: from the demo brand (the free
 * trial for a workspace that never subscribed, 50% off the first month once
 * a plan ended), or the free trial for a workspace's own brand, never
 * tracked yet. Each comes with the first-month code.
 */
export type PlanPitch = { from: 'demo'; offer: DemoOffer } | { from: 'own_brand'; offer: 'trial' };

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
 * Two ways to start, each with a card. Buy now: the full plan from day one,
 * with the first-month offer on a monthly plan (FIRST_MONTH_OFFER): an admin
 * finds its code already applied, and without it (the offer off, a year, a
 * code Stripe refused) the button is the plain Choose {plan}. And, for a
 * workspace that never had a subscription (`pitch.offer` 'trial'), the free
 * trial, with no offer and limited AI usage. A `pitch` also says where the
 * dialog was opened from: the demo brand, or a brand never tracked.
 */
export function ChoosePlanDialog({
  open,
  onOpenChange,
  action,
  askAdmin,
  organizationId,
  pitch = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What was clicked ("Adding prompts needs a plan"); none from the banner. */
  action: string | null;
  /** What a member who isn't an admin is asked to do. */
  askAdmin: string;
  /** The organization the new subscription is for. */
  organizationId: string | null;
  /** The offer its title and buttons make, besides the plans. */
  pitch?: PlanPitch | null;
}) {
  const t = useTranslations('readOnly');
  const tPlans = useTranslations('readOnly.plans');
  const tSettings = useTranslations('settings');
  const tCards = useTranslations('settings.planCards');
  const tOffer = useTranslations('planOffer');
  const planFeatures = usePlanFeatures();
  const { canAdmin } = useUserRole();

  const [period, setPeriod] = useState<BillingInterval>('month');
  const [codeInput, setCodeInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [codeError, setCodeError] = useState<CodeError | null>(null);
  // The code Stripe took, with what it takes off. Only an admin enters one.
  const [offer, setOffer] = useState<PromoOffer | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const demo = pitch?.from === 'demo';
  // The free trial: for a workspace that never had a subscription.
  const trialOffered = pitch?.offer === 'trial';
  const offerOn = firstMonthOfferOn();

  // The first-month offer's code is tried once, the first time the dialog opens.
  useFirstMonthOffer(open && offerOn && canAdmin, setOffer);

  const saving = Math.max(0, ...SUBSCRIBABLE_PLANS.map((id) => annualSaving(id) ?? 0));
  // The code lowers this period's prices: a monthly plan, for an admin.
  const discounted = canAdmin && offer != null && takesPromoCode(period) ? offer : null;
  const { checkout, start } = useStartCheckout({
    organizationId,
    period,
    // The code stopped working since it was applied: say so by the field.
    onCodeRefused: (code) => {
      setOffer(null);
      setCodeInput(code);
      setCodeError({ kind: 'invalid', code: code.toUpperCase() });
    },
  });

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
            {pitch?.from === 'demo'
              ? t('demo.dialog.title')
              : pitch?.from === 'own_brand'
                ? t('trialOffer.title')
                : t('dialog.title.ended')}
          </DialogTitle>
          <DialogDescription className="max-w-2xl">
            {demo
              ? t('demo.dialog.body')
              : pitch?.from === 'own_brand'
                ? t('trialOffer.body')
                : t('dialog.body.ended')}
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
            const busy = periodPrice(planId, period) == null || !organizationId || checkout != null;

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

                <PlanPrice planId={planId} period={period} discounted={discounted} />

                {canAdmin ? (
                  <PlanStartButtons
                    planId={planId}
                    period={period}
                    discounted={discounted}
                    trialOffered={trialOffered}
                    opening={checkout?.planId === planId ? checkout.mode : null}
                    disabled={busy}
                    // A code goes with buying now only: the trial comes without an offer.
                    onStart={(mode) =>
                      void start(planId, mode, mode === 'buy' ? discounted?.code : undefined)
                    }
                  />
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
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            {canAdmin && (
              <span data-slot="card-note" className="inline-flex items-center gap-1.5">
                <CreditCard className="size-3.5" aria-hidden />
                {tOffer('cardNote', { both: trialOffered ? 'yes' : 'no' })}
              </span>
            )}
            {tPlans('pricesInUsd')}
          </span>
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
