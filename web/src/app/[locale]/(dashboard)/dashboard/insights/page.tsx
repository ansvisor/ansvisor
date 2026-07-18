'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
const CompetitorChart = dynamic(() => import('./_charts').then((m) => m.CompetitorChart), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});

const CompetitorLeaderboard = dynamic(
  () => import('./_charts').then((m) => m.CompetitorLeaderboard),
  {
    ssr: false,
    loading: () => <Skeleton className="h-64 w-full" />,
  },
);

const ShareOfVoicePlatformChart = dynamic(
  () => import('./_charts').then((m) => m.ShareOfVoicePlatformChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-64 w-full" />,
  },
);

const ShareOfVoiceTrendChart = dynamic(
  () => import('./_charts').then((m) => m.ShareOfVoiceTrendChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-64 w-full" />,
  },
);
import { MetricBreakdownSheet } from './_metric-breakdown-sheet';
import { useBrandStore } from '@/stores/use-brand-store';
import {
  getInsightsData,
  triggerTrackingCheck,
  getJobStatus,
  cancelTrackingJob,
  getBrandPrompts,
  exportPromptResults,
  type InsightsSummary,
  type TrackedPromptsKpi,
  type CompetitorComparisonData,
  type ShareOfVoiceData,
  type TrackingJobStatus,
  type BreakdownMetric,
} from '@/lib/actions/tracking';
import { getTopics } from '@/lib/actions/topic';
import { PLATFORM_LABELS } from '@/config/platform-labels';
import { formatRegionDisplay } from '@/lib/region';
import type { Topic } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  BarChart3,
  CalendarX2,
  HelpCircle,
  Play,
  TrendingUp,
  TrendingDown,
  Quote,
  Zap,
  AlertCircle,
  Loader2,
  FlaskConical,
  PieChart,
  Users,
  StopCircle,
  ArrowUpRight,
  Download,
  Layers,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { getAIProviderDisplayName, resolveAIProvider } from '@/components/ai-provider-avatar';
import { usePlanContext } from '@/components/providers/plan-provider';
import { toast } from 'sonner';

// ─── Filter Types ─────────────────────────────────────────────────────────────

type DatePreset = '24h' | '7d' | '30d' | '90d' | 'all' | 'custom';

interface InsightsFilters {
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
  region: string;
  model: string;
  topic: string;
}

const DEFAULT_FILTERS: InsightsFilters = {
  datePreset: '24h',
  dateFrom: '',
  dateTo: '',
  region: '',
  model: '',
  topic: '',
};

const INSIGHT_EXPORT_HEADERS = [
  'created_at',
  'prompt',
  'topic',
  'platform',
  'model',
  'region',
  'mention_count',
  'citation_count',
  'visibility_score',
  'sentiment',
  'citation_urls',
  'competitor_mentions',
];

function getDateRange(preset: DatePreset, custom: { from: string; to: string }) {
  if (preset === 'all') return { dateFrom: undefined, dateTo: undefined };
  if (preset === 'custom') {
    return {
      dateFrom: custom.from || undefined,
      dateTo: custom.to ? `${custom.to}T23:59:59.999Z` : undefined,
    };
  }
  if (preset === '24h') {
    const from = new Date();
    from.setHours(from.getHours() - 24);
    return { dateFrom: from.toISOString(), dateTo: undefined };
  }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { dateFrom: from.toISOString(), dateTo: undefined };
}

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

// ─── Sub-components ───────────────────────────────────────────────────────────

const MODEL_DISPLAY_NAME: Record<string, string> = {
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gpt-4.1': 'GPT-4.1',
  'gpt-4.1-mini': 'GPT-4.1 Mini',
  'gpt-4.1-nano': 'GPT-4.1 Nano',
  'gpt-5-chat-latest': 'ChatGPT',
  'claude-sonnet-5': 'Claude',
  'claude-sonnet-4-6': 'Claude',
  'claude-opus-4-6': 'Claude',
  'claude-haiku-4-5': 'Claude',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'grok-3': 'Grok',
  'grok-4-auto': 'Grok',
  'chatgpt-web': 'ChatGPT',
  'perplexity-web': 'Perplexity',
  'google-aio': 'Google AI Overview',
  'google-aimode': 'Google AI Mode',
  'copilot-web': 'Microsoft Copilot',
  'grok-web': 'Grok',
  'gemini-web': 'Gemini',
};

// ─── Delta Badge ──────────────────────────────────────────────────────────────

function DeltaBadge({ delta, suffix = '%' }: { delta: number | null; suffix?: string }) {
  if (delta === null) return null;
  if (delta === 0) return <span className="text-xs text-muted-foreground">— 0{suffix}</span>;
  const pos = delta > 0;
  return (
    <span
      className={cn(
        'flex items-center gap-0.5 text-xs font-medium',
        pos ? 'text-green-600 dark:text-green-400' : 'text-red-500',
      )}
    >
      {pos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {pos ? '+' : ''}
      {delta}
      {suffix}
    </span>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  tooltip,
  icon: Icon,
  value,
  sub,
  subVariant = 'muted',
  onClick,
}: {
  title: string;
  tooltip: string;
  icon: React.ElementType;
  value: React.ReactNode;
  sub: React.ReactNode;
  subVariant?: 'muted' | 'positive';
  onClick?: () => void;
}) {
  const clickable = typeof onClick === 'function';
  return (
    <Card
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `${title} — view breakdown` : undefined}
      title={clickable ? 'Click to see breakdown' : undefined}
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
        'group relative',
        clickable &&
          'cursor-pointer transition-all duration-150 hover:border-foreground/30 hover:shadow-md hover:-translate-y-0.5 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
        <CardTitle className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {title}
          <InfoTip content={tooltip} />
        </CardTitle>
        <div className="relative flex h-4 w-4 items-center justify-center">
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
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        <p
          className={cn(
            'text-xs mt-1 flex items-center gap-0.5',
            subVariant === 'positive'
              ? 'text-green-600 dark:text-green-400'
              : 'text-muted-foreground',
          )}
        >
          {sub}
        </p>
        {clickable && (
          <p className="mt-2 flex items-center gap-1 text-[10px] font-medium text-muted-foreground/70 opacity-0 transition-opacity group-hover:opacity-100">
            View breakdown
            <ArrowUpRight className="h-2.5 w-2.5" />
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Run Single Prompt Dialog ─────────────────────────────────────────────────

function RunSinglePromptDialog({
  brandId,
  open,
  onClose,
  onJobStarted,
}: {
  brandId: string;
  open: boolean;
  onClose: () => void;
  onJobStarted: (jobId: string) => void;
}) {
  const [prompts, setPrompts] = useState<
    { id: string; text: string; category?: string; platforms: string[] }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getBrandPrompts(brandId)
      .then(setPrompts)
      .catch(() => toast.error('Failed to load prompts'))
      .finally(() => setLoading(false));
  }, [open, brandId]);

  const handleRun = async (promptId: string) => {
    setRunningId(promptId);
    try {
      const { jobId } = await triggerTrackingCheck(brandId, { promptId });
      onClose();
      onJobStarted(jobId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to run prompt');
    } finally {
      setRunningId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg max-h-[70vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" />
            Run Single Prompt
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Pick a prompt to test. Only that prompt will run across your enabled platforms.
          </p>
        </DialogHeader>

        <div className="space-y-2 pt-2">
          {loading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          )}

          {!loading && prompts.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No active prompts found. Add prompts in brand settings first.
            </p>
          )}

          {!loading &&
            prompts.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium line-clamp-2">{p.text}</p>
                  {p.category && (
                    <Badge variant="outline" className="text-[10px] mt-1">
                      {p.category}
                    </Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 shrink-0"
                  disabled={runningId !== null}
                  onClick={() => handleRun(p.id)}
                >
                  {runningId === p.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  Run
                </Button>
              </div>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

function FilterBar({
  filters,
  onChange,
  availableRegions,
  availableModels,
  availableTopics,
}: {
  filters: InsightsFilters;
  onChange: (f: InsightsFilters) => void;
  availableRegions: string[];
  availableModels: string[];
  availableTopics: Topic[];
}) {
  const set = (patch: Partial<InsightsFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* Date presets */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Date Range</label>
        <div className="flex rounded-md border overflow-hidden">
          {(['24h', '7d', '30d', '90d', 'all', 'custom'] as DatePreset[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => set({ datePreset: p })}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                filters.datePreset === p
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card hover:bg-muted text-foreground',
              )}
            >
              {p === 'custom' ? 'Custom' : p === 'all' ? 'All' : p}
            </button>
          ))}
        </div>
      </div>

      {/* Custom date inputs */}
      {filters.datePreset === 'custom' && (
        <>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">From</label>
            <Input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => set({ dateFrom: e.target.value })}
              className="h-8 w-36 text-xs"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">To</label>
            <Input
              type="date"
              value={filters.dateTo}
              onChange={(e) => set({ dateTo: e.target.value })}
              className="h-8 w-36 text-xs"
            />
          </div>
        </>
      )}

      {/* Topic filter */}
      {availableTopics.length > 0 && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Topic</label>
          <Select
            value={filters.topic || null}
            onValueChange={(v) => set({ topic: !v || v === '__all__' ? '' : v })}
          >
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder="All Topics">
                {(value) =>
                  value && value !== '__all__'
                    ? (availableTopics.find((t) => t.id === value)?.name ?? 'All Topics')
                    : 'All Topics'
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Topics</SelectItem>
              {availableTopics.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Region filter */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Region</label>
        <Select
          value={filters.region || null}
          onValueChange={(v) => set({ region: !v || v === '__all__' ? '' : v })}
        >
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue placeholder="All Regions">
              {(value) =>
                value && value !== '__all__' ? formatRegionDisplay(String(value)) : 'All Regions'
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Regions</SelectItem>
            {availableRegions.map((r) => (
              <SelectItem key={r} value={r}>
                {formatRegionDisplay(r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Model filter */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">AI Model</label>
        <Select
          value={filters.model || null}
          onValueChange={(v) => set({ model: !v || v === '__all__' ? '' : v })}
        >
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="All Platforms">
              {(value) => {
                if (!value || value === '__all__') return 'All Platforms';
                const firstSlug = String(value).split(',')[0];
                return (
                  MODEL_DISPLAY_NAME[firstSlug] ??
                  PLATFORM_LABELS[firstSlug] ??
                  getAIProviderDisplayName(resolveAIProvider(firstSlug))
                );
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Platforms</SelectItem>
            {availableModels.map((m) => {
              // m is a comma-separated slug list representing a provider family
              const firstSlug = m.split(',')[0];
              return (
                <SelectItem key={m} value={m}>
                  {MODEL_DISPLAY_NAME[firstSlug] ??
                    PLATFORM_LABELS[firstSlug] ??
                    getAIProviderDisplayName(resolveAIProvider(firstSlug))}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function InsightsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({
  onRunPrompts,
  isRunning,
  isCloud,
}: {
  onRunPrompts: () => void;
  isRunning: boolean;
  isCloud: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <BarChart3 className="h-12 w-12 text-muted-foreground/40 mb-4" />
      <h2 className="text-lg font-semibold">No tracking data yet</h2>
      <p className="text-muted-foreground text-sm mt-1 max-w-md">
        Run your prompts through AI platforms to see how your brand appears in AI-generated
        responses.
      </p>
      {!isCloud && (
        <Button onClick={onRunPrompts} disabled={isRunning} className="mt-6 gap-2">
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run Prompts Now
        </Button>
      )}
    </div>
  );
}

function NoDataForPeriod({ datePreset, onReset }: { datePreset: DatePreset; onReset: () => void }) {
  const labels: Record<DatePreset, string> = {
    '24h': 'last 24 hours',
    '7d': 'last 7 days',
    '30d': 'last 30 days',
    '90d': 'last 90 days',
    all: 'selected period',
    custom: 'selected period',
  };
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <CalendarX2 className="h-10 w-10 text-muted-foreground/40 mb-3" />
      <h3 className="text-base font-semibold">No results for the {labels[datePreset]}</h3>
      <p className="text-muted-foreground text-sm mt-1 max-w-sm">
        There is tracking data available in other time periods. Try a wider range or switch to
        &quot;All time&quot;.
      </p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onReset}>
        Show all data
      </Button>
    </div>
  );
}

// ─── Tracking Progress ────────────────────────────────────────────────────────

import { saveTrackingJob, loadTrackingJob, clearTrackingJob } from '@/lib/tracking-job-store';
import { toCsv } from '@/lib/csv';

function TrackingProgressBanner({
  jobStatus,
  onStop,
}: {
  jobStatus: TrackingJobStatus | null;
  onStop: () => void;
}) {
  if (!jobStatus) return null;

  const isActive = jobStatus.status === 'active' || jobStatus.status === 'waiting';
  if (!isActive) return null;

  const progress = jobStatus.progress;
  const pct = progress ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-medium">
            {jobStatus.status === 'waiting'
              ? 'Queued — starting automatically'
              : 'Analyzing prompts...'}
          </span>
          {progress && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {progress.current}/{progress.total}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={onStop}
        >
          <StopCircle className="h-3.5 w-3.5" />
          Stop
        </Button>
      </div>

      {jobStatus.status === 'waiting' && (
        <p className="text-xs text-muted-foreground">
          Another analysis is running right now. Yours will begin the moment a slot opens up — no
          need to wait here, it&apos;ll keep going in the background.
        </p>
      )}

      {progress && progress.total > 0 && (
        <>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${Math.max(pct, 2)}%` }}
            />
          </div>
          {progress.promptText && (
            <p className="text-xs text-muted-foreground truncate">
              {progress.model && (
                <span className="font-medium text-foreground">
                  {PLATFORM_LABELS[progress.model] ?? progress.model}
                  {progress.region && <span> · {progress.region}</span>}
                  {' — '}
                </span>
              )}
              {progress.promptText}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const t = useTranslations('insights');
  const router = useRouter();
  const { isCloud } = usePlanContext();
  const brand = useBrandStore((s) => s.getActiveBrand());
  const [summary, setSummary] = useState<InsightsSummary | null>(null);
  const [trackedPrompts, setTrackedPrompts] = useState<TrackedPromptsKpi | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<TrackingJobStatus | null>(null);
  const [showSinglePrompt, setShowSinglePrompt] = useState(false);
  const [filters, setFilters] = useState<InsightsFilters>(DEFAULT_FILTERS);
  const [hasAnyData, setHasAnyData] = useState<boolean | null>(null);
  const [availableRegions, setAvailableRegions] = useState<string[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availableTopics, setAvailableTopics] = useState<Topic[]>([]);
  const [competitorData, setCompetitorData] = useState<CompetitorComparisonData | null>(null);
  const [sovData, setSovData] = useState<ShareOfVoiceData | null>(null);
  const [breakdownMetric, setBreakdownMetric] = useState<BreakdownMetric | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const loadData = useCallback(
    async (overrideFilters?: InsightsFilters, { silent = false } = {}) => {
      if (!brand) return;
      if (!silent) setIsLoading(true);
      try {
        const f = overrideFilters ?? filtersRef.current;
        const { dateFrom, dateTo } = getDateRange(f.datePreset, {
          from: f.dateFrom,
          to: f.dateTo,
        });
        const filterOpts = {
          model: f.model || undefined,
          region: f.region || undefined,
          topicId: f.topic || undefined,
          dateFrom,
          dateTo,
        };

        const hasFilters = Boolean(f.datePreset !== 'all' || f.model || f.region || f.topic);

        // One consolidated server action (#313): summary + competitor + SoV
        // run in a real server-side Promise.all (one round trip instead of
        // five serialized POSTs), and "has any data" comes from a cheap
        // count instead of an unbounded full-table scan.
        const insights = await getInsightsData(brand.id, {
          ...filterOpts,
          checkUnfiltered: hasFilters,
        });
        setSummary(insights.summary);
        setTrackedPrompts(insights.trackedPrompts);
        setCompetitorData(insights.competitors.brands.length > 1 ? insights.competitors : null);
        setSovData(insights.sov.byPlatform.length > 0 ? insights.sov : null);
        setHasAnyData(insights.hasAnyData);

        // Group raw model slugs by their resolved display name so different
        // ChatGPT versions ("gpt-5-3-mini" + "gpt-5-5") collapse into one
        // "ChatGPT" filter option. Stored as `slugA,slugB` so the server can
        // filter the whole family with .in() via applyModelFilter().
        const slugToLabel = new Map<string, string>();
        for (const slug of insights.filterOptions.models) {
          if (slugToLabel.has(slug)) continue;
          const label =
            MODEL_DISPLAY_NAME[slug] ??
            PLATFORM_LABELS[slug] ??
            getAIProviderDisplayName(resolveAIProvider(slug));
          slugToLabel.set(slug, label);
        }
        const familyToSlugs = new Map<string, string[]>();
        for (const [slug, label] of slugToLabel) {
          const arr = familyToSlugs.get(label) ?? [];
          arr.push(slug);
          familyToSlugs.set(label, arr);
        }
        const models = Array.from(familyToSlugs.values())
          .map((slugs) => slugs.sort().join(','))
          .sort();
        setAvailableRegions([...insights.filterOptions.regions].sort((a, b) => a.localeCompare(b)));
        setAvailableModels(models.sort((a, b) => a.localeCompare(b)));
      } catch (err) {
        const message = err instanceof Error ? err.message : '';

        // Next.js surfaces this when a server action's response stream is
        // cut because the user navigated away mid-load. The destination
        // page renders fine; the toast is pure noise. Matched
        // case-insensitively so a wording tweak between Next versions
        // doesn't reopen the issue.
        if (/unexpected response/i.test(message)) {
          console.debug('[insights] load aborted by navigation', err);
        } else if (!silent) {
          toast.error(message || 'Failed to load insights');
        } else {
          // Silent refreshes fire every ~10s while a tracking job runs; a
          // transient 5xx or network blip there shouldn't pop a red toast —
          // the next poll will retry and the user sees nothing.
          console.warn('[insights] silent refresh failed', err);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [brand],
  );

  useEffect(() => {
    if (!brand?.id) return;
    setAvailableRegions([]);
    setAvailableModels([]);
    setAvailableTopics([]);
    const next = { ...filtersRef.current, region: '', model: '', topic: '' };
    filtersRef.current = next;
    setFilters(next);
    getTopics(brand.id)
      .then(setAvailableTopics)
      .catch(() => {});
  }, [brand?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Restore active job from localStorage or URL query param (post-payment redirect)
  const searchParams = useSearchParams();
  useEffect(() => {
    if (!brand) return;

    const urlJobId = searchParams.get('jobId');
    if (urlJobId) {
      saveTrackingJob({ jobId: urlJobId, brandId: brand.id, startedAt: Date.now() });
      setActiveJobId(urlJobId);
      setIsRunning(true);
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    const saved = loadTrackingJob();
    if (saved && saved.brandId === brand.id) {
      setActiveJobId(saved.jobId);
      setIsRunning(true);
    }
  }, [brand, searchParams]);

  // Poll job status while a job is active
  useEffect(() => {
    if (!activeJobId) return;

    let cancelled = false;
    let lastRefresh = 0;
    const poll = async () => {
      while (!cancelled) {
        try {
          const status = await getJobStatus(activeJobId);
          if (cancelled) break;
          setJobStatus(status);

          // Refresh data every ~10s while active so new results appear progressively
          const now = Date.now();
          if (status.status === 'active' && now - lastRefresh > 10_000) {
            lastRefresh = now;
            loadData(undefined, { silent: true });
          }

          if (status.status === 'completed') {
            clearTrackingJob();
            setActiveJobId(null);
            setIsRunning(false);
            setJobStatus(null);
            toast.success(`Analysis complete — ${status.result?.resultCount ?? 0} results saved.`);
            loadData(undefined, { silent: true });
            break;
          }

          if (status.status === 'failed' || status.status === 'not_found') {
            clearTrackingJob();
            setActiveJobId(null);
            setIsRunning(false);
            setJobStatus(null);
            if (status.status === 'failed') {
              toast.error(`Job failed: ${status.failedReason ?? 'Unknown error'}`);
            }
            break;
          }
        } catch {
          // network error, keep polling
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [activeJobId, loadData]);

  const handleFilterChange = (newFilters: InsightsFilters) => {
    setFilters(newFilters);
    loadData(newFilters);
  };

  const handleRunPrompts = async () => {
    if (!brand) return;
    setIsRunning(true);
    try {
      const { jobId } = await triggerTrackingCheck(brand.id);
      saveTrackingJob({ jobId, brandId: brand.id, startedAt: Date.now() });
      setActiveJobId(jobId);
      setJobStatus({
        status: 'waiting',
        progress: null,
        result: null,
        failedReason: null,
      });
    } catch (err) {
      setIsRunning(false);
      toast.error(err instanceof Error ? err.message : 'Failed to trigger tracking');
    }
  };

  const handleStopTracking = async () => {
    if (!activeJobId) return;
    try {
      await cancelTrackingJob(activeJobId);
    } catch {}
    clearTrackingJob();
    setActiveJobId(null);
    setIsRunning(false);
    setJobStatus(null);
    toast.success('Tracking stopped');
    loadData(undefined, { silent: true });
  };

  const handleJobStarted = (jobId: string) => {
    if (!brand) return;
    setIsRunning(true);
    saveTrackingJob({ jobId, brandId: brand.id, startedAt: Date.now() });
    setActiveJobId(jobId);
    setJobStatus({
      status: 'waiting',
      progress: null,
      result: null,
      failedReason: null,
    });
  };

  const handleExportCsv = useCallback(async () => {
    if (!brand) return;
    setIsExporting(true);
    try {
      const f = filtersRef.current;
      const { dateFrom, dateTo } = getDateRange(f.datePreset, {
        from: f.dateFrom,
        to: f.dateTo,
      });
      const filterOpts = {
        model: f.model || undefined,
        region: f.region || undefined,
        topicId: f.topic || undefined,
        dateFrom,
        dateTo,
      };

      const { results: allResults, isCapped } = await exportPromptResults(brand.id, filterOpts);

      const rows: Record<string, string | number>[] = allResults.map((r) => ({
        created_at: r.createdAt,
        prompt: r.promptText,
        topic: r.topicName ?? '',
        platform: PLATFORM_LABELS[r.platform] ?? r.platform,
        model: r.modelUsed ?? '',
        region: r.region ?? '',
        mention_count: r.mentionCount,
        citation_count: r.citationCount,
        visibility_score: r.visibilityScore,
        sentiment: r.sentiment,
        citation_urls: r.citations.map((c) => c.url).join(', '),
        competitor_mentions:
          r.competitorMentions?.map((c) => `${c.name}:${c.mention_count}`).join(', ') ?? '',
      }));

      if (isCapped) {
        rows.push({
          created_at: 'WARNING',
          prompt: 'Export capped at 50,000 rows',
          topic: '',
          platform: '',
          model: '',
          region: '',
          mention_count: 0,
          citation_count: 0,
          visibility_score: 0,
          sentiment: '',
          citation_urls: '',
          competitor_mentions: '',
        });
        toast.warning('Export capped at 50,000 rows to prevent memory issues');
      }

      const csv = toCsv(rows, INSIGHT_EXPORT_HEADERS);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      const slug = brand.slug ?? 'brand';

      link.href = url;
      link.download = `ansvisor_${slug}_insights_${date}.csv`;
      link.click();

      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export CSV');
    } finally {
      setIsExporting(false);
    }
  }, [brand]);

  if (!brand || (isLoading && !summary)) return <InsightsSkeleton />;

  const noResults = !summary || summary.totalResults === 0;
  const trulyEmpty = noResults && !hasAnyData;

  if (trulyEmpty) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{brand.name}</p>
        </div>
        <TrackingProgressBanner jobStatus={jobStatus} onStop={handleStopTracking} />
        <EmptyState onRunPrompts={handleRunPrompts} isRunning={isRunning} isCloud={isCloud} />
        {!isCloud && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => setShowSinglePrompt(true)} className="gap-2">
              <FlaskConical className="h-4 w-4" />
              Or test a single prompt
            </Button>
          </div>
        )}
        <RunSinglePromptDialog
          brandId={brand.id}
          open={showSinglePrompt}
          onClose={() => setShowSinglePrompt(false)}
          onJobStarted={handleJobStarted}
        />
      </div>
    );
  }

  const lastCheckedLabel = summary?.lastCheckedAt
    ? formatTimeAgo(new Date(summary.lastCheckedAt))
    : 'Never';

  const handleResetFilters = () => {
    const resetFilters = { ...DEFAULT_FILTERS };
    setFilters(resetFilters);
    loadData(resetFilters);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>

          <p className="text-muted-foreground text-sm">
            {brand.name} · Last run: {lastCheckedLabel}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Always visible */}
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleExportCsv}
            disabled={isExporting}
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {isExporting ? 'Exporting...' : 'Export CSV'}
          </Button>

          {/* Self-host only */}
          {!isCloud && (
            <>
              <Button variant="outline" onClick={() => setShowSinglePrompt(true)} className="gap-2">
                <FlaskConical className="h-4 w-4" />
                Test Single Prompt
              </Button>

              <Button onClick={handleRunPrompts} disabled={isRunning} className="gap-2">
                {isRunning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Run All
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <FilterBar
        filters={filters}
        onChange={handleFilterChange}
        availableRegions={availableRegions}
        availableModels={availableModels}
        availableTopics={availableTopics}
      />

      {/* Tracking Progress */}
      <TrackingProgressBanner jobStatus={jobStatus} onStop={handleStopTracking} />

      {noResults ? (
        <NoDataForPeriod datePreset={filters.datePreset} onReset={handleResetFilters} />
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
            <KpiCard
              title="Visibility Score"
              tooltip="A composite score (0–100) reflecting how prominently your brand appears across AI engine responses. Combines mentions, citations, and sentiment."
              icon={BarChart3}
              value={summary!.avgVisibilityScore}
              sub={<DeltaBadge delta={summary!.visibilityChange} suffix=" pts" />}
              subVariant={
                summary!.visibilityChange !== null && summary!.visibilityChange > 0
                  ? 'positive'
                  : 'muted'
              }
              onClick={() => setBreakdownMetric('visibility')}
            />
            <KpiCard
              title="Tracked Prompts"
              tooltip="Distinct prompts that produced tracked results in the selected period and filters. The quota below is current usage across your organization — it does not change with the date range."
              icon={Layers}
              value={trackedPrompts?.activeInPeriod ?? 0}
              sub={
                trackedPrompts && trackedPrompts.quotaLimit !== -1 ? (
                  <>
                    <span className="tabular-nums">
                      {trackedPrompts.quotaUsed} / {trackedPrompts.quotaLimit} prompts
                    </span>
                    {trackedPrompts.quotaUsed >= trackedPrompts.quotaLimit * 0.9 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push('/dashboard/settings');
                        }}
                        className="ml-1 underline underline-offset-2 hover:text-foreground"
                      >
                        Upgrade
                      </button>
                    )}
                  </>
                ) : (
                  `${trackedPrompts?.quotaUsed ?? 0} prompts tracked`
                )
              }
              onClick={() => router.push('/dashboard/prompts')}
            />
            <KpiCard
              title="Mentions"
              tooltip="How many times your brand was referenced by name in AI-generated responses."
              icon={Zap}
              value={summary!.totalMentions}
              sub={<DeltaBadge delta={summary!.mentionsChange} />}
              subVariant={
                summary!.mentionsChange !== null && summary!.mentionsChange > 0
                  ? 'positive'
                  : 'muted'
              }
              onClick={() => setBreakdownMetric('mentions')}
            />
            <KpiCard
              title="Citations"
              tooltip="Times your brand's domain was cited as a source with a direct link in AI responses."
              icon={Quote}
              value={summary!.totalCitations}
              sub={<DeltaBadge delta={summary!.citationsChange} />}
              subVariant={
                summary!.citationsChange !== null && summary!.citationsChange > 0
                  ? 'positive'
                  : 'muted'
              }
              onClick={() => router.push('/dashboard/citations')}
            />
            <KpiCard
              title="Positive Sentiment"
              tooltip="Percentage of AI responses that described your brand in a positive context."
              icon={AlertCircle}
              value={`${summary!.positiveSentimentPct}%`}
              sub={<DeltaBadge delta={summary!.sentimentChange} suffix=" pts" />}
              subVariant={
                summary!.sentimentChange !== null && summary!.sentimentChange > 0
                  ? 'positive'
                  : 'muted'
              }
            />
          </div>

          {/* Competitor Comparison */}
          {competitorData && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
              <Card className="lg:col-span-3">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <Users className="h-4 w-4" />
                    AI Visibility — Brand vs Competitors
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CompetitorChart
                    providerRows={competitorData.providerRows}
                    brands={competitorData.brands}
                  />
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Leaderboard</CardTitle>
                </CardHeader>
                <CardContent>
                  <CompetitorLeaderboard data={competitorData.brands} />
                </CardContent>
              </Card>
            </div>
          )}

          {/* Share of Voice */}
          {sovData && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <PieChart className="h-4 w-4" />
                    Share of Voice by Platform
                  </CardTitle>
                  {sovData.overallSovChange !== null && sovData.overallSovChange !== 0 && (
                    <DeltaBadge delta={sovData.overallSovChange} suffix=" pts" />
                  )}
                </CardHeader>
                <CardContent>
                  <ShareOfVoicePlatformChart
                    data={sovData.byPlatform}
                    overallSov={sovData.overallSov}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <TrendingUp className="h-4 w-4" />
                    Share of Voice Trend
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ShareOfVoiceTrendChart data={sovData.trend} />
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {/* Single Prompt Runner */}
      <RunSinglePromptDialog
        brandId={brand.id}
        open={showSinglePrompt}
        onClose={() => setShowSinglePrompt(false)}
        onJobStarted={handleJobStarted}
      />

      {/* Metric Breakdown Drilldown */}
      <MetricBreakdownSheet
        brandId={brand.id}
        metric={breakdownMetric}
        onOpenChange={(open) => {
          if (!open) setBreakdownMetric(null);
        }}
        filters={(() => {
          const { dateFrom, dateTo } = getDateRange(filters.datePreset, {
            from: filters.dateFrom,
            to: filters.dateTo,
          });
          return {
            dateFrom,
            dateTo,
            region: filters.region || undefined,
            model: filters.model || undefined,
            topicId: filters.topic || undefined,
          };
        })()}
      />
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
