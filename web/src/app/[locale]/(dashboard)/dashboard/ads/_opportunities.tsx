'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { UpgradeCard } from '@/components/billing/upgrade-card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import {
  readAdsOpportunities,
  type AdsDecision,
  type AdsOpportunities as Page,
  type AdsOpportunity,
} from '@/lib/ads/api';
import type { AdsPeriod } from '@/lib/ads/tabs';
import { formatCompactNumber, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/stores/use-brand-store';

/** The filters (§3.2), in the mockup's order; overlap rows show under All. */
const FILTERS = ['all', 'earn_pay', 'pay', 'earn'] as const;
type Filter = (typeof FILTERS)[number];

/** The mockup's pills: earn green, pay grey, earn + pay dark. */
const PILL: Record<AdsDecision, string> = {
  earn: 'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300',
  pay: 'bg-muted text-foreground',
  earn_pay: 'border-foreground bg-foreground text-background',
  overlap:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
};

function Pill({ decision }: { decision: AdsDecision }) {
  const t = useTranslations('ads.opportunities.decisions');
  return (
    <span
      data-decision={decision}
      className={cn(
        'inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        PILL[decision],
      )}
    >
      {t(decision)}
    </span>
  );
}

/** The decision in force, and the rule's when a person changed it. */
function Decision({ row }: { row: AdsOpportunity }) {
  const t = useTranslations('ads.opportunities');
  return (
    <div className="space-y-0.5">
      <Pill decision={row.decision} />
      {row.override && (
        <small className="block text-xs text-muted-foreground">
          {t('recommended', { decision: t(`decisions.${row.recommended}`) })}
        </small>
      )}
    </div>
  );
}

/**
 * Ads' Opportunities (ADS-01 §3.2, §9.3, §9.7, mockup): each buying-intent
 * prompt with its decision, who AI picks, Google searches and its ad
 * channels, filtered by decision. The rows come from the server: Starter and
 * the trial get theirs and a lock row for the rest. Open keeps the prompt
 * opened (`ads.openOpportunity`) for its drawer.
 */
export function AdsOpportunities({ period }: { period: AdsPeriod }) {
  const t = useTranslations('ads.opportunities');
  const tAds = useTranslations('ads');
  const { requiredPlanFor } = useFeatureGate();
  const brandId = useBrandStore((s) => s.activeBrandId);
  const key = `${brandId}/${period}`;
  const [read, setRead] = useState<{ key: string; page: Page | null } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [opened, setOpened] = useState<string | null>(null);

  useEffect(() => {
    if (!brandId) return;
    let live = true;
    const done = (page: Page | null) => {
      if (live) setRead({ key, page });
    };
    readAdsOpportunities(brandId, period).then(done, () => done(null));
    return () => {
      live = false;
    };
  }, [brandId, period, key]);

  if (read?.key !== key) return <Skeleton className="h-64 w-full rounded-xl" />;
  const page = read.page;
  if (!page) {
    return (
      <p role="alert" className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        {t('failed')}
      </p>
    );
  }

  const count = (f: Filter) =>
    f === 'all' ? page.rows.length : page.rows.filter((r) => r.decision === f).length;
  const rows = filter === 'all' ? page.rows : page.rows.filter((r) => r.decision === filter);
  const leader = (r: AdsOpportunity) =>
    r.leader === 'us'
      ? t('leaderUs')
      : r.leader === 'none'
        ? t('leaderNone')
        : (r.leaderName ?? t('leaderRival'));

  if (page.rows.length === 0 && page.locked === 0) {
    return (
      <div data-slot="ads-empty" className="rounded-xl border border-dashed py-12 text-center">
        <h2 className="text-sm font-medium">{t('emptyTitle')}</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('empty')}</p>
      </div>
    );
  }

  return (
    <div data-slot="ads-opportunities" className="space-y-3">
      <div
        role="group"
        aria-label={t('filter')}
        className="flex h-8 w-fit overflow-hidden rounded-md border"
      >
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            data-action="ads.filterDecision"
            data-filter={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 text-xs font-medium transition-colors',
              filter === f
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-foreground hover:bg-muted',
            )}
          >
            {t('filterCount', {
              label: f === 'all' ? t('all') : t(`decisions.${f}`),
              count: count(f),
            })}
          </button>
        ))}
      </div>
      {page.rows.some((r) => !r.paidMeasured) && (
        <p className="text-xs text-muted-foreground">{t('paidNotMeasured')}</p>
      )}

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.prompt')}</TableHead>
              <TableHead>{t('columns.decision')}</TableHead>
              <TableHead>{t('columns.leader')}</TableHead>
              <TableHead className="text-right">{t('columns.searches')}</TableHead>
              <TableHead>{t('columns.channels')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('open')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.promptId}
                data-prompt-id={r.promptId}
                data-state={opened === r.promptId ? 'selected' : undefined}
              >
                <TableCell className="max-w-md whitespace-normal">
                  {r.text}
                  {r.topic?.name && (
                    <small className="block text-xs text-muted-foreground">
                      {t('topic', { name: r.topic.name })}
                    </small>
                  )}
                </TableCell>
                <TableCell>
                  <Decision row={r} />
                </TableCell>
                <TableCell>
                  {leader(r)}
                  <small className="block text-xs text-muted-foreground">
                    {t('you', {
                      at: r.ourPosition ?? (r.weNamed ? 'named' : 'none'),
                      cited: String(r.weCited),
                    })}
                  </small>
                </TableCell>
                <TableCell className="text-right tabular-nums" data-slot="ads-searches">
                  {r.volume === null ? (
                    <span className="text-muted-foreground">{t('notMeasured')}</span>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span
                            tabIndex={0}
                            className="underline decoration-muted-foreground/60 decoration-dotted underline-offset-4"
                          />
                        }
                      >
                        {formatCompactNumber(r.volume)}
                      </TooltipTrigger>
                      <TooltipContent>
                        {t(r.estAiVolume === null ? 'searchesTip' : 'searchesTipAi', {
                          google: formatNumber(r.volume),
                          ai: formatNumber(r.estAiVolume ?? 0),
                        })}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell>
                  {r.adChannels.length
                    ? r.adChannels.map((c) => t(`channels.${c}`)).join(', ')
                    : t('noChannel')}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    data-action="ads.openOpportunity"
                    onClick={() => setOpened(r.promptId)}
                  >
                    {t('open')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  {t('noneFiltered')}
                </TableCell>
              </TableRow>
            )}
            {page.locked > 0 && (
              <TableRow data-slot="ads-lock-row" className="hover:bg-transparent">
                <TableCell colSpan={6} className="p-3 whitespace-normal">
                  <UpgradeCard
                    feature="ads_read"
                    source="ads"
                    title={t('lock', { count: page.locked, plan: requiredPlanFor('ads_read') })}
                    description={tAds('locked.description')}
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
