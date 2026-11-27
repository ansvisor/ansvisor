'use client';

import { useTranslations } from 'next-intl';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { platformLabel } from '@/config/platform-labels';
import type { SlotGroup } from '@/config/tracking-slots';
import { formatNumber } from '@/lib/format';
import { SLOT_DISCOUNT_STEPS, slotDiscount } from '@/lib/billing/slot-discount';
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

const GROUPS: readonly SlotGroup[] = ['standard', 'mid', 'signed_in'];

/**
 * Settings › Billing › Tracking slots (00564): extra slots per platform, in
 * units of 100, on the plan's period, with the marginal volume discount
 * worked out as the pick changes. The card's cart (Review and pay) charges
 * them with the rest.
 */
export function PlanSlotsSection({
  view,
  interval,
  currency,
  units,
  onUnits,
  disabled,
}: {
  view: PlanSlotsView;
  interval: 'month' | 'year';
  currency: string;
  units: SlotUnits;
  onUnits: (platform: string, units: number) => void;
  disabled: boolean;
}) {
  const t = useTranslations('settings.planAddOns.slots');
  const money = (cents: number) => formatPackPrice(cents, currency);
  const discount = slotDiscount(slotListCents(view, units), interval);
  const months = interval === 'year' ? 10 : 1;

  return (
    <section className="space-y-3" data-slot="plan-slots">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{t('title')}</h3>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {GROUPS.map((group) => {
        const platforms = view.platforms.filter((p) => p.group === group);
        if (!platforms.length) return null;
        return (
          <div key={group} className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              {t(`groups.${group}`, {
                price: money(platforms[0].unitCents),
                interval,
              })}
            </p>
            <ul className="divide-y rounded-lg border">
              {platforms.map((platform) => {
                const picked = units[platform.id] ?? 0;
                const bought = picked * platform.unitSlots;
                const total = platform.included < 0 ? -1 : platform.included + bought;
                const label = platformLabel(platform.id);
                return (
                  <li
                    key={platform.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2"
                    data-platform={platform.id}
                  >
                    <div className="min-w-40 flex-1">
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {total < 0
                          ? t('unlimited', { used: formatNumber(platform.inUse) })
                          : total === 0
                            ? t('notIncluded')
                            : t('usage', {
                                used: formatNumber(platform.inUse),
                                total: formatNumber(total),
                                included: formatNumber(platform.included),
                              })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {picked > 0 && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {t('price', { price: money(platform.unitCents * picked), interval })}
                        </span>
                      )}
                      <div className="inline-flex items-center rounded-lg border">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t('fewer', { platform: label })}
                          disabled={disabled || picked === 0}
                          onClick={() => onUnits(platform.id, Math.max(0, picked - 1))}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="min-w-16 px-1 text-center text-sm tabular-nums">
                          {t('extra', { slots: formatNumber(bought) })}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t('more', { platform: label })}
                          disabled={disabled}
                          onClick={() => onUnits(platform.id, picked + 1)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {/* The volume discount: one rate per step, on the part above it. */}
      <div className="space-y-2 rounded-lg border px-3 py-2" data-slot="slots-discount">
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <span>{t('discount.title')}</span>
          <span className="tabular-nums">
            {discount.listCents > 0
              ? t('discount.total', {
                  list: money(discount.listCents),
                  percent: discount.percentOff,
                  off: money(discount.discountCents),
                  price: money(discount.listCents - discount.discountCents),
                  interval,
                })
              : t('discount.none')}
          </span>
        </div>
        <ol className="flex flex-wrap gap-1.5" aria-label={t('discount.steps')}>
          {SLOT_DISCOUNT_STEPS.filter((step) => step.percent > 0).map((step) => {
            const reached = discount.step.percent >= step.percent;
            const current = discount.step.percent === step.percent;
            return (
              <li
                key={step.percent}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-xs tabular-nums',
                  current
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : reached
                      ? 'text-muted-foreground'
                      : 'border-dashed text-muted-foreground',
                )}
              >
                {t('discount.step', {
                  percent: step.percent,
                  from: money(step.fromCents * months),
                  interval,
                })}
              </li>
            );
          })}
        </ol>
        <p className="text-xs text-muted-foreground">
          {discount.next
            ? t('discount.next', {
                more: money(discount.next.remainingCents),
                percent: discount.next.step.percent,
                from: money(discount.next.step.fromCents * months),
              })
            : t('discount.top')}
        </p>
      </div>
    </section>
  );
}
