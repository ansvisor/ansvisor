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
} from '@/types';
import { API_BASE_URL } from '@/config/api';
import { getTopicById } from '@/lib/actions/topic';

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
    createdAt: row.created_at as string,
  };
}

export interface PromptResultWithText extends PromptResult {
  promptText: string;
  promptCategory?: string;
  topicId?: string;
  topicName?: string;
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
  mentionsChange: number | null;
  citationsChange: number | null;
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
  by_competitor: Array<{
    competitor_id: string;
    name: string | null;
    sum_visibility: number;
    row_count: number;
    total_mentions: number;
    total_citations: number;
  }>;
  by_brand_provider: Array<{
    model_used: string | null;
    platform: string | null;
    sum_visibility: number;
    row_count: number;
  }>;
  by_competitor_provider: Array<{
    model_used: string | null;
    platform: string | null;
    competitor_id: string;
    competitor_name: string | null;
    sum_visibility: number;
    row_count: number;
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
  results: PromptResultWithText[];
  total: number;
  competitors: CompetitorComparisonData;
  sov: ShareOfVoiceData;
  hasAnyData: boolean;
}

/**
 * One consolidated server action for the Insights page's first load (#313).
 *
 * Next.js runs server actions sequentially (each is its own queued POST), so
 * firing the summary / results / competitor / SoV reads separately from the
 * client cost roughly their sum, not the slowest. This runs them in a real
 * server-side `Promise.all` (genuinely parallel, one round trip), and derives
 * "has any data" from a cheap count instead of the old unbounded full-table
 * scan. Output is identical to the previous per-call flow.
 */
export async function getInsightsData(
  brandId: string,
  opts: {
    model?: string;
    region?: string;
    topicId?: string;
    dateFrom?: string;
    dateTo?: string;
    rowLimit?: number;
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

  const [summary, resultsData, competitors, sov, unfilteredTotal] = await Promise.all([
    getInsightsSummary(brandId, filterOpts),
    getPromptResults(brandId, { limit: opts.rowLimit ?? 50, ...filterOpts }),
    getCompetitorComparison(brandId, filterOpts),
    getShareOfVoiceData(brandId, filterOpts),
    opts.checkUnfiltered ? getBrandResultsTotal(brandId) : Promise.resolve(null),
  ]);

  const hasAnyData = unfilteredTotal !== null ? unfilteredTotal > 0 : resultsData.total > 0;

  return {
    summary,
    results: resultsData.results,
    total: resultsData.total,
    competitors,
    sov,
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
  opts?: { limit?: number },
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
  const { data: resultRows, error: resultError } = await supabase
    .from('prompt_results')
    .select('*')
    .eq('prompt_id', promptId)
    .neq('platform', 'chatgpt-shopping')
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
      lastCheckedAt: results[0]?.createdAt ?? null,
    },
    results,
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
      const prevMentions = prevWin.total_mentions;
      const prevCitations = prevWin.total_citations;
      const prevSentimentPct = Math.round((prevWin.positive_count / prevWin.total_results) * 100);

      visibilityChange = roundTo1(curAvgVis - prevAvgVis);
      mentionsChange =
        curMentions > 0 && prevMentions > 0
          ? Math.round(((curMentions - prevMentions) / prevMentions) * 100)
          : curMentions - prevMentions;
      citationsChange =
        curCitations > 0 && prevCitations > 0
          ? Math.round(((curCitations - prevCitations) / prevCitations) * 100)
          : curCitations - prevCitations;
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

  // #155 — visibility summary per prompt; exclude chatgpt-shopping to
  // match the aggregate-RPC filters one level up.
  const { data, error } = await supabase
    .from('prompt_results')
    .select('prompt_id, visibility_score, mention_count, created_at')
    .eq('brand_id', brandId)
    .neq('platform', 'chatgpt-shopping')
    .gte('created_at', since);

  if (error) throw new Error(error.message);

  const acc: Record<
    string,
    { sumVis: number; sumMentions: number; runs: number; lastRunAt: string }
  > = {};

  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const pid = r.prompt_id as string;
    if (!pid) continue;
    const vis = (r.visibility_score as number) ?? 0;
    const mentions = (r.mention_count as number) ?? 0;
    const createdAt = r.created_at as string;
    const existing = acc[pid];
    if (existing) {
      existing.sumVis += vis;
      existing.sumMentions += mentions;
      existing.runs += 1;
      if (createdAt > existing.lastRunAt) existing.lastRunAt = createdAt;
    } else {
      acc[pid] = {
        sumVis: vis,
        sumMentions: mentions,
        runs: 1,
        lastRunAt: createdAt,
      };
    }
  }

  const result: Record<string, PromptVisibilitySummary> = {};
  for (const [pid, v] of Object.entries(acc)) {
    result[pid] = {
      avgVisibility: v.runs > 0 ? v.sumVis / v.runs : 0,
      totalMentions: v.sumMentions,
      runs: v.runs,
      lastRunAt: v.lastRunAt,
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
   * Percentage change of the average visibility score versus the previous
   * comparable window (e.g. last 7 days vs the 7 days before that).
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

  const curBrandAvg =
    curWin && curWin.brand_row_count > 0
      ? curWin.brand_sum_visibility / curWin.brand_row_count
      : null;
  const prevBrandAvg =
    prevWin && prevWin.brand_row_count > 0
      ? prevWin.brand_sum_visibility / prevWin.brand_row_count
      : null;

  const curCompAvg = new Map<string, number>();
  for (const c of curWin?.by_competitor ?? []) {
    if (c.row_count > 0) curCompAvg.set(c.competitor_id, c.sum_visibility / c.row_count);
  }
  const prevCompAvg = new Map<string, number>();
  for (const c of prevWin?.by_competitor ?? []) {
    if (c.row_count > 0) prevCompAvg.set(c.competitor_id, c.sum_visibility / c.row_count);
  }

  const brandName = (brand?.name as string) ?? 'Your Brand';
  const brandAvg = Math.round(agg.brand_sum_visibility / agg.brand_row_count);

  // Percentage change relative to the previous-period value.
  // Null when no comparable previous value exists (or growth from 0 → x is undefined).
  const pctChange = (cur: number | null, prev: number | null): number | null => {
    if (cur === null || prev === null) return null;
    if (prev === 0) return cur === 0 ? 0 : null;
    return Math.round(((cur - prev) / prev) * 1000) / 10;
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
      change: pctChange(curBrandAvg, prevBrandAvg),
      totalMentions: agg.brand_total_mentions,
      totalCitations: agg.brand_total_citations,
      resultCount: agg.brand_row_count,
      isOwnBrand: true,
    },
  ];

  for (const c of agg.by_competitor) {
    const avg = c.row_count > 0 ? Math.round(c.sum_visibility / c.row_count) : 0;
    entries.push({
      name: competitorDisplayName(c.name, c.competitor_id),
      avgVisibilityScore: avg,
      change: pctChange(
        curCompAvg.get(c.competitor_id) ?? null,
        prevCompAvg.get(c.competitor_id) ?? null,
      ),
      totalMentions: c.total_mentions,
      totalCitations: c.total_citations,
      resultCount: c.row_count,
      isOwnBrand: false,
    });
  }

  entries.sort((a, b) => b.avgVisibilityScore - a.avgVisibilityScore);

  // --- Per-provider breakdown ---
  // resolveProvider stays in JS so we don't keep a SQL copy of the mapping
  // table in sync — fold the (model_used, platform) groups into provider
  // buckets here.
  type Agg = { totalScore: number; count: number };
  const brandByProvider = new Map<string, Agg>();
  for (const bp of agg.by_brand_provider) {
    const provider = resolveProvider(bp.model_used, bp.platform);
    const ex = brandByProvider.get(provider) ?? { totalScore: 0, count: 0 };
    ex.totalScore += Number(bp.sum_visibility);
    ex.count += bp.row_count;
    brandByProvider.set(provider, ex);
  }

  // compName -> provider -> agg. Keyed by the same display name used in
  // entries[] above so the providerRows column headers line up with the
  // table rows (empty/null names fall back to competitor_id).
  const compByProvider = new Map<string, Map<string, Agg>>();
  for (const cp of agg.by_competitor_provider) {
    const provider = resolveProvider(cp.model_used, cp.platform);
    const name = competitorDisplayName(cp.competitor_name, cp.competitor_id);
    if (!compByProvider.has(name)) compByProvider.set(name, new Map());
    const pm = compByProvider.get(name)!;
    const ex = pm.get(provider) ?? { totalScore: 0, count: 0 };
    ex.totalScore += Number(cp.sum_visibility);
    ex.count += cp.row_count;
    pm.set(provider, ex);
  }

  const allProviders = new Set<string>();
  for (const p of brandByProvider.keys()) allProviders.add(p);
  for (const pm of compByProvider.values()) {
    for (const p of pm.keys()) allProviders.add(p);
  }

  const providerRows: ProviderComparisonRow[] = [...allProviders].sort().map((provider) => {
    const row: ProviderComparisonRow = { provider };
    const bp = brandByProvider.get(provider);
    row[brandName] = bp && bp.count > 0 ? Math.round(bp.totalScore / bp.count) : 0;
    for (const [compName, pm] of compByProvider) {
      const cp = pm.get(provider);
      row[compName] = cp && cp.count > 0 ? Math.round(cp.totalScore / cp.count) : 0;
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
      score: Math.round(d.totalScore / d.count),
      competitors: d.compCount > 0 ? Math.round(d.compTotalScore / d.compCount) : null,
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
