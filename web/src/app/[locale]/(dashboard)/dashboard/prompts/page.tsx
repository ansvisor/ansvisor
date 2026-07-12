'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/i18n/navigation';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

const PlatformVolumeChart = dynamic(() => import('./_charts').then((m) => m.PlatformVolumeChart), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});
import { SuggestionsCard } from './_suggestions-card';
import { QueryFanoutTab } from './_fanout-tab';
import { INTENT_LABELS, INTENT_COLORS } from '@/config/intent-labels';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CompetitionBars } from '@/components/ui/competition-bars';
import {
  TrendingUp,
  Search,
  AlertCircle,
  BarChart3,
  Layers,
  Eye,
  HelpCircle,
  Loader2,
  RefreshCw,
  Pencil,
  Settings2,
  Download,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/stores/use-brand-store';
import {
  getPromptVolumes,
  analyzePromptVolumesBatch,
  refreshVolumes,
  type VolumeQuota,
} from '@/lib/actions/volumes';
import { getPromptSets } from '@/lib/actions/prompt';
import { getPromptVisibilitySummaries, type PromptVisibilitySummary } from '@/lib/actions/tracking';
import { aggregatePromptVolumeClusters } from '@/lib/prompt-volume-clusters';
import type { PromptVolume, Prompt } from '@/types';
import { toast } from 'sonner';
import { toCsv } from '@/lib/csv';
import { compareNullsLast, type SortDir } from './prompt-sort';
import { formatCompactNumber } from '@/lib/format';

// ─── Info Tooltip ─────────────────────────────────────────────────────────────

function InfoTip({ content }: { content: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.bottom + 6 });
  }

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
        className="inline-flex items-center cursor-help"
      >
        <HelpCircle className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground transition-colors" />
      </span>
      {pos &&
        createPortal(
          <div
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

function ColHead({
  children,
  tooltip,
  className,
}: {
  children: React.ReactNode;
  tooltip: string;
  className?: string;
}) {
  return (
    <TableHead className={className}>
      <span className="inline-flex items-center gap-1">
        {children}
        <InfoTip content={tooltip} />
      </span>
    </TableHead>
  );
}

// ─── Sortable column header (All Prompts) ─────────────────────────────────────

type AllPromptsSortKey = 'visibility' | 'mentions' | 'volume' | 'lastRun';

const ALL_PROMPTS_SORT_KEYS: AllPromptsSortKey[] = ['visibility', 'mentions', 'volume', 'lastRun'];

function isAllPromptsSortKey(value: string | null): value is AllPromptsSortKey {
  return value !== null && (ALL_PROMPTS_SORT_KEYS as string[]).includes(value);
}

/**
 * Clickable header that toggles asc⇄desc for its column and marks the active
 * sort with a chevron. The InfoTip lives outside the button so hovering /
 * clicking the help icon doesn't trigger a sort.
 */
function SortableHead({
  children,
  tooltip,
  className,
  sortKey,
  activeSort,
  dir,
  onSort,
}: {
  children: React.ReactNode;
  tooltip: string;
  className?: string;
  sortKey: AllPromptsSortKey;
  activeSort: AllPromptsSortKey | null;
  dir: SortDir;
  onSort: (key: AllPromptsSortKey) => void;
}) {
  const active = activeSort === sortKey;
  return (
    <TableHead
      className={className}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          aria-label={`Sort by ${typeof children === 'string' ? children : sortKey}`}
          className={cn(
            'inline-flex items-center gap-1 transition-colors hover:text-foreground',
            active ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {children}
          {active &&
            (dir === 'asc' ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            ))}
        </button>
        <InfoTip content={tooltip} />
      </span>
    </TableHead>
  );
}

const PROMPT_EXPORT_HEADERS = [
  'text',
  'topic_id',
  'category',
  'platforms',
  'models',
  'regions',
  'is_active',
  'created_at',
  'est_ai_volume',
  'total_google_volume',
  'intent',
  'avg_visibility_30d',
  'total_mentions_30d',
  'runs_30d',
  'last_run_at',
];

const PROMPT_EXPORT_HINT = 'No prompts yet - add prompts first.';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_TABS = ['all', 'fanout', 'insights'] as const;
type TabId = (typeof VALID_TABS)[number];

function formatRelative(iso?: string): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

function visibilityColorClass(score: number): string {
  if (score >= 70) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 40) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function visibilityBarClass(score: number): string {
  if (score >= 70) return 'bg-emerald-500';
  if (score >= 40) return 'bg-amber-500';
  return 'bg-red-500';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  title,
  icon: Icon,
  value,
  sub,
  subPositive,
}: {
  title: string;
  icon: React.ElementType;
  value: React.ReactNode;
  sub: React.ReactNode;
  subPositive?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </CardTitle>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        <p
          className={cn(
            'text-xs mt-1 flex items-center gap-0.5',
            subPositive ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground',
          )}
        >
          {sub}
        </p>
      </CardContent>
    </Card>
  );
}

function VolumePill({ value }: { value: number }) {
  return <span className="tabular-nums text-sm font-semibold">~{formatCompactNumber(value)}</span>;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PromptsPage() {
  const [search, setSearch] = useState('');
  const [volumes, setVolumes] = useState<PromptVolume[]>([]);
  const [allPrompts, setAllPrompts] = useState<Prompt[]>([]);
  const [visibility, setVisibility] = useState<Record<string, PromptVisibilitySummary>>({});
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [quota, setQuota] = useState<VolumeQuota | null>(null);

  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const activeBrand = useBrandStore(
    (s) => s.brands.find((brand) => brand.id === s.activeBrandId) ?? null,
  );
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialTab: TabId = (() => {
    const raw = searchParams.get('tab');
    return (VALID_TABS as readonly string[]).includes(raw ?? '') ? (raw as TabId) : 'all';
  })();
  const [tab, setTab] = useState<TabId>(initialTab);

  // Keep the URL in sync with the active tab so deep links / refreshes land
  // back on the same view.
  useEffect(() => {
    const current = searchParams.get('tab');
    if (current === tab) return;
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.set('tab', tab);
    router.replace(`/dashboard/prompts?${params.toString()}`, {
      scroll: false,
    });
  }, [tab, searchParams, router]);

  const loadData = useCallback(
    async (isCancelled?: () => boolean) => {
      if (!activeBrandId) {
        if (isCancelled?.()) return;
        setVolumes([]);
        setAllPrompts([]);
        setVisibility({});
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const [volumeResult, promptSets, visSummary] = await Promise.all([
          getPromptVolumes(activeBrandId),
          getPromptSets(activeBrandId),
          getPromptVisibilitySummaries(activeBrandId, { days: 30 }),
        ]);
        if (isCancelled?.()) return;
        setVolumes(volumeResult.volumes);
        if (volumeResult.quota) setQuota(volumeResult.quota);
        const prompts = promptSets.flatMap((ps) => ps.prompts);
        setAllPrompts(prompts);
        setVisibility(visSummary);
      } catch (err) {
        if (isCancelled?.()) return;
        console.error('Failed to load prompt data:', err);
        toast.error('Failed to load prompt data');
      } finally {
        if (!isCancelled?.()) setLoading(false);
      }
    },
    [activeBrandId],
  );

  useEffect(() => {
    let cancelled = false;
    loadData(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  const handleAnalyzeNew = async () => {
    if (!activeBrandId) return;

    const promptsWithoutVolume = allPrompts.filter(
      (p) => p.isActive && !volumes.find((v) => v.promptId === p.id),
    );

    const promptsToAnalyze =
      promptsWithoutVolume.length > 0 ? promptsWithoutVolume : allPrompts.filter((p) => p.isActive);

    if (promptsToAnalyze.length === 0) {
      toast.error('No active prompts to analyze. Add prompts to a brand first.');
      return;
    }

    setAnalyzing(true);
    try {
      const result = await analyzePromptVolumesBatch(
        promptsToAnalyze.map((p) => ({ promptId: p.id, promptText: p.text })),
      );
      if (result.remaining !== undefined && quota) {
        setQuota({
          ...quota,
          remaining: result.remaining,
          used: quota.limit === -1 ? 0 : quota.limit - result.remaining,
        });
      }
      toast.success(`Analyzed ${promptsToAnalyze.length} prompts`);
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Volume analysis failed';
      if (message.includes('limit reached')) {
        toast.error('Monthly volume analysis limit reached. Upgrade your plan for more.');
      } else {
        console.error('Volume analysis failed:', err);
        toast.error('Volume analysis failed');
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const handleRefreshVolumes = async () => {
    if (!activeBrandId || volumes.length === 0) return;

    setRefreshing(true);
    try {
      const result = await refreshVolumes(activeBrandId);
      if (result.remaining !== undefined && quota) {
        setQuota({
          ...quota,
          remaining: result.remaining,
          used: quota.limit === -1 ? 0 : quota.limit - result.remaining,
        });
      }
      toast.success(`Refreshed volumes for ${result.refreshed} prompts`);
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Volume refresh failed';
      if (message.includes('limit reached')) {
        toast.error('Monthly volume analysis limit reached. Upgrade your plan for more.');
      } else {
        console.error('Volume refresh failed:', err);
        toast.error('Volume refresh failed');
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleReanalyzeAll = async () => {
    if (!activeBrandId) return;

    const activePrompts = allPrompts.filter((p) => p.isActive);
    if (activePrompts.length === 0) {
      toast.error('No active prompts to analyze.');
      return;
    }

    setAnalyzing(true);
    try {
      const result = await analyzePromptVolumesBatch(
        activePrompts.map((p) => ({ promptId: p.id, promptText: p.text })),
        undefined,
        undefined,
        true,
      );
      if (result.remaining !== undefined && quota) {
        setQuota({
          ...quota,
          remaining: result.remaining,
          used: quota.limit === -1 ? 0 : quota.limit - result.remaining,
        });
      }
      toast.success(`Re-analyzed ${activePrompts.length} prompts with new keywords`);
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Re-analysis failed';
      if (message.includes('limit reached')) {
        toast.error('Monthly volume analysis limit reached. Upgrade your plan for more.');
      } else {
        console.error('Re-analysis failed:', err);
        toast.error('Re-analysis failed');
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const totalGoogleVol = volumes.reduce((s, v) => s + v.totalGoogleVolume, 0);
  const totalAiVol = volumes.reduce((s, v) => s + v.estAiVolume, 0);
  const totalKeywords = volumes.reduce((s, v) => s + v.keywords.length, 0);

  const filtered = volumes.filter(
    (v) =>
      v.promptText.toLowerCase().includes(search.toLowerCase()) ||
      v.intent.toLowerCase().includes(search.toLowerCase()),
  );

  const quotaExhausted = quota !== null && quota.limit !== -1 && quota.remaining <= 0;

  // Join prompts with their volume + visibility summaries once, reused by the
  // All Prompts table.
  const volumeByPromptId = useMemo(() => {
    const m = new Map<string, PromptVolume>();
    for (const v of volumes) m.set(v.promptId, v);
    return m;
  }, [volumes]);

  // Active prompts that have no volume row yet — their Volume/Competition cells
  // render blank. Drives the "unanalyzed keywords" banner + one-click Analyze.
  const unanalyzedCount = useMemo(
    () => allPrompts.filter((p) => p.isActive && !volumeByPromptId.has(p.id)).length,
    [allPrompts, volumeByPromptId],
  );

  const canExport = !loading && allPrompts.length > 0;

  const handleExportCsv = useCallback(() => {
    if (!canExport) return;

    const rows = allPrompts.map((p) => ({
      text: p.text,
      topic_id: p.topicId ?? '',
      category: p.category ?? '',
      platforms: p.platforms.join(', '),
      models: p.models.join(', '),
      regions: p.regions.join(', '),
      is_active: p.isActive,
      created_at: p.createdAt,
      est_ai_volume: volumeByPromptId.get(p.id)?.estAiVolume ?? '',
      total_google_volume: volumeByPromptId.get(p.id)?.totalGoogleVolume ?? '',
      intent: volumeByPromptId.get(p.id)?.intent ?? '',
      avg_visibility_30d: visibility[p.id]?.avgVisibility ?? '',
      total_mentions_30d: visibility[p.id]?.totalMentions ?? '',
      runs_30d: visibility[p.id]?.runs ?? '',
      last_run_at: visibility[p.id]?.lastRunAt ?? '',
    }));

    const csv = toCsv(rows, PROMPT_EXPORT_HEADERS);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    const slug = activeBrand?.slug ?? 'brand';

    link.href = url;
    link.download = `ansvisor_${slug}_prompts_${date}.csv`;
    link.click();

    URL.revokeObjectURL(url);
  }, [activeBrand?.slug, canExport, allPrompts, visibility, volumeByPromptId]);

  if (!activeBrandId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Select a brand to view prompts.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Prompts</h1>
          <p className="text-muted-foreground text-sm">
            Manage every tracked prompt and review estimated AI demand
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground/70">
              <AlertCircle className="h-3 w-3" />
              Volumes are estimates, not exact figures
            </span>
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <TabsList>
            <TabsTrigger value="all">All Prompts</TabsTrigger>
            <TabsTrigger value="fanout">Query Fan-out</TabsTrigger>
            <TabsTrigger value="insights">Insights</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            {tab === 'all' && (
              <span title={!canExport ? PROMPT_EXPORT_HINT : undefined}>
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
            )}

            <Link
              href={`/dashboard/brands/${activeBrandId}/prompts`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Settings2 className="h-4 w-4" />
              Manage prompts
            </Link>
          </div>
        </div>

        {/* ─── All Prompts tab ─────────────────────────────────────────── */}
        <TabsContent value="all" className="mt-4 space-y-4">
          {!loading && unanalyzedCount > 0 && (
            <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/50 dark:bg-amber-950/30">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
                <div className="text-sm">
                  <p className="font-medium text-amber-900 dark:text-amber-200">
                    {unanalyzedCount} prompt{unanalyzedCount === 1 ? '' : 's'} haven&apos;t been
                    analyzed yet
                  </p>
                  <p className="text-amber-800/80 dark:text-amber-300/80">
                    {quotaExhausted
                      ? 'Their Volume & Competition stay empty until analyzed — but your monthly volume analysis limit is reached. Upgrade your plan to analyze more.'
                      : 'Run volume analysis to fill in their Volume & Competition.'}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                className="shrink-0"
                onClick={handleAnalyzeNew}
                disabled={analyzing || quotaExhausted}
              >
                {analyzing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <BarChart3 className="mr-2 h-4 w-4" />
                    Analyze {unanalyzedCount} prompt{unanalyzedCount === 1 ? '' : 's'}
                  </>
                )}
              </Button>
            </div>
          )}
          <AllPromptsTab
            loading={loading}
            prompts={allPrompts}
            activeBrandId={activeBrandId}
            volumeByPromptId={volumeByPromptId}
            visibility={visibility}
          />
        </TabsContent>

        {/* ─── Query Fan-out tab ───────────────────────────────────────── */}
        <TabsContent value="fanout" className="mt-4">
          {activeBrandId && <QueryFanoutTab brandId={activeBrandId} onTracked={loadData} />}
        </TabsContent>

        {/* ─── Insights tab ────────────────────────────────────────────── */}
        <TabsContent value="insights" className="mt-4">
          {/* Action toolbar */}
          <div className="flex items-center justify-end gap-2 flex-wrap mb-4">
            {quota && quota.limit !== -1 && (
              <span
                className={cn(
                  'text-xs tabular-nums',
                  quotaExhausted ? 'text-red-500' : 'text-muted-foreground',
                )}
              >
                {quota.remaining}/{quota.limit} analyses left
              </span>
            )}
            {volumes.length > 0 && (
              <>
                <Button
                  onClick={handleRefreshVolumes}
                  disabled={refreshing || analyzing || loading || quotaExhausted}
                  size="sm"
                  variant="outline"
                  className="gap-2"
                >
                  {refreshing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {refreshing ? 'Refreshing...' : 'Refresh Volumes'}
                </Button>
                <Button
                  onClick={handleReanalyzeAll}
                  disabled={analyzing || refreshing || loading || quotaExhausted}
                  size="sm"
                  variant="outline"
                  className="gap-2"
                >
                  {analyzing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <BarChart3 className="h-4 w-4" />
                  )}
                  {analyzing ? 'Analyzing...' : 'Re-analyze Keywords'}
                </Button>
              </>
            )}
            {volumes.length > 0 &&
              allPrompts.filter((p) => p.isActive && !volumes.find((v) => v.promptId === p.id))
                .length > 0 && (
                <Button
                  onClick={handleAnalyzeNew}
                  disabled={analyzing || refreshing || loading || quotaExhausted}
                  size="sm"
                  className="gap-2"
                >
                  {analyzing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <BarChart3 className="h-4 w-4" />
                  )}
                  {analyzing ? 'Analyzing...' : 'Analyze New Prompts'}
                </Button>
              )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center min-h-[300px]">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : volumes.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
                <BarChart3 className="h-12 w-12 text-muted-foreground/40" />
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium">No volume data yet</p>
                  <p className="text-xs text-muted-foreground">
                    {allPrompts.length > 0
                      ? 'Click "Analyze Volumes" to fetch search volume data for your prompts.'
                      : 'Add prompts to your brand first, then analyze their volumes.'}
                  </p>
                </div>
                {allPrompts.length > 0 && (
                  <>
                    <Button
                      onClick={handleAnalyzeNew}
                      disabled={analyzing || quotaExhausted}
                      size="sm"
                      className="gap-2"
                    >
                      {analyzing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <BarChart3 className="h-4 w-4" />
                      )}
                      {analyzing ? 'Analyzing...' : 'Analyze Volumes'}
                    </Button>
                    {quotaExhausted && (
                      <p className="text-xs text-red-500">
                        Monthly analysis limit reached. Resets on the 1st.
                      </p>
                    )}
                    {quota && quota.limit !== -1 && !quotaExhausted && (
                      <p className="text-xs text-muted-foreground">
                        {quota.remaining}/{quota.limit} analyses remaining this month
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <KpiCard
                  title="Prompts Analyzed"
                  icon={Layers}
                  value={volumes.length}
                  sub={`across ${totalKeywords} keywords`}
                />
                <KpiCard
                  title="Total Est. AI Volume"
                  icon={BarChart3}
                  value={`~${formatCompactNumber(totalAiVol)}`}
                  sub={`from ${formatCompactNumber(totalGoogleVol)} Google searches`}
                />
                <KpiCard
                  title="AI Adoption Rate"
                  icon={TrendingUp}
                  value={`${((volumes[0]?.aiVolumeMultiplier ?? 0.15) * 100).toFixed(0)}%`}
                  sub="of Google search volume"
                />
                <KpiCard
                  title="Avg. AI Volume"
                  icon={BarChart3}
                  value={`~${formatCompactNumber(totalAiVol / volumes.length)}`}
                  sub="per prompt"
                />
              </div>

              {/* Charts row */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Prompt Volumes</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Total estimated AI-answered queries across all topic clusters, split by
                      answer-engine share. Weights include Google AI Overview (~35% of Google
                      searches), Google AI Mode, and standalone chatbots.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <PlatformVolumeChart totalVolume={totalAiVol} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-sm font-medium">Similar Topics</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          Most-searched keyword clusters across all prompts
                        </p>
                      </div>
                      <Link
                        href="/dashboard/prompts/similar-topics"
                        className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline"
                      >
                        See all
                      </Link>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <SimilarTopicsList volumes={volumes} />
                  </CardContent>
                </Card>
              </div>

              {/* Prompt Suggestions */}
              {activeBrandId && <SuggestionsCard brandId={activeBrandId} />}

              {/* Prompt Volume Table */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <CardTitle className="text-sm font-medium">Prompt Volumes</CardTitle>
                    <div className="relative w-60">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search prompts…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-8 h-8 text-xs"
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Prompt</TableHead>

                        <ColHead
                          className="text-right"
                          tooltip="Total monthly Google search volume across all extracted keywords."
                        >
                          Google Vol.
                        </ColHead>
                        <ColHead
                          className="text-right"
                          tooltip="Estimated monthly AI prompt volume. Calculated as total Google volume multiplied by the AI adoption rate."
                        >
                          Est. AI Vol.
                        </ColHead>
                        <ColHead
                          className="text-center"
                          tooltip="The search intent detected by AI analysis. Different intents indicate how users frame their queries."
                        >
                          Intent
                        </ColHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((row) => (
                        <TableRow key={row.id} className="hover:bg-muted/50">
                          <TableCell className="pl-6 font-medium text-sm max-w-[280px]">
                            <span className="line-clamp-1">{row.promptText}</span>
                          </TableCell>

                          <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                            {row.totalGoogleVolume.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <VolumePill value={row.estAiVolume} />
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-xs whitespace-nowrap',
                                INTENT_COLORS[row.intent] || '',
                              )}
                            >
                              {INTENT_LABELS[row.intent] || row.intent}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {filtered.length === 0 && (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      No prompts match your search.
                    </div>
                  )}
                  <div className="px-6 py-2 border-t">
                    <p className="text-xs text-muted-foreground">
                      * Est. AI Volume = Total Google search volume of extracted keywords × AI
                      adoption rate. Figures are approximations for planning purposes.
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* High Opportunity Prompts */}
              {volumes.filter((v) => v.estAiVolume >= 5000).length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4 text-emerald-500" />
                      <CardTitle className="text-sm font-medium">
                        High Opportunity Prompts
                      </CardTitle>
                      <span className="text-xs text-muted-foreground ml-1">
                        Prompts with highest estimated AI search demand
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-6">Prompt</TableHead>
                          <ColHead
                            className="text-right"
                            tooltip="Estimated monthly AI prompt volume. Sorted by highest volume first."
                          >
                            Est. AI Volume
                          </ColHead>
                          <ColHead className="text-center" tooltip="The detected search intent.">
                            Intent
                          </ColHead>
                          <ColHead
                            className="text-right pr-6"
                            tooltip="Opportunity level based on estimated AI volume. High = above 10k/mo, Medium = 5k–10k/mo."
                          >
                            Opportunity
                          </ColHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {volumes
                          .filter((v) => v.estAiVolume >= 5000)
                          .sort((a, b) => b.estAiVolume - a.estAiVolume)
                          .map((row) => (
                            <TableRow key={row.id} className="hover:bg-muted/50">
                              <TableCell className="pl-6 font-medium text-sm">
                                {row.promptText}
                              </TableCell>
                              <TableCell className="text-right">
                                <VolumePill value={row.estAiVolume} />
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge
                                  variant="outline"
                                  className={cn('text-xs', INTENT_COLORS[row.intent] || '')}
                                >
                                  {INTENT_LABELS[row.intent] || row.intent}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right pr-6">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    'text-xs',
                                    row.estAiVolume >= 10000
                                      ? 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
                                      : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
                                  )}
                                >
                                  {row.estAiVolume >= 10000 ? 'High' : 'Medium'}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── All Prompts Tab ──────────────────────────────────────────────────────────

function AllPromptsTab({
  loading,
  prompts,
  activeBrandId,
  volumeByPromptId,
  visibility,
}: {
  loading: boolean;
  prompts: Prompt[];
  activeBrandId: string;
  volumeByPromptId: Map<string, PromptVolume>;
  visibility: Record<string, PromptVisibilitySummary>;
}) {
  const [search, setSearch] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawSort = searchParams.get('sort');
  const activeSort: AllPromptsSortKey | null = isAllPromptsSortKey(rawSort) ? rawSort : null;
  const dir: SortDir = searchParams.get('dir') === 'asc' ? 'asc' : 'desc';

  // Click a header to sort: a new column starts at desc ("show me the extremes");
  // re-clicking the active column toggles desc⇄asc. Persisted to the URL so the
  // sort survives reloads and is shareable (matches the existing `tab` sync).
  const handleSort = useCallback(
    (key: AllPromptsSortKey) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      const nextDir: SortDir = activeSort === key && dir === 'desc' ? 'asc' : 'desc';
      params.set('tab', 'all');
      params.set('sort', key);
      params.set('dir', nextDir);
      router.replace(`/dashboard/prompts?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, activeSort, dir],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = [...prompts];
    if (q) {
      list = list.filter(
        (p) => p.text.toLowerCase().includes(q) || (p.category ?? '').toLowerCase().includes(q),
      );
    }

    if (!activeSort) {
      // Default ordering: newest first.
      return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    const valueOf = (p: Prompt): number | null => {
      const vis = visibility[p.id];
      const vol = volumeByPromptId.get(p.id);
      switch (activeSort) {
        case 'visibility':
          return vis ? vis.avgVisibility : null;
        case 'mentions':
          return vis ? vis.totalMentions : null;
        case 'volume':
          return vol ? vol.estAiVolume : null;
        case 'lastRun':
          return vis?.lastRunAt ? new Date(vis.lastRunAt).getTime() : null;
      }
    };

    return list.sort((a, b) => compareNullsLast(valueOf(a), valueOf(b), dir));
  }, [prompts, search, activeSort, dir, visibility, volumeByPromptId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (prompts.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
          <Layers className="h-12 w-12 text-muted-foreground/40" />
          <div className="text-center space-y-1">
            <p className="text-sm font-medium">No prompts yet</p>
            <p className="text-xs text-muted-foreground">
              Add prompts to your brand to start tracking their AI visibility.
            </p>
          </div>
          <Link href={`/dashboard/brands/${activeBrandId}/prompts`}>
            <Button size="sm" className="gap-2">
              <Pencil className="h-4 w-4" />
              Manage prompts
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="text-sm font-medium">All Prompts ({prompts.length})</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Read-only overview · edit prompts from each brand&apos;s page
            </p>
          </div>
          <div className="relative w-60">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search prompts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Prompt</TableHead>
              <TableHead>Topic</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <SortableHead
                className="text-right"
                tooltip="Average brand visibility score in AI answers for this prompt over the last 30 days."
                sortKey="visibility"
                activeSort={activeSort}
                dir={dir}
                onSort={handleSort}
              >
                Visibility
              </SortableHead>
              <SortableHead
                className="text-right"
                tooltip="Total times the brand was mentioned across AI answers for this prompt over the last 30 days."
                sortKey="mentions"
                activeSort={activeSort}
                dir={dir}
                onSort={handleSort}
              >
                Mentions
              </SortableHead>
              <SortableHead
                className="text-right"
                tooltip="Estimated monthly AI prompt volume, from keyword analysis. Empty until analysed."
                sortKey="volume"
                activeSort={activeSort}
                dir={dir}
                onSort={handleSort}
              >
                Volume
              </SortableHead>
              <ColHead
                className="text-center"
                tooltip="Based on Google Ads competition for related keywords (LOW / MEDIUM / HIGH). A proxy for topic difficulty."
              >
                Competition
              </ColHead>
              <SortableHead
                className="text-right"
                tooltip="Most recent tracking run for this prompt."
                sortKey="lastRun"
                activeSort={activeSort}
                dir={dir}
                onSort={handleSort}
              >
                Last run
              </SortableHead>
              <TableHead className="text-right pr-6 w-[60px]">Edit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((p) => {
              const vol = volumeByPromptId.get(p.id);
              const vis = visibility[p.id];
              return (
                <TableRow key={p.id} className="hover:bg-muted/50">
                  <TableCell className="pl-6 font-medium text-sm max-w-[320px]">
                    <Link
                      href={`/dashboard/prompts/${p.id}`}
                      className="line-clamp-2 transition-colors hover:text-primary hover:underline"
                    >
                      {p.text}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground truncate inline-block max-w-[140px] align-middle">
                      {p.category?.trim() ? p.category : '—'}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-xs',
                        p.isActive
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'border-muted-foreground/20 text-muted-foreground',
                      )}
                    >
                      {p.isActive ? 'Active' : 'Paused'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {vis ? (
                      <div className="inline-flex items-center gap-2 justify-end min-w-[110px]">
                        <span
                          className={cn(
                            'text-sm font-semibold tabular-nums',
                            visibilityColorClass(vis.avgVisibility),
                          )}
                        >
                          {vis.avgVisibility.toFixed(0)}
                        </span>
                        <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              visibilityBarClass(vis.avgVisibility),
                            )}
                            style={{
                              width: `${Math.min(100, Math.max(0, vis.avgVisibility))}%`,
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {vis ? (
                      vis.totalMentions.toLocaleString()
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {vol ? (
                      <VolumePill value={vol.estAiVolume} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex justify-center">
                      <CompetitionBars
                        index={vol?.competitionIndex ?? null}
                        label={vol?.competition ?? null}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {formatRelative(vis?.lastRunAt)}
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <Link href={`/dashboard/brands/${activeBrandId}/prompts`}>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        aria-label="Edit prompt"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {filtered.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No prompts match your search.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Similar Topics List ──────────────────────────────────────────────────────

/**
 * Aggregates related keyword clusters across all prompts. Keywords can appear
 * in multiple prompts (e.g. "most reliable luxury cars"), so we sum their
 * volumes and keep a unique row per normalised keyword to avoid duplicate
 * React keys and double-counted totals.
 */
function SimilarTopicsList({ volumes }: { volumes: PromptVolume[] }) {
  const sorted = aggregatePromptVolumeClusters(volumes).slice(0, 8);

  const maxVol = sorted[0]?.volume || 1;

  return (
    <div className="w-full space-y-2">
      {sorted.map((item) => {
        const key = item.keyword.trim().toLowerCase();
        return (
          <div key={key} className="flex items-center gap-2 text-xs">
            <span
              className="w-32 shrink-0 text-muted-foreground truncate"
              title={`${item.keyword}${item.occurrences > 1 ? ` (in ${item.occurrences} prompts)` : ''}`}
            >
              {item.keyword}
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${(item.volume / maxVol) * 100}%` }}
              />
            </div>
            <span className="w-12 text-right font-medium tabular-nums text-foreground">
              {formatCompactNumber(item.volume)}
            </span>
          </div>
        );
      })}
      {sorted.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">No keyword data yet</p>
      )}
    </div>
  );
}
