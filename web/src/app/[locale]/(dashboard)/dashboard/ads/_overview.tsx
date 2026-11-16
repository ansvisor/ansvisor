'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { Link } from '@/i18n/navigation';
import { readAdsOverview, type AdsOverview as Overview } from '@/lib/ads/api';
import type { AdsPeriod, AdsTab } from '@/lib/ads/tabs';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/stores/use-brand-store';

/** The bar's parts in the mockup's order and colours; one not measured (null) isn't shown. */
const PARTS = [
  ['earned', 'bg-green-600'],
  ['earnedPaid', 'bg-foreground'],
  ['paidOnly', 'bg-muted-foreground/50'],
  ['neither', 'bg-muted-foreground/15'],
] as const;

/** A link inside a KPI, plainly one. */
const LINK =
  'text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground';

function Kpi({ label, value, children }: { label: string; value: ReactNode; children: ReactNode }) {
  return (
    <Card size="sm" data-slot="ads-kpi">
      <CardContent className="space-y-1">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
        <div className="text-3xl font-bold">{value}</div>
        <div className="space-y-0.5 text-xs text-muted-foreground">{children}</div>
      </CardContent>
    </Card>
  );
}

/**
 * Ads' Overview (ADS-01 §3.1, mockup): four KPIs, then the earn-or-pay bar,
 * read from the server over every buying-intent prompt for the period, on
 * every plan (§8). What isn't measured yet says so, never a number: paid
 * (sponsored ads in AI answers) and the cost per signup (ad spend, Phase 1).
 */
export function AdsOverview({
  period,
  onOpenTab,
}: {
  period: AdsPeriod;
  onOpenTab: (tab: AdsTab) => void;
}) {
  const t = useTranslations('ads.overview');
  const { requiredPlanFor } = useFeatureGate();
  const brandId = useBrandStore((s) => s.activeBrandId);
  const key = `${brandId}/${period}`;
  const [read, setRead] = useState<{ key: string; overview: Overview | null } | null>(null);

  useEffect(() => {
    if (!brandId) return;
    let live = true;
    const done = (overview: Overview | null) => {
      if (live) setRead({ key, overview });
    };
    readAdsOverview(brandId, period).then(done, () => done(null));
    return () => {
      live = false;
    };
  }, [brandId, period, key]);

  if (read?.key !== key) return <Skeleton className="h-64 w-full rounded-xl" />;
  const o = read.overview;
  if (!o) {
    return (
      <p role="alert" className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        {t('failed')}
      </p>
    );
  }
  const notMeasured = <span className="text-xl text-muted-foreground">{t('notMeasured')}</span>;
  const covered = o.total - o.bar.neither;
  const parts = PARTS.filter(([part]) => o.bar[part] !== null);

  return (
    <div data-slot="ads-overview" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t('prompts')} value={o.total}>
          {o.notAnalysed > 0 && (
            <Link href="/dashboard/prompts/insights" data-action="ads.openVolumes" className={LINK}>
              {t('notAnalysed', { count: o.notAnalysed })}
            </Link>
          )}
        </Kpi>
        <Kpi
          label={t('covered')}
          value={o.total ? `${Math.round((covered / o.total) * 100)}%` : '—'}
        >
          {t(o.paidMeasured ? 'coveredOf' : 'coveredEarned', { covered, total: o.total })}
        </Kpi>
        <Kpi label={t('sov')} value={notMeasured}>
          <p>{t('sovNote')}</p>
          <button
            type="button"
            data-action="ads.openSov"
            onClick={() => onOpenTab('sov')}
            className={LINK}
          >
            {t('openSov')}
          </button>
        </Kpi>
        <Kpi label={t('cost')} value={notMeasured}>
          <p>{t('costNote')}</p>
          <p data-slot="ads-signups">
            {o.signups === null ? t('signupsNotMeasured') : t('signups', { count: o.signups })}
          </p>
        </Kpi>
      </div>

      <Card data-slot="ads-earn-or-pay">
        <CardHeader>
          <CardTitle>{t('barTitle', { count: o.total })}</CardTitle>
          <CardDescription>{t('days', { days: Number.parseInt(period, 10) })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div aria-hidden className="flex h-3.5 overflow-hidden rounded-full bg-muted">
            {parts.map(([part, colour]) => (
              <i
                key={part}
                className={cn('block h-full', colour)}
                style={{ width: `${((o.bar[part] ?? 0) / (o.total || 1)) * 100}%` }}
              />
            ))}
          </div>
          <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
            {parts.map(([part, colour]) => (
              <li key={part} data-part={part} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn('size-2.5 rounded-[3px] ring-1 ring-foreground/10', colour)}
                />
                {t(part)}
                <b className="ml-auto font-semibold tabular-nums">{o.bar[part]}</b>
              </li>
            ))}
          </ul>
          {!o.paidMeasured && (
            <p className="text-xs text-muted-foreground">{t('paidNotMeasured')}</p>
          )}
          <Button size="sm" data-action="ads.openOpportunities" onClick={() => onOpenTab('op')}>
            {t('openPrompts', { count: o.bar.neither })}
          </Button>
          {o.locked > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('locked', { count: o.locked, plan: requiredPlanFor('ads_read') })}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
