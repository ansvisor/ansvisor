'use client';

import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { platformLabel } from '@/config/platform-labels';
import { STANDARD_SLOT_PLATFORMS } from '@/config/tracking-slots';
import { formatNumber } from '@/lib/format';
import { SLOT_DISCOUNT_STEPS, slotDiscount, type SlotDiscount } from '@/lib/billing/slot-discount';
import type { PlanSlotsView } from '@/lib/actions/plan-add-ons';
import { cn } from '@/lib/utils';
import { formatPackPrice } from './add-ons-card';

/** Units of 100 slots picked per platform. */
export type SlotUnits = Readonly<Record<string, number>>;

/** The units the subscription holds now, per platform. */
export function currentSlotUnits(view: PlanSlotsView): Record<string, number> {
  return Object.fromEntries(view.platforms.map((p) => [p.id, p.units]));
}

/** Whether the pick differs from what the subscription holds. */
export function slotUnitsChanged(view: PlanSlotsView, units: SlotUnits): boolean {
  return view.platforms.some((p) => (units[p.id] ?? 0) !== p.units);
}

/** The slots' list price per period for a pick, in cents. */
export function slotListCents(view: PlanSlotsView, units: SlotUnits): number {
  return view.platforms.reduce((sum, p) => sum + p.unitCents * (units[p.id] ?? 0), 0);
}

/** The volume discount on a pick, and on what the subscription holds now. */
export function slotDiscounts(view: PlanSlotsView, units: SlotUnits, interval: 'month' | 'year') {
  return {
    now: slotDiscount(slotListCents(view, currentSlotUnits(view)), interval),
    picked: slotDiscount(slotListCents(view, units), interval),
  };
}

/** A price after the volume discount's rate, in cents. */
export const discounted = (cents: number, discount: SlotDiscount) =>
  Math.round(cents * (1 - discount.percentOff / 100));

/**
 * Settings › Billing › Buy extra tracking credits (00564, mockup E): extra
 * slots per platform, in units of 100, on the plan's period. Above the
 * table, the marginal volume discount the pick reaches and what the next
 * step needs; each row's price per 100 and cost show it taken off. The cart
 * below (Your add-ons) charges them with the rest.
 */
export function PlanSlotsCard({
  view,
  planName,
  interval,
  currency,
  units,
  onUnits,
  onStep,
  disabled,
}: {
  view: PlanSlotsView;
  planName: string;
  interval: 'month' | 'year';
  currency: string;
  units: SlotUnits;
  /** Sets a platform's units (the box, Undo). */
  onUnits: (platform: string, units: number) => void;
  /** Adds to a platform's units (− / +), from what they are when it runs. */
  onStep: (platform: string, delta: number) => void;
  disabled: boolean;
}) {
  const t = useTranslations('settings.planAddOns.slots');
  const money = (cents: number) => formatPackPrice(cents, currency);
  const { now, picked } = slotDiscounts(view, units, interval);
  const months = interval === 'year' ? 10 : 1;
  const included = view.platforms.find((p) => STANDARD_SLOT_PLATFORMS.includes(p.id))?.included;

  return (
    <Card data-slot="plan-slots">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {included != null && included > 0
            ? t('description', { plan: planName, included: formatNumber(included) })
            : t('descriptionNone')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* The discount the pick reaches, and what the next step needs. */}
        <div
          data-slot="slots-discount"
          className={cn(
            'rounded-lg border px-3 py-2 text-sm',
            picked.percentOff > 0
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200'
              : 'bg-muted/40',
          )}
        >
          {picked.percentOff > 0
            ? t.rich('discount.reached', {
                percent: picked.percentOff,
                off: money(picked.discountCents),
                list: money(picked.listCents),
                interval,
                b: (chunks) => <strong>{chunks}</strong>,
              })
            : t('discount.list', { list: money(picked.listCents), interval })}{' '}
          {picked.next
            ? t.rich('discount.next', {
                more: money(picked.next.remainingCents),
                percent: picked.next.step.percent,
                from: money(picked.next.step.fromCents * months),
                interval,
                b: (chunks) => <strong>{chunks}</strong>,
              })
            : t('discount.top')}
          {picked.percentOff < now.percentOff && (
            <div className="mt-1 font-medium text-amber-800 dark:text-amber-300">
              {t('discount.drops', { from: now.percentOff, to: picked.percentOff })}
            </div>
          )}
        </div>

        {/* Each step's rate applies to the part of the price above it. */}
        <ol className="flex flex-wrap gap-1.5 text-xs" aria-label={t('discount.steps')}>
          <li className="py-0.5 pe-1 text-muted-foreground">{t('discount.stepsLead')}</li>
          {SLOT_DISCOUNT_STEPS.filter((step) => step.percent > 0).map((step) => {
            const reached = picked.step.percent >= step.percent;
            const next = picked.next?.step.percent === step.percent;
            return (
              <li
                key={step.percent}
                aria-current={picked.step.percent === step.percent ? 'step' : undefined}
                className={cn(
                  'rounded-full border px-2 py-0.5 tabular-nums',
                  reached
                    ? 'border-emerald-600 bg-emerald-600 font-semibold text-white dark:border-emerald-500 dark:bg-emerald-500 dark:text-emerald-950'
                    : next
                      ? 'border-dashed border-foreground/60'
                      : 'text-muted-foreground',
                )}
              >
                {t('discount.step', {
                  percent: step.percent,
                  from: money(step.fromCents * months),
                  interval,
                })}
                {reached ? ` ${t('discount.yours')}` : next ? ` ${t('discount.nextTag')}` : ''}
              </li>
            );
          })}
        </ol>

        <p className="text-xs text-muted-foreground">
          {t.rich('unit', {
            b: (chunks) => <b className="font-medium text-foreground">{chunks}</b>,
          })}
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b text-start text-xs text-muted-foreground">
                <th className="py-2 pe-2 text-start font-medium">{t('columns.platform')}</th>
                <th className="py-2 pe-2 text-start font-medium">{t('columns.included')}</th>
                <th className="py-2 pe-2 text-start font-medium">
                  <span className="inline-flex items-center gap-1">
                    {t('columns.extra')}
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            aria-label={t('unitInfo')}
                            className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Info className="h-3.5 w-3.5" />
                          </button>
                        }
                      />
                      <TooltipContent>
                        {t.rich('unit', {
                          b: (chunks) => <b className="font-medium">{chunks}</b>,
                        })}
                      </TooltipContent>
                    </Tooltip>
                  </span>
                </th>
                <th className="py-2 pe-2 text-end font-medium">
                  {t('columns.price', { interval })}
                </th>
                <th className="py-2 text-end font-medium">{t('columns.cost', { interval })}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {view.platforms.map((platform) => {
                const pickedUnits = units[platform.id] ?? 0;
                const extra = pickedUnits * platform.unitSlots;
                const changed = pickedUnits !== platform.units;
                const label = platformLabel(platform.id);
                return (
                  <tr key={platform.id} data-platform={platform.id}>
                    <td className="py-2 pe-2 font-medium">{label}</td>
                    <td className="py-2 pe-2 tabular-nums text-muted-foreground">
                      {platform.included < 0
                        ? t('unlimited')
                        : platform.included > 0
                          ? formatNumber(platform.included)
                          : '—'}
                    </td>
                    <td className="py-2 pe-2">
                      <div
                        className={cn(
                          'inline-flex items-center rounded-lg border',
                          changed && 'border-foreground',
                        )}
                      >
                        <button
                          type="button"
                          aria-label={t('fewer', { platform: label })}
                          disabled={disabled || pickedUnits === 0}
                          onClick={() => onStep(platform.id, -1)}
                          className="h-8 w-7 text-muted-foreground hover:bg-accent disabled:opacity-40"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          step={platform.unitSlots}
                          value={extra}
                          disabled={disabled}
                          aria-label={t('extraOn', { platform: label })}
                          onChange={(e) =>
                            onUnits(
                              platform.id,
                              Math.max(
                                0,
                                Math.round((Number(e.target.value) || 0) / platform.unitSlots),
                              ),
                            )
                          }
                          className="h-8 w-20 border-x bg-transparent px-2 text-end tabular-nums outline-none focus:bg-accent disabled:opacity-60"
                        />
                        <button
                          type="button"
                          aria-label={t('more', { platform: label })}
                          disabled={disabled}
                          onClick={() => onStep(platform.id, 1)}
                          className="h-8 w-7 hover:bg-accent disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                      {changed && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {t('was', { slots: formatNumber(platform.units * platform.unitSlots) })} ·{' '}
                          <button
                            type="button"
                            onClick={() => onUnits(platform.id, platform.units)}
                            className="underline underline-offset-2 hover:text-foreground"
                          >
                            {t('undo')}
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="py-2 pe-2 text-end tabular-nums">
                      {picked.percentOff > 0 && (
                        <span className="text-xs text-muted-foreground line-through">
                          {money(platform.unitCents)}
                        </span>
                      )}{' '}
                      {money(discounted(platform.unitCents, picked))}
                    </td>
                    <td className="py-2 text-end tabular-nums">
                      {pickedUnits
                        ? money(discounted(platform.unitCents * pickedUnits, picked))
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">{t('footer')}</p>
      </CardContent>
    </Card>
  );
}
