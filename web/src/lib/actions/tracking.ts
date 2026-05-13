'use server';

import { createClient } from '@/lib/supabase/server';
import type {
  PromptResult,
  AIPlatform,
  Sentiment,
  Citation,
  CompetitorMention,
} from '@/types';

/**
 * Apply the `model` filter to a Supabase query against `prompt_results.model_used`.
 *
 * Accepts either a single slug ("gpt-5-5") or a comma-separated list
 * ("gpt-5-5,gpt-5-3-mini,chatgpt-web") so callers can filter by a provider
 * family without the UI having to enumerate every per-model row in the
 * filter dropdown.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyModelFilter<T extends { eq: any; in: any }>(
  query: T,
  model: string | undefined,
): T {
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
    competitorMentions:
      (row.competitor_mentions as CompetitorMention[] | null) ?? undefined,
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
) {
  const supabase = await createClient();
  let query = supabase
    .from('prompt_results')
    .select('*')
    .eq('brand_id', brandId);

  if (opts?.platform) query = query.eq('platform', opts.platform);
  query = applyModelFilter(query, opts?.model);
  if (opts?.region) query = query.eq('region', opts.region);
  if (opts?.dateFrom) query = query.gte('created_at', opts.dateFrom);
  if (opts?.dateTo) query = query.lte('created_at', opts.dateTo);
  if (opts?.promptId) query = query.eq('prompt_id', opts.promptId);

  if (opts?.topicId) {
    const { data: topicPrompts } = await supabase
      .from('prompts')
      .select('id')
      .eq('topic_id', opts.topicId);
    const topicPromptIds = ((topicPrompts ?? []) as { id: string }[]).map(
      (p) => p.id,
    );
    // Use a sentinel that matches nothing when the topic has no prompts so results are empty.
    query = query.in(
      'prompt_id',
      topicPromptIds.length > 0
        ? topicPromptIds
        : ['00000000-0000-0000-0000-000000000000'],
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
  const { supabase, query } = await buildResultsQuery(brandId, opts);

  const { data: allRows, error } = await query.order('created_at', {
    ascending: false,
  });
  if (error) throw new Error(error.message);

  const rows = (allRows ?? []) as Record<string, unknown>[];

  const promptIds = [...new Set(rows.map((r) => r.prompt_id as string))];
  const { data: promptRows } =
    promptIds.length > 0
      ? await supabase
          .from('prompts')
          .select('id, text, category, topic_id')
          .in('id', promptIds)
      : { data: [] };

  const promptRowsRaw = (promptRows ?? []) as unknown as Record<
    string,
    unknown
  >[];

  const topicIds = [
    ...new Set(
      promptRowsRaw
        .map((p) => p.topic_id as string | null)
        .filter(Boolean) as string[],
    ),
  ];
  const { data: topicRows } =
    topicIds.length > 0
      ? await supabase.from('topics').select('id, name').in('id', topicIds)
      : { data: [] };
  const topicMap = new Map(
    ((topicRows ?? []) as Record<string, unknown>[]).map((t) => [
      t.id as string,
      t.name as string,
    ]),
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

  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const paged = rows.slice(offset, offset + limit);

  const results = paged.map((r) => {
    const pm = promptMap.get(r.prompt_id as string);
    return {
      ...mapResultRow(r),
      promptText: (pm?.text as string) ?? '',
      promptCategory: (pm?.category as string | null) ?? undefined,
      topicId: (pm?.topicId as string | null) ?? undefined,
      topicName: pm?.topicId
        ? (topicMap.get(pm.topicId) ??
          (pm?.category as string | null) ??
          undefined)
        : ((pm?.category as string | null) ?? undefined),
    };
  });

  return { results, total: rows.length };
}

/**
 * Fetch a single prompt result by its ID, joining prompt text.
 */
export async function getPromptResultById(
  resultId: string,
): Promise<PromptResultWithText | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('prompt_results')
    .select('*')
    .eq('id', resultId)
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
    .select(
      'id, prompt_set_id, text, category, topic_id, is_active, created_at',
    )
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

  const { data: resultRows, error: resultError } = await supabase
    .from('prompt_results')
    .select('*')
    .eq('prompt_id', promptId)
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
      ? Math.round(
          results.reduce((sum, row) => sum + row.visibilityScore, 0) /
            totalResults,
        )
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
  const { query } = await buildResultsQuery(brandId, opts);

  const { data: results, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (results ?? []) as Record<string, unknown>[];

  if (rows.length === 0) {
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

  const totalResults = rows.length;
  const avgVisibilityScore = Math.round(
    rows.reduce((s, r) => s + (r.visibility_score as number), 0) / totalResults,
  );
  const totalMentions = rows.reduce(
    (s, r) => s + (r.mention_count as number),
    0,
  );
  const totalCitations = rows.reduce(
    (s, r) => s + (r.citation_count as number),
    0,
  );
  const positiveCount = rows.filter((r) => r.sentiment === 'positive').length;
  const positiveSentimentPct = Math.round((positiveCount / totalResults) * 100);

  const lastCheckedAt =
    rows
      .map((r) => r.created_at as string)
      .sort()
      .pop() ?? null;

  const modelMap = new Map<string, { totalScore: number; count: number }>();
  for (const r of rows) {
    const m = (r.model_used as string) || 'unknown';
    const existing = modelMap.get(m) ?? { totalScore: 0, count: 0 };
    existing.totalScore += r.visibility_score as number;
    existing.count += 1;
    modelMap.set(m, existing);
  }

  const platformBreakdown = Array.from(modelMap.entries()).map(
    ([model, data]) => ({
      platform: model,
      avgScore: Math.round(data.totalScore / data.count),
      resultCount: data.count,
    }),
  );

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

    const currentFilterOpts = opts?.dateFrom
      ? opts
      : { ...opts, dateFrom: currentFrom.toISOString() };

    const { query: curQuery } = await buildResultsQuery(
      brandId,
      currentFilterOpts,
    );
    const { data: curResults } = await curQuery;
    const curRows = (curResults ?? []) as Record<string, unknown>[];

    const { query: prevQuery } = await buildResultsQuery(brandId, {
      ...opts,
      dateFrom: prevFrom.toISOString(),
      dateTo: currentFrom.toISOString(),
    });

    const { data: prevResults } = await prevQuery;
    const prevRows = (prevResults ?? []) as Record<string, unknown>[];

    if (curRows.length > 0 && prevRows.length > 0) {
      const curTotal = curRows.length;
      const curAvgVis = Math.round(
        curRows.reduce((s, r) => s + (r.visibility_score as number), 0) /
          curTotal,
      );
      const curMentions = curRows.reduce(
        (s, r) => s + (r.mention_count as number),
        0,
      );
      const curCitations = curRows.reduce(
        (s, r) => s + (r.citation_count as number),
        0,
      );
      const curPositive = curRows.filter(
        (r) => r.sentiment === 'positive',
      ).length;
      const curSentimentPct = Math.round((curPositive / curTotal) * 100);

      const prevTotal = prevRows.length;
      const prevAvgVis = Math.round(
        prevRows.reduce((s, r) => s + (r.visibility_score as number), 0) /
          prevTotal,
      );
      const prevMentions = prevRows.reduce(
        (s, r) => s + (r.mention_count as number),
        0,
      );
      const prevCitations = prevRows.reduce(
        (s, r) => s + (r.citation_count as number),
        0,
      );
      const prevPositive = prevRows.filter(
        (r) => r.sentiment === 'positive',
      ).length;
      const prevSentimentPct = Math.round((prevPositive / prevTotal) * 100);

      visibilityChange = curAvgVis - prevAvgVis;
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

  const serverUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost';

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
  status:
    | 'waiting'
    | 'active'
    | 'completed'
    | 'failed'
    | 'delayed'
    | 'not_found';
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

  const serverUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost';

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
        data.progress &&
        typeof data.progress === 'object' &&
        data.progress.total
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

  const serverUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost';

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

  const { data, error } = await supabase
    .from('prompt_results')
    .select('prompt_id, visibility_score, mention_count, created_at')
    .eq('brand_id', brandId)
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
): Promise<
  { id: string; text: string; category?: string; platforms: string[] }[]
> {
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

function resolveProvider(
  modelUsed: string | null | undefined,
  platform?: string | null,
): string {
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

  const { data: brand } = await supabase
    .from('brands')
    .select('name')
    .eq('id', brandId)
    .single();

  const { query } = await buildResultsQuery(brandId, opts);
  const { data: results, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (results ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return { brands: [], providerRows: [] };

  // --- Current vs previous period for change calculation ---
  // The displayed avg/totals come from `rows` (respects the selected preset),
  // but the ↑/↓ delta always compares a fixed "current" window to the window
  // immediately before it so the arrow reflects recent momentum (mirrors
  // getInsightsSummary's KPI change logic).
  let curBrandAvg: number | null = null;
  let prevBrandAvg: number | null = null;
  const curCompAvg = new Map<string, number>();
  const prevCompAvg = new Map<string, number>();

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

    const currentFilterOpts = opts?.dateFrom
      ? opts
      : { ...opts, dateFrom: currentFrom.toISOString() };

    const [curRes, prevRes] = await Promise.all([
      (async () => {
        const { query: curQuery } = await buildResultsQuery(
          brandId,
          currentFilterOpts,
        );
        return curQuery;
      })(),
      (async () => {
        const { query: prevQuery } = await buildResultsQuery(brandId, {
          ...opts,
          dateFrom: prevFrom.toISOString(),
          dateTo: currentFrom.toISOString(),
        });
        return prevQuery;
      })(),
    ]);

    const curRows = (curRes.data ?? []) as Record<string, unknown>[];
    const prevRows = (prevRes.data ?? []) as Record<string, unknown>[];

    if (curRows.length > 0) {
      const curTotal = curRows.reduce(
        (s, r) => s + (r.visibility_score as number),
        0,
      );
      curBrandAvg = curTotal / curRows.length;

      const curCompMap = new Map<
        string,
        { totalScore: number; count: number }
      >();
      for (const row of curRows) {
        const mentions =
          (row.competitor_mentions as CompetitorMention[] | null) ?? [];
        for (const cm of mentions) {
          const ex = curCompMap.get(cm.competitor_id) ?? {
            totalScore: 0,
            count: 0,
          };
          ex.totalScore += cm.visibility_score;
          ex.count += 1;
          curCompMap.set(cm.competitor_id, ex);
        }
      }
      for (const [id, d] of curCompMap) {
        curCompAvg.set(id, d.totalScore / d.count);
      }
    }

    if (prevRows.length > 0) {
      const prevTotal = prevRows.reduce(
        (s, r) => s + (r.visibility_score as number),
        0,
      );
      prevBrandAvg = prevTotal / prevRows.length;

      const prevCompMap = new Map<
        string,
        { totalScore: number; count: number }
      >();
      for (const row of prevRows) {
        const mentions =
          (row.competitor_mentions as CompetitorMention[] | null) ?? [];
        for (const cm of mentions) {
          const ex = prevCompMap.get(cm.competitor_id) ?? {
            totalScore: 0,
            count: 0,
          };
          ex.totalScore += cm.visibility_score;
          ex.count += 1;
          prevCompMap.set(cm.competitor_id, ex);
        }
      }
      for (const [id, d] of prevCompMap) {
        prevCompAvg.set(id, d.totalScore / d.count);
      }
    }
  }

  const brandName = (brand?.name as string) ?? 'Your Brand';

  // --- Flat brand-level aggregates ---
  const brandTotalScore = rows.reduce(
    (s, r) => s + (r.visibility_score as number),
    0,
  );
  const brandTotalMentions = rows.reduce(
    (s, r) => s + (r.mention_count as number),
    0,
  );
  const brandTotalCitations = rows.reduce(
    (s, r) => s + (r.citation_count as number),
    0,
  );
  const brandAvg = Math.round(brandTotalScore / rows.length);

  // Percentage change relative to the previous-period value.
  // Null when no comparable previous value exists (or growth from 0 → x is undefined).
  const pctChange = (
    cur: number | null,
    prev: number | null,
  ): number | null => {
    if (cur === null || prev === null) return null;
    if (prev === 0) return cur === 0 ? 0 : null;
    return Math.round(((cur - prev) / prev) * 1000) / 10;
  };

  const entries: CompetitorComparisonEntry[] = [
    {
      name: brandName,
      avgVisibilityScore: brandAvg,
      change: pctChange(curBrandAvg, prevBrandAvg),
      totalMentions: brandTotalMentions,
      totalCitations: brandTotalCitations,
      resultCount: rows.length,
      isOwnBrand: true,
    },
  ];

  const compMap = new Map<
    string,
    {
      id: string;
      name: string;
      totalScore: number;
      totalMentions: number;
      totalCitations: number;
      count: number;
    }
  >();

  for (const row of rows) {
    const mentions =
      (row.competitor_mentions as CompetitorMention[] | null) ?? [];
    for (const cm of mentions) {
      const existing = compMap.get(cm.competitor_id) ?? {
        id: cm.competitor_id,
        name: cm.name,
        totalScore: 0,
        totalMentions: 0,
        totalCitations: 0,
        count: 0,
      };
      existing.totalScore += cm.visibility_score;
      existing.totalMentions += cm.mention_count;
      existing.totalCitations += cm.citation_count;
      existing.count += 1;
      compMap.set(cm.competitor_id, existing);
    }
  }

  for (const [, data] of compMap) {
    const avg = Math.round(data.totalScore / data.count);
    const cur = curCompAvg.get(data.id);
    const prev = prevCompAvg.get(data.id);
    entries.push({
      name: data.name,
      avgVisibilityScore: avg,
      change: pctChange(cur ?? null, prev ?? null),
      totalMentions: data.totalMentions,
      totalCitations: data.totalCitations,
      resultCount: data.count,
      isOwnBrand: false,
    });
  }

  entries.sort((a, b) => b.avgVisibilityScore - a.avgVisibilityScore);

  // --- Per-provider breakdown ---
  // brand: { provider -> { totalScore, count } }
  type Agg = { totalScore: number; count: number };
  const brandByProvider = new Map<string, Agg>();
  const compByProvider = new Map<string, Map<string, Agg>>(); // compName -> provider -> agg

  for (const row of rows) {
    const provider = resolveProvider(
      row.model_used as string | null,
      row.platform as string | null,
    );
    const score = row.visibility_score as number;

    const bp = brandByProvider.get(provider) ?? { totalScore: 0, count: 0 };
    bp.totalScore += score;
    bp.count += 1;
    brandByProvider.set(provider, bp);

    const mentions =
      (row.competitor_mentions as CompetitorMention[] | null) ?? [];
    for (const cm of mentions) {
      if (!compByProvider.has(cm.name)) compByProvider.set(cm.name, new Map());
      const pm = compByProvider.get(cm.name)!;
      const cp = pm.get(provider) ?? { totalScore: 0, count: 0 };
      cp.totalScore += cm.visibility_score;
      cp.count += 1;
      pm.set(provider, cp);
    }
  }

  const allProviders = new Set<string>();
  for (const p of brandByProvider.keys()) allProviders.add(p);
  for (const pm of compByProvider.values()) {
    for (const p of pm.keys()) allProviders.add(p);
  }

  const providerRows: ProviderComparisonRow[] = [...allProviders]
    .sort()
    .map((provider) => {
      const row: ProviderComparisonRow = { provider };

      const bp = brandByProvider.get(provider);
      row[brandName] = bp ? Math.round(bp.totalScore / bp.count) : 0;

      for (const [compName, pm] of compByProvider) {
        const cp = pm.get(provider);
        row[compName] = cp ? Math.round(cp.totalScore / cp.count) : 0;
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
  const { query } = await buildResultsQuery(brandId, opts);
  const { data: results, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (results ?? []) as Record<string, unknown>[];

  if (rows.length === 0) {
    return { overallSov: 0, overallSovChange: null, byPlatform: [], trend: [] };
  }

  // --- Overall + by-platform aggregation ---
  let totalBrandMentions = 0;
  let totalCompMentions = 0;

  type ProviderAgg = { brandMentions: number; competitorMentions: number };
  const providerMap = new Map<string, ProviderAgg>();

  type DayAgg = { brandMentions: number; competitorMentions: number };
  const dayMap = new Map<string, DayAgg>();

  for (const row of rows) {
    const provider = resolveProvider(
      row.model_used as string | null,
      row.platform as string | null,
    );
    const brandM = row.mention_count as number;
    totalBrandMentions += brandM;

    const pa = providerMap.get(provider) ?? {
      brandMentions: 0,
      competitorMentions: 0,
    };
    pa.brandMentions += brandM;

    const mentions =
      (row.competitor_mentions as CompetitorMention[] | null) ?? [];
    let rowCompMentions = 0;
    for (const cm of mentions) {
      rowCompMentions += cm.mention_count;
    }
    totalCompMentions += rowCompMentions;
    pa.competitorMentions += rowCompMentions;
    providerMap.set(provider, pa);

    // Daily aggregation
    const day = (row.created_at as string).slice(0, 10);
    const da = dayMap.get(day) ?? { brandMentions: 0, competitorMentions: 0 };
    da.brandMentions += brandM;
    da.competitorMentions += rowCompMentions;
    dayMap.set(day, da);
  }

  const totalAll = totalBrandMentions + totalCompMentions;
  const overallSov =
    totalAll > 0 ? Math.round((totalBrandMentions / totalAll) * 1000) / 10 : 0;

  // --- By platform ---
  const byPlatform: SoVByPlatform[] = [...providerMap.entries()]
    .map(([provider, agg]) => {
      const total = agg.brandMentions + agg.competitorMentions;
      return {
        provider,
        brandMentions: agg.brandMentions,
        competitorMentions: agg.competitorMentions,
        sov:
          total > 0 ? Math.round((agg.brandMentions / total) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.sov - a.sov);

  // --- Trend ---
  const sortedDays = [...dayMap.keys()].sort();
  const trend: SoVTrendPoint[] = sortedDays.map((day) => {
    const d = dayMap.get(day)!;
    const total = d.brandMentions + d.competitorMentions;
    const brandSov =
      total > 0 ? Math.round((d.brandMentions / total) * 1000) / 10 : 0;
    const competitorSov =
      total > 0 ? Math.round((d.competitorMentions / total) * 1000) / 10 : 0;
    const dateObj = new Date(day + 'T00:00:00');
    const label = dateObj.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    return { date: label, brandSov, competitorSov };
  });

  // --- Previous period delta ---
  let overallSovChange: number | null = null;

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

    const { query: prevQuery } = await buildResultsQuery(brandId, {
      ...opts,
      dateFrom: prevFrom.toISOString(),
      dateTo: currentFrom.toISOString(),
    });

    const { data: prevResults } = await prevQuery;
    const prevRows = (prevResults ?? []) as Record<string, unknown>[];

    if (prevRows.length > 0) {
      let prevBrandM = 0;
      let prevCompM = 0;
      for (const row of prevRows) {
        prevBrandM += row.mention_count as number;
        const cms =
          (row.competitor_mentions as CompetitorMention[] | null) ?? [];
        for (const cm of cms) prevCompM += cm.mention_count;
      }
      const prevTotal = prevBrandM + prevCompM;
      const prevSov =
        prevTotal > 0 ? Math.round((prevBrandM / prevTotal) * 1000) / 10 : 0;
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

  let query = supabase
    .from('prompt_results')
    .select('created_at, visibility_score, competitor_mentions')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true });

  query = applyModelFilter(query, opts?.model);
  if (opts?.region) query = query.eq('region', opts.region);
  if (opts?.dateFrom) query = query.gte('created_at', opts.dateFrom);
  if (opts?.dateTo) query = query.lte('created_at', opts.dateTo);

  if (opts?.topicId) {
    const { data: topicPrompts } = await supabase
      .from('prompts')
      .select('id')
      .eq('topic_id', opts.topicId);
    const ids = ((topicPrompts ?? []) as { id: string }[]).map((p) => p.id);
    query = query.in(
      'prompt_id',
      ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'],
    );
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

    const mentions =
      (row.competitor_mentions as CompetitorMention[] | null) ?? [];
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
      competitors:
        d.compCount > 0 ? Math.round(d.compTotalScore / d.compCount) : null,
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

  const { data: results, error } = await supabase
    .from('prompt_results')
    .select('*')
    .eq('brand_id', brandId)
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
      ? await supabase
          .from('prompts')
          .select('id, text, category')
          .in('id', promptIds)
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
    const mentions =
      (row.competitor_mentions as CompetitorMention[] | null) ?? [];
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

  const brandAvg =
    brandCount > 0 ? Math.round(brandTotalScore / brandCount) : 0;
  const competitorAvg =
    compCount > 0 ? Math.round(compTotalScore / compCount) : 0;

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

  const promptInfo = new Map<
    string,
    { text: string; topicId: string | null }
  >();
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
      const { delta, deltaPct } = computeDelta(
        curAgg.value,
        prevAgg.value,
        metric,
      );
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
    const topicName = info?.topicId
      ? topicNameById.get(info.topicId)
      : undefined;
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
      tid === '__uncategorized__'
        ? 'Uncategorized'
        : (topicNameById.get(tid) ?? 'Unknown topic'),
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
    metric === 'visibility'
      ? 'Visibility'
      : metric === 'mentions'
        ? 'Mentions'
        : 'Citations';

  const isDrop = totalDelta < 0;
  const isFlat = totalDelta === 0;

  // Select the biggest contributor in the same direction as the overall change.
  // `buildRows` sorts ascending by delta so byPrompt[0] is the largest drop and
  // byPrompt[last] is the largest gain.
  const topPrompt = isDrop ? byPrompt[0] : byPrompt[byPrompt.length - 1];
  const topPlatform = isDrop
    ? byPlatform[0]
    : byPlatform[byPlatform.length - 1];

  const promptContributes =
    !!topPrompt && (isDrop ? topPrompt.delta < 0 : topPrompt.delta > 0);
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
function formatContribution(
  row: BreakdownRow,
  metric: BreakdownMetric,
): string {
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
