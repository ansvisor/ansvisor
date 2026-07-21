'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useBrandStore } from '@/stores/use-brand-store';
import { useUserRole } from '@/hooks/use-user-role';
import { getTopicsOverview, type TopicOverviewRow } from '@/lib/actions/topic';
import { TopicSuggestionsCard } from './_suggestions-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  ArrowRight,
  Download,
  Flame,
  Layers,
  Minus,
  Settings2,
  Tag,
  TrendingDown,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toCsv } from '@/lib/csv';

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function visibilityBarColor(score: number) {
  if (score >= 75) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  if (score >= 25) return 'bg-orange-500';
  return 'bg-rose-500';
}

function visibilityTextColor(score: number) {
  if (score >= 75) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 50) return 'text-amber-600 dark:text-amber-400';
  if (score >= 25) return 'text-orange-600 dark:text-orange-400';
  return 'text-rose-600 dark:text-rose-400';
}

const TOPIC_EXPORT_HEADERS = [
  'topic',
  'prompt_count',
  'avg_visibility_score',
  'visibility_change',
  'total_mentions',
  'total_citations',
  'share_of_voice',
  'top_competitor',
  'top_competitor_sov',
  'last_run_at',
];

const TOPIC_EXPORT_HINT = 'No topics yet - add topics or run a tracking job first.';

// ─── Sparkline ───────────────────────────────────────────────────────────

function Sparkline({ points }: { points: number[] }) {
  if (!points.length) return null;
  const width = 80;
  const height = 24;
  const max = Math.max(...points, 1);
  const min = Math.min(...points);
  const range = max - min || 1;
  const step = width / Math.max(points.length - 1, 1);

  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = height - ((p - min) / range) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const last = points[points.length - 1];
  const first = points[0];
  const trendUp = last >= first;

  return (
    <svg width={width} height={height} className="inline-block">
      <path
        d={path}
        fill="none"
        strokeWidth={1.5}
        className={trendUp ? 'stroke-emerald-500' : 'stroke-rose-500'}
      />
    </svg>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning';
}) {
  const toneClasses: Record<string, string> = {
    neutral: 'text-foreground',
    positive: 'text-emerald-600 dark:text-emerald-400',
    negative: 'text-rose-600 dark:text-rose-400',
    warning: 'text-amber-600 dark:text-amber-400',
  };
  return (
    <Card>
      <CardContent className="pt-6 pb-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className={cn('text-2xl font-semibold tabular-nums', toneClasses[tone])}>{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1 truncate">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function TopicsPage() {
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const activeBrand = useBrandStore(
    (s) => s.brands.find((brand) => brand.id === s.activeBrandId) ?? null,
  );
  const { canManage } = useUserRole();
  const [topics, setTopics] = useState<TopicOverviewRow[]>([]);
  const [unassignedPromptCount, setUnassignedPromptCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!activeBrandId) {
      setTopics([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await getTopicsOverview(activeBrandId);
      setTopics(data.topics);
      setUnassignedPromptCount(data.unassignedPromptCount);
    } catch (err) {
      console.error('Failed to load topics overview', err);
    } finally {
      setLoading(false);
    }
  }, [activeBrandId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const sortedByVisibility = useMemo(
    () => [...topics].sort((a, b) => b.avgVisibilityScore - a.avgVisibilityScore),
    [topics],
  );

  const kpis = useMemo(() => {
    if (topics.length === 0) return null;
    const withData = topics.filter((t) => t.avgVisibilityScore > 0);
    if (withData.length === 0) {
      return {
        total: topics.length,
        best: null as TopicOverviewRow | null,
        weakest: null as TopicOverviewRow | null,
        gainer: null as TopicOverviewRow | null,
      };
    }
    const best = [...withData].sort((a, b) => b.avgVisibilityScore - a.avgVisibilityScore)[0];
    const weakest = [...withData].sort((a, b) => a.avgVisibilityScore - b.avgVisibilityScore)[0];
    const withChange = topics.filter((t) => t.visibilityChange !== null);
    const gainer = withChange.length
      ? [...withChange].sort((a, b) => (b.visibilityChange ?? 0) - (a.visibilityChange ?? 0))[0]
      : null;

    return {
      total: topics.length,
      best,
      weakest,
      gainer,
    };
  }, [topics]);

  const canExport = !loading && topics.length > 0;

  const handleExportCsv = useCallback(() => {
    if (!canExport) return;

    const rows = topics.map((t) => ({
      topic: t.name,
      prompt_count: t.promptCount,
      avg_visibility_score: t.avgVisibilityScore,
      visibility_change: t.visibilityChange ?? '',
      total_mentions: t.totalMentions,
      total_citations: t.totalCitations,
      share_of_voice: t.shareOfVoice,
      top_competitor: t.topCompetitor?.name ?? '',
      top_competitor_sov: t.topCompetitor?.sov ?? '',
      last_run_at: t.lastRunAt ?? '',
    }));

    const csv = toCsv(rows, TOPIC_EXPORT_HEADERS);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    const slug = activeBrand?.slug ?? 'brand';

    link.href = url;
    link.download = `ansvisor_${slug}_topics_${date}.csv`;
    link.click();

    URL.revokeObjectURL(url);
  }, [activeBrand?.slug, canExport, topics]);

  if (!activeBrandId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <Tag className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <h2 className="mt-3 text-base font-semibold">No brand selected</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Select a brand from the top switcher to view topic analytics.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Topics</h1>
          <p className="text-muted-foreground text-sm">
            Topic-level analytics across all tracked prompts (last 30 days)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span title={!canExport ? TOPIC_EXPORT_HINT : undefined}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={handleExportCsv}
              disabled={!canExport}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
          </span>
          <Link
            href={`/dashboard/brands/${activeBrandId}/topics`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <Settings2 className="h-4 w-4" />
            Manage topics
          </Link>
        </div>
      </div>

      {/* KPIs */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px]" />
          ))}
        </div>
      ) : kpis ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            icon={Layers}
            label="Tracked topics"
            value={kpis.total}
            sub={
              unassignedPromptCount > 0
                ? `${unassignedPromptCount} prompts without a topic`
                : 'All prompts categorised'
            }
          />
          <KpiCard
            icon={Trophy}
            label="Best performer"
            value={kpis.best ? `${kpis.best.avgVisibilityScore}%` : '—'}
            sub={kpis.best?.name ?? 'No data yet'}
            tone="positive"
          />
          <KpiCard
            icon={TrendingDown}
            label="Biggest gap"
            value={kpis.weakest ? `${kpis.weakest.avgVisibilityScore}%` : '—'}
            sub={kpis.weakest?.name ?? 'No data yet'}
            tone="warning"
          />
          <KpiCard
            icon={Flame}
            label="Top mover (7d)"
            value={
              kpis.gainer && kpis.gainer.visibilityChange !== null
                ? `${kpis.gainer.visibilityChange > 0 ? '+' : ''}${kpis.gainer.visibilityChange}%`
                : '—'
            }
            sub={kpis.gainer?.name ?? 'Not enough data'}
            tone={
              kpis.gainer?.visibilityChange && kpis.gainer.visibilityChange >= 0
                ? 'positive'
                : 'negative'
            }
          />
        </div>
      ) : null}

      {/* Topic Suggestions (#463) — collapsed strip by default; loads its
          persisted rows only when expanded and never generates on page load. */}
      <TopicSuggestionsCard brandId={activeBrandId} canManage={canManage} onAccepted={loadData} />

      {/* Leaderboard */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Topic leaderboard</CardTitle>
          <p className="text-xs text-muted-foreground">
            Click a topic to drill into detailed analytics
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : topics.length === 0 ? (
            <div className="py-14 text-center text-sm text-muted-foreground">
              <Tag className="mx-auto h-9 w-9 text-muted-foreground/40" />
              <p className="mt-2">No topics defined yet.</p>
              <p className="text-xs">
                Add topics from brand settings to enable topic-based analytics.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Topic</TableHead>
                  <TableHead className="text-right">Prompts</TableHead>
                  <TableHead>Visibility (30d)</TableHead>
                  <TableHead className="text-right">SoV</TableHead>
                  <TableHead className="text-right">Mentions</TableHead>
                  <TableHead className="text-right">Citations</TableHead>
                  <TableHead>Trend</TableHead>
                  <TableHead>Top competitor</TableHead>
                  <TableHead className="text-right">Last run</TableHead>
                  <TableHead className="pr-6 text-right w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedByVisibility.map((t) => (
                  <TableRow key={t.id} className="group hover:bg-muted/50">
                    <TableCell className="pl-6 font-medium text-sm">
                      <Link href={`/dashboard/topics/${t.id}`} className="hover:underline">
                        {t.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {t.promptCount}
                    </TableCell>
                    <TableCell className="min-w-[160px]">
                      {t.avgVisibilityScore > 0 ? (
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'text-sm font-semibold tabular-nums w-8',
                              visibilityTextColor(t.avgVisibilityScore),
                            )}
                          >
                            {t.avgVisibilityScore}
                          </span>
                          <div className="h-1.5 flex-1 max-w-[90px] rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                visibilityBarColor(t.avgVisibilityScore),
                              )}
                              style={{
                                width: `${Math.min(100, t.avgVisibilityScore)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {t.shareOfVoice > 0 ? `${t.shareOfVoice}%` : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {t.totalMentions.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {t.totalCitations.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {t.trendSparkline.length > 0 && t.trendSparkline.some((v) => v > 0) ? (
                        <div className="flex items-center gap-2">
                          <Sparkline points={t.trendSparkline} />
                          {t.visibilityChange !== null && t.visibilityChange !== 0 && (
                            <span
                              className={cn(
                                'text-xs font-medium tabular-nums',
                                t.visibilityChange > 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-rose-600 dark:text-rose-400',
                              )}
                            >
                              {t.visibilityChange > 0 ? (
                                <TrendingUp className="h-3 w-3 inline mr-0.5" />
                              ) : (
                                <TrendingDown className="h-3 w-3 inline mr-0.5" />
                              )}
                              {Math.abs(t.visibilityChange).toFixed(1)}%
                            </span>
                          )}
                          {t.visibilityChange === 0 && (
                            <Minus className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {t.topCompetitor ? (
                        <Badge variant="outline" className="text-[10px]">
                          {t.topCompetitor.name} · {t.topCompetitor.sov}%
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {formatRelative(t.lastRunAt)}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <Link
                        href={`/dashboard/topics/${t.id}`}
                        className="inline-flex opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label="Open topic details"
                      >
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
