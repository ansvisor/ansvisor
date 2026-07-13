'use client';

import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useParams } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import {
  getPromptDetail,
  type PromptDetailData,
  type PromptResultWithText,
} from '@/lib/actions/tracking';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, ChevronDown, Clock, Eye, MessageSquareText, Quote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AIProviderAvatar, resolveAIProvider } from '@/components/ai-provider-avatar';
import { groupByPlatform, type PlatformGroup } from './grouping';

const PLATFORM_LABELS: Record<string, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
  claude: 'Claude',
  grok: 'Grok',
  copilot: 'Copilot',
  'meta-ai': 'Meta AI',
  'google-ai-overviews': 'Google AI',
  'google-ai-mode': 'Google AI Mode',
  'chatgpt-web': 'ChatGPT',
  'google-aio': 'Google AI Overview',
  'google-aimode': 'Google AI Mode',
  'perplexity-web': 'Perplexity',
  'copilot-web': 'Microsoft Copilot',
  'grok-web': 'Grok',
  'gemini-web': 'Gemini',
};

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

function getModelDisplayName(model?: string, platform?: string): string {
  if (model && MODEL_DISPLAY_NAME[model]) return MODEL_DISPLAY_NAME[model];
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

  const [data, setData] = useState<PromptDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const detail = await getPromptDetail(promptId);
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
  }, [promptId]);

  const platformGroups = useMemo(() => groupByPlatform(data?.results ?? []), [data?.results]);

  const togglePlatform = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (loading) {
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
        </div>
      </div>

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
            {data.summary.totalResults} result{data.summary.totalResults !== 1 ? 's' : ''} grouped
            by platform and model.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {platformGroups.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
              No tracking results yet for this prompt.
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
    </div>
  );
}
