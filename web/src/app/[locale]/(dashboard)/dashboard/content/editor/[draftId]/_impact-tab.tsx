'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ExternalLink, Loader2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { getContentImpact, getContentResults } from '@/lib/actions/content-drafts';
import {
  DEFAULT_IMPACT_PERIOD,
  GSC_PAGE_DAYS,
  IMPACT_PERIODS,
  gscCoverage,
  impactChange,
  isLost,
  platformNames,
  type ContentImpact,
  type ContentResults,
  type ImpactPeriod,
} from '@/lib/content/impact';
import { pagePath } from '@/lib/content/overlap';
import { formatNumber } from '@/lib/format';
import { formatPctChange } from '@/lib/traffic-kpis';
import type { VisitChange } from '@/lib/traffic-change';
import { cn } from '@/lib/utils';
import { ImpactResults } from './_impact-results';

/** One read of the tab, for one period: null while it runs. */
interface ImpactRead {
  period: ImpactPeriod;
  impact: ContentImpact | null;
  results: ContentResults | null;
  failed: boolean;
}

/**
 * The Impact tab (Content Editor CE-016, spec §7): what the page a draft
 * optimizes earns. Every number follows the period: citations, AI visits,
 * Google clicks and prompts cited, each against the period before; the
 * prompts themselves, always listed, the ones it lost marked; the results
 * from AI visits, per AI source; the brand's other pages cited for the same
 * prompts; and where the numbers come from.
 */
export function ImpactTab({
  brandId,
  pageUrl,
  rebuilding = false,
  onUseLostPrompts,
}: {
  brandId: string;
  pageUrl: string | null;
  /** Use lost prompts in this draft: they join its sources and the brief is rebuilt. */
  rebuilding?: boolean;
  onUseLostPrompts?: (promptIds: string[]) => void;
}) {
  const t = useTranslations('contentEditor.editor.impact');
  const [period, setPeriod] = useState<ImpactPeriod>(DEFAULT_IMPACT_PERIOD);
  const [read, setRead] = useState<ImpactRead | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!pageUrl) return;
    let cancelled = false;
    Promise.all([
      getContentImpact(brandId, pageUrl, period),
      getContentResults(brandId, pageUrl, period),
    ])
      .then(([impact, results]) => {
        if (!cancelled) setRead({ period, impact, results, failed: false });
      })
      .catch((err) => {
        console.error('Failed to read the page impact:', err);
        if (!cancelled) setRead({ period, impact: null, results: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, pageUrl, period, attempt]);

  // A new page has nothing to measure until it is live at an address.
  if (!pageUrl) {
    return <p className="text-sm text-muted-foreground">{t('newPage')}</p>;
  }

  const current = read?.period === period ? read : null;
  const impact = current?.impact ?? null;

  return (
    <div className="space-y-5 text-sm">
      <div className="flex items-center gap-2">
        <h3 className="font-medium">{t('thisPage')}</h3>
        <div
          role="group"
          aria-label={t('periodLabel')}
          className="ml-auto flex rounded-lg border p-0.5"
        >
          {IMPACT_PERIODS.map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={period === days}
              onClick={() => setPeriod(days)}
              className={cn(
                'rounded-md px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground',
                period === days && 'bg-muted font-medium text-foreground',
              )}
            >
              {t(`periods.${days}`)}
            </button>
          ))}
        </div>
      </div>

      {!current ? (
        <div className="flex justify-center py-8" aria-busy="true">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : current.failed || !impact ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          {t('loadError')}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => {
              setRead(null);
              setAttempt((n) => n + 1);
            }}
          >
            {t('retry')}
          </button>
        </p>
      ) : (
        <ImpactBody
          impact={impact}
          results={current.results}
          period={period}
          pageUrl={pageUrl}
          rebuilding={rebuilding}
          onUseLostPrompts={onUseLostPrompts}
        />
      )}
    </div>
  );
}

function ImpactBody({
  impact,
  results,
  period,
  pageUrl,
  rebuilding,
  onUseLostPrompts,
}: {
  impact: ContentImpact;
  results: ContentResults | null;
  period: ImpactPeriod;
  pageUrl: string;
  rebuilding: boolean;
  onUseLostPrompts?: (promptIds: string[]) => void;
}) {
  const t = useTranslations('contentEditor.editor.impact');
  const coverage = gscCoverage(impact.gscSince, period);
  const cited = impact.promptCounts;
  const lost = impact.promptCounts.lost;
  // The lost prompts listed, to use in the draft (the list is capped at 100).
  const lostPrompts = impact.prompts.filter(isLost);
  const promptDelta = cited.cur - cited.prev;

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Metric
          label={t('metrics.citations')}
          value={formatNumber(impact.citations.cur)}
          change={<ChangeText change={impactChange(impact.citations)} />}
        />
        <Metric
          label={t('metrics.aiVisits')}
          value={formatNumber(impact.aiVisits.cur)}
          change={<ChangeText change={impactChange(impact.aiVisits)} />}
        />
        <Metric
          label={t('metrics.gscClicks')}
          value={coverage === 'none' ? '—' : formatNumber(impact.gscClicks.cur)}
          change={
            coverage === 'none' ? (
              <span className="text-muted-foreground">{t('noSearchConsole')}</span>
            ) : (
              <ChangeText change={impactChange(impact.gscClicks, coverage === 'both')} />
            )
          }
        />
        <Metric
          label={t('metrics.promptsCited')}
          value={formatNumber(cited.cur)}
          change={
            promptDelta === 0 ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <span
                className={
                  promptDelta > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }
              >
                {promptDelta > 0 ? `+${promptDelta}` : `−${Math.abs(promptDelta)}`}
              </span>
            )
          }
        />
      </div>

      <section className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground">
          {t('prompts.title', { count: cited.cur })}
          {lost > 0 && (
            <span className="text-red-600 dark:text-red-400">
              {' · '}
              {t('prompts.lost', { count: lost })}
            </span>
          )}
        </h4>
        {impact.prompts.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('prompts.none')}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {impact.prompts.map((prompt) => {
              const gone = isLost(prompt);
              const platforms = platformNames(gone ? prompt.prevPlatforms : prompt.curPlatforms);
              return (
                <li key={prompt.id} className="flex items-start gap-2.5 px-3 py-2">
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      gone ? 'bg-red-500' : 'bg-emerald-500',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-xs font-medium" title={prompt.text}>
                      {prompt.text}
                    </p>
                    {platforms.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {gone
                          ? t('prompts.wasCitedOn', { platforms: platforms.join(', ') })
                          : platforms.join(', ')}
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      'shrink-0 text-xs font-medium',
                      gone
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-emerald-600 dark:text-emerald-400',
                    )}
                  >
                    {gone ? t('prompts.lostBadge') : t('prompts.cited', { count: prompt.cur })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href={`/dashboard/citations/url?u=${encodeURIComponent(pageUrl)}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {t('prompts.seeInCitations')}
            <ExternalLink className="h-3 w-3" />
          </Link>
          {lostPrompts.length > 0 && onUseLostPrompts && (
            <Button
              size="sm"
              variant="outline"
              disabled={rebuilding}
              onClick={() => onUseLostPrompts(lostPrompts.map((p) => p.id))}
            >
              {rebuilding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('prompts.useLost', { count: lostPrompts.length })}
            </Button>
          )}
        </div>
      </section>

      {results && <ImpactResults results={results} />}

      {cited.cur > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">{t('overlap.title')}</h4>
          {impact.overlap.length === 0 ? (
            <p className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs">
              <span>{t('overlap.only', { count: cited.cur })}</span>
              <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            </p>
          ) : (
            <ul className="space-y-1 rounded-lg border px-3 py-2 text-xs">
              {impact.overlap.map((other) => (
                <li key={other.page} className="flex items-center justify-between gap-2">
                  <span className="truncate" title={other.page}>
                    {pagePath(other.page)}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {t('overlap.shared', { count: other.prompts, total: cited.cur })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        {t('note', { days: period })}
        {(coverage === 'partial' || coverage === 'current') &&
          ` ${t('gscWindow', { days: GSC_PAGE_DAYS })}`}
      </p>
    </>
  );
}

function Metric({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs tabular-nums">{change}</p>
    </div>
  );
}

function ChangeText({ change }: { change: VisitChange }) {
  const t = useTranslations('contentEditor.editor.impact.change');
  switch (change.kind) {
    case 'pct':
      return (
        <span
          className={
            change.pct > 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400'
          }
        >
          {formatPctChange(change.pct)}
        </span>
      );
    case 'new':
      return <span className="text-emerald-600 dark:text-emerald-400">{t('new')}</span>;
    case 'low':
      return (
        <span className="text-muted-foreground" title={t('lowHint')}>
          {t('low')}
        </span>
      );
    default:
      return <span className="text-muted-foreground">—</span>;
  }
}
