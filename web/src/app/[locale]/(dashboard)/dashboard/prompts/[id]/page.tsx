'use client';

import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useParams } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import {
  getPromptDetail,
  type PromptDetailData,
  type PromptResultWithText,
  type PromptTopSource,
  type PromptTopSourceUrl,
} from '@/lib/actions/tracking';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft,
  ChevronDown,
  Clock,
  ExternalLink,
  Eye,
  Loader2,
  MessageSquareText,
  Quote,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/use-user-role';
import { AIProviderAvatar, resolveAIProvider } from '@/components/ai-provider-avatar';
import { WorkStatusBadge } from '@/components/prompts/work-status';
import {
  getPromptWorkflow,
  setPromptWorkStatus,
  type PromptNote,
  type PromptTargetUrl,
  type PromptWorkStatus,
} from '@/lib/actions/prompt-workflow';
import { NotesCard, TargetUrlsCard } from './_workflow-cards';
import {
  CategoryBadge,
  DomainFavicon,
  PlatformsCell,
  UsageBar,
} from '@/components/citations/source-cells';
import { TablePager, usePagination } from '@/components/table-pager';
import { MODEL_PROVIDER_LABELS, PLATFORM_LABELS } from '@/config/platform-labels';
import { groupByPlatform, type PlatformGroup } from './grouping';

// ─── Date range (kept in sync with the insights page filter bar) ─────────────

type DatePreset = '24h' | '7d' | '30d' | '90d' | 'all' | 'custom';

const DATE_PRESETS: DatePreset[] = ['24h', '7d', '30d', '90d', 'all', 'custom'];

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

function DateRangeBar({
  preset,
  customFrom,
  customTo,
  onPreset,
  onCustomFrom,
  onCustomTo,
}: {
  preset: DatePreset;
  customFrom: string;
  customTo: string;
  onPreset: (p: DatePreset) => void;
  onCustomFrom: (v: string) => void;
  onCustomTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Date Range</label>
        <div className="flex overflow-hidden rounded-md border">
          {DATE_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPreset(p)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                preset === p
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card hover:bg-muted text-foreground',
              )}
            >
              {p === 'custom' ? 'Custom' : p === 'all' ? 'All' : p}
            </button>
          ))}
        </div>
      </div>
      {preset === 'custom' && (
        <>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">From</label>
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => onCustomFrom(e.target.value)}
              className="h-8 w-36 text-xs"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">To</label>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => onCustomTo(e.target.value)}
              className="h-8 w-36 text-xs"
            />
          </div>
        </>
      )}
    </div>
  );
}

function getModelDisplayName(model?: string, platform?: string): string {
  if (model && MODEL_PROVIDER_LABELS[model]) return MODEL_PROVIDER_LABELS[model];
  if (platform && PLATFORM_LABELS[platform]) return PLATFORM_LABELS[platform];
  return model ?? platform ?? 'Unknown';
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function SentimentBadge({ sentiment }: { sentiment: 'positive' | 'neutral' | 'negative' }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-xs capitalize',
        sentiment === 'positive' &&
          'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
        sentiment === 'neutral' &&
          'border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
        sentiment === 'negative' &&
          'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
      )}
    >
      {sentiment}
    </Badge>
  );
}

function ModelBadge({ model, platform }: { model?: string; platform?: string }) {
  const provider = resolveAIProvider(model ?? platform ?? '', platform);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-1">
      <AIProviderAvatar provider={provider} className="h-4 w-4" />
      <span className="text-xs">{getModelDisplayName(model, platform)}</span>
    </span>
  );
}

function VisibilityBar({ score }: { score: number }) {
  const rounded = Math.round(score);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full',
            rounded >= 70 ? 'bg-emerald-500' : rounded >= 40 ? 'bg-amber-500' : 'bg-red-500',
          )}
          style={{ width: `${Math.min(100, Math.max(0, rounded))}%` }}
        />
      </div>
      <span className="w-8 text-right text-xs font-semibold tabular-nums">{rounded}</span>
    </div>
  );
}

function KpiCard({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <Icon className="h-5 w-5 text-muted-foreground" />
        <div>
          <p className="text-2xl font-bold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{title}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function TopSourceDomainsTable({ rows }: { rows: PromptTopSource[] }) {
  const pager = usePagination(rows.length, rows.length);
  const pageRows = rows.slice(pager.start, pager.end);

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[56px] text-xs">Rank</TableHead>
            <TableHead className="text-xs">Domain</TableHead>
            <TableHead className="text-xs">Platforms</TableHead>
            <TableHead className="text-xs">Usage</TableHead>
            <TableHead className="text-right text-xs">Citations</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.map((row, i) => (
            <TableRow key={row.domain}>
              {/* Global rank — offset by page so rank is continuous across pages */}
              <TableCell className="text-xs text-muted-foreground tabular-nums">
                {pager.start + i + 1}
              </TableCell>
              <TableCell>
                <div className="flex min-w-0 items-center gap-2">
                  <DomainFavicon domain={row.domain} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{row.domain}</span>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <CategoryBadge category={row.category} />
                      <a
                        href={`https://${row.domain}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center text-muted-foreground hover:text-foreground"
                        aria-label={`Open ${row.domain} in a new tab`}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <PlatformsCell models={row.models} />
              </TableCell>
              <TableCell>
                <UsageBar pct={row.usagePct} />
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {row.totalCitations}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePager
        page={pager.page}
        totalPages={pager.totalPages}
        total={rows.length}
        start={pager.start}
        end={pager.end}
        onPage={pager.setPage}
      />
    </div>
  );
}

function TopSourceUrlsTable({ rows }: { rows: PromptTopSourceUrl[] }) {
  const pager = usePagination(rows.length, rows.length);
  const pageRows = rows.slice(pager.start, pager.end);

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[56px] text-xs">Rank</TableHead>
            <TableHead className="text-xs">URL</TableHead>
            <TableHead className="text-xs">Platforms</TableHead>
            <TableHead className="text-xs">Usage</TableHead>
            <TableHead className="text-right text-xs">Citations</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.map((row, i) => (
            <TableRow key={row.url}>
              {/* Global rank — offset by page so rank is continuous across pages */}
              <TableCell className="text-xs text-muted-foreground tabular-nums">
                {pager.start + i + 1}
              </TableCell>
              <TableCell>
                <div className="flex min-w-0 items-start gap-2">
                  <DomainFavicon domain={row.domain} />
                  <div className="flex min-w-0 max-w-[480px] flex-col">
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="truncate text-sm font-medium text-foreground hover:underline"
                      title={row.title || row.url}
                    >
                      {row.title || row.url}
                    </a>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <span className="truncate text-[11px] text-muted-foreground">
                        {row.domain}
                      </span>
                      <CategoryBadge category={row.category} />
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <PlatformsCell models={row.models} />
              </TableCell>
              <TableCell>
                <UsageBar pct={row.usagePct} />
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {row.totalCitations}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePager
        page={pager.page}
        totalPages={pager.totalPages}
        total={rows.length}
        start={pager.start}
        end={pager.end}
        onPage={pager.setPage}
      />
    </div>
  );
}

function TopSourcesCard({
  sources,
  sourceUrls,
}: {
  sources: PromptTopSource[];
  sourceUrls: PromptTopSourceUrl[];
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Top Sources</CardTitle>
        <p className="text-xs text-muted-foreground">
          Sources AI platforms cite when answering this prompt.
        </p>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="domains">
          <TabsList>
            <TabsTrigger value="domains">Domains ({sources.length})</TabsTrigger>
            <TabsTrigger value="urls">URLs ({sourceUrls.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="domains" keepMounted className="mt-4">
            <TopSourceDomainsTable rows={sources} />
          </TabsContent>
          <TabsContent value="urls" keepMounted className="mt-4">
            <TopSourceUrlsTable rows={sourceUrls} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function PlatformResultGroup({
  group,
  expanded,
  onToggle,
  onViewResult,
}: {
  group: PlatformGroup;
  expanded: boolean;
  onToggle: () => void;
  onViewResult: (result: PromptResultWithText) => void;
}) {
  const visibleRuns = group.results.slice(0, 10);
  const hiddenCount = group.results.length - visibleRuns.length;

  return (
    <div className="overflow-hidden rounded-lg border">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
        className="flex cursor-pointer select-none items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
      >
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            !expanded && '-rotate-90',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <ModelBadge model={group.modelUsed ?? group.platform} platform={group.platform} />
            {group.region && (
              <Badge variant="outline" className="text-[10px]">
                {group.region}
              </Badge>
            )}
            <span className="text-[11px] text-muted-foreground">
              {group.results.length} run{group.results.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <div className="hidden items-center gap-5 sm:flex">
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">Mentions</p>
            <p className="text-xs font-semibold tabular-nums">{group.totalMentions}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">Citations</p>
            <p className="text-xs font-semibold tabular-nums">{group.totalCitations}</p>
          </div>
          <div className="w-32">
            <VisibilityBar score={group.avgScore} />
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t bg-muted/10 px-4 py-3">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Runs
          </p>
          <div className="overflow-hidden rounded-md border bg-background">
            {visibleRuns.map((result, index) => (
              <div
                key={result.id}
                className={cn(
                  'grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-xs sm:grid-cols-[1.4fr_90px_90px_100px_140px_40px] sm:items-center',
                  index > 0 && 'border-t',
                )}
              >
                <div className="min-w-0 text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatTimestamp(result.createdAt)}
                  </span>
                </div>
                <div className="hidden text-center tabular-nums sm:block">
                  <span className="font-semibold">{result.mentionCount}</span>
                  <span className="text-muted-foreground"> mentions</span>
                </div>
                <div className="hidden text-center tabular-nums sm:block">
                  <span className="font-semibold">{result.citationCount}</span>
                  <span className="text-muted-foreground"> citations</span>
                </div>
                <div className="hidden justify-center sm:flex">
                  <SentimentBadge sentiment={result.sentiment} />
                </div>
                <div className="hidden sm:block">
                  <VisibilityBar score={result.visibilityScore} />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 justify-self-end"
                  title="View response detail"
                  onClick={(event) => {
                    event.stopPropagation();
                    onViewResult(result);
                  }}
                  aria-label="View response details"
                >
                  <Eye className="h-3.5 w-3.5" />
                </Button>
                <div className="col-span-2 flex flex-wrap items-center gap-2 sm:hidden">
                  <span className="tabular-nums">
                    <span className="font-semibold">{result.mentionCount}</span>
                    <span className="text-muted-foreground"> mentions</span>
                  </span>
                  <span className="tabular-nums">
                    <span className="font-semibold">{result.citationCount}</span>
                    <span className="text-muted-foreground"> citations</span>
                  </span>
                  <SentimentBadge sentiment={result.sentiment} />
                  <div className="w-32">
                    <VisibilityBar score={result.visibilityScore} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          {hiddenCount > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing latest {visibleRuns.length} of {group.results.length} runs for this platform.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function PromptDetailPage() {
  const params = useParams();
  const router = useRouter();
  const promptId = params.id as string;

  const { canManage } = useUserRole();

  const [data, setData] = useState<PromptDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [datePreset, setDatePreset] = useState<DatePreset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [workStatus, setWorkStatus] = useState<PromptWorkStatus | null>(null);
  const [notes, setNotes] = useState<PromptNote[]>([]);
  const [targetUrls, setTargetUrls] = useState<PromptTargetUrl[]>([]);

  // Workflow data is independent of the date window — load it once per
  // prompt, outside the main load cycle, so date changes don't refetch it.
  useEffect(() => {
    let cancelled = false;
    getPromptWorkflow(promptId)
      .then((wf) => {
        if (cancelled) return;
        setWorkStatus(wf.workStatus);
        setNotes(wf.notes);
        setTargetUrls(wf.targetUrls);
      })
      .catch((err) => console.error('Failed to load prompt workflow:', err));
    return () => {
      cancelled = true;
    };
  }, [promptId]);

  const handleStatusChange = (status: PromptWorkStatus | null) => {
    const previous = workStatus;
    setWorkStatus(status);
    setPromptWorkStatus(promptId, status).catch(() => {
      setWorkStatus(previous);
      toast.error('Failed to update status');
    });
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { dateFrom, dateTo } = getDateRange(datePreset, { from: customFrom, to: customTo });
      const detail = await getPromptDetail(promptId, { dateFrom, dateTo });
      if (cancelled) return;
      if (!detail) {
        setNotFound(true);
      } else {
        setData(detail);
        const groups = groupByPlatform(detail.results);
        setExpanded(new Set(groups.length > 0 ? [groups[0].key] : []));
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [promptId, datePreset, customFrom, customTo]);

  const platformGroups = useMemo(() => groupByPlatform(data?.results ?? []), [data?.results]);

  const togglePlatform = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // First load renders the skeleton (data is still null); once data has ever
  // arrived, a reload from a date change is a "refetch" — the stale content
  // stays visible under the overlay instead of flashing a skeleton (#494).
  const isRefetching = loading && data !== null;

  if (loading && !data && !notFound) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-2 sm:p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-full max-w-3xl" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <MessageSquareText className="mb-4 h-12 w-12 text-muted-foreground/40" />
        <h2 className="text-lg font-semibold">Prompt not found</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This prompt may have been deleted or does not exist.
        </p>
        <Button variant="outline" className="mt-6 gap-2" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
          Go back
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-2 sm:p-6">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 gap-2 text-muted-foreground hover:text-foreground"
        onClick={() => router.back()}
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Button>

      <div className="space-y-3">
        <h1 className="text-xl font-semibold leading-snug">{data.prompt.text}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {data.prompt.topicName && (
            <Badge variant="secondary" className="text-xs">
              {data.prompt.topicName}
            </Badge>
          )}
          <Badge
            variant="outline"
            className={cn(
              'text-xs',
              data.prompt.isActive
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'border-muted-foreground/20 text-muted-foreground',
            )}
          >
            {data.prompt.isActive ? 'Active' : 'Paused'}
          </Badge>
          {data.summary.lastCheckedAt && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Clock className="h-3 w-3" />
              Last run: {formatTimestamp(data.summary.lastCheckedAt)}
            </Badge>
          )}
          <WorkStatusBadge
            status={workStatus}
            onChange={canManage ? handleStatusChange : undefined}
          />
        </div>
      </div>

      <DateRangeBar
        preset={datePreset}
        customFrom={customFrom}
        customTo={customTo}
        onPreset={setDatePreset}
        onCustomFrom={setCustomFrom}
        onCustomTo={setCustomTo}
      />

      {/* Refetch overlay: on a date change the previous window's data stays
          mounted; dim it and float a spinner so stale numbers aren't read as
          the new period's. The date bar stays outside, so switching presets
          mid-load keeps working (#494). */}
      <div className="relative">
        {isRefetching && (
          <div className="absolute inset-0 z-10 flex items-start justify-center rounded-lg bg-background/50 pt-32">
            <div className="flex items-center rounded-md border bg-background p-2.5 shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div className={cn('space-y-6', isRefetching && 'opacity-60')}>
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard
              title="Visibility Score"
              value={`${data.summary.avgVisibilityScore}/100`}
              icon={Eye}
            />
            <KpiCard
              title="Mentions"
              value={data.summary.totalMentions.toLocaleString()}
              icon={MessageSquareText}
            />
            <KpiCard
              title="Citations"
              value={data.summary.totalCitations.toLocaleString()}
              icon={Quote}
            />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Platform Results</CardTitle>
              <p className="text-xs text-muted-foreground">
                {data.summary.totalResults} result{data.summary.totalResults !== 1 ? 's' : ''}{' '}
                grouped by platform and model.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {platformGroups.length === 0 ? (
                <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                  {datePreset === 'all' ? (
                    'No tracking results yet for this prompt.'
                  ) : (
                    <>
                      No results in the selected date range.{' '}
                      <button
                        type="button"
                        className="font-medium text-foreground underline underline-offset-2"
                        onClick={() => setDatePreset('all')}
                      >
                        Show all data
                      </button>
                    </>
                  )}
                </div>
              ) : (
                platformGroups.map((group) => (
                  <PlatformResultGroup
                    key={group.key}
                    group={group}
                    expanded={expanded.has(group.key)}
                    onToggle={() => togglePlatform(group.key)}
                    onViewResult={(result) => router.push(`/dashboard/insights/${result.id}`)}
                  />
                ))
              )}
            </CardContent>
          </Card>

          {data.topSources.length > 0 && (
            <TopSourcesCard sources={data.topSources} sourceUrls={data.topSourceUrls} />
          )}
        </div>
      </div>

      {/* Workflow — outside the refetch overlay: notes and target URLs are
          date-window independent. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <NotesCard
          promptId={promptId}
          notes={notes}
          onNotesChange={setNotes}
          canManage={canManage}
        />
        <TargetUrlsCard
          promptId={promptId}
          urls={targetUrls}
          onUrlsChange={setTargetUrls}
          canManage={canManage}
        />
      </div>
    </div>
  );
}
