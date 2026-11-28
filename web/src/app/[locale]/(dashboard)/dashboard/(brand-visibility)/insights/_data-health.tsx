'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ReadError } from '@/components/brand-visibility/read-error';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { platformLabel } from '@/config/platform-labels';
import { dataHealthArgs, type DataHealth, type DataHealthFilters } from '@/lib/data-health';
import { numberFormat } from '@/lib/number-format';
import { cn } from '@/lib/utils';
import { getDataHealth } from '@/lib/visibility-reads';

/** "Nov 10", read as the UTC day it is. */
function dayLabel(day: string, locale: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** "Nov 28, 09:14", in the reader's own time zone. */
function timeLabel(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Data health (00567), under "By AI platform": per platform, the answers
 * the tracked prompts should have brought in over the page's window, region
 * and topic, how many came in, how many are missing and the last answer.
 * It shows buyers the data is complete, and says a day with no answer is a
 * day not tracked, never a day the brand wasn't named. Its own read, so a
 * failed one shows Retry here and never hides the page.
 */
export function DataHealthCard({
  brandId,
  filters,
  className,
  read = getDataHealth,
}: {
  brandId: string;
  filters: DataHealthFilters;
  className?: string;
  /** The read; tests pass their own. */
  read?: typeof getDataHealth;
}) {
  const t = useTranslations('insights.dataHealth');
  const locale = useLocale();
  const f = numberFormat(locale);
  // What came back, for the read it answers: a new window or a Retry is a
  // new read, so the card shows loading until its own answer is in.
  const [result, setResult] = useState<{
    key: string;
    data: DataHealth | null;
    failed: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { datePreset, dateFrom, dateTo, region, topic } = filters;
  const args = useMemo(
    () => dataHealthArgs({ datePreset, dateFrom, dateTo, region, topic }),
    [datePreset, dateFrom, dateTo, region, topic],
  );
  const key = `${brandId}|${JSON.stringify(args)}|${attempt}`;

  useEffect(() => {
    let live = true;
    read(brandId, args).then(
      (data) => live && setResult({ key, data, failed: false }),
      () => live && setResult({ key, data: null, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [brandId, args, read, key]);

  const current = result?.key === key ? result : null;
  const data = current?.data ?? null;

  if (current?.failed) {
    return (
      <ReadError
        compact
        className={className}
        title={t('loadFailed')}
        onRetry={() => setAttempt((n) => n + 1)}
      />
    );
  }

  const range =
    datePreset === 'custom' && dateFrom && dateTo
      ? t('range.custom', { from: dayLabel(dateFrom, locale), to: dayLabel(dateTo, locale) })
      : t(`range.${datePreset === 'custom' ? 'all' : datePreset}`);

  return (
    <Card className={className} data-testid="data-health-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('title')}</CardTitle>
        {data && data.percent !== null && (
          <p className="text-xs text-muted-foreground">
            {t('summary', { range, percent: f.percent(data.percent) })}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!data ? (
          <div className="space-y-2" aria-busy="true" aria-label={t('loading')}>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm" aria-label={t('tableLabel')}>
              <thead>
                <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pe-3 text-start font-medium">{t('platform')}</th>
                  <th className="w-24 px-2 py-2 text-end font-medium">{t('expected')}</th>
                  <th className="w-24 px-2 py-2 text-end font-medium">{t('received')}</th>
                  <th className="w-20 px-2 py-2 text-end font-medium">{t('missing')}</th>
                  <th className="w-36 py-2 ps-2 text-end font-medium">{t('lastAnswer')}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.platform} className="border-b last:border-b-0">
                    <td className="py-2.5 pe-3 font-medium">{platformLabel(row.platform)}</td>
                    <td className="px-2 py-2.5 text-end tabular-nums">{f.number(row.expected)}</td>
                    <td className="px-2 py-2.5 text-end tabular-nums">
                      {f.number(row.received)}
                      {row.percent !== null && (
                        <span className="ms-1 text-[11px] text-muted-foreground">
                          ({f.percent(row.percent)})
                        </span>
                      )}
                    </td>
                    <td
                      className={cn(
                        'px-2 py-2.5 text-end font-medium tabular-nums',
                        row.missing > 0
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-muted-foreground',
                      )}
                    >
                      {f.number(row.missing)}
                    </td>
                    <td className="py-2.5 ps-2 text-end text-xs text-muted-foreground tabular-nums">
                      {row.lastAnswerAt ? timeLabel(row.lastAnswerAt, locale) : t('none')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="space-y-1 rounded-lg border border-dashed px-2.5 py-2 text-xs text-muted-foreground">
          <p>{t('footnote')}</p>
          <p>{t('pausedNote')}</p>
        </div>
      </CardContent>
    </Card>
  );
}
