'use client';

/**
 * Per-URL citation detail page (#535): everything one cited URL is doing for
 * the brand — the answers citing it, the prompts triggering it and, for
 * brand-owned URLs, the targeting + AI-referred traffic bridges. Keyed by
 * `?u=<encoded-url>`; scoped by the shared citations filter bar so counts
 * agree with the overview for the same URL, window and filters.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { useBrandStore } from '@/stores/use-brand-store';
import {
  getCitationUrlDetail,
  type CitationsDatePreset,
  type CitationsFilters,
  type CitationUrlDetail,
} from '@/lib/actions/citations';
import {
  CitationsFilterBar,
  DEFAULT_CITATIONS_FILTERS,
  buildPlatformOptions,
  getDateRange,
  getPlatformDisplayLabel,
  type CitationsUIFilters,
} from '@/components/citations/filter-bar';
import { AddCompetitorButton } from '@/components/citations/add-competitor-button';
import { CategoryBadge, DomainFavicon, PlatformsCell } from '@/components/citations/source-cells';
import { PositionLabel } from '@/components/position-label';
import { TablePager, usePagination } from '@/components/table-pager';
import { Badge } from '@/components/ui/badge';
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
import {
  ArrowLeft,
  Check,
  Clock,
  ExternalLink,
  Layers,
  ListChecks,
  MessagesSquare,
  Quote,
  Target,
  TrendingUp,
} from 'lucide-react';
import { formatDate, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { HeaderWithAiUsage } from '@/components/ai-usage/ai-usage-meter';
import { useTranslations } from 'next-intl';
import { useChatPageContext } from '@/components/chat/panel/chat-panel-context';
import { rangeChipLabel } from '@/lib/chat/page-context';
import { formatRegionDisplay } from '@/lib/region';

const CITED_IN_PAGE_SIZE = 10;
const DATE_PRESET_VALUES: CitationsDatePreset[] = ['24h', '7d', '30d', '90d', 'all', 'custom'];

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
}: {
  title: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
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
        <div className="text-2xl font-bold tabular-nums truncate">{value}</div>
        <p className="text-xs mt-1 text-muted-foreground truncate">{sub}</p>
      </CardContent>
    </Card>
  );
}

function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  const t = useTranslations('citations.url.sentiments');
  if (!sentiment) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[10px] font-medium capitalize',
        sentiment === 'positive' &&
          'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        sentiment === 'negative' &&
          'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
      )}
    >
      {t.has(sentiment) ? t(sentiment) : sentiment}
    </Badge>
  );
}

export default function CitationUrlDetailPage() {
  const { getActiveBrand } = useBrandStore();
  const brand = getActiveBrand();
  const searchParams = useSearchParams();
  const targetUrl = searchParams.get('u') ?? '';

  const [filters, setFilters] = useState<CitationsUIFilters>(() => {
    const presetParam = searchParams.get('preset');
    const preset = DATE_PRESET_VALUES.includes(presetParam as CitationsDatePreset)
      ? (presetParam as CitationsDatePreset)
      : DEFAULT_CITATIONS_FILTERS.datePreset;
    return {
      ...DEFAULT_CITATIONS_FILTERS,
      datePreset: preset,
      dateFrom: searchParams.get('from') ?? '',
      dateTo: searchParams.get('to') ?? '',
      platform: searchParams.get('platform') ?? '',
      region: searchParams.get('region') ?? '',
    };
  });
  const [data, setData] = useState<CitationUrlDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const activeBrandId = brand?.id ?? null;
  const filterKey = JSON.stringify(filters);
  const citedInPager = usePagination(data?.occurrences.length ?? 0, filterKey, CITED_IN_PAGE_SIZE);
  const promptGroupsPager = usePagination(
    data?.promptGroups.length ?? 0,
    filterKey,
    CITED_IN_PAGE_SIZE,
  );

  const apiFilters = useMemo<CitationsFilters>(() => {
    const { dateFrom, dateTo } = getDateRange(filters.datePreset, {
      from: filters.dateFrom,
      to: filters.dateTo,
    });
    return {
      datePreset: filters.datePreset,
      dateFrom,
      dateTo,
      platforms: filters.platform ? [filters.platform] : undefined,
      regions: filters.region ? [filters.region] : undefined,
    };
  }, [filters.datePreset, filters.dateFrom, filters.dateTo, filters.platform, filters.region]);

  const loadData = useCallback(async () => {
    if (!activeBrandId || !targetUrl) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadFailed(false);
    try {
      setData(await getCitationUrlDetail(activeBrandId, targetUrl, apiFilters));
    } catch {
      setData(null);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [activeBrandId, targetUrl, apiFilters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const platformOptions = useMemo(
    () => (data ? buildPlatformOptions([{ models: data.totals.models }]) : []),
    [data],
  );

  // Chat's side panel sees the page (the owner's plan of 2026-11-16, step 9): its period and
  // filters; the panel adds its address (?u=), which it holds open, from the URL.
  const tChatPanel = useTranslations('chatPanel');
  const t = useTranslations('citations.url');
  useChatPageContext(
    brand && targetUrl
      ? {
          pageName: tChatPanel('pageNames.citedPage'),
          dateRange: {
            from: filters.datePreset === 'custom' ? filters.dateFrom : filters.datePreset,
            to: filters.datePreset === 'custom' ? filters.dateTo : null,
            label: rangeChipLabel(
              filters.datePreset,
              { from: filters.dateFrom, to: filters.dateTo },
              (key, values) => tChatPanel(`range.${key}`, values),
            ),
          },
          filters: [
            ...(filters.platform
              ? [
                  {
                    key: 'platform',
                    label: getPlatformDisplayLabel(filters.platform),
                    value: filters.platform,
                  },
                ]
              : []),
            ...(filters.region
              ? [
                  {
                    key: 'region',
                    label: formatRegionDisplay(filters.region),
                    value: filters.region,
                  },
                ]
              : []),
          ],
        }
      : null,
  );

  const pageOccurrences = data?.occurrences.slice(citedInPager.start, citedInPager.end) ?? [];
  const pagePromptGroups =
    data?.promptGroups.slice(promptGroupsPager.start, promptGroupsPager.end) ?? [];

  if (!targetUrl) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-muted-foreground">{t('noUrl')}</p>
      </div>
    );
  }

  if (!brand) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-muted-foreground">{t('noBrand')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div>
          {/* The back link's line takes the page's button, beside Ask Chat. */}
          <div className="flex items-center justify-between gap-3">
            <BackLink />
            <div className="shrink-0">
              {data &&
                (data.category === 'you' ? (
                  <Badge className="border border-primary/30 bg-primary/10 text-foreground">
                    {t('owned')}
                  </Badge>
                ) : (
                  <AddCompetitorButton
                    brandId={brand.id}
                    domain={data.domain}
                    onAdded={loadData}
                    appearance="button"
                  />
                ))}
            </div>
          </div>
          {/* Header */}
          <div className="mt-2 flex items-start gap-3 min-w-0">
            <div className="pt-1">
              <DomainFavicon domain={data?.domain || extractDisplayHost(targetUrl)} />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight leading-tight break-all">
                {data?.title || targetUrl}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <a
                  href={targetUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex max-w-[560px] items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  <span className="truncate">{targetUrl}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
                {data && <CategoryBadge category={data.category} />}
                {data?.articleType && (
                  <Badge variant="outline" className="text-[10px] font-medium">
                    {data.articleType}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>
      </HeaderWithAiUsage>

      {/* Filters */}
      <CitationsFilterBar
        filters={filters}
        onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
        platforms={platformOptions}
        regions={[]}
      />

      {loading ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[104px]" />
            ))}
          </div>
          <Skeleton className="h-[320px]" />
        </div>
      ) : !data || data.totals.answers === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            {loadFailed ? t('loadFailed') : t('empty')}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard
              title={t('kpis.citations')}
              value={formatNumber(data.totals.citations)}
              sub={t('kpis.citationsSub', { answers: data.totals.answers })}
              icon={Quote}
            />
            <KpiCard
              title={t('kpis.answers')}
              value={formatNumber(data.totals.answers)}
              sub={t('kpis.answersSub')}
              icon={MessagesSquare}
            />
            <KpiCard
              title={t('kpis.prompts')}
              value={formatNumber(data.totals.prompts)}
              sub={t('kpis.promptsSub')}
              icon={ListChecks}
            />
            <KpiCard
              title={t('kpis.platforms')}
              value={String(
                new Set(data.totals.models.map((m) => getPlatformDisplayLabel(m))).size,
              )}
              sub={Array.from(new Set(data.totals.models.map((m) => getPlatformDisplayLabel(m))))
                .sort()
                .join(', ')}
              icon={Layers}
            />
            <KpiCard
              title={t('kpis.lastSeen')}
              value={formatDate(data.totals.lastSeen)}
              sub={t('kpis.firstSeen', { date: formatDate(data.totals.firstSeen) })}
              icon={Clock}
            />
          </div>

          {/* Owned-URL bridges */}
          {data.owned && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    {t('targeted', { count: data.owned.targetingPrompts.length })}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">{t('targetedSub')}</p>
                </CardHeader>
                <CardContent>
                  {data.owned.targetingPrompts.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      {t('notTargeted')}
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {data.owned.targetingPrompts.map((tp) => (
                        <li key={tp.promptId} className="flex items-center gap-3 py-2">
                          <Link
                            href={`/dashboard/prompts/${tp.promptId}`}
                            className="flex-1 truncate text-sm hover:underline"
                            title={tp.promptText}
                          >
                            {tp.promptText}
                          </Link>
                          {tp.label && (
                            <Badge variant="outline" className="text-[10px] shrink-0">
                              {tp.label}
                            </Badge>
                          )}
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {t('citedCount', { count: tp.citedCount })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    {t('visits')}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">{t('visitsSub')}</p>
                </CardHeader>
                <CardContent>
                  {data.owned.traffic.totalVisits === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      {t('noVisits')}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-2xl font-bold tabular-nums">
                        {formatNumber(data.owned.traffic.totalVisits)}
                      </div>
                      <ul className="space-y-1.5">
                        {data.owned.traffic.byPlatform.map((p) => (
                          <li key={p.platform} className="flex items-center gap-2 text-xs">
                            <span className="flex-1 truncate capitalize">
                              {p.platform === 'unknown'
                                ? t('unknownPlatform')
                                : getPlatformDisplayLabel(p.platform)}
                            </span>
                            <span className="tabular-nums text-muted-foreground">{p.visits}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Cited-in list */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('citedIn')}</CardTitle>
              <p className="text-xs text-muted-foreground">{t('citedInSub')}</p>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="ps-6 text-xs">{t('columns.date')}</TableHead>
                    <TableHead className="text-xs">{t('columns.platform')}</TableHead>
                    <TableHead className="text-xs">{t('columns.prompt')}</TableHead>
                    <TableHead className="text-xs">{t('columns.sentiment')}</TableHead>
                    <TableHead className="text-xs">{t('columns.brandMentioned')}</TableHead>
                    <TableHead className="pe-6 text-xs">{t('columns.position')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageOccurrences.map((o) => (
                    <TableRow key={o.resultId}>
                      <TableCell className="ps-6 text-xs tabular-nums whitespace-nowrap">
                        {formatDate(o.createdAt)}
                      </TableCell>
                      <TableCell>
                        <PlatformsCell models={[o.modelUsed || o.platform || ''].filter(Boolean)} />
                      </TableCell>
                      <TableCell className="max-w-[380px]">
                        <Link
                          href={`/dashboard/prompts/${o.promptId}`}
                          className="block truncate text-sm hover:underline"
                          title={o.promptText}
                        >
                          {o.promptText}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <SentimentBadge sentiment={o.sentiment} />
                      </TableCell>
                      <TableCell>
                        {o.brandMentioned ? (
                          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="pe-6">
                        {/* Where in the answer the URL's first citation sits. */}
                        <PositionLabel rank={o.rank} total={o.totalSources} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePager
                page={citedInPager.page}
                totalPages={citedInPager.totalPages}
                total={data.occurrences.length}
                start={citedInPager.start}
                end={citedInPager.end}
                onPage={citedInPager.setPage}
              />
            </CardContent>
          </Card>

          {/* Prompts breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('breakdown')}</CardTitle>
              <p className="text-xs text-muted-foreground">{t('breakdownSub')}</p>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {data.promptGroups.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t('noPrompts')}</p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="ps-6 text-xs">{t('columns.prompt')}</TableHead>
                        <TableHead className="text-end text-xs">{t('columns.answers')}</TableHead>
                        <TableHead className="text-end text-xs">{t('columns.citations')}</TableHead>
                        <TableHead className="pe-6 text-end text-xs">
                          {t('columns.lastSeen')}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagePromptGroups.map((g) => (
                        <TableRow key={g.promptId}>
                          <TableCell className="ps-6 max-w-[520px]">
                            <Link
                              href={`/dashboard/prompts/${g.promptId}`}
                              className="block truncate text-sm hover:underline"
                              title={g.promptText}
                            >
                              {g.promptText}
                            </Link>
                          </TableCell>
                          <TableCell className="text-end text-xs tabular-nums">
                            {g.answers}
                          </TableCell>
                          <TableCell className="text-end text-xs tabular-nums">
                            {g.citations}
                          </TableCell>
                          <TableCell className="pe-6 text-end text-xs tabular-nums whitespace-nowrap">
                            {formatDate(g.lastSeen)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <TablePager
                    page={promptGroupsPager.page}
                    totalPages={promptGroupsPager.totalPages}
                    total={data.promptGroups.length}
                    start={promptGroupsPager.start}
                    end={promptGroupsPager.end}
                    onPage={promptGroupsPager.setPage}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function BackLink() {
  const t = useTranslations('citations.url');
  return (
    <Link
      href="/dashboard/citations"
      className="-ms-2 inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      {t('back')}
    </Link>
  );
}

/** Display-only host fallback while the detail payload is loading. */
function extractDisplayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
