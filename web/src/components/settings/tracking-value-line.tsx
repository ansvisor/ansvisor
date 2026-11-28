'use client';

import { useTranslations } from 'next-intl';
import { formatNumber } from '@/lib/format';
import type { PlanAddOnsView } from '@/lib/actions/plan-add-ons';
import { trackingValue } from '@/lib/billing/tracking-value';
import { formatPackPrice } from './add-ons-card';

/**
 * Settings › Billing › Current Plan: what the tracking gives for its price,
 * "Up to 37,500 answers a month · $6.64 per 1,000". Nothing when it can't be
 * told (tracking-value.ts).
 */
export function TrackingValueLine({ addOns }: { addOns: PlanAddOnsView }) {
  const t = useTranslations('settings.planAddOns');
  const value = trackingValue(addOns);
  if (!value) return null;
  const b = (chunks: React.ReactNode) => (
    <strong className="font-semibold text-foreground tabular-nums">{chunks}</strong>
  );
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t pt-3 text-sm">
      <span>
        {t.rich('value.line', {
          answers: formatNumber(value.answersPerMonth),
          price: formatPackPrice(value.centsPer1000, addOns.currency),
          b,
        })}
      </span>
      <span className="text-muted-foreground">
        {t('value.note', { slots: formatNumber(value.slotsPerDay) })}
      </span>
    </div>
  );
}
