'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { MetricBreakdownSheet, type BreakdownTab } from './_metric-breakdown-sheet';
import { FormulaDialog } from './_formula-dialog';
import { useBrandStore } from '@/stores/use-brand-store';
import { useFirstRun } from '@/hooks/use-first-run';
import { FirstRunEmptyState } from '@/components/first-run/first-run-empty-state';
import { useChatPageContext } from '@/components/chat/panel/chat-panel-context';
import { ReadError } from '@/components/brand-visibility/read-error';
import { readKey } from '@/components/brand-visibility/read-cache';
import {
  TabHeaderActions,
  useBrandRead,
  useBrandVisibilityShell,
} from '@/components/brand-visibility/shell-context';
import { OverviewSkeleton } from '@/components/brand-visibility/tab-skeleton';
import { OVERVIEW_DEFAULT_RANGE } from '@/lib/brand-visibility';
import { largestMove, rangeChipLabel } from '@/lib/chat/page-context';
import {
  type VisibilityRateTrendData,
  exportPromptResults,
  type InsightsData,
  type InsightsSection,
  type InsightsSummary,
  type TrackedPromptsKpi,
  type CompetitorComparisonData,
  type ShareOfVoiceData,
  type BreakdownFilters,
  type BreakdownMetric,
  type CoverageKpi,
} from '@/lib/actions/tracking';
import {
  getBrandFilterOptions,
  getInsightsData,
  getInsightsOpportunities,
  getTopics,
} from '@/lib/visibility-reads';
import { PLATFORM_LABELS } from '@/config/platform-labels';
import { isSingleModel, modelFamilies, modelFamilyValue, modelLabel } from '@/lib/model-families';
import { formatRegionDisplay } from '@/lib/region';
import { mentionsHref } from '@/lib/mentions-filters';
import type { Topic } from '@/types';
import {
  ALL_DATE_PRESETS,
  DateRangeFilter,
  type DateRangePreset,
} from '@/components/filters/date-range-filter';
import { getDateRange } from '@/lib/date-range';
import { Button } from '@/components/ui/button';
import {
  BarChart3,
  CalendarX2,
  Play,
  Loader2,
  FlaskConical,
  Users,
  ArrowRight,
  Download,
  RotateCw,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { usePlanContext } from '@/components/providers/plan-provider';
import { toast } from 'sonner';
import { readUrlChoice, readUrlParam, writeUrlParams } from '@/lib/url-state';
import { toCsv } from '@/lib/csv';
import { exportFileName } from '@/lib/white-label/export-name';
import type { PromptComparison } from '@/lib/insights-same-prompts';
import type { KpiSeriesDay } from '@/lib/insights-kpis';
import type { PlatformChange, PlatformTableRow } from '@/lib/insights-summary';
import { formatWindowBound } from './kpi-format';
import { KpiRows } from './_kpi-cards';
import { SummaryLine } from './_summary-line';
import { PlatformTable } from './_platform-table';
import { Leaderboard } from './_leaderboard';
import { TrendCard } from './_trend-card';
import { trendLines, type TrendMarkerData } from '@/lib/insights-trend';
import { TopicHeatmap } from './_topic-heatmap';
import { Opportunities } from './_opportunities';
import type { TopicCompetitors } from '@/lib/insights-topics';
import { WhyChanged } from './_why-changed';
import type { WhyChanged as WhyChangedData } from '@/lib/insights-drivers';

// ─── Filter Types ─────────────────────────────────────────────────────────────

// The preset vocabulary is shared with the control that renders it (#713), so
// a page cannot drift from the options it actually offers.
type DatePreset = DateRangePreset;

interface InsightsFilters {
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
  region: string;
  model: string;
  topic: string;
}

const DEFAULT_FILTERS: InsightsFilters = {
  // The last 24 hours: what the latest run found. Longer ranges are one
  // click away.
  datePreset: OVERVIEW_DEFAULT_RANGE,
  dateFrom: '',
  dateTo: '',
  region: '',
  model: '',
  topic: '',
};

/**
 * The filters as kept in the URL (#917): ?range=, plus ?from=/&to= for a
 * custom range, ?region=, ?model= and ?topic=. Defaults are left out, and an
 * unknown range falls back to the default.
 */
function filtersFromUrl(): InsightsFilters {
  const datePreset = readUrlChoice<DatePreset>(
    'range',
    ALL_DATE_PRESETS as readonly DatePreset[],
    DEFAULT_FILTERS.datePreset,
  );
  return {
    datePreset,
    dateFrom: datePreset === 'custom' ? readUrlParam('from') : '',
    dateTo: datePreset === 'custom' ? readUrlParam('to') : '',
    region: readUrlParam('region'),
    model: readUrlParam('model'),
    topic: readUrlParam('topic'),
  };
}

function writeFiltersToUrl(f: InsightsFilters) {
  const custom = f.datePreset === 'custom';
  writeUrlParams(
    {
      range: f.datePreset,
      from: custom ? f.dateFrom : null,
      to: custom ? f.dateTo : null,
      region: f.region,
      model: f.model,
      topic: f.topic,
      // Dropped from links made while "Same prompts" could be turned off.
      compare: null,
    },
    { range: DEFAULT_FILTERS.datePreset },
  );
}

/** An Overview read as the tab shows it, kept for the brand and filters it was read with. */
interface OverviewRead {
  insights: InsightsData;
  /** The window and filters the figures were read with (the breakdown panel explains those). */
  loadedFilters: BreakdownFilters;
}

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

// ─── Filter Bar ───────────────────────────────────────────────────────────────

/** An AI model filter's name: its provider family's, as the filter shows it. */
function modelName(value: string): string {
  return modelLabel(value.split(',')[0]);
}

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
  const t = useTranslations('common');
  const set = (patch: Partial<InsightsFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap items-end gap-3">
      <DateRangeFilter
        value={filters.datePreset}
        presets={ALL_DATE_PRESETS as readonly DatePreset[]}
        onChange={(datePreset) => set({ datePreset })}
        from={filters.dateFrom}
        to={filters.dateTo}
        onFromChange={(dateFrom) => set({ dateFrom })}
        onToChange={(dateTo) => set({ dateTo })}
      />

      {/* Topic filter */}
      {availableTopics.length > 0 && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {t('topic')}
          </label>
          <Select
            value={filters.topic || null}
            onValueChange={(v) => set({ topic: !v || v === '__all__' ? '' : v })}
          >
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder={t('allTopics')}>
                {(value) =>
                  value && value !== '__all__'
                    ? (availableTopics.find((topic) => topic.id === value)?.name ?? t('allTopics'))
                    : t('allTopics')
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('allTopics')}</SelectItem>
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
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {t('region')}
        </label>
        <Select
          value={filters.region || null}
          onValueChange={(v) => set({ region: !v || v === '__all__' ? '' : v })}
        >
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue placeholder={t('allRegions')}>
              {(value) =>
                value && value !== '__all__' ? formatRegionDisplay(String(value)) : t('allRegions')
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t('allRegions')}</SelectItem>
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
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {t('aiModel')}
        </label>
        <Select
          value={filters.model || null}
          onValueChange={(v) => set({ model: !v || v === '__all__' ? '' : v })}
        >
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder={t('allPlatforms')}>
              {(value) => {
                if (!value || value === '__all__') return t('allPlatforms');
                return modelName(String(value));
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t('allPlatforms')}</SelectItem>
            {/* Each value is a comma-separated slug list: a provider family. */}
            {availableModels.map((m) => (
              <SelectItem key={m} value={m}>
                {modelName(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({
  onRunPrompts,
  isRunning,
  isCloud,
}: {
  /** Run all: admins and managers only (a run spends the plan's tracking). */
  onRunPrompts?: () => void;
  isRunning: boolean;
  isCloud: boolean;
}) {
  const t = useTranslations('insights');
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <BarChart3 className="h-12 w-12 text-muted-foreground/40 mb-4" />
      <h2 className="text-lg font-semibold">No tracking data yet</h2>
      <p className="text-muted-foreground text-sm mt-1 max-w-md">
        Run your prompts through AI platforms to see how your brand appears in AI-generated
        responses.
      </p>
      {!isCloud && onRunPrompts && (
        <Button onClick={onRunPrompts} disabled={isRunning} className="mt-6 gap-2">
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {t('runPromptsNow')}
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

// ─── No Competitors Teaser ────────────────────────────────────────────────────

/**
 * Shown in place of the Competitor Comparison section when the brand has no
 * tracked competitors yet (#507). Gives users a clear path to
 * /dashboard/competitors so the head-to-head feature is discoverable even
 * before any competitors are added.
 */
function NoCompetitorsTeaser() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-muted-foreground/30 p-8 text-center">
      <Users className="h-8 w-8 text-muted-foreground/40" />
      <div>
        <p className="text-sm font-medium text-foreground">No competitors tracked yet</p>
        <p className="mt-0.5 max-w-xs text-xs text-muted-foreground">
          Add competitors to see how you compare in AI answers.
        </p>
      </div>
      <Link
        href="/dashboard/competitors"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-2 hover:underline"
      >
        Head-to-Head Comparison
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

/**
 * Brand Visibility's Overview tab (was the Answer Engine Insights page). The
 * header, the run line, Run All and the run's bands are the shared layout's
 * (components/brand-visibility/shell.tsx); a run there brings this tab's
 * figures in as they arrive (`refreshes`).
 */
export default function InsightsPage() {
  const t = useTranslations('insights');
  const tBrandVisibility = useTranslations('brandVisibility');
  const tCommon = useTranslations('common');
  const tChat = useTranslations('chatPanel.suggest');
  const tChatRange = useTranslations('chatPanel.range');
  const tPlatforms = useTranslations('insights.platforms');
  const tLeaderboard = useTranslations('insights.leaderboard');
  const router = useRouter();
  const { isCloud } = usePlanContext();
  const locale = useLocale();
  const brand = useBrandStore((s) => s.getActiveBrand());
  const {
    refreshes,
    isRunning,
    runAll,
    openSinglePrompt,
    reportRunWindow,
    reportData,
    cache,
    shown,
  } = useBrandVisibilityShell();
  // The brand's first run while it goes on: the run's band above says it
  // all, so no empty state under it.
  const firstRun = useFirstRun();
  const [summary, setSummary] = useState<InsightsSummary | null>(null);
  const [trackedPrompts, setTrackedPrompts] = useState<TrackedPromptsKpi | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // The latest read failed: the tab says so, with Retry, rather than an
  // empty state or the last filters' figures under the new ones.
  const [loadFailed, setLoadFailed] = useState(false);
  // Sections whose own read failed, standing in empty: said, not shown as "none".
  const [failedSections, setFailedSections] = useState<InsightsSection[]>([]);
  const [filters, setFilters] = useState<InsightsFilters>(DEFAULT_FILTERS);
  const [hasAnyData, setHasAnyData] = useState<boolean | null>(null);
  const [competitorData, setCompetitorData] = useState<CompetitorComparisonData | null>(null);
  const [rateTrend, setRateTrend] = useState<VisibilityRateTrendData | null>(null);
  const [sovData, setSovData] = useState<ShareOfVoiceData | null>(null);
  const [comparison, setComparison] = useState<PromptComparison | null>(null);
  const [coverage, setCoverage] = useState<CoverageKpi | null>(null);
  const [kpiSeries, setKpiSeries] = useState<KpiSeriesDay[] | null>(null);
  const [platformChanges, setPlatformChanges] = useState<PlatformChange[] | null>(null);
  const [platforms, setPlatforms] = useState<PlatformTableRow[] | null>(null);
  const [whyChanged, setWhyChanged] = useState<WhyChangedData | null>(null);
  const [trendMarkers, setTrendMarkers] = useState<TrendMarkerData | null>(null);
  const [topicCompetitors, setTopicCompetitors] = useState<TopicCompetitors[] | null>(null);
  const [breakdownMetric, setBreakdownMetric] = useState<BreakdownMetric | null>(null);
  const [breakdownTab, setBreakdownTab] = useState<BreakdownTab | undefined>(undefined);
  // The window and filters the cards were last loaded with (the 24h view
  // anchored to its tracking run): the breakdown panel explains those exact
  // numbers rather than recomputing "now" on every render (VIS-001).
  const [loadedFilters, setLoadedFilters] = useState<BreakdownFilters>();
  const [isExporting, setIsExporting] = useState(false);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  // The single models already read as their family (modelFamilyValue): each
  // asks the brand's models once.
  const familyRead = useRef(new Set<string>());

  // The filters are read from the URL after mount (window isn't available
  // during the server render), and the first load waits for them.
  const [urlRead, setUrlRead] = useState(false);
  useEffect(() => {
    const fromUrl = filtersFromUrl();
    filtersRef.current = fromUrl;
    setFilters(fromUrl);
    setUrlRead(true);
  }, []);

  useEffect(() => {
    if (urlRead) writeFiltersToUrl(filters);
  }, [urlRead, filters]);

  // Keyed on the id, not the brand object: the store hands out a new object
  // for the same brand, and a new loadData re-runs the load effect below.
  const brandId = brand?.id;

  // The figures on screen, from a read or from what the tab kept. Only a
  // fresh read tells the header about the run and the brand's answers: kept
  // figures may be older than what the run line already knows.
  const show = useCallback(
    ({ insights, loadedFilters: read }: OverviewRead, { fresh }: { fresh: boolean }) => {
      if (fresh) {
        if (insights.trackingWindow) reportRunWindow(insights.trackingWindow);
        reportData({
          hasData: insights.hasAnyData,
          lastCheckedAt: insights.summary.lastCheckedAt ?? null,
        });
      }
      setLoadFailed(false);
      setFailedSections(insights.failedSections ?? []);
      setLoadedFilters(read);
      const trend = insights.trend;
      setRateTrend(trend && trend.points.length > 0 ? trend : null);
      setSummary(insights.summary);
      setTrackedPrompts(insights.trackedPrompts);
      setCompetitorData(insights.competitors.brands.length > 1 ? insights.competitors : null);
      setSovData(insights.sov.byPlatform.length > 0 ? insights.sov : null);
      setComparison(insights.comparison);
      setCoverage(insights.coverage);
      setKpiSeries(insights.kpiSeries);
      setPlatformChanges(insights.platformChanges);
      setPlatforms(insights.platforms);
      setWhyChanged(insights.whyChanged);
      setTrendMarkers(insights.trendMarkers);
      setTopicCompetitors(insights.topicCompetitors);
      setHasAnyData(insights.hasAnyData);
      shown();
    },
    [reportRunWindow, reportData, shown],
  );

  // Each load claims a generation: a read that lands after a newer one was
  // sent (new filters, Retry) is not shown over it.
  const loadGen = useRef(0);
  const loadData = useCallback(
    async (overrideFilters?: InsightsFilters, { silent = false } = {}) => {
      if (!brandId) return;
      const gen = ++loadGen.current;
      const stale = () => gen !== loadGen.current;
      if (!silent) {
        setIsLoading(true);
        // Retry, or new filters: loading again, not failed.
        setLoadFailed(false);
      }
      // Quiet: a run's refresh, or figures kept from the last time already on screen.
      let quiet = silent;
      try {
        let f = overrideFilters ?? filtersRef.current;
        // A model from an address can be one slug of a family (Chat's link,
        // model=chatgpt-web): it reads as its family, as the dropdown sets
        // it, so the numbers are those of picking ChatGPT there.
        if (isSingleModel(f.model) && !familyRead.current.has(f.model)) {
          familyRead.current.add(f.model);
          const asked = f.model;
          const family = await cache
            .read(readKey('filterOptions', brandId), () => getBrandFilterOptions(brandId))
            .then((options) => modelFamilyValue(asked, modelFamilies(options.models)))
            .catch(() => asked);
          if (stale()) return;
          familyRead.current.add(family);
          if (family !== asked) {
            f = { ...f, model: family };
            filtersRef.current = f;
            setFilters(f);
          }
        }
        const { dateFrom, dateTo, days } = getDateRange(f.datePreset, {
          from: f.dateFrom,
          to: f.dateTo,
        });

        const filterOpts = {
          model: f.model || undefined,
          region: f.region || undefined,
          topicId: f.topic || undefined,
          dateFrom,
          dateTo,
          // Whole-day window → the aggregate actions answer from the daily
          // rollups (00066). Absent for 24h, whose anchored window above is
          // timestamp-shaped and stays on the raw path.
          days,
          // Changes compare only the prompts answered in both periods
          // (VIS-002), so adding prompts doesn't inflate them.
          samePrompts: true,
        };

        const hasFilters = Boolean(f.datePreset !== 'all' || f.model || f.region || f.topic);

        // The same brand and filters read before (this tab opened again, or
        // a range picked again): on screen at once, read again quietly.
        const key = readKey('overview', brandId, f);
        const kept = cache.get<OverviewRead>(key);
        if (kept) {
          show(kept, { fresh: false });
          setIsLoading(false);
          quiet = true;
        }

        // Everything the figures need — summary, competitors, SoV, KPIs and
        // the trend chart — runs in one server-side Promise.all (#313), and
        // "has any data" comes from a cheap count. The filters' choices,
        // the topics and the Opportunities card are their own reads, sent
        // beside this one (below), as is the run line's.
        // The 24h preset is anchored to the last completed tracking run
        // (00044) so the morning refresh can't flash "no results" while
        // today's run streams in; the action resolves that window itself.
        // The trend chart follows the same window as every other number.
        const insights = await getInsightsData(brandId, {
          ...filterOpts,
          checkUnfiltered: hasFilters,
          anchor24h: f.datePreset === '24h',
        });
        if (stale()) return;
        const anchored = insights.trackingWindow?.anchored;
        const read: OverviewRead = {
          insights,
          loadedFilters: {
            ...filterOpts,
            dateFrom: anchored?.dateFrom ?? filterOpts.dateFrom,
            dateTo: anchored?.dateTo ?? filterOpts.dateTo,
          },
        };
        cache.set(key, read);
        show(read, { fresh: true });
      } catch (err) {
        if (stale()) return;
        if (!quiet) {
          // The read's route keeps the server's error in its log, so there
          // is nothing more actionable to say than this.
          toast.error('Failed to load insights — please try again');
          // Not "No tracking data yet", nor the last filters' figures: the
          // tab says the read failed, with Retry (Brand Visibility).
          setLoadFailed(true);
        } else {
          // Silent refreshes fire every ~10s while a tracking job runs; a
          // transient 5xx or network blip there shouldn't pop a red toast —
          // the next poll will retry and the user sees nothing. Nor does a
          // quiet read under kept figures: they stay.
          console.warn('[insights] silent refresh failed', err);
        }
      } finally {
        if (!stale()) setIsLoading(false);
      }
    },
    [brandId, cache, show],
  );

  // The brand's filter choices, topics and Opportunities card: their own
  // reads, sent beside the figures' and kept for the brand, so a filter
  // change doesn't ask for them again. The choices are read again as a run
  // brings answers in (a new engine or country shows up).
  const readFor = urlRead ? brandId : null;
  const filterOptions = useBrandRead('filterOptions', readFor, getBrandFilterOptions, refreshes);
  const topics = useBrandRead('topics', readFor, getTopics);
  const opportunities = useBrandRead('opportunities', readFor, getInsightsOpportunities);
  const availableRegions = useMemo(
    () => [...(filterOptions?.regions ?? [])].sort((a, b) => a.localeCompare(b)),
    [filterOptions],
  );
  // Different ChatGPT versions ("gpt-5-3-mini" + "gpt-5-5") collapse into
  // one "ChatGPT" filter option, stored as `slugA,slugB` so the server
  // filters the whole family with .in() via applyModelFilter().
  const availableModels = useMemo(
    () => modelFamilies(filterOptions?.models ?? []).sort((a, b) => a.localeCompare(b)),
    [filterOptions],
  );
  const availableTopics = useMemo<Topic[]>(() => topics ?? [], [topics]);

  // A brand switch clears the brand-specific filters. Not on the first brand,
  // so filters linked in the URL survive the initial load.
  const filteredBrandRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!brand?.id) return;
    if (filteredBrandRef.current && filteredBrandRef.current !== brand.id) {
      const next = { ...filtersRef.current, region: '', model: '', topic: '' };
      filtersRef.current = next;
      setFilters(next);
    }
    filteredBrandRef.current = brand.id;
  }, [brand?.id]);

  useEffect(() => {
    if (urlRead) loadData();
  }, [loadData, urlRead]);

  // A run the header started or saw (Run All, the daily run, a teammate's)
  // brings answers in: read again, quietly, as they arrive and when it ends.
  const seenRefreshes = useRef(refreshes);
  useEffect(() => {
    if (refreshes === seenRefreshes.current) return;
    seenRefreshes.current = refreshes;
    if (urlRead) loadData(undefined, { silent: true });
  }, [refreshes, urlRead, loadData]);

  const handleFilterChange = (newFilters: InsightsFilters) => {
    setFilters(newFilters);
    loadData(newFilters);
  };

  const retry = () => loadData();

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
      link.download = await exportFileName(`${slug}_insights_${date}.csv`);
      link.click();

      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export CSV');
    } finally {
      setIsExporting(false);
    }
  }, [brand]);

  // Chat's side panel sees the page (W1-08): its dates and filters, the
  // platform that moved most, and the tables to ask about.
  const moved = largestMove(platforms?.filter((row) => row.status === 'ok'));
  const topicName = availableTopics.find((topic) => topic.id === filters.topic)?.name;
  useChatPageContext(
    brand
      ? {
          pageName: tBrandVisibility('title'),
          dateRange: {
            from: filters.datePreset === 'custom' ? filters.dateFrom : filters.datePreset,
            to: filters.datePreset === 'custom' ? filters.dateTo : null,
            label: rangeChipLabel(
              filters.datePreset,
              { from: filters.dateFrom, to: filters.dateTo },
              (key, values) => tChatRange(key, values),
            ),
          },
          filters: [
            {
              key: 'platform',
              label: filters.model ? modelName(filters.model) : tCommon('allPlatforms'),
              value: filters.model,
            },
            ...(filters.region
              ? [
                  {
                    key: 'region',
                    label: formatRegionDisplay(filters.region),
                    value: filters.region,
                  },
                ]
              : []),
            ...(filters.topic && topicName
              ? [{ key: 'topic', label: topicName, value: filters.topic }]
              : []),
          ],
          suggestions: [
            ...(moved
              ? [
                  tChat(moved.change < 0 ? 'visibilityDrop' : 'visibilityRise', {
                    platform: moved.name,
                  }),
                ]
              : []),
            tChat('competitorGained'),
            tChat('actions'),
          ],
          referenceables: [
            { type: 'table', id: 'visibility-by-platform', label: tPlatforms('title') },
            { type: 'table', id: 'visibility-leaderboard', label: tLeaderboard('title') },
          ],
        }
      : null,
  );

  // The tab's own actions, in the shared header beside Reports: Formulas
  // and this tab's Export CSV. They need no data to show.
  const headerActions = (
    <TabHeaderActions>
      <FormulaDialog />
      <Button variant="outline" className="gap-2" onClick={handleExportCsv} disabled={isExporting}>
        {isExporting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {isExporting ? tCommon('exporting') : tCommon('exportCsv')}
      </Button>
    </TabHeaderActions>
  );

  // Until the first read is back the tab is loading, never empty.
  if (!brand || (isLoading && !summary)) {
    return (
      <>
        {headerActions}
        <OverviewSkeleton />
      </>
    );
  }

  const filterBar = (
    <FilterBar
      filters={filters}
      onChange={handleFilterChange}
      availableRegions={availableRegions}
      availableModels={availableModels}
      availableTopics={availableTopics}
    />
  );

  // The read failed or timed out: say so, with Retry. Not "No tracking data
  // yet" (nothing said there was none), and not the last filters' figures
  // under the new filters. No figures and no read on its way is the same.
  if (loadFailed || !summary) {
    return (
      <div className="space-y-6">
        {headerActions}
        {filterBar}
        <ReadError title={tBrandVisibility('readError.overview')} onRetry={retry} />
      </div>
    );
  }

  const noResults = !summary || summary.totalResults === 0;

  // First load renders the skeleton (summary is still null); once data has
  // ever arrived, a reload from a filter change is a "refetch" — the stale
  // content stays visible under the overlay instead of flashing a skeleton.
  const isRefetching = isLoading && summary !== null;

  const trulyEmpty = noResults && hasAnyData === false;

  if (trulyEmpty) {
    return (
      <div className="space-y-6">
        {headerActions}
        {/* While the first run goes on, the page says its data is on the way. */}
        {firstRun ? (
          <FirstRunEmptyState run={firstRun} />
        ) : (
          <EmptyState onRunPrompts={runAll} isRunning={isRunning} isCloud={isCloud} />
        )}
        {!isCloud && openSinglePrompt && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={openSinglePrompt} className="gap-2">
              <FlaskConical className="h-4 w-4" />
              Or test a single prompt
            </Button>
          </div>
        )}
      </div>
    );
  }

  // The trend's subtitle (VIS-007): "Visibility · last 30 days".
  const trendRangeLabel =
    filters.datePreset === 'custom'
      ? t('trend.range.custom', {
          from: formatWindowBound(filters.dateFrom, locale),
          to: formatWindowBound(filters.dateTo, locale),
        })
      : t(`trend.range.${filters.datePreset}`);

  const handleResetFilters = () => {
    const resetFilters = { ...DEFAULT_FILTERS };
    setFilters(resetFilters);
    loadData(resetFilters);
  };

  // A section whose own read failed stands in empty: it says so instead.
  const competitorsFailed = failedSections.includes('competitors');
  const trendFailed = failedSections.includes('trend');
  const otherSectionsFailed = failedSections.some(
    (section) => section !== 'competitors' && section !== 'trend',
  );

  return (
    <div className="space-y-6">
      {headerActions}

      {filterBar}

      {/* Refetch overlay: on a filter/date change the previous window's data
          stays mounted (no skeleton — that's first-load only), so without a
          signal the user reads stale numbers as the new period's. Dim the
          content and float a spinner over it; the overlay also swallows
          clicks so a stale card can't be interacted with. The filter bar
          stays outside, so switching presets mid-load keeps working. */}
      <div className="relative">
        {isRefetching && (
          <div className="absolute inset-0 z-10 flex items-start justify-center rounded-lg bg-background/50 pt-32">
            <div className="flex items-center rounded-md border bg-background p-2.5 shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div className={cn('space-y-6', isRefetching && 'opacity-60')}>
          {noResults && firstRun ? (
            <FirstRunEmptyState run={firstRun} />
          ) : noResults ? (
            <NoDataForPeriod datePreset={filters.datePreset} onReset={handleResetFilters} />
          ) : (
            <>
              {/* Some sections' own reads failed: they are left out or say so, and Retry reads them again. */}
              {otherSectionsFailed && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                >
                  <span>{tBrandVisibility('readError.sections')}</span>
                  <Button variant="outline" size="sm" className="gap-2" onClick={retry}>
                    <RotateCw className="h-3.5 w-3.5" aria-hidden />
                    {tBrandVisibility('readError.retry')}
                  </Button>
                </div>
              )}

              {/* Summary line (VIS-006): the page's story in one line. */}
              <SummaryLine
                trend={rateTrend}
                competitors={competitorData}
                comparison={comparison}
                platformChanges={platformChanges}
                answers={summary?.totalResults}
              />

              {/* KPI cards (VIS-003): today's five, then the new rates. */}
              <KpiRows
                summary={summary!}
                trend={rateTrend}
                trackedPrompts={trackedPrompts}
                coverage={coverage}
                sov={sovData}
                competitors={competitorData}
                comparison={comparison}
                series={kpiSeries}
                onBreakdown={(metric) => {
                  setBreakdownTab(undefined);
                  setBreakdownMetric(metric);
                }}
                onNavigate={(path) => router.push(path)}
                mentionsHref={mentionsHref({
                  range: filters.datePreset,
                  from: filters.dateFrom,
                  to: filters.dateTo,
                  region: filters.region,
                  topic: filters.topic,
                })}
              />

              {/* Competitor Comparison. A failed read of it is not "no competitors". */}
              {competitorsFailed ? (
                <ReadError
                  compact
                  title={tBrandVisibility('readError.competitors')}
                  onRetry={retry}
                />
              ) : competitorData ? (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                  {trendFailed ? (
                    <ReadError
                      compact
                      className="lg:col-span-3"
                      title={tBrandVisibility('readError.trend')}
                      onRetry={retry}
                    />
                  ) : (
                    <TrendCard
                      className="lg:col-span-3"
                      brandId={brand.id}
                      data={rateTrend}
                      markers={trendMarkers}
                      rangeLabel={trendRangeLabel}
                      answers={summary?.totalResults}
                      onPinnedChange={(pinned) =>
                        setRateTrend((current) => current && { ...current, pinned })
                      }
                    />
                  )}

                  <Leaderboard
                    className="lg:col-span-2"
                    brands={competitorData.brands}
                    providerRows={competitorData.providerRows}
                    platforms={platforms}
                    answers={summary?.totalResults}
                  />
                </div>
              ) : (
                <NoCompetitorsTeaser />
              )}

              {/* By AI platform (VIS-008) and Why it changed (VIS-009), side by side as in the mockup. */}
              {((platforms && platforms.length > 0) || whyChanged) && (
                <div className="flex flex-wrap gap-4">
                  {platforms && platforms.length > 0 && (
                    <PlatformTable className="min-w-0 flex-[1_1_520px]" rows={platforms} />
                  )}
                  {whyChanged && (
                    <WhyChanged
                      className="min-w-0 flex-[1_1_420px]"
                      data={whyChanged}
                      onOpenBreakdown={(tab) => {
                        setBreakdownTab(tab);
                        setBreakdownMetric('visibility');
                      }}
                    />
                  )}
                </div>
              )}

              {/* Topics vs competitors (VIS-010): the trend's brands, topic by topic. */}
              {/* Its columns are the trend's lines, so it needs the trend's points. */}
              {rateTrend &&
                rateTrend.points.length > 0 &&
                topicCompetitors &&
                topicCompetitors.length > 0 && (
                  <TopicHeatmap
                    topics={topicCompetitors}
                    columns={trendLines(rateTrend.entities, rateTrend.points, rateTrend.pinned).map(
                      (line) => ({ key: line.key, name: line.name }),
                    )}
                  />
                )}

              {/* Opportunities (VIS-011), under the map: stored suggestions, not period-scoped. */}
              {opportunities && (
                <Opportunities
                  brandId={brand.id}
                  suggestions={opportunities.suggestions}
                  trackedTopicIds={opportunities.trackedTopicIds}
                  topics={topicCompetitors}
                  entities={rateTrend?.entities ?? null}
                  slotsLeft={
                    !trackedPrompts || trackedPrompts.quotaLimit < 0
                      ? null
                      : Math.max(0, trackedPrompts.quotaLimit - trackedPrompts.quotaUsed)
                  }
                  contentUsage={opportunities.contentUsage}
                  onTracked={(count) =>
                    setTrackedPrompts(
                      (current) => current && { ...current, quotaUsed: current.quotaUsed + count },
                    )
                  }
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Metric Breakdown Drilldown */}
      <MetricBreakdownSheet
        brandId={brand.id}
        metric={breakdownMetric}
        onOpenChange={(open) => {
          if (!open) setBreakdownMetric(null);
        }}
        filters={loadedFilters}
        initialTab={breakdownTab}
      />
    </div>
  );
}
