'use client';

import { Fragment } from 'react';
import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { CATEGORY_META, pct } from '@/components/audit/audit-report';
import type { AuditOverview, AuditQuota, SiteCoverage } from '@/lib/actions/audits';
import { nextAutoRun } from '@/lib/audit-auto-runs';
import { formatMonthDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useRubricText } from '@/hooks/use-rubric-text';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days from `now` to `iso`, in the viewer's time zone. */
export function daysUntil(iso: string, now: Date): number {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((day(new Date(iso)) - day(now)) / DAY_MS);
}

/**
 * The summary strip on top of Site Audit (spec §4.4, Insights style): "68
 * site score +4 · 48 pages audited · Lowest: E-E-A-T 36 · Next auto-audit
 * tomorrow · 25 pages", the primary domain on the right.
 */
export function AuditSummaryStrip({
  overview,
  quota,
  now,
  coverage = null,
  loading = false,
}: {
  overview: AuditOverview | null;
  quota: AuditQuota | null;
  now: Date;
  /**
   * The site's coverage (customer priorities item 11): "18 of 36 pages
   * audited", every page with an audit (out of date ones too), as the site
   * score and the Authority card count them.
   */
  coverage?: SiteCoverage | null;
  /** The hub is still loading: a placeholder of the strip's height. */
  loading?: boolean;
}) {
  const t = useTranslations('audit.strip');
  const rubric = useRubricText();
  // While the hub loads, a strip of the same height holds its place, so the
  // page below doesn't move down when it fills in.
  if (loading) {
    return (
      <div
        aria-hidden
        data-testid="audit-summary-strip-skeleton"
        className="flex items-center gap-3.5 rounded-xl border bg-card px-4 py-3"
      >
        <div className="flex h-5 items-center">
          <Skeleton className="h-3.5 w-28" />
        </div>
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-3.5 w-36" />
      </div>
    );
  }
  if (!overview) return null;

  const b = (chunks: React.ReactNode) => <b className="font-semibold">{chunks}</b>;
  const items: React.ReactNode[] = [];
  const score = pct(overview.siteScore);
  if (score !== null) {
    const change = overview.siteScoreChange;
    items.push(
      <>
        {t.rich('siteScore', { b, score })}
        {change !== null && change !== 0 && (
          <span
            className={cn(
              'tabular-nums',
              change > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
            )}
          >
            {change > 0 ? `+${change}` : change}
          </span>
        )}
      </>,
    );
  }
  items.push(
    coverage && coverage.pages > 0
      ? t('pagesOf', { audited: coverage.audited + coverage.stale, count: coverage.pages })
      : overview.pages > 0
        ? t('pages', { count: overview.pages })
        : t('noPages'),
  );
  if (overview.lowestCategory) {
    const { key } = overview.lowestCategory;
    const label = rubric.category(key, CATEGORY_META.find((c) => c.key === key)?.label ?? key);
    items.push(
      t.rich('lowest', { b, category: label, score: pct(overview.lowestCategory.score) ?? 0 }),
    );
  }
  const auto = quota?.auto;
  if (auto?.enabled) {
    // This month's next run, else next month's first; within a day when its
    // turn has started without it (the next daily sweep takes it).
    const next = nextAutoRun(auto, now);
    const days = daysUntil(next.at, now);
    const when = next.soon
      ? t('withinADay')
      : days <= 0
        ? t('today')
        : days === 1
          ? t('tomorrow')
          : t('onDate', { date: formatMonthDay(next.at) });
    items.push(t.rich('nextAuto', { b, when, count: auto.perRun }));
  } else if (auto && !auto.enabled) {
    items.push(t('autoOff'));
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-xl border bg-card px-4 py-3 text-sm">
      {items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <span aria-hidden className="h-[3px] w-[3px] rounded-full bg-muted-foreground/50" />
          )}
          <span className="flex items-center gap-1.5 whitespace-nowrap">{item}</span>
        </Fragment>
      ))}
      {overview.primaryHost && (
        <span className="ms-auto text-xs text-muted-foreground">{overview.primaryHost}</span>
      )}
    </div>
  );
}
