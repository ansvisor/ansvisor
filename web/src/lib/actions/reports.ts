'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { computeAiVisibilityScore } from '@/lib/visibility-score';
import type { Json } from '@/types/supabase';
import { API_BASE_URL } from '@/config/api';
import {
  getInsightsSummary,
  getShareOfVoiceData,
  getCompetitorComparison,
  getVisibilityRateTrend,
  getVisibilityRateKpi,
  getTrackedPromptsKpi,
  type InsightsSummary,
  type CompetitorComparisonEntry,
  type SoVByPlatform,
  type VisibilityTrendPoint,
} from '@/lib/actions/tracking';
import { getCitationsOverview, type CitationsSourceBreakdown } from '@/lib/actions/citations';
import { getShoppingKpis } from '@/lib/actions/shopping';
import { extractHostname, type SourceCategory } from '@/lib/citations/classify';
import {
  getReportTemplate,
  ALL_REPORT_SECTIONS,
  type ReportSection,
  type ReportTemplateId,
} from '@/lib/reports/templates';

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
  /** Average 0-100 intensity score over all runs — kept for older payloads. */
  avgVisibility: number;
  /**
   * Share of runs where the brand was mentioned or cited, as a percentage
   * (#562 semantics). Absent on reports generated before this shipped.
   */
  visibilityRate?: number;
  /** AI Visibility Score (0-100). Absent on reports generated before it shipped. */
  score?: number;
  totalMentions: number;
  runs: number;
}

export interface ReportFanoutQuery {
  query: string;
  engines: string[];
  timesSearched: number;
}

/** One concrete brand mention: which prompt, where, and the passage (#429). */
export interface ReportMentionEvidence {
  promptText: string;
  /** Platform slug as stored on the result (UI maps to a label). */
  platform: string;
  date: string;
  mentionCount: number;
  /** Short passage of the answer around the brand mention. */
  excerpt: string;
}

/** One concrete cited URL and the prompts whose answers cited it (#429). */
export interface ReportCitationEvidence {
  url: string;
  domain: string;
  title: string;
  totalCitations: number;
  /** Up to a few tracked prompts whose answers cited this URL. */
  sourcedPrompts: string[];
}

export interface ReportTopicPerf {
  name: string;
  /** Average 0-100 intensity score over all runs — kept for older payloads. */
  avgVisibility: number;
  /**
   * Share of the topic's runs where the brand was mentioned or cited, as a
   * percentage (#562 semantics). Absent on reports generated before this
   * shipped.
   */
  visibilityRate?: number;
  /** AI Visibility Score (0-100). Absent on reports generated before it shipped. */
  score?: number;
  /**
   * Points change vs the previous window of equal length; null when no prior
   * data. Score points on payloads carrying `score`, visibility-rate points
   * on `visibilityRate`-era ones, raw-score points on the oldest.
   */
  change: number | null;
  results: number;
}

export interface ReportAiTraffic {
  totalVisits: number;
  /** Percent change vs the previous window; null when the previous window had no visits. */
  change: number | null;
  platformBreakdown: { platform: string; visits: number }[];
  topPages: { url: string; visits: number }[];
}

export interface ReportShoppingVisibility {
  /** Own share of all shopping cards in the window, as a percentage. */
  shoppingSovPct: number;
  /** Points change vs the previous window; null when no prior shopping data. */
  sovChange: number | null;
  productsSurfaced: number;
  /** Share of tracked answers that produced shopping cards, as a percentage. */
  cardRatePct: number;
  topMerchant: string | null;
}

export interface ReportAuditScore {
  url: string;
  totalScore: number | null;
  /** The prior completed audit's score, for the delta; null when first audit. */
  previousScore: number | null;
  auditedAt: string;
}

/** Prompt-level Visibility Rate KPI (#492) — mirrors the Insights dashboard's headline metric. */
export interface ReportVisibilityRate {
  /** Distinct prompts the brand appeared in (the rate's numerator). */
  visiblePrompts: number;
  /** Distinct tracked prompts that produced results in the window (shared denominator). */
  promptCount: number;
  /** visiblePrompts / promptCount as a percentage, one decimal place (coverage). */
  ratePct: number;
  /**
   * AI Visibility Score (0-100): 0.6×mention rate + 0.25×citation rate +
   * 0.15×position factor over the window's answers. Absent on reports
   * generated before the score shipped.
   */
  score?: number | null;
  mentionAnswers?: number;
  citationAnswers?: number;
  positionFactor?: number | null;
}

/**
 * All metric fields are optional: a template only gathers its own sections
 * (see lib/reports/templates.ts), and the detail page + PDF render purely by
 * field presence. Reports generated before a field shipped simply don't have
 * it — the payload is immutable.
 */
export interface ReportPayload {
  brandName: string;
  /** AI-generated executive summary (plain prose). */
  summaryText: string;
  insights?: InsightsSummary;
  /** Prompt-level Visibility Rate — leads the KPI row (#492); absent on reports generated before this shipped. */
  visibilityRate?: ReportVisibilityRate;
  /** Daily visibility trend over the report period. */
  visibilityTrend?: VisibilityTrendPoint[];
  /** Best/worst performing prompts in the period. */
  promptPerformance?: {
    best: ReportPromptPerf[];
    worst: ReportPromptPerf[];
  };
  /** The top mentioning answers, with the passage around the mention (#429). */
  mentionEvidence?: ReportMentionEvidence[];
  /** The top cited URLs with the prompts whose answers cited them (#429). */
  citationEvidence?: ReportCitationEvidence[];
  /** Most-run observed fan-out sub-queries in the period. */
  queryFanout?: ReportFanoutQuery[];
  /** Per-topic visibility with deltas vs the previous window. */
  topicPerformance?: ReportTopicPerf[];
  /** Real AI-referred visits in the period. */
  aiTraffic?: ReportAiTraffic;
  /** Shopping card presence (only gathered when the brand's shopping mode is on). */
  shoppingVisibility?: ReportShoppingVisibility;
  /** Latest completed Site Audit as of the period end. */
  auditScore?: ReportAuditScore;
  shareOfVoice?: {
    overallSov: number;
    overallSovChange: number | null;
    byPlatform: SoVByPlatform[];
  };
  /** Own brand + competitors, as returned by getCompetitorComparison. */
  competitors?: CompetitorComparisonEntry[];
  citations?: {
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
 * Every full-window prompt_results scan must page: PostgREST silently caps a
 * select at 1000 rows, which on busy brands computes a report section from a
 * truncated window (the #430/#464 defect family).
 */
const SCAN_PAGE_SIZE = 1000;
const SCAN_MAX_ROWS = 50_000;

/**
 * Best/worst prompts by prompt-level Visibility Rate WITHIN the report period
 * — the share of runs the brand actually appeared in, not an average score
 * that zero-visibility runs dilute into misleading single digits (#562).
 * getPromptVisibilitySummaries anchors its window to "now", which lies for
 * custom historical ranges — so reports aggregate over [dateFrom, dateTo]
 * directly (same shape: exclude chatgpt-shopping, one row per run).
 */
async function getPromptPerformance(
  brandId: string,
  dateFrom: string,
  dateTo: string,
): Promise<{ best: ReportPromptPerf[]; worst: ReportPromptPerf[] }> {
  const supabase = await createClient();

  const acc = new Map<
    string,
    {
      sumVis: number;
      mentions: number;
      runs: number;
      visibleRuns: number;
      mentionAnswers: number;
      citationAnswers: number;
      posSum: number;
      posN: number;
    }
  >();
  for (let offset = 0; offset < SCAN_MAX_ROWS; offset += SCAN_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('prompt_results')
      .select('prompt_id, visibility_score, mention_count, citation_count, mention_position')
      .eq('brand_id', brandId)
      .neq('platform', 'chatgpt-shopping')
      .gte('created_at', dateFrom)
      .lte('created_at', dateTo)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + SCAN_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const batch = data ?? [];
    for (const r of batch) {
      const pid = r.prompt_id as string | null;
      if (!pid) continue;
      const entry = acc.get(pid) ?? {
        sumVis: 0,
        mentions: 0,
        runs: 0,
        visibleRuns: 0,
        mentionAnswers: 0,
        citationAnswers: 0,
        posSum: 0,
        posN: 0,
      };
      const mentions = (r.mention_count as number) ?? 0;
      const citations = (r.citation_count as number) ?? 0;
      const pos = r.mention_position as number | null;
      entry.sumVis += (r.visibility_score as number) ?? 0;
      entry.mentions += mentions;
      entry.runs += 1;
      if (mentions > 0 || citations > 0) entry.visibleRuns += 1;
      if (mentions > 0) entry.mentionAnswers += 1;
      if (citations > 0) entry.citationAnswers += 1;
      if (pos !== null && pos !== undefined && pos > 0) {
        entry.posSum += 1 / pos;
        entry.posN += 1;
      }
      acc.set(pid, entry);
    }

    if (batch.length < SCAN_PAGE_SIZE) break;
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
      visibilityRate: Math.round((v.visibleRuns / v.runs) * 1000) / 10,
      // AI Visibility Score over this prompt's answers — same blend as the
      // All Prompts column, so a prompt reads identically in a report.
      score:
        computeAiVisibilityScore({
          answers: v.runs,
          mentionAnswers: v.mentionAnswers,
          citationAnswers: v.citationAnswers,
          positionFactor: v.posN > 0 ? v.posSum / v.posN : null,
        }) ?? 0,
      totalMentions: v.mentions,
      runs: v.runs,
    }))
    .filter((p) => p.text)
    .sort((a, b) => b.score - a.score || b.totalMentions - a.totalMentions);

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
    .map((a) => ({
      query: a.display,
      engines: [...a.engines].sort(),
      timesSearched: a.count,
    }));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The window of equal length immediately before [dateFrom, dateTo] — every
 *  report delta (US-1.4) compares against this. */
function previousWindow(dateFrom: string, dateTo: string): { from: string; to: string } {
  const from = new Date(dateFrom).getTime();
  const to = new Date(dateTo).getTime();
  return { from: new Date(from - (to - from)).toISOString(), to: dateFrom };
}

/** How many topics a report keeps. */
const REPORT_TOPIC_COUNT = 8;

/**
 * Per-topic Visibility Rate WITHIN the report period, with a rate-points delta
 * vs the previous window (#562 — an all-runs average score lets zero-visibility
 * runs dilute a well-covered topic). Same two-step pattern as
 * getPromptPerformance: one paged prompt_results scan spanning both windows,
 * then resolve topic names.
 */
async function getTopicPerformance(
  brandId: string,
  dateFrom: string,
  dateTo: string,
): Promise<ReportTopicPerf[]> {
  const supabase = await createClient();
  const prev = previousWindow(dateFrom, dateTo);

  // Two windows in one scan hits the 1000-row cap even sooner than the
  // single-window scans, so page it.
  const rows: {
    prompt_id: string | null;
    visibility_score: number | null;
    mention_count: number | null;
    citation_count: number | null;
    mention_position: number | null;
    created_at: string;
  }[] = [];
  for (let offset = 0; offset < SCAN_MAX_ROWS; offset += SCAN_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('prompt_results')
      .select(
        'prompt_id, visibility_score, mention_count, citation_count, mention_position, created_at',
      )
      .eq('brand_id', brandId)
      .neq('platform', 'chatgpt-shopping')
      .gte('created_at', prev.from)
      .lte('created_at', dateTo)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + SCAN_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < SCAN_PAGE_SIZE) break;
  }
  if (rows.length === 0) return [];

  const promptIds = [...new Set(rows.map((r) => r.prompt_id as string).filter(Boolean))];
  const { data: promptRows } = await supabase
    .from('prompts')
    .select('id, topic_id')
    .in('id', promptIds);
  const topicByPrompt = new Map(
    (promptRows ?? []).filter((p) => p.topic_id).map((p) => [p.id as string, p.topic_id as string]),
  );
  if (topicByPrompt.size === 0) return [];

  interface Acc {
    sumVis: number;
    n: number;
    visible: number;
    mentionAnswers: number;
    citationAnswers: number;
    posSum: number;
    posN: number;
    prevN: number;
    prevVisible: number;
    prevMentionAnswers: number;
    prevCitationAnswers: number;
    prevPosSum: number;
    prevPosN: number;
  }
  const byTopic = new Map<string, Acc>();
  for (const r of rows) {
    const topicId = topicByPrompt.get(r.prompt_id as string);
    if (!topicId) continue;
    const acc = byTopic.get(topicId) ?? {
      sumVis: 0,
      n: 0,
      visible: 0,
      mentionAnswers: 0,
      citationAnswers: 0,
      posSum: 0,
      posN: 0,
      prevN: 0,
      prevVisible: 0,
      prevMentionAnswers: 0,
      prevCitationAnswers: 0,
      prevPosSum: 0,
      prevPosN: 0,
    };
    const mentions = (r.mention_count as number | null) ?? 0;
    const citations = (r.citation_count as number | null) ?? 0;
    const pos = r.mention_position as number | null;
    const isVisible = mentions > 0 || citations > 0;
    if ((r.created_at as string) >= dateFrom) {
      acc.sumVis += r.visibility_score ?? 0;
      acc.n += 1;
      if (isVisible) acc.visible += 1;
      if (mentions > 0) acc.mentionAnswers += 1;
      if (citations > 0) acc.citationAnswers += 1;
      if (pos !== null && pos !== undefined && pos > 0) {
        acc.posSum += 1 / pos;
        acc.posN += 1;
      }
    } else {
      acc.prevN += 1;
      if (isVisible) acc.prevVisible += 1;
      if (mentions > 0) acc.prevMentionAnswers += 1;
      if (citations > 0) acc.prevCitationAnswers += 1;
      if (pos !== null && pos !== undefined && pos > 0) {
        acc.prevPosSum += 1 / pos;
        acc.prevPosN += 1;
      }
    }
    byTopic.set(topicId, acc);
  }

  const { data: topicRows } = await supabase
    .from('topics')
    .select('id, name')
    .in('id', [...byTopic.keys()]);
  const nameById = new Map((topicRows ?? []).map((t) => [t.id as string, t.name as string]));

  return [...byTopic.entries()]
    .filter(([id, acc]) => acc.n > 0 && nameById.has(id))
    .map(([id, acc]) => {
      const rate = Math.round((acc.visible / acc.n) * 1000) / 10;
      // AI Visibility Score over the topic's answers, per window — same
      // blend as the Topics page so the two surfaces agree.
      const score =
        computeAiVisibilityScore({
          answers: acc.n,
          mentionAnswers: acc.mentionAnswers,
          citationAnswers: acc.citationAnswers,
          positionFactor: acc.posN > 0 ? acc.posSum / acc.posN : null,
        }) ?? 0;
      const prevScore =
        acc.prevN > 0
          ? (computeAiVisibilityScore({
              answers: acc.prevN,
              mentionAnswers: acc.prevMentionAnswers,
              citationAnswers: acc.prevCitationAnswers,
              positionFactor: acc.prevPosN > 0 ? acc.prevPosSum / acc.prevPosN : null,
            }) ?? 0)
          : null;
      return {
        name: nameById.get(id)!,
        avgVisibility: round1(acc.sumVis / acc.n),
        visibilityRate: rate,
        score,
        change: prevScore === null ? null : round1(score - prevScore),
        results: acc.n,
      };
    })
    .sort((a, b) => b.results - a.results || b.score - a.score)
    .slice(0, REPORT_TOPIC_COUNT);
}

/**
 * Real AI-referred visits WITHIN the report period, with a percent delta vs
 * the previous window. Windowed here (getTrafficSummary anchors to "now").
 */
async function getTrafficSnapshot(
  brandId: string,
  dateFrom: string,
  dateTo: string,
): Promise<ReportAiTraffic> {
  const supabase = await createClient();
  const prev = previousWindow(dateFrom, dateTo);

  const [{ data: cur, error }, { data: prevRows }] = await Promise.all([
    supabase
      .from('ai_traffic_logs')
      .select('source_platform, url')
      .eq('brand_id', brandId)
      .gte('created_at', dateFrom)
      .lte('created_at', dateTo),
    supabase
      .from('ai_traffic_logs')
      .select('id')
      .eq('brand_id', brandId)
      .gte('created_at', prev.from)
      .lt('created_at', prev.to),
  ]);
  if (error) throw new Error(error.message);

  const byPlatform = new Map<string, number>();
  const byPage = new Map<string, number>();
  for (const r of cur ?? []) {
    const p = (r.source_platform as string) || 'unknown';
    byPlatform.set(p, (byPlatform.get(p) ?? 0) + 1);
    const u = (r.url as string) || '';
    if (u) byPage.set(u, (byPage.get(u) ?? 0) + 1);
  }

  const totalVisits = cur?.length ?? 0;
  const prevVisits = prevRows?.length ?? 0;
  return {
    totalVisits,
    change: prevVisits > 0 ? round1(((totalVisits - prevVisits) / prevVisits) * 100) : null,
    platformBreakdown: [...byPlatform.entries()]
      .map(([platform, visits]) => ({ platform, visits }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 5),
    topPages: [...byPage.entries()]
      .map(([url, visits]) => ({ url, visits }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 5),
  };
}

/**
 * Shopping card presence WITHIN the report period (reuses getShoppingKpis
 * with an explicit window), plus a points delta on shopping SoV vs the
 * previous window. Callers gate on the brand's shopping mode.
 */
async function getShoppingSnapshot(
  brandId: string,
  dateFrom: string,
  dateTo: string,
): Promise<ReportShoppingVisibility> {
  const prev = previousWindow(dateFrom, dateTo);
  const [cur, prior] = await Promise.all([
    getShoppingKpis(brandId, { datePreset: 'all', dateFrom, dateTo }),
    getShoppingKpis(brandId, {
      datePreset: 'all',
      dateFrom: prev.from,
      dateTo: prev.to,
    }),
  ]);

  const sovPct = round1(cur.shoppingSov * 100);
  const priorHasData = prior.shoppingCardRateSampleSize > 0;
  return {
    shoppingSovPct: sovPct,
    sovChange: priorHasData ? round1(sovPct - prior.shoppingSov * 100) : null,
    productsSurfaced: cur.productsSurfaced,
    cardRatePct: round1(cur.shoppingCardRate * 100),
    topMerchant: cur.topMerchant?.domain ?? null,
  };
}

/**
 * Latest completed Site Audit as of the period end, with the prior audit's
 * score for the delta. Audits aren't period-bound like the other metrics, so
 * "as of dateTo" keeps historical reports honest.
 */
async function getAuditSnapshot(brandId: string, dateTo: string): Promise<ReportAuditScore | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('site_audits')
    .select('url, total_score, created_at')
    .eq('brand_id', brandId)
    .eq('status', 'completed')
    .lte('created_at', dateTo)
    .order('created_at', { ascending: false })
    .limit(2);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return null;

  const [latest, prior] = data;
  return {
    url: latest.url as string,
    totalScore: latest.total_score === null ? null : round1(Number(latest.total_score)),
    previousScore: prior && prior.total_score !== null ? round1(Number(prior.total_score)) : null,
    auditedAt: latest.created_at as string,
  };
}

/**
 * Visibility Rate KPI for the report snapshot (#492) — same shape and
 * denominator as the Insights dashboard's headline metric, so a report's KPI
 * row matches what the Insights page shows for the identical date range.
 */
async function getReportVisibilityRate(
  brandId: string,
  range: { dateFrom: string; dateTo: string },
): Promise<ReportVisibilityRate> {
  const supabase = await createClient();
  const [rate, tracked, visRes] = await Promise.all([
    getVisibilityRateKpi(brandId, range),
    getTrackedPromptsKpi(brandId, range),
    supabase.rpc('ai_visibility_aggregates', {
      p_brand_id: brandId,
      p_platform: null,
      p_models: null,
      p_region: null,
      p_date_from: range.dateFrom,
      p_date_to: range.dateTo,
      p_prompt_id: null,
      p_topic_id: null,
    }),
  ]);
  const promptCount = tracked.activeInPeriod;
  const vis = (visRes.data ?? {}) as {
    answers?: number;
    mention_answers?: number;
    citation_answers?: number;
    position_factor?: number | null;
  };
  const answers = Number(vis.answers ?? 0);
  const mentionAnswers = Number(vis.mention_answers ?? 0);
  const citationAnswers = Number(vis.citation_answers ?? 0);
  const positionFactor = vis.position_factor ?? null;
  return {
    visiblePrompts: rate.visiblePrompts,
    promptCount,
    ratePct: promptCount > 0 ? Math.round((rate.visiblePrompts / promptCount) * 1000) / 10 : 0,
    score: computeAiVisibilityScore({
      answers,
      mentionAnswers,
      citationAnswers,
      positionFactor,
    }),
    mentionAnswers,
    citationAnswers,
    positionFactor,
  };
}

/** How many evidence rows a report keeps per evidence section (#429). */
const REPORT_EVIDENCE_COUNT = 10;
/** How many sourcing prompts each cited URL lists. */
const EVIDENCE_PROMPTS_PER_URL = 3;

/** Light markdown/URL strip so excerpts read as prose. */
function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/[^\s)>\]]+/g, '')
    .replace(/[*_#`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The passage of an answer around the first brand mention — the "how was I
 * mentioned" a KPI total can't convey. Falls back to the answer's opening
 * when the mention came via a domain rather than the brand name.
 */
function mentionExcerpt(response: string, brandName: string): string {
  const clean = stripMarkdown(response);
  const idx = clean.toLowerCase().indexOf(brandName.toLowerCase());
  if (idx === -1) {
    return clean.length > 180 ? `${clean.slice(0, 180).trimEnd()}…` : clean;
  }
  const start = Math.max(0, idx - 60);
  const end = Math.min(clean.length, idx + brandName.length + 140);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < clean.length ? '…' : '';
  return `${prefix}${clean.slice(start, end).trim()}${suffix}`;
}

/**
 * Top mentioning answers in the window (#429): prompt, platform, date and the
 * passage around the mention. Server-side ORDER BY + LIMIT — no scan needed.
 */
async function getMentionEvidence(
  brandId: string,
  brandName: string,
  dateFrom: string,
  dateTo: string,
): Promise<ReportMentionEvidence[]> {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from('prompt_results')
    .select('prompt_id, platform, created_at, mention_count, response')
    .eq('brand_id', brandId)
    .neq('platform', 'chatgpt-shopping')
    .gt('mention_count', 0)
    .gte('created_at', dateFrom)
    .lte('created_at', dateTo)
    .order('mention_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(REPORT_EVIDENCE_COUNT);

  const results = (rows ?? []) as Array<{
    prompt_id: string | null;
    platform: string | null;
    created_at: string;
    mention_count: number | null;
    response: string | null;
  }>;
  if (results.length === 0) return [];

  const promptIds = [...new Set(results.map((r) => r.prompt_id).filter(Boolean))] as string[];
  const promptTextById = new Map<string, string>();
  if (promptIds.length > 0) {
    const { data: promptRows } = await supabase
      .from('prompts')
      .select('id, text')
      .in('id', promptIds);
    for (const p of promptRows ?? []) promptTextById.set(p.id as string, p.text as string);
  }

  return results.map((r) => ({
    promptText: (r.prompt_id && promptTextById.get(r.prompt_id)) || '(deleted prompt)',
    platform: r.platform ?? '',
    date: r.created_at,
    mentionCount: r.mention_count ?? 0,
    excerpt: mentionExcerpt(r.response ?? '', brandName),
  }));
}

/**
 * Top cited URLs in the window with the prompts whose answers cited them
 * (#429). Needs its own paginated scan: the citations overview aggregates
 * URLs but doesn't keep the prompt attribution the evidence section is for.
 */
async function getCitationEvidence(
  brandId: string,
  dateFrom: string,
  dateTo: string,
): Promise<ReportCitationEvidence[]> {
  const supabase = await createClient();
  const PAGE_SIZE = 1000;
  const MAX_ROWS = 50_000;

  interface UrlAgg {
    url: string;
    domain: string;
    title: string;
    count: number;
    promptIds: Set<string>;
  }
  const byUrl = new Map<string, UrlAgg>();

  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('prompt_results')
      .select('prompt_id, citations')
      .eq('brand_id', brandId)
      .neq('platform', 'chatgpt-shopping')
      .gte('created_at', dateFrom)
      .lte('created_at', dateTo)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const batch = (data ?? []) as Array<{
      prompt_id: string | null;
      citations: Array<{ url?: string; title?: string }> | null;
    }>;

    for (const row of batch) {
      const citations = Array.isArray(row.citations) ? row.citations : [];
      for (const cite of citations) {
        if (!cite?.url) continue;
        const host = extractHostname(cite.url);
        if (!host) continue;
        // Same URL normalization the Citations page uses, so the evidence
        // list lines up with the overview's Top URLs.
        let normalized = cite.url;
        try {
          const parsed = new URL(cite.url);
          parsed.search = '';
          parsed.hash = '';
          normalized = parsed.toString().replace(/\/$/, '');
        } catch {
          // leave as-is
        }
        const agg = byUrl.get(normalized) ?? {
          url: normalized,
          domain: host,
          title: cite.title || '',
          count: 0,
          promptIds: new Set<string>(),
        };
        agg.count += 1;
        if (!agg.title && cite.title) agg.title = cite.title;
        if (row.prompt_id) agg.promptIds.add(row.prompt_id);
        byUrl.set(normalized, agg);
      }
    }

    if (batch.length < PAGE_SIZE) break;
  }

  const top = [...byUrl.values()]
    .sort((a, b) => b.count - a.count || a.url.localeCompare(b.url))
    .slice(0, REPORT_EVIDENCE_COUNT);
  if (top.length === 0) return [];

  const allPromptIds = [...new Set(top.flatMap((u) => [...u.promptIds]))];
  const promptTextById = new Map<string, string>();
  if (allPromptIds.length > 0) {
    const { data: promptRows } = await supabase
      .from('prompts')
      .select('id, text')
      .in('id', allPromptIds);
    for (const p of promptRows ?? []) promptTextById.set(p.id as string, p.text as string);
  }

  return top.map((u) => ({
    url: u.url,
    domain: u.domain,
    title: u.title,
    totalCitations: u.count,
    sourcedPrompts: [...u.promptIds]
      .map((id) => promptTextById.get(id))
      .filter((t): t is string => Boolean(t))
      .slice(0, EVIDENCE_PROMPTS_PER_URL),
  }));
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/** English display names used in stored (immutable) report titles. */
const TEMPLATE_TITLES: Record<ReportTemplateId, string> = {
  weekly_visibility: 'Weekly Visibility Summary',
  executive_summary: 'Executive Summary',
  competitor_benchmark: 'Competitor Benchmark',
  citation_sources: 'Citation & Sources Report',
};

export async function createReport(
  brandId: string,
  opts: {
    dateFrom: string;
    dateTo: string;
    title?: string;
    template?: ReportTemplateId;
    /** Explicit section picks (US-1.3); falls back to the template's defaults. */
    sections?: ReportSection[];
  },
): Promise<{ id: string }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { dateFrom, dateTo } = opts;
  const range = { dateFrom, dateTo };
  const template = getReportTemplate(opts.template);

  // The brand row gates the shopping section server-side: even if a caller
  // sends `shoppingVisibility`, a brand with shopping mode off never gathers
  // it (mirrors the sidebar's requiresBrandPref rule).
  const { data: brand } = await supabase
    .from('brands')
    .select('name, shopping_mode_enabled')
    .eq('id', brandId)
    .single();
  const brandName = (brand?.name as string) ?? 'Brand';

  const picked = (opts.sections ?? template.sections).filter((s) =>
    ALL_REPORT_SECTIONS.includes(s),
  );
  const sectionSet = new Set<ReportSection>(picked);
  if (!brand?.shopping_mode_enabled) sectionSet.delete('shoppingVisibility');
  const has = (s: ReportSection) => sectionSet.has(s);

  // 1. Gather the metric snapshot through the existing analytics actions —
  //    only the picked sections (null = section not gathered).
  const [
    insights,
    visibilityRate,
    sov,
    comparison,
    citations,
    trend,
    promptPerformance,
    mentionEvidence,
    citationEvidence,
    queryFanout,
    topicPerformance,
    aiTraffic,
    shoppingVisibility,
    auditScore,
  ] = await Promise.all([
    has('kpis') ? getInsightsSummary(brandId, range) : null,
    has('kpis') ? getReportVisibilityRate(brandId, range) : null,
    has('shareOfVoice') ? getShareOfVoiceData(brandId, range) : null,
    has('competitors') ? getCompetitorComparison(brandId, range) : null,
    has('citations')
      ? getCitationsOverview(brandId, {
          datePreset: 'custom',
          dateFrom,
          dateTo,
        })
      : null,
    has('trend') ? getVisibilityRateTrend(brandId, range) : null,
    has('promptPerformance') ? getPromptPerformance(brandId, dateFrom, dateTo) : null,
    has('mentionEvidence') ? getMentionEvidence(brandId, brandName, dateFrom, dateTo) : null,
    has('citationEvidence') ? getCitationEvidence(brandId, dateFrom, dateTo) : null,
    has('queryFanout') ? getFanoutSnapshot(brandId, dateFrom, dateTo) : null,
    has('topicPerformance') ? getTopicPerformance(brandId, dateFrom, dateTo) : null,
    has('aiTraffic') ? getTrafficSnapshot(brandId, dateFrom, dateTo) : null,
    has('shoppingVisibility') ? getShoppingSnapshot(brandId, dateFrom, dateTo) : null,
    has('auditScore') ? getAuditSnapshot(brandId, dateTo) : null,
  ]);

  // Adapt VisibilityRateTrendData → VisibilityTrendPoint[] so the report
  // payload's visibilityTrend field stays array-shaped (same contract as
  // getTopicDetail in tracking.ts). Each day's brand score maps to `score`;
  // the average of all competitor scores for that day maps to `competitors`
  // (null when no competitors are tracked).
  const visibilityTrend: VisibilityTrendPoint[] | null = trend
    ? (() => {
        const competitorKeys = trend.entities.filter((e) => !e.isOwnBrand).map((e) => e.key);
        return trend.points.map((pt) => {
          const compScores = competitorKeys
            .map((k) => pt.values[k])
            .filter((v): v is number => v !== undefined);
          return {
            date: pt.date,
            score: pt.values['you'] ?? 0,
            competitors:
              compScores.length > 0
                ? round1(compScores.reduce((a, b) => a + b, 0) / compScores.length)
                : null,
          };
        });
      })()
    : null;

  const snapshot: Omit<ReportPayload, 'summaryText'> = {
    brandName,
    ...(insights ? { insights } : {}),
    ...(visibilityRate ? { visibilityRate } : {}),
    ...(visibilityTrend ? { visibilityTrend } : {}),
    ...(promptPerformance ? { promptPerformance } : {}),
    ...(mentionEvidence && mentionEvidence.length > 0 ? { mentionEvidence } : {}),
    ...(citationEvidence && citationEvidence.length > 0 ? { citationEvidence } : {}),
    ...(queryFanout ? { queryFanout } : {}),
    ...(topicPerformance && topicPerformance.length > 0 ? { topicPerformance } : {}),
    ...(aiTraffic ? { aiTraffic } : {}),
    ...(shoppingVisibility ? { shoppingVisibility } : {}),
    ...(auditScore ? { auditScore } : {}),
    ...(sov
      ? {
          shareOfVoice: {
            overallSov: sov.overallSov,
            overallSovChange: sov.overallSovChange,
            byPlatform: sov.byPlatform,
          },
        }
      : {}),
    ...(comparison ? { competitors: comparison.brands } : {}),
    ...(citations
      ? {
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
        }
      : {}),
  };

  // 2. AI executive summary from the server (content.js-style single call).
  //    The template id lets the server flavor the prose for the report type.
  const res = await fetch(`${API_BASE_URL}/api/reports/summary`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      brandId,
      snapshot,
      dateFrom,
      dateTo,
      template: template.id,
    }),
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
    `${brandName} — ${TEMPLATE_TITLES[template.id]} (${dateFrom.slice(0, 10)} → ${dateTo.slice(0, 10)})`;

  const { data: created, error } = await supabase
    .from('reports')
    .insert({
      brand_id: brandId,
      title,
      template: template.id,
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
