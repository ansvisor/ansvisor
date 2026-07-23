'use server';

import { createClient } from '@/lib/supabase/server';
import { expandDateToEndOfDay } from '@/lib/dates';
import type {
  PromptResult,
  AIPlatform,
  Sentiment,
  Citation,
  CompetitorMention,
  Topic,
  ObservedSearchQuery,
} from '@/types';
import { API_BASE_URL } from '@/config/api';
import {
  classifyDomain,
  extractHostname,
  normalizeDomain,
  type SourceCategory,
} from '@/lib/citations/classify';
import { getTopicById } from '@/lib/actions/topic';
import { getOrgPlan } from '@/lib/guards/plan-guard';
import { getPromptVolumes } from '@/lib/actions/volumes';
import { getPromptSuggestions } from '@/lib/actions/prompt-suggestions';
import { aggregatePromptVolumeClusters } from '@/lib/prompt-volume-clusters';
import { percentageChange } from '@/lib/metrics';

/** Round to one decimal place (keeps sub-1 averages visible instead of flooring to 0). */
function roundTo1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Apply the `model` filter to a Supabase query against `prompt_results.model_used`.
 *
 * Accepts either a single slug ("gpt-5-5") or a comma-separated list
 * ("gpt-5-5,gpt-5-3-mini,chatgpt-web") so callers can filter by a provider
 * family without the UI having to enumerate every per-model row in the
 * filter dropdown.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyModelFilter<T extends { eq: any; in: any }>(query: T, model: string | undefined): T {
  if (!model) return query;
  const list = model
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length <= 1) return query.eq('model_used', list[0] ?? model);
  return query.in('model_used', list);
}

function mapResultRow(row: Record<string, unknown>): PromptResult {
  return {
    id: row.id as string,
    promptId: row.prompt_id as string,
    brandId: row.brand_id as string,
    platform: row.platform as AIPlatform,
    response: row.response as string,
    citations: (row.citations as Citation[]) ?? [],
    mentionCount: row.mention_count as number,
    citationCount: row.citation_count as number,
    sentiment: row.sentiment as Sentiment,
    visibilityScore: row.visibility_score as number,
    modelUsed: (row.model_used as string | null) ?? undefined,
    region: (row.region as string | null) ?? undefined,
    competitorMentions: (row.competitor_mentions as CompetitorMention[] | null) ?? undefined,
    searchQueries: Array.isArray(row.search_queries)
      ? (row.search_queries as ObservedSearchQuery[])
      : [],
    createdAt: row.created_at as string,
  };
}

export interface PromptResultWithText extends PromptResult {
  promptText: string;
  promptCategory?: string;
  topicId?: string;
  topicName?: string;
}

/** One row of the prompt detail "Top Sources" card — mirrors CitationDomainRow. */
export interface PromptTopSource {
  domain: string;
  category: SourceCategory;
  models: string[];
  totalCitations: number;
  resultsCiting: number;
  usagePct: number;
}

/** One URL row of the prompt detail "Top Sources" card — mirrors CitationUrlRow. */
export interface PromptTopSourceUrl {
  url: string;
  domain: string;
  category: SourceCategory;
  title: string;
  models: string[];
  totalCitations: number;
  resultsCiting: number;
  usagePct: number;
}

export interface PromptDetailData {
  prompt: {
    id: string;
    brandId: string;
    text: string;
    category?: string;
    topicId?: string;
    topicName?: string;
    isActive: boolean;
    createdAt: string;
  };
  summary: {
    avgVisibilityScore: number;
    totalMentions: number;
    totalCitations: number;
    totalResults: number;
    lastCheckedAt: string | null;
  };
  results: PromptResultWithText[];
  topSources: PromptTopSource[];
  topSourceUrls: PromptTopSourceUrl[];
}

export interface InsightsSummary {
  avgVisibilityScore: number;
  totalMentions: number;
  totalCitations: number;
  positiveSentimentPct: number;
  totalResults: number;
  lastCheckedAt: string | null;
  platformBreakdown: {
    platform: string;
    avgScore: number;
    resultCount: number;
  }[];
  visibilityChange: number | null;
  /** Percentage change vs the previous period; null when the previous count is zero or unavailable. */
  mentionsChange: number | null;
  /** Percentage change vs the previous period; null when the previous count is zero or unavailable. */
  citationsChange: number | null;
  /** Raw previous-period count, used to distinguish a zero base from unavailable comparison data. */
  prevMentions: number | null;
  /** Raw previous-period count, used to distinguish a zero base from unavailable comparison data. */
  prevCitations: number | null;
  sentimentChange: number | null;
}

/**
 * Convert the comma-separated `model` filter string the UI passes around
 * into the `text[]` shape the aggregate RPCs accept. Matches the parsing
 * applyModelFilter does for the buildResultsQuery path so the two callers
 * stay equivalent.
 */
function modelFilterArray(model: string | undefined): string[] | null {
  if (!model) return null;
  const list = model
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

// ── RPC return shapes (mirror supabase/migrations/00006_insights_aggregates.sql) ─

interface InsightsAggregates {
  total_results: number;
  sum_visibility: number;
  total_mentions: number;
  total_citations: number;
  positive_count: number;
  last_checked_at: string | null;
  by_model: Array<{
    model_used: string;
    sum_visibility: number;
    result_count: number;
  }>;
}

interface CompetitorAggregatesRow {
  brand_row_count: number;
  brand_sum_visibility: number;
  brand_total_mentions: number;
  brand_total_citations: number;
  brand_prompt_count: number;
  brand_visible_prompts: number;
  by_competitor: Array<{
    competitor_id: string;
    name: string | null;
    sum_visibility: number;
    row_count: number;
    total_mentions: number;
    total_citations: number;
    visible_prompts: number;
  }>;
  by_brand_provider: Array<{
    model_used: string | null;
    platform: string | null;
    sum_visibility: number;
    row_count: number;
    prompt_count: number;
    visible_prompts: number;
  }>;
  by_competitor_provider: Array<{
    model_used: string | null;
    platform: string | null;
    competitor_id: string;
    competitor_name: string | null;
    sum_visibility: number;
    row_count: number;
    visible_prompts: number;
  }>;
}

interface ShareOfVoiceAggregatesRow {
  total_brand_mentions: number;
  total_competitor_mentions: number;
  by_platform: Array<{
    model_used: string | null;
    platform: string | null;
    brand_mentions: number;
    competitor_mentions: number;
  }>;
  by_day: Array<{
    day: string;
    brand_mentions: number;
    competitor_mentions: number;
  }>;
}

/**
 * Build a filtered query on prompt_results for a brand.
 */
async function buildResultsQuery(
  brandId: string,
  opts?: {
    platform?: string;
    model?: string;
    region?: string;
    dateFrom?: string;
    dateTo?: string;
    promptId?: string;
    topicId?: string;
  },
  selectOpts?: { count?: 'exact' },
) {
  const supabase = await createClient();
  // #155 — Insights aggregates exclude `chatgpt-shopping`. That model's
  // visibility numbers aren't comparable to a normal ChatGPT answer and
  // would skew brand-level visibility/mentions/citations. Shopping data
  // is consumed by /dashboard/shopping only.
  //
  // `count: 'exact'` (opt-in) makes the query return the full match count
  // alongside a `.range()` page, so getPromptResults gets an accurate total
  // without materializing every row. Export leaves it off (it paginates and
  // doesn't need a per-page count).
  const base = supabase.from('prompt_results');
  let query = (selectOpts?.count ? base.select('*', { count: selectOpts.count }) : base.select('*'))
    .eq('brand_id', brandId)
    .neq('platform', 'chatgpt-shopping');

  if (opts?.platform) query = query.eq('platform', opts.platform);
  query = applyModelFilter(query, opts?.model);
  if (opts?.region) query = query.eq('region', opts.region);
  if (opts?.dateFrom) query = query.gte('created_at', opts.dateFrom);
  const expandedDateTo = expandDateToEndOfDay(opts?.dateTo);
  if (expandedDateTo) query = query.lte('created_at', expandedDateTo);
  if (opts?.promptId) query = query.eq('prompt_id', opts.promptId);

  if (opts?.topicId) {
    const { data: topicPrompts } = await supabase
      .from('prompts')
      .select('id')
      .eq('topic_id', opts.topicId);
    const topicPromptIds = ((topicPrompts ?? []) as { id: string }[]).map((p) => p.id);
    // Use a sentinel that matches nothing when the topic has no prompts so results are empty.
    query = query.in(
      'prompt_id',
      topicPromptIds.length > 0 ? topicPromptIds : ['00000000-0000-0000-0000-000000000000'],
    );
  }

  return { supabase, query };
}

/**
 * Fetch prompt results for a brand with proper date filtering.
 */
export async function getPromptResults(
  brandId: string,
  opts?: {
    limit?: number;
    offset?: number;
    platform?: string;
    model?: string;
    region?: string;
    dateFrom?: string;
    dateTo?: string;
    promptId?: string;
    topicId?: string;
  },
): Promise<{ results: PromptResultWithText[]; total: number }> {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const { supabase, query } = await buildResultsQuery(brandId, opts, { count: 'exact' });

  // One round trip: fetch only the requested page via SQL `.range()` and read
  // the full match count from the same query, instead of materializing every
  // matching row (all heavy columns) into Node and slicing/counting in JS.
  const {
    data: pageRows,
    count,
    error,
  } = await query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);

  const rows = (pageRows ?? []) as Record<string, unknown>[];
  const total = count ?? rows.length;

  const promptIds = [...new Set(rows.map((r) => r.prompt_id as string))];
  const { data: promptRows } =
    promptIds.length > 0
      ? await supabase.from('prompts').select('id, text, category, topic_id').in('id', promptIds)
      : { data: [] };

  const promptRowsRaw = (promptRows ?? []) as unknown as Record<string, unknown>[];

  const topicIds = [
    ...new Set(promptRowsRaw.map((p) => p.topic_id as string | null).filter(Boolean) as string[]),
  ];
  const { data: topicRows } =
    topicIds.length > 0
      ? await supabase.from('topics').select('id, name').in('id', topicIds)
      : { data: [] };
  const topicMap = new Map(
    ((topicRows ?? []) as Record<string, unknown>[]).map((t) => [t.id as string, t.name as string]),
  );

  const promptMap = new Map(
    promptRowsRaw.map((p) => [
      p.id as string,
      {
        text: p.text as string,
        category: p.category as string | null,
        topicId: p.topic_id as string | null,
      },
    ]),
  );

  // `rows` is already the requested page (SQL `.range()` above), so map it
  // directly — no JS slicing.
  const results = rows.map((r) => {
    const pm = promptMap.get(r.prompt_id as string);
    return {
      ...mapResultRow(r),
      promptText: (pm?.text as string) ?? '',
      promptCategory: (pm?.category as string | null) ?? undefined,
      topicId: (pm?.topicId as string | null) ?? undefined,
      topicName: pm?.topicId
        ? (topicMap.get(pm.topicId) ?? (pm?.category as string | null) ?? undefined)
        : ((pm?.category as string | null) ?? undefined),
    };
  });

  return { results, total };
}

export interface TrackedPromptsKpi {
  /** Distinct prompts with results in the filtered window (shopping excluded). */
  activeInPeriod: number;
  /** Org-wide prompt count — the number the plan limit is enforced against. */
  quotaUsed: number;
  /** Effective org limit with Enterprise plan_overrides merged; -1 = unlimited. */
  quotaLimit: number;
}

export interface VisibilityRateKpi {
  /** Distinct prompts with >= 1 answer mentioning or citing the brand. */
  visiblePrompts: number;
  /** Result rows where the brand appeared. */
  visibleResults: number;
  /** Average visibility score over only the rows the brand appeared in. */
  avgScoreWhenVisible: number;
}

/**
 * Visibility Rate KPI — the "appeared" side of the how-often ⁄ how-good
 * split. Averaging visibility over ALL results reads near zero for most
 * brands (absent answers contribute 0 each), so the headline shows how many
 * tracked prompts the brand actually surfaced in, and the average score of
 * only those appearances. Same filters and shopping exclusion as the rest of
 * the KPI row; the rate's denominator is TrackedPromptsKpi.activeInPeriod.
 */
export async function getVisibilityRateKpi(
  brandId: string,
  opts?: { model?: string; region?: string; dateFrom?: string; dateTo?: string; topicId?: string },
): Promise<VisibilityRateKpi> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('visible_prompt_stats', {
    p_brand_id: brandId,
    p_platform: null,
    p_models: modelFilterArray(opts?.model),
    p_region: opts?.region ?? null,
    p_date_from: opts?.dateFrom ?? null,
    p_date_to: expandDateToEndOfDay(opts?.dateTo) ?? null,
    p_topic_id: opts?.topicId ?? null,
  });
  if (error) throw new Error(error.message);

  const row = (data ?? {}) as {
    visible_prompts?: number;
    visible_results?: number;
    sum_visibility_visible?: number;
  };
  const visibleResults = Number(row.visible_results ?? 0);
  return {
    visiblePrompts: Number(row.visible_prompts ?? 0),
    visibleResults,
    avgScoreWhenVisible:
      visibleResults > 0 ? Math.round(Number(row.sum_visibility_visible ?? 0) / visibleResults) : 0,
  };
}

/**
 * Tracked Prompts KPI (#457). The main value is period-aware — distinct
 * prompts that produced results under the SAME filters as the other KPI
 * cards (the `tracked_prompt_count` RPC mirrors `insights_aggregates`,
 * shopping excluded) — because a static account-state number sitting in a
 * filter-reactive row would read as inconsistent. The quota sub-line is
 * deliberately a "now" fact: org-wide usage against the effective plan
 * limit, matching what `enforceLimit` counts on write.
 */
export async function getTrackedPromptsKpi(
  brandId: string,
  opts?: { model?: string; region?: string; dateFrom?: string; dateTo?: string; topicId?: string },
): Promise<TrackedPromptsKpi> {
  const supabase = await createClient();

  const { data: brand } = await supabase
    .from('brands')
    .select('organization_id')
    .eq('id', brandId)
    .single();
  const orgId = (brand?.organization_id as string | undefined) ?? null;

  const countOrgPrompts = async (): Promise<number> => {
    if (!orgId) return 0;
    const { count } = await supabase
      .from('prompts')
      .select('id, prompt_sets!inner(brand_id, brands!inner(organization_id))', {
        count: 'exact',
        head: true,
      })
      .eq('prompt_sets.brands.organization_id', orgId);
    return count ?? 0;
  };

  const [rpcResult, plan, quotaUsed] = await Promise.all([
    supabase.rpc('tracked_prompt_count', {
      p_brand_id: brandId,
      p_platform: null,
      p_models: modelFilterArray(opts?.model),
      p_region: opts?.region ?? null,
      p_date_from: opts?.dateFrom ?? null,
      p_date_to: expandDateToEndOfDay(opts?.dateTo) ?? null,
      p_topic_id: opts?.topicId ?? null,
    }),
    orgId ? getOrgPlan(orgId) : Promise.resolve(null),
    countOrgPrompts(),
  ]);
  if (rpcResult.error) throw new Error(rpcResult.error.message);

  return {
    activeInPeriod: (rpcResult.data as number | null) ?? 0,
    quotaUsed,
    quotaLimit: plan?.limits.maxPrompts ?? -1,
  };
}

export interface InsightsFilterOptions {
  /** Distinct result regions for the brand (shopping excluded), sorted. */
  regions: string[];
  /** Distinct model_used slugs for the brand (shopping excluded), sorted. */
  models: string[];
}

/**
 * Filter dropdown options for the Insights page (#458). These used to be
 * derived client-side from the removed results tree's 1500-row fetch; one
 * DISTINCT scan in Postgres returns the same sets without shipping rows.
 * Deliberately unfiltered (whole-brand): the dropdowns must keep offering
 * every value the brand has ever produced, not just the current window's.
 */
async function getInsightsFilterOptions(brandId: string): Promise<InsightsFilterOptions> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('insights_filter_options', { p_brand_id: brandId });
  if (error) throw new Error(error.message);
  const row = (data as { regions: string[] | null; models: string[] | null }[] | null)?.[0];
  return {
    regions: row?.regions ?? [],
    models: row?.models ?? [],
  };
}

export interface TopicOpportunity {
  keyword: string;
  estimatedAiVolume: number;
  promptCount: number;
}

export interface PromptOpportunity {
  id: string;
  text: string;
  topicName?: string;
  estVolume?: number;
}

export interface InsightsRecommendations {
  topics: TopicOpportunity[];
  prompts: PromptOpportunity[];
}

/** Items per Recommendations teaser card on the Insights page (#459). */
const RECOMMENDATION_ITEM_LIMIT = 5;

/**
 * Teaser data for the Insights Recommendations row (#459): the top stored
 * similar-topic clusters and prompt suggestions. Both are bounded reads of
 * already-persisted data — generation only ever happens from the Prompts
 * page's explicit refresh actions, never from the Insights load path.
 * Each read degrades independently to an empty list on failure so a hiccup
 * here can never take the Insights page down with it.
 */
async function getInsightsRecommendations(brandId: string): Promise<InsightsRecommendations> {
  const [topics, prompts] = await Promise.all([
    getPromptVolumes(brandId)
      .then(({ volumes }) =>
        aggregatePromptVolumeClusters(volumes)
          .slice(0, RECOMMENDATION_ITEM_LIMIT)
          .map((c) => ({
            keyword: c.keyword,
            estimatedAiVolume: c.estimatedAiVolume,
            promptCount: c.prompts.length,
          })),
      )
      .catch(() => [] as TopicOpportunity[]),
    getPromptSuggestions(brandId)
      .then(({ suggestions }) =>
        suggestions.slice(0, RECOMMENDATION_ITEM_LIMIT).map((s) => ({
          id: s.id,
          text: s.suggestedText,
          topicName: s.topicName ?? undefined,
          estVolume: s.estVolume ?? undefined,
        })),
      )
      .catch(() => [] as PromptOpportunity[]),
  ]);
  return { topics, prompts };
}

/** Cheap existence check for a brand's (non-shopping) prompt_results — counts, no rows. */
async function getBrandResultsTotal(brandId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('prompt_results')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .neq('platform', 'chatgpt-shopping');
  // Throw rather than swallow: a failed count must not masquerade as "no data"
  // and silently flip the page to its empty state.
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export interface InsightsData {
  summary: InsightsSummary;
  competitors: CompetitorComparisonData;
  sov: ShareOfVoiceData;
  trackedPrompts: TrackedPromptsKpi;
  visibilityRate: VisibilityRateKpi;
  filterOptions: InsightsFilterOptions;
  recommendations: InsightsRecommendations;
  hasAnyData: boolean;
}

/**
 * One consolidated server action for the Insights page's first load (#313).
 *
 * Next.js runs server actions sequentially (each is its own queued POST), so
 * firing the summary / competitor / SoV reads separately from the client cost
 * roughly their sum, not the slowest. This runs them in a real server-side
 * `Promise.all` (genuinely parallel, one round trip), and derives "has any
 * data" from a cheap count instead of the old unbounded full-table scan.
 * The raw prompt_results rows are no longer part of the payload — the
 * "Prompt Results by Topic" tree they fed was removed in #458.
 */
export async function getInsightsData(
  brandId: string,
  opts: {
    model?: string;
    region?: string;
    topicId?: string;
    dateFrom?: string;
    dateTo?: string;
    /** When the current view is filtered, check unfiltered data existence too. */
    checkUnfiltered?: boolean;
  },
): Promise<InsightsData> {
  const filterOpts = {
    model: opts.model,
    region: opts.region,
    topicId: opts.topicId,
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
  };

  const [
    summary,
    competitors,
    sov,
    trackedPrompts,
    visibilityRate,
    filterOptions,
    recommendations,
    unfilteredTotal,
  ] = await Promise.all([
    getInsightsSummary(brandId, filterOpts),
    getCompetitorComparison(brandId, filterOpts),
    getShareOfVoiceData(brandId, filterOpts),
    getTrackedPromptsKpi(brandId, filterOpts),
    getVisibilityRateKpi(brandId, filterOpts),
    getInsightsFilterOptions(brandId),
    getInsightsRecommendations(brandId),
    opts.checkUnfiltered ? getBrandResultsTotal(brandId) : Promise.resolve(null),
  ]);

  // insights_aggregates counts the same filtered set the summary shows, so it
  // stands in for the removed results fetch when no unfiltered check ran.
  const hasAnyData = unfilteredTotal !== null ? unfilteredTotal > 0 : summary.totalResults > 0;

  return {
    summary,
    competitors,
    sov,
    trackedPrompts,
    visibilityRate,
    filterOptions,
    recommendations,
    hasAnyData,
  };
}

/**
 * Fetch all prompt results for export, bypassing the default 1000 limit by paginating.
 * Applies a hard ceiling to prevent OOM errors on massive datasets.
 */
export async function exportPromptResults(
  brandId: string,
  opts?: {
    platform?: string;
    model?: string;
    region?: string;
    dateFrom?: string;
    dateTo?: string;
    promptId?: string;
    topicId?: string;
  },
): Promise<{ results: PromptResultWithText[]; isCapped: boolean }> {
  const allRows: Record<string, unknown>[] = [];
  const pageSize = 1000;
  const hardCeiling = 50000;
  let isCapped = false;
  let offset = 0;

  while (true) {
    const { query } = await buildResultsQuery(brandId, opts);
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];
    allRows.push(...rows);

    if (rows.length < pageSize) {
      break; // Reached the end
    }

    offset += pageSize;
    if (offset >= hardCeiling) {
      isCapped = true;
      break;
    }
  }

  const { supabase } = await buildResultsQuery(brandId, opts);

  const promptIds = [...new Set(allRows.map((r) => r.prompt_id as string))];
  const promptRowsRaw: Record<string, unknown>[] = [];
  const chunkSize = 500;

  for (let i = 0; i < promptIds.length; i += chunkSize) {
    const chunk = promptIds.slice(i, i + chunkSize);
    if (chunk.length > 0) {
      const { data: pRows } = await supabase
        .from('prompts')
        .select('id, text, category, topic_id')
        .in('id', chunk);
      if (pRows) {
        promptRowsRaw.push(...(pRows as unknown as Record<string, unknown>[]));
      }
    }
  }

  const topicIds = [
    ...new Set(promptRowsRaw.map((p) => p.topic_id as string | null).filter(Boolean) as string[]),
  ];
  const topicRowsRaw: Record<string, unknown>[] = [];

  for (let i = 0; i < topicIds.length; i += chunkSize) {
    const chunk = topicIds.slice(i, i + chunkSize);
    if (chunk.length > 0) {
      const { data: tRows } = await supabase.from('topics').select('id, name').in('id', chunk);
      if (tRows) {
        topicRowsRaw.push(...(tRows as Record<string, unknown>[]));
      }
    }
  }

  const topicMap = new Map(topicRowsRaw.map((t) => [t.id as string, t.name as string]));

  const promptMap = new Map(
    promptRowsRaw.map((p) => [
      p.id as string,
      {
        text: p.text as string,
        category: p.category as string | null,
        topicId: p.topic_id as string | null,
      },
    ]),
  );

  const results = allRows.map((r) => {
    const pm = promptMap.get(r.prompt_id as string);
    return {
      ...mapResultRow(r),
      promptText: (pm?.text as string) ?? '',
      promptCategory: (pm?.category as string | null) ?? undefined,
      topicId: (pm?.topicId as string | null) ?? undefined,
      topicName: pm?.topicId
        ? (topicMap.get(pm.topicId) ?? (pm?.category as string | null) ?? undefined)
        : ((pm?.category as string | null) ?? undefined),
    };
  });

  return { results, isCapped };
}

/**
 * Fetch a single prompt result by its ID, joining prompt text.
 */
export async function getPromptResultById(resultId: string): Promise<PromptResultWithText | null> {
  const supabase = await createClient();

  // #155 — Insights detail view; chatgpt-shopping is excluded here for the
  // same reason the aggregates exclude it. Shopping rows are shown by the
  // Shopping dashboard, not Insights.
  const { data, error } = await supabase
    .from('prompt_results')
    .select('*')
    .eq('id', resultId)
    .neq('platform', 'chatgpt-shopping')
    .single();

  if (error || !data) return null;

  const row = data as Record<string, unknown>;
  const { data: promptData } = await supabase
    .from('prompts')
    .select('text, category, topic_id')
    .eq('id', row.prompt_id as string)
    .single();

  const prompt = promptData as unknown as Record<string, unknown> | null;

  let topicName: string | undefined;
  if (prompt?.topic_id) {
    const { data: topic } = await supabase
      .from('topics')
      .select('name')
      .eq('id', prompt.topic_id as string)
      .single();
    topicName = (topic?.name as string) ?? undefined;
  }
  if (!topicName && prompt?.category) {
    topicName = prompt.category as string;
  }

  return {
    ...mapResultRow(row),
    promptText: (prompt?.text as string) ?? '',
    promptCategory: (prompt?.category as string | null) ?? undefined,
    topicId: (prompt?.topic_id as string | null) ?? undefined,
    topicName,
  };
}

/**
 * Fetch one prompt and its recent tracking results for the prompt detail page.
 */
export async function getPromptDetail(
  promptId: string,
  opts?: { limit?: number; dateFrom?: string; dateTo?: string },
): Promise<PromptDetailData | null> {
  const supabase = await createClient();

  const { data: promptData, error: promptError } = await supabase
    .from('prompts')
    .select('id, prompt_set_id, text, category, topic_id, is_active, created_at')
    .eq('id', promptId)
    .single();

  if (promptError || !promptData) return null;

  const prompt = promptData as unknown as Record<string, unknown>;
  const promptSetId = prompt.prompt_set_id as string;

  const { data: promptSetData } = await supabase
    .from('prompt_sets')
    .select('brand_id')
    .eq('id', promptSetId)
    .single();

  const brandId = (promptSetData?.brand_id as string | undefined) ?? '';

  // Brand + competitor domains feed classifyDomain, same as the citations page.
  // The extra query pins lastCheckedAt to the prompt's true latest run so the
  // "Last run" badge doesn't move (or empty out) when a date window is applied.
  const [{ data: brandDomainRows }, { data: competitorRows }, { data: lastRunRows }] =
    await Promise.all([
      supabase.from('brand_domains').select('domain').eq('brand_id', brandId),
      supabase.from('competitors').select('domain').eq('brand_id', brandId),
      supabase
        .from('prompt_results')
        .select('created_at')
        .eq('prompt_id', promptId)
        .neq('platform', 'chatgpt-shopping')
        .order('created_at', { ascending: false })
        .limit(1),
    ]);
  const lastCheckedAt = (lastRunRows?.[0]?.created_at as string | undefined) ?? null;
  const classifyCtx = {
    brandDomains: (brandDomainRows ?? [])
      .map((r) => normalizeDomain((r as { domain: string }).domain))
      .filter(Boolean),
    competitorDomains: (competitorRows ?? [])
      .map((r) => normalizeDomain((r as { domain: string }).domain))
      .filter(Boolean),
  };

  let topicName: string | undefined;
  if (prompt.topic_id) {
    const { data: topic } = await supabase
      .from('topics')
      .select('name')
      .eq('id', prompt.topic_id as string)
      .single();
    topicName = (topic?.name as string) ?? undefined;
  }
  if (!topicName && prompt.category) {
    topicName = prompt.category as string;
  }

  // #155 — same isolation rule as the other aggregating queries here.
  let resultQuery = supabase
    .from('prompt_results')
    .select('*')
    .eq('prompt_id', promptId)
    .neq('platform', 'chatgpt-shopping');
  if (opts?.dateFrom) resultQuery = resultQuery.gte('created_at', opts.dateFrom);
  const expandedDateTo = expandDateToEndOfDay(opts?.dateTo);
  if (expandedDateTo) resultQuery = resultQuery.lte('created_at', expandedDateTo);
  const { data: resultRows, error: resultError } = await resultQuery
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 500);

  if (resultError) throw new Error(resultError.message);

  const rows = (resultRows ?? []) as unknown as Record<string, unknown>[];
  const results: PromptResultWithText[] = rows.map((row) => ({
    ...mapResultRow(row),
    promptText: prompt.text as string,
    promptCategory: (prompt.category as string | null) ?? undefined,
    topicId: (prompt.topic_id as string | null) ?? undefined,
    topicName,
  }));

  const totalResults = results.length;
  const avgVisibilityScore =
    totalResults > 0
      ? Math.round(results.reduce((sum, row) => sum + row.visibilityScore, 0) / totalResults)
      : 0;

  // Aggregate citations by domain — same shape and rounding as getCitationsOverview,
  // but scoped to this prompt's already-loaded results.
  interface SourceAgg {
    domain: string;
    category: SourceCategory;
    totalCitations: number;
    resultsCiting: Set<string>;
    models: Set<string>;
  }
  interface UrlAgg extends SourceAgg {
    url: string;
    title: string;
  }
  const sourceMap = new Map<string, SourceAgg>();
  const urlMap = new Map<string, UrlAgg>();
  for (const result of results) {
    const modelKey = result.modelUsed || result.platform || '';
    for (const cite of result.citations) {
      const host = extractHostname(cite.url);
      if (!host) continue;
      const category = sourceMap.get(host)?.category ?? classifyDomain(host, classifyCtx);

      const agg = sourceMap.get(host) ?? {
        domain: host,
        category,
        totalCitations: 0,
        resultsCiting: new Set<string>(),
        models: new Set<string>(),
      };
      agg.totalCitations += 1;
      agg.resultsCiting.add(result.id);
      if (modelKey) agg.models.add(modelKey);
      sourceMap.set(host, agg);

      // URL aggregation (strip query/fragment and trailing slash for dedupe,
      // same as getCitationsOverview).
      let normalizedUrl = cite.url;
      try {
        const parsed = new URL(cite.url);
        parsed.search = '';
        parsed.hash = '';
        normalizedUrl = parsed.toString().replace(/\/$/, '');
      } catch {
        // leave as-is
      }
      const urlAgg = urlMap.get(normalizedUrl) ?? {
        url: normalizedUrl,
        domain: host,
        category,
        title: cite.title || '',
        totalCitations: 0,
        resultsCiting: new Set<string>(),
        models: new Set<string>(),
      };
      urlAgg.totalCitations += 1;
      urlAgg.resultsCiting.add(result.id);
      if (modelKey) urlAgg.models.add(modelKey);
      if (!urlAgg.title && cite.title) urlAgg.title = cite.title;
      urlMap.set(normalizedUrl, urlAgg);
    }
  }
  const usagePctOf = (resultsCiting: number) =>
    totalResults > 0 ? Math.round((resultsCiting / totalResults) * 1000) / 10 : 0;
  const topSources: PromptTopSource[] = Array.from(sourceMap.values())
    .map((agg) => ({
      domain: agg.domain,
      category: agg.category,
      models: Array.from(agg.models).sort(),
      totalCitations: agg.totalCitations,
      resultsCiting: agg.resultsCiting.size,
      usagePct: usagePctOf(agg.resultsCiting.size),
    }))
    .sort((a, b) => b.totalCitations - a.totalCitations || a.domain.localeCompare(b.domain));
  const topSourceUrls: PromptTopSourceUrl[] = Array.from(urlMap.values())
    .map((agg) => ({
      url: agg.url,
      domain: agg.domain,
      category: agg.category,
      title: agg.title,
      models: Array.from(agg.models).sort(),
      totalCitations: agg.totalCitations,
      resultsCiting: agg.resultsCiting.size,
      usagePct: usagePctOf(agg.resultsCiting.size),
    }))
    .sort((a, b) => b.totalCitations - a.totalCitations || a.url.localeCompare(b.url));

  return {
    prompt: {
      id: prompt.id as string,
      brandId,
      text: prompt.text as string,
      category: (prompt.category as string | null) ?? undefined,
      topicId: (prompt.topic_id as string | null) ?? undefined,
      topicName,
      isActive: Boolean(prompt.is_active),
      createdAt: prompt.created_at as string,
    },
    summary: {
      avgVisibilityScore,
      totalMentions: results.reduce((sum, row) => sum + row.mentionCount, 0),
      totalCitations: results.reduce((sum, row) => sum + row.citationCount, 0),
      totalResults,
      lastCheckedAt,
    },
    results,
    topSources,
    topSourceUrls,
  };
}

/**
 * Compute aggregated insights for a brand with proper date filtering.
 */
export async function getInsightsSummary(
  brandId: string,
  opts?: {
    model?: string;
    region?: string;
    dateFrom?: string;
    dateTo?: string;
    topicId?: string;
  },
): Promise<InsightsSummary> {
  const supabase = await createClient();
  const p_models = modelFilterArray(opts?.model);

  // Sums + counts come from Postgres in one round trip; we still do the
  // final divide + round in JS so the displayed numbers track the old
  // reducer math exactly (verified by the parity test in 00006).
  const baseArgs = {
    p_brand_id: brandId,
    p_platform: null as string | null,
    p_models,
    p_region: opts?.region ?? null,
    p_prompt_id: null as string | null,
    p_topic_id: opts?.topicId ?? null,
  };

  const { data: curData, error } = await supabase.rpc('insights_aggregates', {
    ...baseArgs,
    p_date_from: opts?.dateFrom ?? null,
    p_date_to: expandDateToEndOfDay(opts?.dateTo) ?? null,
  });
  if (error) throw new Error(error.message);

  const cur = curData as unknown as InsightsAggregates;

  if (cur.total_results === 0) {
    return {
      avgVisibilityScore: 0,
      totalMentions: 0,
      totalCitations: 0,
      positiveSentimentPct: 0,
      totalResults: 0,
      lastCheckedAt: null,
      platformBreakdown: [],
      visibilityChange: null,
      mentionsChange: null,
      citationsChange: null,
      prevMentions: null,
      prevCitations: null,
      sentimentChange: null,
    };
  }

  const totalResults = cur.total_results;
  // Average visibility across ALL runs (brand-mentioned or not) — the intended
  // "absolute visibility" metric. Keep one decimal instead of rounding to a
  // whole number: a brand that appears in a small fraction of answers can have
  // a genuine sub-1 average (e.g. 0.4), and integer rounding collapsed that to
  // a flat "0" that read like a broken metric next to non-zero mentions.
  const avgVisibilityScore = roundTo1(cur.sum_visibility / totalResults);
  const totalMentions = cur.total_mentions;
  const totalCitations = cur.total_citations;
  const positiveSentimentPct = Math.round((cur.positive_count / totalResults) * 100);
  const lastCheckedAt = cur.last_checked_at;

  const platformBreakdown = cur.by_model.map((m) => ({
    platform: m.model_used,
    avgScore: m.result_count > 0 ? Math.round(m.sum_visibility / m.result_count) : 0,
    resultCount: m.result_count,
  }));

  // --- Previous period comparison ---
  let visibilityChange: number | null = null;
  let mentionsChange: number | null = null;
  let citationsChange: number | null = null;
  let prevMentions: number | null = null;
  let prevCitations: number | null = null;
  let sentimentChange: number | null = null;

  {
    let currentFrom: Date;
    let currentTo: Date;

    if (opts?.dateFrom) {
      currentFrom = new Date(opts.dateFrom);
      currentTo = opts.dateTo ? new Date(opts.dateTo) : new Date();
    } else {
      currentTo = new Date();
      currentFrom = new Date();
      currentFrom.setDate(currentFrom.getDate() - 7);
    }

    const duration = currentTo.getTime() - currentFrom.getTime();
    const prevFrom = new Date(currentFrom.getTime() - duration);

    // Current-window aggregate: when no dateFrom was passed, the top-level
    // call above is unbounded — for the delta math we need the same
    // explicit "last 7 days" window the JS code used so the comparison
    // stays anchored to recent momentum.
    const [curRes, prevRes] = await Promise.all([
      supabase.rpc('insights_aggregates', {
        ...baseArgs,
        p_date_from: opts?.dateFrom ?? currentFrom.toISOString(),
        p_date_to: expandDateToEndOfDay(opts?.dateTo) ?? null,
      }),
      supabase.rpc('insights_aggregates', {
        ...baseArgs,
        p_date_from: prevFrom.toISOString(),
        p_date_to: currentFrom.toISOString(),
      }),
    ]);
    // Surface RPC failures rather than silently emit null deltas — masking
    // server-side errors here would hide real outages behind "no change."
    if (curRes.error) throw new Error(curRes.error.message);
    if (prevRes.error) throw new Error(prevRes.error.message);

    const curWin = curRes.data as unknown as InsightsAggregates | null;
    const prevWin = prevRes.data as unknown as InsightsAggregates | null;

    if (curWin && prevWin && curWin.total_results > 0 && prevWin.total_results > 0) {
      const curAvgVis = roundTo1(curWin.sum_visibility / curWin.total_results);
      const curMentions = curWin.total_mentions;
      const curCitations = curWin.total_citations;
      const curSentimentPct = Math.round((curWin.positive_count / curWin.total_results) * 100);

      const prevAvgVis = roundTo1(prevWin.sum_visibility / prevWin.total_results);
      prevMentions = prevWin.total_mentions;
      prevCitations = prevWin.total_citations;
      const prevSentimentPct = Math.round((prevWin.positive_count / prevWin.total_results) * 100);

      visibilityChange = roundTo1(curAvgVis - prevAvgVis);
      mentionsChange = percentageChange(curMentions, prevMentions);
      citationsChange = percentageChange(curCitations, prevCitations);
      sentimentChange = curSentimentPct - prevSentimentPct;
    }
  }

  return {
    avgVisibilityScore,
    totalMentions,
    totalCitations,
    positiveSentimentPct,
    totalResults,
    lastCheckedAt,
    platformBreakdown,
    visibilityChange,
    mentionsChange,
    citationsChange,
    prevMentions,
    prevCitations,
    sentimentChange,
  };
}

/**
 * Trigger a tracking check via the aeo-server API.
 * Pass promptId to run a single prompt instead of all.
 */
export async function triggerTrackingCheck(
  brandId: string,
  opts?: { promptId?: string },
): Promise<{ jobId: string }> {
  const supabase = await createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const serverUrl = API_BASE_URL;

  const payload: Record<string, string> = { brandId };
  if (opts?.promptId) payload.promptId = opts.promptId;

  const res = await fetch(`${serverUrl}/api/tracking/check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return { jobId: data.jobId };
}

export interface TrackingJobStatus {
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'not_found';
  progress: {
    current: number;
    total: number;
    promptText?: string;
    model?: string;
    region?: string;
    platform?: string;
  } | null;
  result: { resultCount: number } | null;
  failedReason: string | null;
}

/**
 * Poll a tracking job's status from the aeo-server.
 */
export async function getJobStatus(jobId: string): Promise<TrackingJobStatus> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const serverUrl = API_BASE_URL;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${serverUrl}/api/tracking/job/${jobId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        status: 'not_found',
        progress: null,
        result: null,
        failedReason: null,
      };
    }

    const data = await res.json();
    return {
      status: data.status ?? 'not_found',
      progress:
        data.progress && typeof data.progress === 'object' && data.progress.total
          ? data.progress
          : null,
      result: data.result ?? null,
      failedReason: data.failedReason ?? null,
    };
  } catch {
    return {
      status: 'not_found',
      progress: null,
      result: null,
      failedReason: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Cancel/stop an active tracking job.
 */
export async function cancelTrackingJob(jobId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const serverUrl = API_BASE_URL;

  await fetch(`${serverUrl}/api/tracking/job/${jobId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
}

export interface PromptVisibilitySummary {
  avgVisibility: number;
  totalMentions: number;
  runs: number;
  lastRunAt: string;
}

/**
 * Aggregate visibility + mention stats per prompt for a brand, over the
 * last N days (default 30). Used by the All Prompts tab to show a quick
 * health column next to each prompt.
 *
 * Returns a map keyed by prompt_id. Prompts without any runs in the window
 * simply won't appear in the map (callers should render "—").
 */
export async function getPromptVisibilitySummaries(
  brandId: string,
  opts?: { days?: number },
): Promise<Record<string, PromptVisibilitySummary>> {
  const supabase = await createClient();
  const days = opts?.days ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // One GROUP BY in Postgres (migration 00025) instead of pulling the raw
  // result window into JS: the old un-paginated select silently capped at
  // 1000 rows (wrong health columns on busy brands — the #430/#464 defect
  // family) and its transfer cost slowed the Prompts page's first load.
  // The RPC excludes chatgpt-shopping (#155) like every analytical surface.
  const { data, error } = await supabase.rpc('prompt_visibility_summaries', {
    p_brand_id: brandId,
    p_date_from: since,
  });

  if (error) throw new Error(error.message);

  const result: Record<string, PromptVisibilitySummary> = {};
  for (const row of data ?? []) {
    result[row.prompt_id] = {
      avgVisibility: row.avg_visibility ?? 0,
      totalMentions: Number(row.total_mentions ?? 0),
      runs: Number(row.runs ?? 0),
      lastRunAt: row.last_run_at,
    };
  }
  return result;
}

/**
 * Fetch active prompts for a brand (for the prompt selector).
 */
export async function getBrandPrompts(
  brandId: string,
): Promise<{ id: string; text: string; category?: string; platforms: string[] }[]> {
  const supabase = await createClient();

  const { data: promptSets } = await supabase
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);

  if (!promptSets || promptSets.length === 0) return [];

  const setIds = promptSets.map((s) => s.id);

  const { data: prompts, error } = await supabase
    .from('prompts')
    .select('id, text, category, platforms')
    .in('prompt_set_id', setIds)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return (prompts ?? []).map((p) => ({
    id: p.id as string,
    text: p.text as string,
    category: (p.category as string | null) ?? undefined,
    platforms: (p.platforms as string[]) ?? [],
  }));
}

export interface CompetitorComparisonEntry {
  name: string;
  avgVisibilityScore: number;
  /**
   * Prompt-level visibility rate (%): distinct prompts this entity appeared
   * in ÷ distinct prompts that produced results in the window. Same
   * denominator for the brand and every competitor — the leaderboard metric.
   */
  visibilityRate: number;
  /** Distinct prompts this entity appeared in (the rate's numerator). */
  visiblePrompts: number;
  /** Distinct prompts that produced results in the window (shared denominator). */
  promptCount: number;
  /**
   * Point change of the visibility rate versus the previous comparable
   * window (e.g. last 7 days vs the 7 days before that).
   * `null` when there is no comparable previous-period value.
   */
  change: number | null;
  totalMentions: number;
  totalCitations: number;
  resultCount: number;
  isOwnBrand: boolean;
}

export interface ProviderComparisonRow {
  provider: string;
  [brandName: string]: string | number;
}

export interface CompetitorComparisonData {
  brands: CompetitorComparisonEntry[];
  providerRows: ProviderComparisonRow[];
}

const MODEL_TO_PROVIDER: Record<string, string> = {
  'gpt-5-chat-latest': 'ChatGPT',
  'gpt-5-mini': 'ChatGPT',
  'gpt-4o': 'ChatGPT',
  'claude-sonnet-5': 'Claude',
  'claude-sonnet-4-6': 'Claude',
  'claude-opus-4-6': 'Claude',
  'gemini-2.5-pro': 'Gemini',
  'gemini-2.5-flash': 'Gemini',
};

const SCRAPER_PROVIDER: Record<string, string> = {
  chatgpt: 'ChatGPT',
  'chatgpt-web': 'ChatGPT',
  'google-aio': 'Google AI Overview',
  'google-aimode': 'Google AI Mode',
  'copilot-web': 'Microsoft Copilot',
  'grok-web': 'Grok',
  'perplexity-web': 'Perplexity',
  'gemini-web': 'Gemini',
};

function resolveProvider(modelUsed: string | null | undefined, platform?: string | null): string {
  if (platform && SCRAPER_PROVIDER[platform]) return SCRAPER_PROVIDER[platform];
  if (!modelUsed) return 'Unknown';
  const mapped = MODEL_TO_PROVIDER[modelUsed];
  if (mapped) return mapped;
  if (modelUsed.startsWith('gpt-')) return 'ChatGPT';
  if (modelUsed.startsWith('claude-')) return 'Claude';
  if (modelUsed.startsWith('gemini-')) return 'Gemini';
  if (modelUsed.startsWith('sonar')) return 'Perplexity';
  if (modelUsed.startsWith('grok')) return 'Grok';
  return modelUsed;
}

/**
 * Aggregate competitor comparison data from prompt results.
 * Returns both flat brand scores and per-provider breakdown.
 *
 * Server-side aggregation lives in the competitor_aggregates RPC
 * (supabase/migrations/00006). This function only does the resolveProvider
 * fold + final divide/round — the heavy `select(*) + reduce` loop is gone.
 */
export async function getCompetitorComparison(
  brandId: string,
  opts?: {
    model?: string;
    region?: string;
    dateFrom?: string;
    dateTo?: string;
    topicId?: string;
  },
): Promise<CompetitorComparisonData> {
  const supabase = await createClient();
  const p_models = modelFilterArray(opts?.model);

  const baseArgs = {
    p_brand_id: brandId,
    p_platform: null as string | null,
    p_models,
    p_region: opts?.region ?? null,
    p_prompt_id: null as string | null,
    p_topic_id: opts?.topicId ?? null,
  };

  // Brand name + the displayed-period aggregate fire in parallel — both
  // are needed before we can shape the response.
  const [{ data: brand }, { data: aggDisplay, error: aggErr }] = await Promise.all([
    supabase.from('brands').select('name').eq('id', brandId).single(),
    supabase.rpc('competitor_aggregates', {
      ...baseArgs,
      p_date_from: opts?.dateFrom ?? null,
      p_date_to: expandDateToEndOfDay(opts?.dateTo) ?? null,
    }),
  ]);
  if (aggErr) throw new Error(aggErr.message);

  const agg = aggDisplay as unknown as CompetitorAggregatesRow;
  if (agg.brand_row_count === 0) return { brands: [], providerRows: [] };

  // --- Current vs previous period for change calculation ---
  // The displayed avg/totals come from `agg` (respects the selected preset),
  // but the ↑/↓ delta always compares a fixed "current" window to the window
  // immediately before it so the arrow reflects recent momentum (mirrors
  // getInsightsSummary's KPI change logic).
  let currentFrom: Date;
  let currentTo: Date;

  if (opts?.dateFrom) {
    currentFrom = new Date(opts.dateFrom);
    currentTo = opts.dateTo ? new Date(opts.dateTo) : new Date();
  } else {
    currentTo = new Date();
    currentFrom = new Date();
    currentFrom.setDate(currentFrom.getDate() - 7);
  }

  const duration = currentTo.getTime() - currentFrom.getTime();
  const prevFrom = new Date(currentFrom.getTime() - duration);

  const [curRes, prevRes] = await Promise.all([
    supabase.rpc('competitor_aggregates', {
      ...baseArgs,
      p_date_from: opts?.dateFrom ?? currentFrom.toISOString(),
      p_date_to: expandDateToEndOfDay(opts?.dateTo) ?? null,
    }),
    supabase.rpc('competitor_aggregates', {
      ...baseArgs,
      p_date_from: prevFrom.toISOString(),
      p_date_to: currentFrom.toISOString(),
    }),
  ]);
  if (curRes.error) throw new Error(curRes.error.message);
  if (prevRes.error) throw new Error(prevRes.error.message);

  const curWin = curRes.data as unknown as CompetitorAggregatesRow | null;
  const prevWin = prevRes.data as unknown as CompetitorAggregatesRow | null;

  // The leaderboard metric is the prompt-level visibility rate: distinct
  // prompts an entity appeared in ÷ distinct prompts that produced results.
  // Same-denominator rule as before (#478) — the brand and every competitor
  // divide by the same prompt count, so absence still costs; but a prompt
  // counts once no matter how many platforms answered it, which keeps the
  // number readable instead of the near-zero all-rows score average.
  const rateOf = (visible: number, prompts: number): number | null =>
    prompts > 0 ? Math.round((visible / prompts) * 1000) / 10 : null;

  const curBrandRate = curWin
    ? rateOf(curWin.brand_visible_prompts, curWin.brand_prompt_count)
    : null;
  const prevBrandRate = prevWin
    ? rateOf(prevWin.brand_visible_prompts, prevWin.brand_prompt_count)
    : null;

  const curCompRate = new Map<string, number | null>();
  if (curWin) {
    for (const c of curWin.by_competitor) {
      curCompRate.set(c.competitor_id, rateOf(c.visible_prompts, curWin.brand_prompt_count));
    }
  }
  const prevCompRate = new Map<string, number | null>();
  if (prevWin) {
    for (const c of prevWin.by_competitor) {
      prevCompRate.set(c.competitor_id, rateOf(c.visible_prompts, prevWin.brand_prompt_count));
    }
  }

  const brandName = (brand?.name as string) ?? 'Your Brand';
  const brandAvg = Math.round(agg.brand_sum_visibility / agg.brand_row_count);
  const brandRate = rateOf(agg.brand_visible_prompts, agg.brand_prompt_count) ?? 0;

  // Point change of the rate relative to the previous-period value.
  // Null when no comparable previous value exists.
  const rateDiff = (cur: number | null, prev: number | null): number | null => {
    if (cur === null || prev === null) return null;
    return Math.round((cur - prev) * 10) / 10;
  };

  // Falls back to the competitor id when the name is null/empty so two
  // unnamed competitors don't collide under the same empty-string key in
  // compByProvider below. Applied consistently to the entries[] name field
  // so the providerRows column header matches the table row label.
  const competitorDisplayName = (name: string | null | undefined, id: string): string =>
    name && name.trim() !== '' ? name : id;

  const entries: CompetitorComparisonEntry[] = [
    {
      name: brandName,
      avgVisibilityScore: brandAvg,
      visibilityRate: brandRate,
      visiblePrompts: agg.brand_visible_prompts,
      promptCount: agg.brand_prompt_count,
      change: rateDiff(curBrandRate, prevBrandRate),
      totalMentions: agg.brand_total_mentions,
      totalCitations: agg.brand_total_citations,
      resultCount: agg.brand_row_count,
      isOwnBrand: true,
    },
  ];

  for (const c of agg.by_competitor) {
    // Same-denominator rule as the window rates above (agg.brand_row_count
    // is guaranteed > 0 by the early return).
    const avg = Math.round(c.sum_visibility / agg.brand_row_count);
    entries.push({
      name: competitorDisplayName(c.name, c.competitor_id),
      avgVisibilityScore: avg,
      visibilityRate: rateOf(c.visible_prompts, agg.brand_prompt_count) ?? 0,
      visiblePrompts: c.visible_prompts,
      promptCount: agg.brand_prompt_count,
      change: rateDiff(
        curCompRate.get(c.competitor_id) ?? null,
        prevCompRate.get(c.competitor_id) ?? null,
      ),
      totalMentions: c.total_mentions,
      totalCitations: c.total_citations,
      resultCount: c.row_count,
      isOwnBrand: false,
    });
  }

  entries.sort((a, b) => b.visibilityRate - a.visibilityRate || b.totalMentions - a.totalMentions);

  // --- Per-provider breakdown ---
  // resolveProvider stays in JS so we don't keep a SQL copy of the mapping
  // table in sync — fold the (model_used, platform) groups into provider
  // buckets here. The chart plots the same prompt-level rate as the
  // leaderboard; summing DISTINCT counts across two engines of one provider
  // counts a shared prompt once per engine in numerator and denominator
  // alike, so the folded rate stays unbiased.
  type Agg = { visiblePrompts: number; promptCount: number };
  const brandByProvider = new Map<string, Agg>();
  for (const bp of agg.by_brand_provider) {
    const provider = resolveProvider(bp.model_used, bp.platform);
    const ex = brandByProvider.get(provider) ?? { visiblePrompts: 0, promptCount: 0 };
    ex.visiblePrompts += bp.visible_prompts;
    ex.promptCount += bp.prompt_count;
    brandByProvider.set(provider, ex);
  }

  // compName -> provider -> visible prompt count. Keyed by the same display
  // name used in entries[] above so the providerRows column headers line up
  // with the table rows (empty/null names fall back to competitor_id). No
  // denominator here — competitors divide by the brand's provider bucket.
  const compByProvider = new Map<string, Map<string, number>>();
  for (const cp of agg.by_competitor_provider) {
    const provider = resolveProvider(cp.model_used, cp.platform);
    const name = competitorDisplayName(cp.competitor_name, cp.competitor_id);
    if (!compByProvider.has(name)) compByProvider.set(name, new Map());
    const pm = compByProvider.get(name)!;
    pm.set(provider, (pm.get(provider) ?? 0) + cp.visible_prompts);
  }

  const allProviders = new Set<string>();
  for (const p of brandByProvider.keys()) allProviders.add(p);
  for (const pm of compByProvider.values()) {
    for (const p of pm.keys()) allProviders.add(p);
  }

  const providerRows: ProviderComparisonRow[] = [...allProviders].sort().map((provider) => {
    const row: ProviderComparisonRow = { provider };
    const bp = brandByProvider.get(provider);
    // Same-denominator rule: everyone divides by the brand bucket's prompt
    // count (which spans every filtered prompt for the provider), not their
    // own appearance count. Competitor rows are a subset of the brand's, so
    // bp always exists when a competitor has data for the provider.
    const denom = bp?.promptCount ?? 0;
    row[brandName] = bp && denom > 0 ? Math.round((bp.visiblePrompts / denom) * 1000) / 10 : 0;
    for (const [compName, pm] of compByProvider) {
      const visible = pm.get(provider) ?? 0;
      row[compName] = denom > 0 ? Math.round((visible / denom) * 1000) / 10 : 0;
    }
    return row;
  });

  return { brands: entries, providerRows };
}

// ─── Share of Voice ─────────────────────────────────────────────────────────

export interface SoVByPlatform {
  provider: string;
  brandMentions: number;
  competitorMentions: number;
  sov: number;
}

export interface SoVTrendPoint {
  date: string;
  brandSov: number;
  competitorSov: number;
}

export interface ShareOfVoiceData {
  overallSov: number;
  overallSovChange: number | null;
  byPlatform: SoVByPlatform[];
  trend: SoVTrendPoint[];
}

export async function getShareOfVoiceData(
  brandId: string,
  opts?: {
    model?: string;
    region?: string;
    dateFrom?: string;
    dateTo?: string;
    topicId?: string;
  },
): Promise<ShareOfVoiceData> {
  const supabase = await createClient();
  const p_models = modelFilterArray(opts?.model);

  const baseArgs = {
    p_brand_id: brandId,
    p_platform: null as string | null,
    p_models,
    p_region: opts?.region ?? null,
    p_prompt_id: null as string | null,
    p_topic_id: opts?.topicId ?? null,
  };

  // Current-period aggregate + previous-period aggregate run in parallel —
  // both server-side, no row transfer or JS reduce. The previous-period
  // window always anchors to "last 7 days" when the caller hasn't picked an
  // explicit dateFrom (matches the original delta logic for SoV).
  let currentFrom: Date;
  let currentTo: Date;
  if (opts?.dateFrom) {
    currentFrom = new Date(opts.dateFrom);
    currentTo = opts.dateTo ? new Date(opts.dateTo) : new Date();
  } else {
    currentTo = new Date();
    currentFrom = new Date();
    currentFrom.setDate(currentFrom.getDate() - 7);
  }
  const duration = currentTo.getTime() - currentFrom.getTime();
  const prevFrom = new Date(currentFrom.getTime() - duration);

  const [{ data: curData, error: curErr }, { data: prevData, error: prevErr }] = await Promise.all([
    supabase.rpc('share_of_voice_aggregates', {
      ...baseArgs,
      p_date_from: opts?.dateFrom ?? null,
      p_date_to: expandDateToEndOfDay(opts?.dateTo) ?? null,
    }),
    supabase.rpc('share_of_voice_aggregates', {
      ...baseArgs,
      p_date_from: prevFrom.toISOString(),
      p_date_to: currentFrom.toISOString(),
    }),
  ]);
  if (curErr) throw new Error(curErr.message);
  if (prevErr) throw new Error(prevErr.message);

  const cur = curData as unknown as ShareOfVoiceAggregatesRow;
  const prev = prevData as unknown as ShareOfVoiceAggregatesRow | null;

  const totalBrandMentions = Number(cur.total_brand_mentions);
  const totalCompMentions = Number(cur.total_competitor_mentions);

  if (totalBrandMentions === 0 && totalCompMentions === 0) {
    return { overallSov: 0, overallSovChange: null, byPlatform: [], trend: [] };
  }

  const totalAll = totalBrandMentions + totalCompMentions;
  const overallSov = totalAll > 0 ? Math.round((totalBrandMentions / totalAll) * 1000) / 10 : 0;

  // --- By provider ---
  // resolveProvider stays in JS so the SQL doesn't carry a duplicate of the
  // model/platform → provider mapping table.
  type ProviderAgg = { brandMentions: number; competitorMentions: number };
  const providerMap = new Map<string, ProviderAgg>();
  for (const bp of cur.by_platform) {
    const provider = resolveProvider(bp.model_used, bp.platform);
    const ex = providerMap.get(provider) ?? { brandMentions: 0, competitorMentions: 0 };
    ex.brandMentions += Number(bp.brand_mentions);
    ex.competitorMentions += Number(bp.competitor_mentions);
    providerMap.set(provider, ex);
  }

  const byPlatform: SoVByPlatform[] = [...providerMap.entries()]
    .map(([provider, agg]) => {
      const total = agg.brandMentions + agg.competitorMentions;
      return {
        provider,
        brandMentions: agg.brandMentions,
        competitorMentions: agg.competitorMentions,
        sov: total > 0 ? Math.round((agg.brandMentions / total) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.sov - a.sov);

  // --- Trend ---
  // RPC already returns by_day ordered by date ascending, but be defensive.
  const trend: SoVTrendPoint[] = [...cur.by_day]
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .map((d) => {
      const brand = Number(d.brand_mentions);
      const comp = Number(d.competitor_mentions);
      const total = brand + comp;
      const brandSov = total > 0 ? Math.round((brand / total) * 1000) / 10 : 0;
      const competitorSov = total > 0 ? Math.round((comp / total) * 1000) / 10 : 0;
      const dateObj = new Date(d.day + 'T00:00:00');
      const label = dateObj.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      return { date: label, brandSov, competitorSov };
    });

  // --- Previous period delta (overall SoV only) ---
  let overallSovChange: number | null = null;
  if (prev) {
    const prevBrandM = Number(prev.total_brand_mentions);
    const prevCompM = Number(prev.total_competitor_mentions);
    if (prevBrandM + prevCompM > 0) {
      const prevTotal = prevBrandM + prevCompM;
      const prevSov = prevTotal > 0 ? Math.round((prevBrandM / prevTotal) * 1000) / 10 : 0;
      overallSovChange = Math.round((overallSov - prevSov) * 10) / 10;
    }
  }

  return { overallSov, overallSovChange, byPlatform, trend };
}

export interface VisibilityTrendPoint {
  date: string;
  score: number;
  competitors: number | null;
}

/**
 * Fetch daily visibility score trend for a brand (and avg competitor score).
 * Queries ALL prompt_results (not deduplicated) to build a time-series.
 */
export async function getVisibilityTrend(
  brandId: string,
  opts?: {
    model?: string;
    region?: string;
    dateFrom?: string;
    dateTo?: string;
    topicId?: string;
  },
): Promise<VisibilityTrendPoint[]> {
  const supabase = await createClient();

  // #155 — visibility trend; exclude chatgpt-shopping to match the
  // aggregate RPCs. (The RPC variant in 00012_shopping_mode.sql is what
  // most callers hit; this JS path is used by the older codepath.)
  let query = supabase
    .from('prompt_results')
    .select('created_at, visibility_score, competitor_mentions')
    .eq('brand_id', brandId)
    .neq('platform', 'chatgpt-shopping')
    .order('created_at', { ascending: true });

  query = applyModelFilter(query, opts?.model);
  if (opts?.region) query = query.eq('region', opts.region);
  if (opts?.dateFrom) query = query.gte('created_at', opts.dateFrom);
  const expandedDateTo = expandDateToEndOfDay(opts?.dateTo);
  if (expandedDateTo) query = query.lte('created_at', expandedDateTo);

  if (opts?.topicId) {
    const { data: topicPrompts } = await supabase
      .from('prompts')
      .select('id')
      .eq('topic_id', opts.topicId);
    const ids = ((topicPrompts ?? []) as { id: string }[]).map((p) => p.id);
    query = query.in('prompt_id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  const rows = data as Record<string, unknown>[];

  // Group by day (YYYY-MM-DD)
  const dayMap = new Map<
    string,
    {
      totalScore: number;
      count: number;
      compTotalScore: number;
      compCount: number;
    }
  >();

  for (const row of rows) {
    const day = (row.created_at as string).slice(0, 10);
    const entry = dayMap.get(day) ?? {
      totalScore: 0,
      count: 0,
      compTotalScore: 0,
      compCount: 0,
    };
    entry.totalScore += row.visibility_score as number;
    entry.count += 1;

    const mentions = (row.competitor_mentions as CompetitorMention[] | null) ?? [];
    for (const cm of mentions) {
      entry.compTotalScore += cm.visibility_score;
      entry.compCount += 1;
    }

    dayMap.set(day, entry);
  }

  const points: VisibilityTrendPoint[] = [];
  const sortedDays = [...dayMap.keys()].sort();

  for (const day of sortedDays) {
    const d = dayMap.get(day)!;
    const dateObj = new Date(day + 'T00:00:00');
    const label = dateObj.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

    points.push({
      date: label,
      // One decimal, not integer rounding: realistic daily averages for a
      // low-visibility brand sit in the 0.3–1.5 band (see the sub-1 note on
      // getInsightsSummary), and Math.round crushed the whole window into a
      // flat "1" line on the chart.
      score: roundTo1(d.totalScore / d.count),
      competitors: d.compCount > 0 ? roundTo1(d.compTotalScore / d.compCount) : null,
    });
  }

  return points;
}

// ─── Head-to-Head Competitor Comparison ─────────────────────────────────────

export interface HeadToHeadPromptRow {
  resultId: string;
  promptId: string;
  promptText: string;
  promptCategory?: string;
  brandScore: number;
  competitorScore: number;
  diff: number;
  platform: string;
  modelUsed: string;
  region?: string;
  response: string;
  citations: Citation[];
  sentiment: Sentiment;
  brandMentionCount: number;
  brandCitationCount: number;
  compMentionCount: number;
  compCitationCount: number;
  createdAt: string;
}

export interface HeadToHeadPlatformRow {
  platform: string;
  brandScore: number;
  competitorScore: number;
  diff: number;
}

export interface HeadToHeadData {
  promptRows: HeadToHeadPromptRow[];
  platformRows: HeadToHeadPlatformRow[];
  brandAvg: number;
  competitorAvg: number;
  gaps: HeadToHeadPromptRow[];
  strengths: HeadToHeadPromptRow[];
}

/**
 * Compare a brand vs a single competitor prompt-by-prompt.
 * Returns per-prompt scores, per-platform breakdown, gaps and strengths.
 */
export async function getHeadToHeadComparison(
  brandId: string,
  competitorId: string,
): Promise<HeadToHeadData> {
  const supabase = await createClient();

  // #155 — head-to-head comparisons are a Competitors-tab feature, which
  // also lives under Insights — same isolation rule applies here.
  const { data: results, error } = await supabase
    .from('prompt_results')
    .select('*')
    .eq('brand_id', brandId)
    .neq('platform', 'chatgpt-shopping')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  const rows = (results ?? []) as Record<string, unknown>[];
  if (rows.length === 0) {
    return {
      promptRows: [],
      platformRows: [],
      brandAvg: 0,
      competitorAvg: 0,
      gaps: [],
      strengths: [],
    };
  }

  const promptIds = [...new Set(rows.map((r) => r.prompt_id as string))];
  const { data: promptData } =
    promptIds.length > 0
      ? await supabase.from('prompts').select('id, text, category').in('id', promptIds)
      : { data: [] };
  const promptMap = new Map(
    (promptData ?? []).map((p) => [
      p.id,
      {
        text: p.text as string,
        category: (p.category as string | null) ?? undefined,
      },
    ]),
  );

  const promptRows: HeadToHeadPromptRow[] = [];

  type PlatAgg = {
    brandTotal: number;
    brandCount: number;
    compTotal: number;
    compCount: number;
  };
  const platMap = new Map<string, PlatAgg>();

  let brandTotalScore = 0;
  let brandCount = 0;
  let compTotalScore = 0;
  let compCount = 0;

  for (const row of rows) {
    const brandScore = row.visibility_score as number;
    const platform = resolveProvider(
      row.model_used as string | null,
      row.platform as string | null,
    );
    const mentions = (row.competitor_mentions as CompetitorMention[] | null) ?? [];
    const comp = mentions.find((cm) => cm.competitor_id === competitorId);
    const compScore = comp?.visibility_score ?? 0;

    const pm = promptMap.get(row.prompt_id as string);

    const modelUsed = (row.model_used as string | null) ?? '';

    promptRows.push({
      resultId: row.id as string,
      promptId: row.prompt_id as string,
      promptText: pm?.text ?? '',
      promptCategory: pm?.category,
      brandScore,
      competitorScore: compScore,
      diff: brandScore - compScore,
      platform,
      modelUsed,
      region: (row.region as string | null) ?? undefined,
      response: (row.response as string) ?? '',
      citations: (row.citations as Citation[]) ?? [],
      sentiment: (row.sentiment as Sentiment) ?? 'neutral',
      brandMentionCount: row.mention_count as number,
      brandCitationCount: row.citation_count as number,
      compMentionCount: comp?.mention_count ?? 0,
      compCitationCount: comp?.citation_count ?? 0,
      createdAt: row.created_at as string,
    });

    brandTotalScore += brandScore;
    brandCount += 1;
    if (comp) {
      compTotalScore += compScore;
      compCount += 1;
    }

    const pa = platMap.get(platform) ?? {
      brandTotal: 0,
      brandCount: 0,
      compTotal: 0,
      compCount: 0,
    };
    pa.brandTotal += brandScore;
    pa.brandCount += 1;
    if (comp) {
      pa.compTotal += compScore;
      pa.compCount += 1;
    }
    platMap.set(platform, pa);
  }

  const platformRows: HeadToHeadPlatformRow[] = [...platMap.entries()]
    .map(([platform, a]) => {
      const bs = a.brandCount > 0 ? Math.round(a.brandTotal / a.brandCount) : 0;
      const cs = a.compCount > 0 ? Math.round(a.compTotal / a.compCount) : 0;
      return { platform, brandScore: bs, competitorScore: cs, diff: bs - cs };
    })
    .sort((a, b) => a.platform.localeCompare(b.platform));

  const brandAvg = brandCount > 0 ? Math.round(brandTotalScore / brandCount) : 0;
  const competitorAvg = compCount > 0 ? Math.round(compTotalScore / compCount) : 0;

  const sorted = [...promptRows].sort((a, b) => a.diff - b.diff);
  const gaps = sorted.filter((r) => r.diff < 0).slice(0, 10);
  const strengths = sorted
    .filter((r) => r.diff > 0)
    .reverse()
    .slice(0, 10);

  return { promptRows, platformRows, brandAvg, competitorAvg, gaps, strengths };
}

// ─── Insights Metric Breakdown (Root-Cause Drilldown) ─────────────────────────

export type BreakdownMetric = 'mentions' | 'visibility';

/**
 * Human-readable platform/scraper slugs used across the Insights UI.
 * Kept in sync with the mapping in insights/page.tsx so drill-down narratives
 * read like the rest of the dashboard ("Gemini" instead of "gemini-web").
 */
const BREAKDOWN_PLATFORM_LABELS: Record<string, string> = {
  chatgpt: 'ChatGPT',
  'chatgpt-web': 'ChatGPT',
  gemini: 'Gemini',
  'gemini-web': 'Google Gemini',
  perplexity: 'Perplexity',
  'perplexity-web': 'Perplexity',
  claude: 'Claude',
  grok: 'Grok',
  'grok-web': 'Grok',
  copilot: 'Copilot',
  'copilot-web': 'Microsoft Copilot',
  'meta-ai': 'Meta AI',
  'google-aio': 'Google AI Overview',
  'google-ai-overviews': 'Google AI Overview',
  'google-aimode': 'Google AI Mode',
  'google-ai-mode': 'Google AI Mode',
};

function formatPlatformLabel(slug: string): string {
  return BREAKDOWN_PLATFORM_LABELS[slug] ?? slug;
}

export interface BreakdownRow {
  /** Unique identifier for the row: prompt_id / platform name / topic_id. */
  id: string;
  /** Display label: prompt text / platform name / topic name. */
  label: string;
  /** Optional secondary label (e.g. topic name for a prompt). */
  sublabel?: string;
  /** Metric value in the current window. */
  cur: number;
  /** Metric value in the previous window. */
  prev: number;
  /** Absolute change (cur - prev). */
  delta: number;
  /** Percentage change. Null when previous is zero (use delta instead). */
  deltaPct: number | null;
  /** Number of result rows that contributed in the current window. */
  curRuns: number;
  /** Number of result rows that contributed in the previous window. */
  prevRuns: number;
}

export interface InsightsBreakdown {
  metric: BreakdownMetric;
  curTotal: number;
  prevTotal: number;
  delta: number;
  deltaPct: number | null;
  /** Number of full calendar days covered by each comparison window. */
  windowDays: number;
  byPrompt: BreakdownRow[];
  byPlatform: BreakdownRow[];
  byTopic: BreakdownRow[];
  /** One-line rule-based root-cause summary for the drop/rise. */
  rootCause: string;
}

/** Aggregate a metric over a set of raw prompt_results rows. */
function aggregateMetric(
  rows: Array<{
    mention_count: number;
    visibility_score: number;
  }>,
  metric: BreakdownMetric,
): { value: number; runs: number } {
  if (metric === 'visibility') {
    if (rows.length === 0) return { value: 0, runs: 0 };
    const sum = rows.reduce((s, r) => s + (r.visibility_score ?? 0), 0);
    return {
      value: Math.round((sum / rows.length) * 10) / 10,
      runs: rows.length,
    };
  }
  const value = rows.reduce((s, r) => s + (r.mention_count ?? 0), 0);
  return { value, runs: rows.length };
}

function computeDelta(
  cur: number,
  prev: number,
  metric: BreakdownMetric,
): { delta: number; deltaPct: number | null } {
  if (metric === 'visibility') {
    return {
      delta: Math.round((cur - prev) * 10) / 10,
      deltaPct: null,
    };
  }
  const delta = cur - prev;
  const deltaPct = prev > 0 ? Math.round((delta / prev) * 100) : null;
  return { delta, deltaPct };
}

/**
 * Returns a per-prompt / per-platform / per-topic breakdown comparing the
 * current window with the previous window of equal duration.
 *
 * Used by the Insights KPI drill-down Sheet to surface which entities drove a
 * metric change (e.g. "Mentions dropped 12% because prompt X lost 84 mentions
 * on ChatGPT"). Windows mirror `getInsightsSummary` — when `dateFrom` is
 * provided the current window spans [dateFrom, dateTo ?? now] and the previous
 * window has the same length immediately before; otherwise both are 7 days.
 */
export async function getInsightsBreakdown(
  brandId: string,
  metric: BreakdownMetric,
  opts?: {
    model?: string;
    region?: string;
    dateFrom?: string;
    dateTo?: string;
    topicId?: string;
  },
): Promise<InsightsBreakdown> {
  const supabase = await createClient();

  let currentFrom: Date;
  let currentTo: Date;

  if (opts?.dateFrom) {
    currentFrom = new Date(opts.dateFrom);
    currentTo = opts.dateTo ? new Date(opts.dateTo) : new Date();
  } else {
    currentTo = new Date();
    currentFrom = new Date();
    currentFrom.setDate(currentFrom.getDate() - 7);
  }

  const duration = currentTo.getTime() - currentFrom.getTime();
  const prevFrom = new Date(currentFrom.getTime() - duration);
  const prevTo = currentFrom;
  const windowDays = Math.max(1, Math.round(duration / (24 * 60 * 60 * 1000)));

  const { query: curQuery } = await buildResultsQuery(brandId, {
    ...opts,
    dateFrom: currentFrom.toISOString(),
    dateTo: currentTo.toISOString(),
  });
  const { query: prevQuery } = await buildResultsQuery(brandId, {
    ...opts,
    dateFrom: prevFrom.toISOString(),
    dateTo: prevTo.toISOString(),
  });

  const [curRes, prevRes] = await Promise.all([curQuery, prevQuery]);
  if (curRes.error) throw new Error(curRes.error.message);
  if (prevRes.error) throw new Error(prevRes.error.message);

  type Row = {
    prompt_id: string;
    platform: string;
    mention_count: number;
    visibility_score: number;
  };
  const curRows = (curRes.data ?? []) as unknown as Row[];
  const prevRows = (prevRes.data ?? []) as unknown as Row[];

  const allPromptIds = new Set<string>();
  for (const r of curRows) allPromptIds.add(r.prompt_id);
  for (const r of prevRows) allPromptIds.add(r.prompt_id);

  // Resolve prompt text + topic for every participating prompt.
  const { data: promptRowsRaw } =
    allPromptIds.size > 0
      ? await supabase
          .from('prompts')
          .select('id, text, topic_id')
          .in('id', [...allPromptIds])
      : { data: [] as unknown[] };

  const promptInfo = new Map<string, { text: string; topicId: string | null }>();
  const topicIds = new Set<string>();
  for (const p of (promptRowsRaw ?? []) as Array<{
    id: string;
    text: string;
    topic_id: string | null;
  }>) {
    promptInfo.set(p.id, { text: p.text, topicId: p.topic_id });
    if (p.topic_id) topicIds.add(p.topic_id);
  }

  const { data: topicRowsRaw } =
    topicIds.size > 0
      ? await supabase
          .from('topics')
          .select('id, name')
          .in('id', [...topicIds])
      : { data: [] as unknown[] };

  const topicNameById = new Map<string, string>();
  for (const t of (topicRowsRaw ?? []) as Array<{ id: string; name: string }>) {
    topicNameById.set(t.id, t.name);
  }

  // ─── Group rows by prompt / platform / topic ────────────────────────────────
  function groupBy<K extends string>(rows: Row[], keyFn: (r: Row) => K) {
    const m = new Map<K, Row[]>();
    for (const r of rows) {
      const k = keyFn(r);
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    }
    return m;
  }

  function mergeKeys<K>(a: Map<K, unknown>, b: Map<K, unknown>): K[] {
    const s = new Set<K>();
    for (const k of a.keys()) s.add(k);
    for (const k of b.keys()) s.add(k);
    return [...s];
  }

  function buildRows(
    curMap: Map<string, Row[]>,
    prevMap: Map<string, Row[]>,
    resolver: (key: string) => { id: string; label: string; sublabel?: string },
  ): BreakdownRow[] {
    const keys = mergeKeys(curMap, prevMap);
    const rows: BreakdownRow[] = keys.map((key) => {
      const curAgg = aggregateMetric(curMap.get(key) ?? [], metric);
      const prevAgg = aggregateMetric(prevMap.get(key) ?? [], metric);
      const { delta, deltaPct } = computeDelta(curAgg.value, prevAgg.value, metric);
      const { id, label, sublabel } = resolver(key);
      return {
        id,
        label,
        sublabel,
        cur: curAgg.value,
        prev: prevAgg.value,
        delta,
        deltaPct,
        curRuns: curAgg.runs,
        prevRuns: prevAgg.runs,
      };
    });
    // Sort: biggest drops first, then biggest gains, untouched rows last.
    rows.sort((a, b) => a.delta - b.delta);
    return rows;
  }

  const curByPrompt = groupBy(curRows, (r) => r.prompt_id);
  const prevByPrompt = groupBy(prevRows, (r) => r.prompt_id);
  const byPrompt = buildRows(curByPrompt, prevByPrompt, (pid) => {
    const info = promptInfo.get(pid);
    const topicName = info?.topicId ? topicNameById.get(info.topicId) : undefined;
    return {
      id: pid,
      label: info?.text ?? 'Unknown prompt',
      sublabel: topicName,
    };
  });

  const curByPlatform = groupBy(curRows, (r) => r.platform);
  const prevByPlatform = groupBy(prevRows, (r) => r.platform);
  const byPlatform = buildRows(curByPlatform, prevByPlatform, (plat) => ({
    id: plat,
    label: formatPlatformLabel(plat),
  }));

  const curByTopic = groupBy(curRows, (r) => {
    const info = promptInfo.get(r.prompt_id);
    return info?.topicId ?? '__uncategorized__';
  });
  const prevByTopic = groupBy(prevRows, (r) => {
    const info = promptInfo.get(r.prompt_id);
    return info?.topicId ?? '__uncategorized__';
  });
  const byTopic = buildRows(curByTopic, prevByTopic, (tid) => ({
    id: tid,
    label:
      tid === '__uncategorized__' ? 'Uncategorized' : (topicNameById.get(tid) ?? 'Unknown topic'),
  }));

  // ─── Totals + root-cause summary ────────────────────────────────────────────
  const curTotalAgg = aggregateMetric(curRows, metric);
  const prevTotalAgg = aggregateMetric(prevRows, metric);
  const { delta: totalDelta, deltaPct: totalDeltaPct } = computeDelta(
    curTotalAgg.value,
    prevTotalAgg.value,
    metric,
  );

  const metricLabel =
    metric === 'visibility' ? 'Visibility' : metric === 'mentions' ? 'Mentions' : 'Citations';

  const isDrop = totalDelta < 0;
  const isFlat = totalDelta === 0;

  // Select the biggest contributor in the same direction as the overall change.
  // `buildRows` sorts ascending by delta so byPrompt[0] is the largest drop and
  // byPrompt[last] is the largest gain.
  const topPrompt = isDrop ? byPrompt[0] : byPrompt[byPrompt.length - 1];
  const topPlatform = isDrop ? byPlatform[0] : byPlatform[byPlatform.length - 1];

  const promptContributes = !!topPrompt && (isDrop ? topPrompt.delta < 0 : topPrompt.delta > 0);
  const platformContributes =
    !!topPlatform && (isDrop ? topPlatform.delta < 0 : topPlatform.delta > 0);

  let rootCause: string;
  if (isFlat) {
    rootCause = `${metricLabel} held steady vs the previous ${windowDays}-day window.`;
  } else if (!promptContributes) {
    const dir = totalDelta > 0 ? 'rose' : 'fell';
    const magnitude = formatTotalMagnitude(totalDelta, totalDeltaPct, metric);
    rootCause = `${metricLabel} ${dir} ${magnitude} vs the previous ${windowDays}d — the change is spread evenly across prompts, no single driver.`;
  } else {
    const headline = isDrop ? 'Biggest drop' : 'Biggest gain';
    const promptClause = `"${truncate(topPrompt!.label, 60)}" ${formatContribution(topPrompt!, metric)}`;
    const platformClause = platformContributes
      ? ` Top platform ${isDrop ? 'drop' : 'gain'}: ${topPlatform!.label} ${formatContribution(topPlatform!, metric)}.`
      : '';
    rootCause = `${headline}: ${promptClause}.${platformClause}`;
  }

  return {
    metric,
    curTotal: curTotalAgg.value,
    prevTotal: prevTotalAgg.value,
    delta: totalDelta,
    deltaPct: totalDeltaPct,
    windowDays,
    byPrompt,
    byPlatform,
    byTopic,
    rootCause,
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Format a single contributor's delta as a human sentence fragment, e.g.:
 *   - mentions:  "lost 84 mentions (−38%)"   or  "gained 12 mentions"
 *   - citations: "lost 7 citations (−15%)"
 *   - visibility: "dropped 2.1 pts"           or  "rose 2.1 pts"
 */
function formatContribution(row: BreakdownRow, metric: BreakdownMetric): string {
  const isLoss = row.delta < 0;
  const abs = Math.abs(row.delta);

  if (metric === 'visibility') {
    const verb = isLoss ? 'dropped' : 'rose';
    const value = Math.round(abs * 10) / 10;
    return `${verb} ${value} pts`;
  }

  const verb = isLoss ? 'lost' : 'gained';
  const core = `${verb} ${abs.toLocaleString('en-US')} mentions`;
  if (row.deltaPct === null) return core;
  const sign = row.deltaPct < 0 ? '−' : '+';
  return `${core} (${sign}${Math.abs(row.deltaPct)}%)`;
}

function formatTotalMagnitude(
  delta: number,
  deltaPct: number | null,
  metric: BreakdownMetric,
): string {
  const abs = Math.abs(delta);
  if (metric === 'visibility') {
    return `${Math.round(abs * 10) / 10} pts`;
  }
  const core = `${abs.toLocaleString('en-US')} mentions`;
  if (deltaPct === null) return core;
  const sign = deltaPct < 0 ? '−' : '+';
  return `${core} (${sign}${Math.abs(deltaPct)}%)`;
}

// ─── Topic detail bundle (#312) ───────────────────────────────────────────

export interface TopicDetailData {
  topic: Topic | null;
  summary: InsightsSummary;
  trend: VisibilityTrendPoint[];
  sov: ShareOfVoiceData;
  competitors: CompetitorComparisonData;
  results: PromptResultWithText[];
}

/**
 * One server action for the whole topic detail page (#312).
 *
 * The page previously fired six separate server-action calls from the client.
 * Next.js runs server actions **sequentially** (each is its own queued POST),
 * so that cost was roughly the sum of all six, not the slowest. Collapsing them
 * into one action means a single round trip whose body runs the work in a real
 * server-side `Promise.all` (genuinely parallel). The topic is fetched by id
 * instead of pulling the whole topics list just to read one name.
 *
 * Output is identical to the old per-call results — this is a perf refactor.
 */
export async function getTopicDetail(brandId: string, topicId: string): Promise<TopicDetailData> {
  const [topic, summary, trend, sov, competitors, results] = await Promise.all([
    getTopicById(brandId, topicId),
    getInsightsSummary(brandId, { topicId }),
    getVisibilityTrend(brandId, { topicId }),
    getShareOfVoiceData(brandId, { topicId }),
    getCompetitorComparison(brandId, { topicId }),
    getPromptResults(brandId, { topicId, limit: 50 }),
  ]);

  return { topic, summary, trend, sov, competitors, results: results.results };
}
