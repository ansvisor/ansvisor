'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { Json } from '@/types/supabase';
import { API_BASE_URL } from '@/config/api';
import {
  getInsightsSummary,
  getShareOfVoiceData,
  getCompetitorComparison,
  getVisibilityTrend,
  type InsightsSummary,
  type CompetitorComparisonEntry,
  type SoVByPlatform,
  type VisibilityTrendPoint,
} from '@/lib/actions/tracking';
import { getCitationsOverview, type CitationsSourceBreakdown } from '@/lib/actions/citations';
import type { SourceCategory } from '@/lib/citations/classify';

/**
 * Simple Reports MVP — generate, list and delete immutable report snapshots.
 *
 * `createReport` gathers the brand's metrics for the chosen period through the
 * existing analytics actions, asks the server for a 1-2 paragraph AI executive
 * summary, and saves everything as one JSONB payload in the `reports` table
 * (migration 00023). The detail page renders purely from that saved payload —
 * a report never changes after generation.
 */

// ─── Payload shape (what reports.payload stores) ─────────────────────────────

export interface ReportTopDomain {
  domain: string;
  category: SourceCategory;
  totalCitations: number;
  resultsCiting: number;
  usagePct: number;
}

export interface ReportPromptPerf {
  text: string;
  avgVisibility: number;
  totalMentions: number;
  runs: number;
}

export interface ReportFanoutQuery {
  query: string;
  engines: string[];
  timesSearched: number;
}

export interface ReportPayload {
  brandName: string;
  /** AI-generated executive summary (plain prose). */
  summaryText: string;
  insights: InsightsSummary;
  /**
   * Daily visibility trend over the report period. Optional: reports
   * generated before this field shipped simply don't have it (the payload is
   * immutable), and the detail page hides the section.
   */
  visibilityTrend?: VisibilityTrendPoint[];
  /** Best/worst performing prompts in the period (also optional, see above). */
  promptPerformance?: {
    best: ReportPromptPerf[];
    worst: ReportPromptPerf[];
  };
  /** Most-run observed fan-out sub-queries in the period (optional, see above). */
  queryFanout?: ReportFanoutQuery[];
  shareOfVoice: {
    overallSov: number;
    overallSovChange: number | null;
    byPlatform: SoVByPlatform[];
  };
  /** Own brand + competitors, as returned by getCompetitorComparison. */
  competitors: CompetitorComparisonEntry[];
  citations: {
    totals: {
      domains: number;
      urls: number;
      citations: number;
      results: number;
      avgCitationsPerResult: number;
    };
    sourceTypeBreakdown: CitationsSourceBreakdown[];
    topDomains: ReportTopDomain[];
  };
}

export interface ReportListItem {
  id: string;
  brandId: string;
  title: string;
  template: string;
  dateFrom: string;
  dateTo: string;
  createdAt: string;
}

export interface Report extends ReportListItem {
  payload: ReportPayload;
}

/** How many citation domains a report keeps (the table is capped, by design). */
const REPORT_TOP_DOMAINS = 10;

/** How many best/worst prompts a report keeps. */
const REPORT_PROMPT_COUNT = 5;

/**
 * Best/worst prompts by average visibility WITHIN the report period.
 * getPromptVisibilitySummaries anchors its window to "now", which lies for
 * custom historical ranges — so reports aggregate over [dateFrom, dateTo]
 * directly (same shape: exclude chatgpt-shopping, average per prompt).
 */
async function getPromptPerformance(
  brandId: string,
  dateFrom: string,
  dateTo: string,
): Promise<{ best: ReportPromptPerf[]; worst: ReportPromptPerf[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prompt_results')
    .select('prompt_id, visibility_score, mention_count')
    .eq('brand_id', brandId)
    .neq('platform', 'chatgpt-shopping')
    .gte('created_at', dateFrom)
    .lte('created_at', dateTo);
  if (error) throw new Error(error.message);

  const acc = new Map<string, { sumVis: number; mentions: number; runs: number }>();
  for (const r of data ?? []) {
    const pid = r.prompt_id as string | null;
    if (!pid) continue;
    const entry = acc.get(pid) ?? { sumVis: 0, mentions: 0, runs: 0 };
    entry.sumVis += (r.visibility_score as number) ?? 0;
    entry.mentions += (r.mention_count as number) ?? 0;
    entry.runs += 1;
    acc.set(pid, entry);
  }
  if (acc.size === 0) return { best: [], worst: [] };

  const { data: promptRows } = await supabase
    .from('prompts')
    .select('id, text')
    .in('id', [...acc.keys()]);
  const textById = new Map((promptRows ?? []).map((p) => [p.id as string, p.text as string]));

  const ranked = [...acc.entries()]
    .map(([pid, v]) => ({
      text: textById.get(pid) ?? '',
      avgVisibility: Math.round((v.sumVis / v.runs) * 10) / 10,
      totalMentions: v.mentions,
      runs: v.runs,
    }))
    .filter((p) => p.text)
    .sort((a, b) => b.avgVisibility - a.avgVisibility);

  const best = ranked.slice(0, REPORT_PROMPT_COUNT);
  // Worst come from the remaining pool so a short prompt list doesn't show
  // the same prompt in both columns.
  const worst = ranked.slice(REPORT_PROMPT_COUNT).slice(-REPORT_PROMPT_COUNT).reverse();
  return { best, worst };
}

/** How many fan-out sub-queries a report keeps. */
const REPORT_FANOUT_COUNT = 10;

/**
 * Top observed fan-out sub-queries WITHIN the report period. Mirrors the
 * aggregation in fanout.ts (dedupe per answer, whitespace/case-normalized
 * grouping) but bounded to [dateFrom, dateTo] instead of a rolling window
 * anchored to "now", which would lie for historical custom ranges.
 */
async function getFanoutSnapshot(
  brandId: string,
  dateFrom: string,
  dateTo: string,
): Promise<ReportFanoutQuery[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prompt_results')
    .select('platform, search_queries')
    .eq('brand_id', brandId)
    .gte('created_at', dateFrom)
    .lte('created_at', dateTo);
  if (error) throw new Error(error.message);

  const normalize = (raw: string) => raw.replace(/\s+/g, ' ').trim();
  const byQuery = new Map<string, { display: string; engines: Set<string>; count: number }>();

  for (const row of data ?? []) {
    const items = Array.isArray(row.search_queries)
      ? (row.search_queries as { query?: unknown; source_platform?: unknown }[])
      : [];
    const seenInRow = new Set<string>();
    for (const item of items) {
      const q = typeof item?.query === 'string' ? normalize(item.query) : '';
      if (!q) continue;
      const key = q.toLowerCase();
      let acc = byQuery.get(key);
      if (!acc) {
        acc = { display: q, engines: new Set(), count: 0 };
        byQuery.set(key, acc);
      }
      const sp =
        typeof item?.source_platform === 'string' && item.source_platform
          ? item.source_platform
          : (row.platform as string | null);
      if (sp) acc.engines.add(sp);
      if (!seenInRow.has(key)) {
        acc.count += 1;
        seenInRow.add(key);
      }
    }
  }

  return [...byQuery.values()]
    .sort((a, b) => b.count - a.count || a.display.localeCompare(b.display))
    .slice(0, REPORT_FANOUT_COUNT)
    .map((a) => ({ query: a.display, engines: [...a.engines].sort(), timesSearched: a.count }));
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export async function createReport(
  brandId: string,
  opts: { dateFrom: string; dateTo: string; title?: string },
): Promise<{ id: string }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { dateFrom, dateTo } = opts;
  const range = { dateFrom, dateTo };

  // 1. Gather the metric snapshot through the existing analytics actions.
  const [brandRow, insights, sov, comparison, citations, trend, promptPerformance, queryFanout] =
    await Promise.all([
      supabase.from('brands').select('name').eq('id', brandId).single(),
      getInsightsSummary(brandId, range),
      getShareOfVoiceData(brandId, range),
      getCompetitorComparison(brandId, range),
      getCitationsOverview(brandId, { datePreset: 'custom', dateFrom, dateTo }),
      getVisibilityTrend(brandId, range),
      getPromptPerformance(brandId, dateFrom, dateTo),
      getFanoutSnapshot(brandId, dateFrom, dateTo),
    ]);
  const brandName = (brandRow.data?.name as string) ?? 'Brand';

  const snapshot: Omit<ReportPayload, 'summaryText'> = {
    brandName,
    insights,
    visibilityTrend: trend,
    promptPerformance,
    queryFanout,
    shareOfVoice: {
      overallSov: sov.overallSov,
      overallSovChange: sov.overallSovChange,
      byPlatform: sov.byPlatform,
    },
    competitors: comparison.brands,
    citations: {
      totals: citations.totals,
      sourceTypeBreakdown: citations.sourceTypeBreakdown,
      topDomains: citations.rows.slice(0, REPORT_TOP_DOMAINS).map((r) => ({
        domain: r.domain,
        category: r.category,
        totalCitations: r.totalCitations,
        resultsCiting: r.resultsCiting,
        usagePct: r.usagePct,
      })),
    },
  };

  // 2. AI executive summary from the server (content.js-style single call).
  const res = await fetch(`${API_BASE_URL}/api/reports/summary`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ brandId, snapshot, dateFrom, dateTo }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Summary generation failed: ${res.status}`);
  }
  const { summary } = (await res.json()) as { summary: string };

  const payload: ReportPayload = { ...snapshot, summaryText: summary };

  // 3. Persist the immutable snapshot (RLS scopes the insert to org members).
  const title =
    opts.title?.trim() ||
    `${brandName} — Executive Summary (${dateFrom.slice(0, 10)} → ${dateTo.slice(0, 10)})`;

  const { data: created, error } = await supabase
    .from('reports')
    .insert({
      brand_id: brandId,
      title,
      template: 'executive_summary',
      date_from: dateFrom,
      date_to: dateTo,
      payload: payload as unknown as Json,
      created_by: session.user.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  revalidatePath('/dashboard/reports');
  return { id: created.id as string };
}

export async function getReports(brandId: string): Promise<ReportListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reports')
    .select('id, brand_id, title, template, date_from, date_to, created_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: r.id as string,
    brandId: r.brand_id as string,
    title: r.title as string,
    template: r.template as string,
    dateFrom: r.date_from as string,
    dateTo: r.date_to as string,
    createdAt: r.created_at as string,
  }));
}

export async function getReport(id: string): Promise<Report | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reports')
    .select('id, brand_id, title, template, date_from, date_to, payload, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    id: data.id as string,
    brandId: data.brand_id as string,
    title: data.title as string,
    template: data.template as string,
    dateFrom: data.date_from as string,
    dateTo: data.date_to as string,
    createdAt: data.created_at as string,
    payload: data.payload as unknown as ReportPayload,
  };
}

export async function deleteReport(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('reports').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/reports');
}
