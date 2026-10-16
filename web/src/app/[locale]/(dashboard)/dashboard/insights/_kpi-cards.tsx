'use client';

import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import {
  ArrowUpRight,
  Eye,
  HelpCircle,
  Layers,
  Link2,
  ListOrdered,
  MessageCircle,
  PieChart,
  Quote,
  Smile,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatCompactNumber } from '@/lib/format';
import type {
  CompetitorComparisonData,
  CoverageKpi,
  InsightsSummary,
  ShareOfVoiceData,
  TrackedPromptsKpi,
  VisibilityRateTrendData,
} from '@/lib/actions/tracking';
import type { PromptComparison } from '@/lib/insights-same-prompts';
import type { KpiSeriesDay } from '@/lib/insights-kpis';
import {
  lowerIsGood,
  signedChange,
  signedValue,
  TONE_TEXT,
  upIsGood,
  type Change,
} from './kpi-format';

// ─── Info tooltip ─────────────────────────────────────────────────────────────

export function InfoTip({ content }: { content: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.bottom + 6 });
  }

  function hide() {
    setPos(null);
  }

  return (
    <>
      <span
        ref={ref}
        tabIndex={0}
        aria-label="More information"
        aria-describedby={pos ? tooltipId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => {
          if (e.key === 'Escape') hide();
        }}
        className="inline-flex items-center cursor-help rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HelpCircle className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground transition-colors" />
      </span>
      {pos &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            style={{ left: pos.x, top: pos.y, transform: 'translateX(-50%)' }}
            className="pointer-events-none fixed z-[9999] w-56 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

// ─── Card parts ───────────────────────────────────────────────────────────────

/**
 * A daily sparkline. Days without a value are skipped; fewer than two
 * points draw nothing. Grey normally, red when the card's change is bad.
 */
function Sparkline({ values, bad }: { values: (number | null)[]; bad: boolean }) {
  const points = values
    .map((v, i) => (v === null ? null : { i, v }))
    .filter((p): p is { i: number; v: number } => p !== null);
  if (points.length < 2) return <div className="h-6" aria-hidden />;
  const min = Math.min(...points.map((p) => p.v));
  const max = Math.max(...points.map((p) => p.v));
  const last = values.length - 1 || 1;
  const coords = points
    .map(({ i, v }) => {
      const x = (i / last) * 100;
      const y = max === min ? 12 : 22 - ((v - min) / (max - min)) * 20;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className={cn(
        'h-6 w-full',
        bad ? 'text-red-500 dark:text-red-400' : 'text-muted-foreground/50',
      )}
      aria-hidden
    >
      <polyline
        points={coords}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** The plan's prompt locations as a fill bar: amber from 80%, red when full. */
function QuotaBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div
      role="img"
      aria-label={label}
      className="my-[9px] h-1.5 overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn(
          'h-full rounded-full',
          used >= limit ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-foreground/60',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

interface MetricCardProps {
  label: string;
  tooltip: string;
  icon: LucideIcon;
  value: string;
  delta?: Change | null;
  sub?: React.ReactNode;
  spark?: (number | null)[] | null;
  quota?: { used: number; limit: number; label: string } | null;
  onClick?: () => void;
  clickLabel?: string;
}

/** One KPI card, as in the v2 mockup: label, value with its change, a line of context, a sparkline. */
function MetricCard({
  label,
  tooltip,
  icon: Icon,
  value,
  delta,
  sub,
  spark,
  quota,
  onClick,
  clickLabel,
}: MetricCardProps) {
  const clickable = typeof onClick === 'function';
  return (
    <Card
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? clickLabel : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={cn(
        'group flex min-w-0 flex-col gap-1.5 rounded-xl px-4 pt-3.5 pb-2.5',
        clickable &&
          'cursor-pointer transition-colors hover:border-foreground/30 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <span className="truncate">{label}</span>
        <InfoTip content={tooltip} />
        <span className="flex-1" />
        <span className="relative flex h-4 w-4 items-center justify-center">
          <Icon
            className={cn(
              'h-3.5 w-3.5 text-muted-foreground transition-opacity',
              clickable && 'group-hover:opacity-0',
            )}
          />
          {clickable && (
            <ArrowUpRight
              className="absolute h-4 w-4 text-foreground opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden
            />
          )}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[28px] font-semibold leading-tight tracking-tight tabular-nums">
          {value}
        </span>
        {delta && (
          <span className={cn('text-xs font-medium tabular-nums', TONE_TEXT[delta.tone])}>
            {delta.text}
          </span>
        )}
      </div>
      <div className="truncate text-xs text-muted-foreground">{sub}</div>
      {quota ? (
        <QuotaBar used={quota.used} limit={quota.limit} label={quota.label} />
      ) : (
        <Sparkline values={spark ?? []} bad={delta?.tone === 'bad'} />
      )}
    </Card>
  );
}

const pct = (n: number | null) => (n === null ? null : `${n}%`);

// ─── The two rows ─────────────────────────────────────────────────────────────

interface KpiRowsProps {
  summary: InsightsSummary;
  trend: VisibilityRateTrendData | null;
  trackedPrompts: TrackedPromptsKpi | null;
  coverage: CoverageKpi | null;
  sov: ShareOfVoiceData | null;
  competitors: CompetitorComparisonData | null;
  comparison: PromptComparison | null;
  series: KpiSeriesDay[] | null;
  onBreakdown: (metric: 'visibility' | 'mentions') => void;
  onNavigate: (path: string) => void;
}

/**
 * The Insights KPI cards (VIS-003): today's five on the first row, the new
 * rates on the second, as in the v2 mockup. Changes follow "Compare: Same
 * prompts"; the values themselves cover every prompt in the window.
 */
export function KpiRows({
  summary,
  trend,
  trackedPrompts,
  coverage,
  sov,
  competitors,
  comparison,
  series,
  onBreakdown,
  onNavigate,
}: KpiRowsProps) {
  const t = useTranslations('insights.kpi');
  const none = t('noData');

  const own = competitors?.brands.findIndex((b) => b.isOwnBrand) ?? -1;
  const visibilitySub =
    competitors && own >= 0
      ? t('rankOf', { rank: own + 1, count: competitors.brands.length })
      : coverage
        ? t('appearedIn', { visible: coverage.visiblePrompts, active: coverage.activePrompts })
        : null;
  const basisSub =
    comparison?.basis === 'same'
      ? t('samePrompts', { count: comparison.samePrompts })
      : t('allPrompts');

  const quota =
    trackedPrompts && trackedPrompts.quotaLimit !== -1
      ? { used: trackedPrompts.quotaUsed, limit: trackedPrompts.quotaLimit }
      : null;
  const trackedSub = !trackedPrompts
    ? null
    : !quota
      ? t('unlimited', { count: trackedPrompts.quotaUsed })
      : quota.used > quota.limit
        ? t('overLimit', { count: quota.used - quota.limit })
        : t('slotsLeft', { count: quota.limit - quota.used });

  const daily = <K extends keyof KpiSeriesDay>(key: K) =>
    series ? series.map((d) => d[key] as number | null) : null;

  return (
    <section aria-label={t('sectionLabel')} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label={t('visibility')}
          tooltip={t('visibilityTip')}
          icon={Eye}
          value={String(trend?.summary.rate ?? 0)}
          delta={upIsGood(trend?.summary.change ?? null)}
          sub={visibilitySub}
          spark={trend ? trend.points.map((p) => p.values.you ?? null) : null}
          onClick={() => onBreakdown('visibility')}
          clickLabel={t('viewBreakdown', { metric: t('visibility') })}
        />
        <MetricCard
          label={t('trackedPrompts')}
          tooltip={
            quota
              ? t('trackedPromptsTip', {
                  used: quota.used.toLocaleString('en-US'),
                  limit: quota.limit.toLocaleString('en-US'),
                })
              : t('trackedPromptsTipUnlimited')
          }
          icon={Layers}
          value={(trackedPrompts?.activeInPeriod ?? 0).toLocaleString('en-US')}
          delta={
            comparison && comparison.newPrompts > 0
              ? { text: signedChange(comparison.newPrompts), tone: 'neutral' }
              : null
          }
          sub={trackedSub}
          quota={
            quota
              ? {
                  ...quota,
                  label: t('quotaLabel', {
                    used: quota.used.toLocaleString('en-US'),
                    limit: quota.limit.toLocaleString('en-US'),
                  }),
                }
              : null
          }
          onClick={() => onNavigate('/dashboard/prompts')}
          clickLabel={t('openPrompts')}
        />
        <MetricCard
          label={t('mentions')}
          tooltip={t('mentionsTip')}
          icon={MessageCircle}
          value={formatCompactNumber(summary.totalMentions)}
          delta={upIsGood(summary.mentionsChange, '%')}
          sub={basisSub}
          spark={daily('mentions')}
          onClick={() => onBreakdown('mentions')}
          clickLabel={t('viewBreakdown', { metric: t('mentions') })}
        />
        <MetricCard
          label={t('citations')}
          tooltip={t('citationsTip')}
          icon={Quote}
          value={formatCompactNumber(summary.totalCitations)}
          delta={upIsGood(summary.citationsChange, '%')}
          sub={basisSub}
          spark={daily('citations')}
          onClick={() => onNavigate('/dashboard/citations')}
          clickLabel={t('openCitations')}
        />
        <MetricCard
          label={t('netSentiment')}
          tooltip={t('netSentimentTip')}
          icon={Smile}
          value={summary.netSentiment === null ? none : signedValue(summary.netSentiment)}
          delta={upIsGood(summary.netSentimentChange)}
          sub={
            summary.netSentiment === null
              ? null
              : t('sentimentSplit', {
                  positive: summary.positiveSentimentPct,
                  negative: summary.negativeSentimentPct ?? 0,
                })
          }
          spark={daily('netSentiment')}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label={t('coverage')}
          tooltip={t('coverageTip')}
          icon={Target}
          value={pct(coverage?.value ?? null) ?? none}
          delta={upIsGood(coverage?.change ?? null)}
          sub={
            coverage
              ? t('coverageSub', {
                  visible: coverage.visiblePrompts,
                  active: coverage.activePrompts,
                })
              : null
          }
          spark={daily('coverage')}
        />
        <MetricCard
          label={t('shareOfVoice')}
          tooltip={t('shareOfVoiceTip')}
          icon={PieChart}
          value={pct(sov ? sov.overallSov : null) ?? none}
          delta={upIsGood(sov?.overallSovChange ?? null)}
          sub={t('shareOfVoiceSub')}
          spark={daily('shareOfVoice')}
        />
        <MetricCard
          label={t('avgPosition')}
          tooltip={t('avgPositionTip')}
          icon={ListOrdered}
          value={summary.avgPosition === null ? none : `#${summary.avgPosition}`}
          delta={lowerIsGood(summary.avgPositionChange)}
          sub={t('avgPositionSub')}
          spark={daily('avgPosition')}
        />
        <MetricCard
          label={t('citationRate')}
          tooltip={t('citationRateTip')}
          icon={Link2}
          value={pct(summary.citationRate) ?? none}
          delta={upIsGood(summary.citationRateChange)}
          sub={t('citationRateSub')}
          spark={daily('citationRate')}
        />
      </div>
    </section>
  );
}
