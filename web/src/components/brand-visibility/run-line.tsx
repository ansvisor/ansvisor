'use client';

import { Fragment, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelative } from '@/lib/format-relative';
import { timeUntil } from '@/lib/tracking-schedule';
import { numberFormat } from '@/lib/number-format';

/**
 * The header's "Acme Coffee · Last run 11h ago · next run in 13h" (VIS-012).
 * Its own component with its own minute tick, so keeping "11h ago" current
 * re-renders this line, not the whole page. The brand shows at once; the
 * run's times are read on their own, so they never hold the tabs, and a
 * placeholder stands in for them until then.
 */
export function RunLine({
  brandName,
  lastRunAt,
  nextRunAt,
  hasData,
  loading = false,
}: {
  brandName: string;
  /** The brand's last full run; null when it has none. */
  lastRunAt: string | null;
  /** When the next scheduled run is due; null when not known. */
  nextRunAt: string | null;
  /** Whether the brand has any answers, for a last run the ledger doesn't know. */
  hasData: boolean;
  /** The run's times aren't read yet. */
  loading?: boolean;
}) {
  const t = useTranslations('insights.header');
  const tCommon = useTranslations('common');
  const f = numberFormat(useLocale());
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const nextIn = nextRunAt ? timeUntil(nextRunAt) : null;
  const parts = [
    // Answers without a known run (older than the ledger, outside the range):
    // say nothing rather than "No runs yet".
    lastRunAt
      ? t('lastRun', { when: formatRelative(lastRunAt, tCommon) })
      : hasData
        ? null
        : t('noRuns'),
    nextIn ? t('nextRun', { when: t(nextIn.unit, { n: f.number(nextIn.value) }) }) : null,
  ].filter((part): part is string => part !== null);

  if (loading) {
    return (
      // A div, not a p: the skeleton is a div, and a p can't hold one.
      <div className="text-muted-foreground flex items-center gap-2 text-sm" aria-busy>
        {brandName}
        <Skeleton className="h-3.5 w-48" data-testid="run-line-loading" />
      </div>
    );
  }

  return (
    <p className="text-muted-foreground text-sm">
      {brandName}
      {/* Wraps between the parts, never inside one ("next / run in 13h"). */}
      {parts.map((part) => (
        <Fragment key={part}>
          {' · '}
          <span className="whitespace-nowrap">{part}</span>
        </Fragment>
      ))}
    </p>
  );
}
