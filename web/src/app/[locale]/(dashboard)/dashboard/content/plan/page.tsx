'use client';

import { useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { NewContentDialog, type DialogPreset } from '@/components/content/new-content-dialog';
import { getContentPlan, getContentPlanInsights } from '@/lib/actions/content-plan';
import type { PageType } from '@/lib/content/drafts';
import { pageTypeMix } from '@/lib/content/plan-mix';
import { siteTypeOf } from '@/lib/content/page-types';
import {
  PLAN_CARDS,
  PLAN_PERIODS,
  buildPlan,
  earlierPeriod,
  rowsFor,
  type PlanCard,
  type PlanPeriod,
  type PlanRow,
} from '@/lib/content/plan';
import { formatNumber } from '@/lib/format';
import { readUrlChoice, writeUrlParams } from '@/lib/url-state';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/stores/use-brand-store';
import { AiResultsStrip, PageTypeMix } from './_plan-insights';
import { PlanTable } from './_plan-table';

type PlanRead = {
  brandId: string;
  days: PlanPeriod;
  data: Awaited<ReturnType<typeof getContentPlan>>;
  failed: boolean;
};

/** The page-type mix and results strip, read on their own: either can fail alone. */
type InsightsRead = {
  brandId: string;
  days: PlanPeriod;
  data: Awaited<ReturnType<typeof getContentPlanInsights>>;
};

/** Each card's color, as its action's tag: Create blue, Optimize amber, Protect green. */
const CARD_DOT: Record<PlanCard, string> = {
  create: 'bg-blue-600 dark:bg-blue-400',
  optimize: 'bg-amber-600 dark:bg-amber-400',
  protect: 'bg-green-600 dark:bg-green-400',
};

/**
 * The Content plan (Content Editor CE-014, spec v2 §4): what to create,
 * optimize or protect next, for the last 7, 30 or 90 days. Three cards count
 * the work and filter the list, as a row of the page-type mix does; the list
 * ranks it, and each row starts it in New content (Start for an opportunity,
 * an existing page read to optimize) or opens the draft already being
 * written. The period lives in the URL (?days=7).
 */
export default function ContentPlanPage() {
  const t = useTranslations('contentEditor.plan');
  const format = useFormatter();
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const activeBrand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId));
  const siteType = siteTypeOf(activeBrand ?? {});
  // Null until the URL is read, so ?days=7 reads 7 days once, not 30 first.
  const [days, setDays] = useState<PlanPeriod | null>(null);
  const [card, setCard] = useState<PlanCard | null>(null);
  const [mixType, setMixType] = useState<PageType | null>(null);
  const [insights, setInsights] = useState<InsightsRead | null>(null);
  const [read, setRead] = useState<PlanRead | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  const [preset, setPreset] = useState<DialogPreset | null>(null);
  // Another brand starts unfiltered: its cards and types are its own.
  const [filtersFor, setFiltersFor] = useState(activeBrandId);
  if (filtersFor !== activeBrandId) {
    setFiltersFor(activeBrandId);
    setCard(null);
    setMixType(null);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of the URL after mount
    setDays(Number(readUrlChoice('days', ['7', '30', '90'], '30')) as PlanPeriod);
  }, []);

  useEffect(() => {
    if (!activeBrandId || days === null) return;
    let cancelled = false;
    getContentPlan(activeBrandId, days)
      .then((data) => {
        // Null: the brand isn't the member's to read.
        if (!cancelled) setRead({ brandId: activeBrandId, days, data, failed: data === null });
      })
      .catch((err) => {
        console.error('Failed to load the content plan:', err);
        if (!cancelled) setRead({ brandId: activeBrandId, days, data: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, days, attempt]);

  // Read again with the brand or the period only: a draft sent changes nothing in them.
  useEffect(() => {
    if (!activeBrandId || days === null) return;
    let cancelled = false;
    getContentPlanInsights(activeBrandId, days)
      .then((data) => {
        if (!cancelled) setInsights({ brandId: activeBrandId, days, data });
      })
      .catch((err) => {
        // The list still works without them; the sections stay hidden.
        console.error('Failed to load what AI cites for the content plan:', err);
        if (!cancelled) setInsights({ brandId: activeBrandId, days, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, days]);

  // A read for another brand or period (just switched) counts as still loading.
  const current = read?.brandId === activeBrandId && read.days === days ? read : null;
  const plan = useMemo(
    () => (current?.data ? buildPlan({ ...current.data, siteType }) : null),
    [current, siteType],
  );
  const insightsRead = insights?.brandId === activeBrandId && insights.days === days;
  const shown = insightsRead ? insights.data : null;
  // One spinner until both reads are in, so the page opens in its final
  // layout rather than the list first and the sections above it after. A
  // list that failed says so at once.
  const loading = !current?.failed && !(current && insightsRead);
  const mix = useMemo(
    () => (shown ? pageTypeMix(shown.citations, siteType, shown.totalCitations) : null),
    [shown, siteType],
  );
  // A type picked in another period's mix filters only while this one lists it.
  const typeFilter = mix?.rows.some((r) => r.pageType === mixType) ? mixType : null;
  const earlier = current?.data ? earlierPeriod(current.data.answers, current.data.tracking) : null;

  const changeDays = (next: PlanPeriod) => {
    setDays(next);
    writeUrlParams({ days: String(next) }, { days: '30' });
  };

  const startRow = (row: PlanRow) => {
    setPreset(
      row.opportunityId
        ? {
            kind: 'opportunity',
            id: row.opportunityId,
            // An opportunity for an existing page starts on that page.
            page: row.page ? { url: row.page, title: row.title } : null,
          }
        : { kind: 'page', url: row.page! },
    );
    setStarting(true);
  };

  if (!activeBrandId) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-muted-foreground">{t('selectBrand')}</p>
      </div>
    );
  }

  const rows = plan ? rowsFor(plan.rows, card, typeFilter) : [];
  const filtered = card !== null || typeFilter !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label={t('period')}
            className="inline-flex rounded-lg border bg-muted/40 p-0.5"
          >
            {PLAN_PERIODS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={days === value}
                onClick={() => changeDays(value)}
                className={cn(
                  'rounded-md px-3 py-1 text-sm transition-colors',
                  days === value
                    ? 'bg-background font-medium shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t('periods', { days: value })}
              </button>
            ))}
          </div>
          <Button
            className="gap-2"
            onClick={() => {
              setPreset(null);
              setStarting(true);
            }}
          >
            <Plus className="h-4 w-4" />
            {t('newContent')}
          </Button>
        </div>
      </div>
      <NewContentDialog
        open={starting}
        onOpenChange={(open) => {
          setStarting(open);
          if (!open) setPreset(null);
        }}
        brandId={activeBrandId}
        siteType={siteType}
        preset={preset}
        onSent={() => setAttempt((n) => n + 1)}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PLAN_CARDS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={card === value}
            disabled={!plan}
            onClick={() => setCard((c) => (c === value ? null : value))}
            className={cn(
              'rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-card',
              card === value && 'border-foreground ring-1 ring-inset ring-foreground',
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <span aria-hidden className={cn('h-2 w-2 rounded-full', CARD_DOT[value])} />
              {t(`cards.${value}.title`)}
            </span>
            <span className="mt-2 block text-2xl font-semibold tabular-nums">
              {plan ? formatNumber(plan.counts[value]) : '—'}
            </span>
            <span className="block text-xs text-muted-foreground">{t(`cards.${value}.hint`)}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16" aria-busy="true">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {shown && current && <AiResultsStrip results={shown.results} days={current.days} />}
          {mix && (
            <PageTypeMix
              rows={mix.rows}
              covered={mix.covered}
              selected={typeFilter}
              onSelect={setMixType}
            />
          )}

          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium">{t('listTitle')}</h2>
              <p className="text-xs text-muted-foreground">
                {filtered ? t('filtered') : t('ranked')}
              </p>
            </div>
            {current?.data && earlier !== 'full' && earlier !== null && (
              <p className="text-xs text-muted-foreground">
                {t(earlier === 'none' ? 'earlier.none' : 'earlier.partial', {
                  days: current.days,
                  since: current.data.tracking.trackedSince
                    ? format.dateTime(new Date(`${current.data.tracking.trackedSince}T00:00:00Z`), {
                        month: 'short',
                        day: 'numeric',
                        timeZone: 'UTC',
                      })
                    : '—',
                })}
              </p>
            )}
            <Card className="py-0">
              <CardContent className="px-0">
                {current?.failed ? (
                  <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                    <p className="text-sm text-muted-foreground">{t('loadError')}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRead(null);
                        setAttempt((n) => n + 1);
                      }}
                    >
                      {t('retry')}
                    </Button>
                  </div>
                ) : !plan ? (
                  <div className="flex items-center justify-center py-12" aria-busy="true">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : rows.length === 0 ? (
                  <p className="px-6 py-12 text-center text-sm text-muted-foreground">
                    {filtered ? t('emptyFiltered') : t('empty')}
                  </p>
                ) : (
                  <PlanTable rows={rows} days={current?.days ?? 30} onStart={startRow} />
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
