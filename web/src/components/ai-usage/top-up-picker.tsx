'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, formatPackPrice } from '@/components/settings/add-ons-card';
import {
  applyAddOnChange,
  readPlanAddOns,
  type AddOnChangeRefusal,
  type PlanAddOnsRead,
} from '@/lib/actions/plan-add-ons';
import { cn } from '@/lib/utils';

/**
 * The Get more window's AI tab (00547): AI usage top-ups in place of the
 * retired credit packs. A Growth admin picks +5x, +10x or +20x and pays it
 * at once, through the same cart as Billing (applyAddOnChange, the plan's
 * tracking and brands left as they are). Starter is told Growth comes with
 * more; every other state says why it can't buy.
 */
export function TopUpPicker({ onBought }: { onBought?: () => void }) {
  const t = useTranslations('aiUsage.getMoreWindow.topUp');
  const tPlan = useTranslations('settings.planAddOns');
  const [read, setRead] = useState<PlanAddOnsRead | undefined>(undefined);
  const [picked, setPicked] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readPlanAddOns()
      .catch((): PlanAddOnsRead => ({ ok: false, failure: 'failed' }))
      .then((next) => {
        if (cancelled) return;
        setRead(next);
        // The middle one to start with, as Billing's "Most picked".
        if (next.ok) {
          const options = next.addOns.topUps;
          setPicked(options[Math.floor(options.length / 2)]?.multiplier ?? null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!read) return <Skeleton className="h-24 w-full" />;
  if (!read.ok) return <p className="text-sm text-muted-foreground">{tPlan('readFailed')}</p>;
  const view = read.addOns;

  if (view.state === 'starter') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
        <span>{t('starter')}</span>
        <Link
          href="/dashboard/settings/billing"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          {t('seeGrowth')}
        </Link>
      </div>
    );
  }

  // Enterprise buys top-ups too (00566), when its plan lets this person buy.
  const shownState = view.state === 'enterprise' ? view.buyState : view.state;
  const open = shownState === 'open';
  const option = view.topUps.find((o) => o.multiplier === picked) ?? null;
  const money = (cents: number) => formatPackPrice(cents, view.currency);

  function refusal(answer: AddOnChangeRefusal): string {
    const base = tPlan(`errors.${answer.failure === 'below_usage' ? 'failed' : answer.failure}`);
    return answer.message ? `${base} ${answer.message}` : base;
  }

  async function pay() {
    if (!option) return;
    setBusy(true);
    const answer = await applyAddOnChange({
      trackingUnits: view.current.trackingUnits,
      extraBrands: view.current.extraBrands,
      topUp: option.multiplier,
      topUpOnly: true,
    });
    setBusy(false);
    setConfirming(false);
    if (answer.ok) {
      setMessage({ tone: 'ok', text: t('done') });
      onBought?.();
    } else {
      setMessage({ tone: 'error', text: refusal(answer) });
    }
  }

  return (
    <div className="space-y-3" data-slot="top-up-picker">
      <p className="text-sm text-muted-foreground">
        {view.renewsOn
          ? tPlan('topUp.description', { date: formatDate(view.renewsOn) })
          : tPlan('topUp.descriptionNoDate')}
      </p>
      {!open && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {tPlan(`states.${shownState}`)}
        </p>
      )}
      <div
        role="radiogroup"
        aria-label={t('label')}
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      >
        {view.topUps.map((o) => (
          <button
            key={o.multiplier}
            type="button"
            role="radio"
            aria-checked={picked === o.multiplier}
            disabled={!open}
            onClick={() => {
              setPicked(o.multiplier);
              setConfirming(false);
            }}
            className={cn(
              'rounded-xl border p-3 text-start text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60',
              picked === o.multiplier ? 'border-foreground bg-accent' : 'hover:bg-accent',
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="font-semibold">
                {tPlan('topUp.option', { multiplier: o.multiplier })}
              </span>
              <span className="tabular-nums">{money(o.priceCents)}</span>
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {tPlan('topUp.adds', {
                multiplier: o.multiplier,
                briefs: o.briefs,
                opportunities: o.opportunities,
              })}
            </span>
          </button>
        ))}
      </div>

      {open && option && confirming && (
        <div role="group" className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <p>{t('confirm', { price: money(option.priceCents) })}</p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              {t('cancel')}
            </Button>
            <Button size="sm" data-action="topUp.pay" onClick={() => void pay()} disabled={busy}>
              {busy ? t('paying') : t('pay', { price: money(option.priceCents) })}
            </Button>
          </div>
        </div>
      )}
      {open && option && !confirming && (
        <div className="flex justify-end">
          <Button size="sm" data-action="topUp.buy" onClick={() => setConfirming(true)}>
            {t('buy', {
              option: tPlan('topUp.option', { multiplier: option.multiplier }),
              price: money(option.priceCents),
            })}
          </Button>
        </div>
      )}

      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'text-sm',
            message.tone === 'error'
              ? 'text-red-600 dark:text-red-400'
              : 'text-emerald-700 dark:text-emerald-400',
          )}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
