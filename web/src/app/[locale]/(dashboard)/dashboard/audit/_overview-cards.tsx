'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarDays, FileText, Gauge, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { pct } from '@/components/audit/audit-report';
import type { AuditOverview, AuditQuota } from '@/lib/actions/audits';
import { formatNumber } from '@/lib/format';
import { MetricCard } from '../insights/_kpi-cards';
import { upIsGood } from '../insights/kpi-format';
import { autoSharePct, quotaShares, QuotaSegments, RunDots } from './_quota-meter';

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

/**
 * "How it works" under the cards (spec §4.4), closed until asked for: the
 * plan's audits, the auto-audit share and the user's, and where to turn it
 * off. Settings opens the Site Audit settings.
 */
function HowItWorks({ quota, onOpenSettings }: { quota: AuditQuota; onOpenSettings?: () => void }) {
  const t = useTranslations('audit.quota');
  const auto = quota.auto;
  const limit = formatNumber(quota.limit);
  const share = auto ? autoSharePct(auto, quota.limit) : 0;
  const rich = {
    b: (chunks: React.ReactNode) => <b className="font-semibold text-foreground">{chunks}</b>,
    settings: (chunks: React.ReactNode) =>
      onOpenSettings ? (
        <button type="button" className="underline underline-offset-2" onClick={onOpenSettings}>
          {chunks}
        </button>
      ) : (
        chunks
      ),
  };
  const points = auto?.enabled
    ? [
        t.rich('how1', { ...rich, limit }),
        t.rich('how2', { ...rich, share, runShare: Math.round(share / 5) }),
        t.rich('how3', { ...rich, rest: 100 - share }),
        t.rich('how4', { ...rich, limit }),
      ]
    : [
        t.rich('how1', { ...rich, limit }),
        t.rich('howOff2', { ...rich, limit }),
        t.rich('howOff3', rich),
      ];
  return (
    <div id="audit-how-it-works" className="rounded-xl border px-4 py-3">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        {points.map((point, i) => (
          <li key={i}>{point}</li>
        ))}
      </ol>
    </div>
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
  onOpenSettings,
}: {
  overview: AuditOverview | null;
  quota: AuditQuota | null;
  /** Opens the Site Audit settings, from How it works. */
  onOpenSettings?: () => void;
}) {
  const t = useTranslations('audit.overview');
  const tq = useTranslations('audit.quota');
  const [howOpen, setHowOpen] = useState(false);

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
  const shares = quota ? quotaShares(quota) : null;
  const auto = quota?.auto;
  const gapsSub =
    overview.pages === 0 ? t('noPages') : overview.gaps.length > 0 ? t('gapsSub') : t('noGaps');

  // The quota card (SA-019): the bar, the five runs, and How it works.
  const howToggle = (
    <button
      type="button"
      className="underline underline-offset-2"
      aria-expanded={howOpen}
      aria-controls="audit-how-it-works"
      onClick={() => setHowOpen((open) => !open)}
    >
      {tq('howItWorks')}
    </button>
  );
  const quotaFooter = !quota ? null : shares ? (
    <div className="space-y-2 pb-0.5">
      <QuotaSegments quota={quota} />
      {auto?.enabled && <RunDots auto={auto} />}
      <div className="truncate text-xs text-muted-foreground">
        {auto?.enabled
          ? tq('autoShare', { share: autoSharePct(auto, quota.limit) })
          : tq('autoOff')}
        {' · '}
        {howToggle}
      </div>
    </div>
  ) : auto?.enabled ? (
    <div className="space-y-2 pb-0.5">
      <RunDots auto={auto} />
      <div className="truncate text-xs text-muted-foreground">
        {tq('autoPerRun', { perRun: auto.perRun })}
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-2.5">
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
          value={shares ? formatNumber(shares.left) : t('unlimited')}
          delta={
            shares && quota
              ? { text: t('ofLeft', { limit: formatNumber(quota.limit) }), tone: 'neutral' }
              : null
          }
          sub={quota && !shares ? t('unlimitedSub') : undefined}
          footer={quotaFooter}
        />
      </div>
      {howOpen && quota && shares && <HowItWorks quota={quota} onOpenSettings={onOpenSettings} />}
    </div>
  );
}
