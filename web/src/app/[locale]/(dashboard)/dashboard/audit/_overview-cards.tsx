'use client';

import { useTranslations } from 'next-intl';
import { CalendarDays, FileText, Gauge, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { pct } from '@/components/audit/audit-report';
import type { AuditOverview, AuditQuota } from '@/lib/actions/audits';
import { formatNumber } from '@/lib/format';
import { MetricCard } from '../insights/_kpi-cards';
import { upIsGood } from '../insights/kpi-format';

/** The Authority · E-E-A-T card's gaps: the signal, and on how many pages it fails. */
function GapList({ overview }: { overview: AuditOverview }) {
  const t = useTranslations('audit.overview');
  if (overview.gaps.length === 0) return <div className="h-6" aria-hidden />;
  return (
    <ul className="space-y-0.5 pb-0.5 text-xs">
      {overview.gaps.map((gap) => (
        <li key={gap.key} className="flex items-baseline justify-between gap-2">
          <span className="truncate">{gap.label}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {t('gapPages', { pages: gap.pages, total: overview.pages })}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Four in a row from 1,200px, two below, one on a phone (spec §4.5). In rem,
// so Tailwind orders it after sm: (a px breakpoint would sort before it).
const GRID = 'grid grid-cols-1 gap-3 sm:grid-cols-2 min-[75rem]:grid-cols-4';

/**
 * The Site Audit hub's KPI cards (SA-018), as in the v2 mockup: site score,
 * pages audited, Authority · E-E-A-T with its biggest gaps, and this month's
 * audits. The numbers cover the latest audit of each page on the primary
 * domain.
 */
export function AuditOverviewCards({
  overview,
  quota,
}: {
  overview: AuditOverview | null;
  quota: AuditQuota | null;
}) {
  const t = useTranslations('audit.overview');

  if (!overview) {
    return (
      <div className={GRID}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="gap-3 rounded-xl px-4 py-3.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-32" />
          </Card>
        ))}
      </div>
    );
  }

  const domain = overview.primaryHost ?? t('yourDomain');
  const limited = quota !== null && quota.limit !== -1;
  const running = quota?.running ?? 0;
  const gapsSub =
    overview.pages === 0 ? t('noPages') : overview.gaps.length > 0 ? t('gapsSub') : t('noGaps');

  return (
    <div className={GRID}>
      <MetricCard
        label={t('siteScore')}
        tooltip={t('siteScoreTip', { domain })}
        icon={Gauge}
        value={pct(overview.siteScore)?.toString() ?? '—'}
        delta={upIsGood(overview.siteScoreChange)}
        sub={t('siteScoreSub')}
      />
      <MetricCard
        label={t('pagesAudited')}
        tooltip={t('pagesAuditedTip', { domain })}
        icon={FileText}
        value={formatNumber(overview.pages)}
        sub={
          overview.otherPages > 0
            ? t('pagesSubOther', { count: overview.otherPages })
            : t('pagesSub', { domain })
        }
      />
      <MetricCard
        label={t('authority')}
        tooltip={t('authorityTip')}
        icon={ShieldCheck}
        value={`${pct(overview.authority) ?? '—'} · ${pct(overview.eeat) ?? '—'}`}
        sub={gapsSub}
        footer={<GapList overview={overview} />}
      />
      <MetricCard
        label={t('auditsThisMonth')}
        tooltip={t('auditsTip')}
        icon={CalendarDays}
        value={limited ? formatNumber(quota.remaining) : t('unlimited')}
        delta={
          limited
            ? { text: t('ofLeft', { limit: formatNumber(quota.limit) }), tone: 'neutral' }
            : null
        }
        sub={
          !quota
            ? ''
            : !limited
              ? t('unlimitedSub')
              : running > 0
                ? t('usedRunning', { used: quota.used, running })
                : t('used', { used: quota.used })
        }
        quota={
          limited
            ? {
                used: quota.used + running,
                limit: quota.limit,
                label: t('quotaBar', { used: quota.used + running, limit: quota.limit }),
              }
            : null
        }
      />
    </div>
  );
}
