import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { allowedBrands, brandAccessFor, hasBrandAccess } from '@/lib/brand-access';
import type { McpAuthContext } from '@/lib/mcp-auth';
import type { Citation } from '@/types';
import {
  classifyDomain,
  extractHostname,
  normalizeDomain,
  SOURCE_CATEGORIES,
  type SourceCategory,
} from '@/lib/citations/classify';
import { classifyArticleType } from '@/lib/citations/article-type';
import { expandDateToEndOfDay } from '@/lib/dates';
import { countTrafficLogs, scanTrafficLogs } from '@/lib/traffic-scan';
import { readSnippet } from '@/lib/traffic-snippet';
import { snippetState, type SnippetState } from '@/lib/traffic-sources';
import { computeAiVisibilityScore } from '@/lib/visibility-score';
import {
  competitorTypeLabel,
  matchesCompetitorType,
  missingCompetitorTypeColumn,
} from '@/lib/competitor-types';
import { aliasesByCompetitor, type MergedCompetitorRow } from '@/lib/competitor-merge';
import {
  answeredSpanMs,
  coveringDayWindow,
  wholeDayWindow,
  type DayWindow,
} from '@/lib/insights-windows';
import { API_BASE_URL } from '@/config/api';
import { ORG_PLAN_COLUMNS, planFromOrgRow, usagePlanFromOrgRow } from '@/lib/guards/plan-guard';
import { PLANS, type Feature, getMinimumPlanForFeature, hasFeature, isCloud } from '@/config/plans';
import { assertSubscriptionActive } from '@/lib/mcp/subscription-gate';
import { DemoBrandError, assertNotDemoBrand, callOnDemoBrand } from '@/lib/mcp/demo-gate';
import { MEMBER_ROLES, requireManager, requireRole } from '@/lib/mcp/role-gate';
import {
  fetchPromptUsageRow,
  toPromptUsageSummary,
  type PromptUsageSummary,
} from '@/lib/prompt-usage-summary';
import { mapSignalRows, type SignalRow } from '@/lib/signals/map';
import { readPromptPlaces } from '@/lib/signals/prompt-places';
import { currentActionFirst, signalDetailForApi, type SignalActionRef } from '@/lib/signals/detail';
import {
  currentPriorityReason,
  currentTaskParams,
  readEntityCounts,
  readKeptEntities,
  withEntityCounts,
  withoutTargetIds,
} from '@/lib/action-center/entity-counts';
import { affectedOf, affectedSignals, type Affected } from '@/lib/action-center/affected';
import {
  parseTaskDetails,
  withTemplateCheck,
  withTemplateDoneWhen,
} from '@/lib/action-center/task-details';
import { controlNetOf } from '@/lib/action-center/history';
import {
  confidenceNote,
  parsePriorityReason,
  type ConfidenceLevel,
} from '@/lib/action-center/priority';
import {
  dismissReasonOf,
  missingDismissReason,
  type ActionDismissReason,
} from '@/lib/action-center/registry';
import { locationCode, isValidLocation } from '@/lib/region';
import { promptVolumeEstimate, type EstimateConfidence } from '@/lib/volume-estimate';
import { readPromptDemand, type PromptDemand } from './prompt-demand';
import { PAGE_ROWS, pageRows } from './list-page';
import {
  ANSWERS_READ_ROWS,
  citedPagesCutNote,
  cutOf,
  productCutNote,
  type AnswersCut,
} from './answers-read';
import {
  CITED_TOP,
  LOOKUP_MAX,
  LOOKUP_WORDS,
  askedIds,
  containsPattern,
  idAndSearchLookup,
  keysOf,
  lookUpCited,
  lookUpKeys,
  lookupEnd,
  periodWords,
  searchWords,
  type CitedLookup,
  type IdAndSearchLookup,
  type LookupWords,
} from './lookup';
import { getOrgLocationUsage, placeNewPrompt, waitingPromptColumns } from '@/lib/prompt-locations';
import { NO_TOPICS, brandHasTopics } from '@/lib/topics-required';
import {
  promptSourceData,
  sourceDataRefused,
  type PromptSuggestionSource,
  type SuggestionSourceData,
} from '@/lib/prompt-suggestion-source';
import {
  filterPromptSuggestionEngines,
  promptSuggestionsAreStale,
} from './prompt-suggestions-utils';
import { readQuestionVolume } from '@/lib/content/question-volume-read';
import {
  opportunityVolumeForMcp,
  type OpportunityVolumeForMcp,
} from '@/lib/content/question-volume';
import { refreshYears } from '@/lib/content/current-year';
import type { OpportunitySort } from '@/lib/content/opportunity-list';
import {
  comparePromptSortRows,
  type PromptSortRow,
} from '@/app/[locale]/(dashboard)/dashboard/prompts/prompt-sort';
import { readPageComparison, type RangedAuditRow } from '@/lib/audit/page-trend';
import type { ScoreRange } from '@/lib/audit/score-range';
import { actionCode } from '@/lib/action-center/action-ref';
import { signalCode } from '@/lib/signals/signal-code';

/**
 * Pure data-fetch functions shared by the MCP route and the parallel REST
 * endpoints under `/api/mcp/*`. Each function takes an authenticated context
 * (already resolved to a user + organization) and returns plain JSON the
 * caller can ship over the wire or into an MCP tool result.
 */

export interface BrandRow {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  region: string | null;
  created_at: string;
  /** The demo brand (00380): sample data, read like any brand; nothing on it is written or run. */
  is_demo: boolean;
}

/**
 * The organization's brands the person may use (BRAND-ACCESS: all, or the
 * ones shared with them), newest first. The demo brand is one of them,
 * marked is_demo, unless the organization hid it (once a plan was bought, or
 * from the brand menu).
 */
export async function listBrandsFor(auth: McpAuthContext): Promise<BrandRow[]> {
  if (!auth.organizationId) return [];

  const [{ data, error }, access] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select('id, name, slug, industry, region, created_at, is_demo')
      .eq('organization_id', auth.organizationId)
      .or('is_demo.eq.false,demo_hidden_at.is.null')
      .order('created_at', { ascending: false }),
    brandAccessFor(auth),
  ]);

  if (error) throw new Error(error.message);
  return allowedBrands(access, (data ?? []) as BrandRow[]);
}

export interface VisibilitySummaryParams {
  brandId: string;
  dateFrom?: string;
  dateTo?: string;
  model?: string;
  region?: string;
  /**
   * Also give every competitor named in the period (`everyCompetitor`), not
   * only the top 5 by mentions: Today's rank among primary rivals (AC-02).
   * Never set from a tool's input.
   */
  everyCompetitor?: boolean;
}

export interface VisibilitySummary {
  brand: { id: string; name: string };
  totals: {
    resultCount: number;
    /** DEPRECATED — all-answers average of the legacy 0-100 intensity score. */
    avgVisibility: number;
    totalMentions: number;
    totalCitations: number;
    /** Distinct prompts the brand appeared in (mention_count > 0 OR citation_count > 0). */
    visiblePrompts: number;
    /** Distinct prompts that produced results (shopping excluded). */
    promptCount: number;
    /**
     * DEPRECATED as the headline — coverage: visiblePrompts / promptCount ×
     * 100. Kept for compatibility; prefer aiVisibilityScore.
     */
    visibilityRatePct: number;
    /**
     * HEADLINE metric (0-100): 0.6 × mention rate + 0.25 × citation rate +
     * 0.15 × position factor over the filtered answers. Matches the
     * dashboard's Visibility number everywhere. Null when no answers.
     */
    aiVisibilityScore: number | null;
    /** Answers mentioning the brand (score component). */
    mentionAnswers: number;
    /** Answers citing the brand's own domain (score component). */
    citationAnswers: number;
    /** Mean of 1/position over mentioning answers; null when never mentioned. */
    positionFactor: number | null;
  };
  topCompetitors: Array<{
    name: string;
    mentions: number;
    /** DEPRECATED — legacy average intensity over the shared denominator. */
    avgVisibility: number;
    /** AI Visibility Score over the brand's answers (shared denominator). */
    score: number | null;
  }>;
  /**
   * Every competitor named in the period, with its score and the prompts it
   * appeared in (null when the read doesn't give them). Only when asked
   * (`everyCompetitor`).
   */
  everyCompetitor?: EveryCompetitorScore[];
  /**
   * The whole UTC days read in place of the period asked, when it started or
   * ended inside a day and ran longer than a day (`note` says so): every day
   * it touches, from the daily rollups. An absent bound stays open.
   */
  roundedToDays?: DayWindow;
  /** Why the summary covers other times than the period asked, when it does. */
  note?: string;
}

/** A competitor's score in the period, for a rank over a chosen set. */
export interface EveryCompetitorScore {
  id: string;
  name: string;
  score: number | null;
  visiblePrompts: number | null;
}

/** ai_visibility_aggregates(_daily)'s payload: the score's components, brand and competitors. */
interface AiVisibilityPayload {
  answers?: number;
  mention_answers?: number;
  citation_answers?: number;
  position_factor?: number | string | null;
  by_competitor?: Array<{
    competitor_id?: string | null;
    name: string | null;
    mention_answers?: number;
    citation_answers?: number;
    position_factor?: number | string | null;
  }>;
}

/** The AI Visibility Score of a payload, the brand's and each competitor's (shared denominator). */
function foldAiVisibility(data: unknown) {
  const aiVis = (data ?? {}) as AiVisibilityPayload;
  const factor = (value: number | string | null | undefined) =>
    value === null || value === undefined ? null : Number(value);
  const answers = Number(aiVis.answers ?? 0);
  const mentionAnswers = Number(aiVis.mention_answers ?? 0);
  const citationAnswers = Number(aiVis.citation_answers ?? 0);
  const positionFactor = factor(aiVis.position_factor);
  return {
    aiVisibilityScore: computeAiVisibilityScore({
      answers,
      mentionAnswers,
      citationAnswers,
      positionFactor,
    }),
    mentionAnswers,
    citationAnswers,
    positionFactor,
    competitors: (aiVis.by_competitor ?? []).map((c) => ({
      id: c.competitor_id ?? null,
      name: c.name,
      score: computeAiVisibilityScore({
        answers,
        mentionAnswers: Number(c.mention_answers ?? 0),
        citationAnswers: Number(c.citation_answers ?? 0),
        positionFactor: factor(c.position_factor),
      }),
    })),
  };
}

export async function getVisibilitySummaryFor(
  auth: McpAuthContext,
  params: VisibilitySummaryParams,
): Promise<VisibilitySummary | null> {
  const summary = await readVisibilitySummary(auth, params);
  if (!summary || params.everyCompetitor) return summary;
  // The full list stays out of Chat's and the MCP Server's reads.
  const rest = { ...summary };
  delete rest.everyCompetitor;
  return rest;
}

async function readVisibilitySummary(
  auth: McpAuthContext,
  params: VisibilitySummaryParams,
): Promise<VisibilitySummary | null> {
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id, name')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  // Build a shared model list once — used by both the raw query and the RPCs.
  const p_models = params.model
    ? params.model
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
  const p_models_arg = p_models && p_models.length > 0 ? p_models : null;

  // Whole UTC days (Chat's default window, a date-only range, all time) are
  // answered from the daily rollups, as the Visibility page answers them.
  const days = wholeDayWindow(params.dateFrom, params.dateTo);
  if (days) {
    return visibilitySummaryFromRollups(brand, {
      models: p_models_arg,
      region: params.region ?? null,
      days,
    });
  }

  // Inside a day and longer than about a day (an MCP call's timestamps): the whole UTC days
  // it touches, from the rollups, saying so. The raw aggregates' cost follows the answers in
  // the window: on the busiest brand 13 s for 7 days, past 120 s for 90 (the maintainer's
  // review of 2026-11-17).
  const span = answeredSpanMs(params.dateFrom, params.dateTo);
  if (span === null || span > SUB_DAY_RAW_MAX_MS) {
    const covering = coveringDayWindow(params.dateFrom, params.dateTo);
    if (!covering) throw new Error(UNREADABLE_PERIOD);
    const summary = await visibilitySummaryFromRollups(brand, {
      models: p_models_arg,
      region: params.region ?? null,
      days: covering,
    });
    return { ...summary, roundedToDays: covering, note: roundedToDaysNote(covering) };
  }

  const rpcBaseArgs = {
    p_brand_id: params.brandId,
    p_platform: null as string | null,
    p_models: p_models_arg,
    p_region: params.region ?? null,
    p_date_from: params.dateFrom ?? null,
    p_date_to: expandDateToEndOfDay(params.dateTo) ?? null,
    p_topic_id: null as string | null,
  };

  // #155 — getVisibilitySummaryFor mirrors the insights_aggregates RPC and
  // excludes chatgpt-shopping for the same reason: its model isn't
  // comparable to a normal ChatGPT answer and would skew brand visibility.
  //
  // A window of at most about a day that starts or ends inside a day is
  // answered to the minute by the raw aggregates the Visibility page reads
  // for it (the maintainer's review of 2026-11-16: no answer rows leave the
  // database), all four together:
  //   • competitor_aggregates → the answers, mentions, citations and legacy
  //     average, and each live competitor's mentions and legacy average, as
  //     the Competitors comparison reads them (security invoker: the
  //     service role reads them by brand, after the check above);
  //   • visible_prompt_stats → visiblePrompts (numerator)
  //   • tracked_prompt_count  → promptCount (denominator), the source pair
  //     of getVisibilityRateKpi / getTrackedPromptsKpi on the Insights KPI card;
  //   • ai_visibility_aggregates → the AI Visibility Score's components.
  const [aggRes, visibleRes, promptCountRes, aiVisRes] = await Promise.all([
    supabaseAdmin.rpc('competitor_aggregates', rpcBaseArgs),
    supabaseAdmin.rpc('visible_prompt_stats', rpcBaseArgs),
    supabaseAdmin.rpc('tracked_prompt_count', rpcBaseArgs),
    supabaseAdmin.rpc('ai_visibility_aggregates', rpcBaseArgs),
  ]);
  if (aggRes.error) throw new Error(aggRes.error.message);
  if (visibleRes.error) throw new Error(visibleRes.error.message);
  if (promptCountRes.error) throw new Error(promptCountRes.error.message);
  if (aiVisRes.error) throw new Error(aiVisRes.error.message);

  // Rate fields come from the RPCs — single source of truth, exact parity
  // with the Insights KPI card for the same brand/window/filters.
  const visRpcRow = (visibleRes.data ?? {}) as { visible_prompts?: number };
  return visibilitySummaryOf(brand, aggRes.data, aiVisRes.data, {
    visiblePrompts: Number(visRpcRow.visible_prompts ?? 0),
    promptCount: Number(promptCountRes.data ?? 0),
  });
}

/**
 * The longest window starting or ending inside a day that the visibility
 * summary reads to the minute, from the raw aggregates: a day of answers,
 * with an hour to spare for a rolling "Last 24 hours" read a moment after it
 * was cut (Chat's before a brand's first run). A longer one is read over the
 * whole UTC days it touches, from the daily rollups (the maintainer's
 * review of 2026-11-17).
 */
const SUB_DAY_RAW_MAX_MS = 25 * 60 * 60 * 1000;

const UNREADABLE_PERIOD =
  'date_from and date_to take a day (2026-11-01) or an ISO time (2026-11-01T09:00:00Z).';

/** What a summary rounded to whole days says of its period. */
function roundedToDaysNote(days: DayWindow): string {
  const from = days.dayFrom ?? 'the first day tracked';
  const to = days.dayTo ?? 'today';
  return `The period asked starts or ends inside a day and is longer than a day, so it was rounded to whole UTC days: ${from} to ${to}, every day it touches, from the daily totals the Visibility page reads. A period of a day or less is read to the minute.`;
}

const roundTenth = (value: number) => Math.round(value * 10) / 10;

/** competitor_aggregates(_daily)'s payload, the parts the summary reads. */
interface CompetitorAggregatesPayload {
  brand_row_count?: number;
  brand_sum_visibility?: number | string | null;
  brand_total_mentions?: number;
  brand_total_citations?: number;
  brand_prompt_count?: number;
  brand_visible_prompts?: number;
  by_competitor?: Array<{
    competitor_id: string;
    name: string | null;
    sum_visibility: number | string | null;
    total_mentions: number | null;
    /** Prompts the competitor appeared in: the daily rollups' read only. */
    visible_prompts?: number | null;
  }>;
}

/**
 * The visibility summary over whole UTC days, from the daily rollups
 * (00066, 00164): what the Visibility page reads for the same window, in two
 * calls that run together. Their cost follows the days in the window, not
 * the answers in it.
 *
 *   • competitor_aggregates_daily → the answers, mentions, citations and
 *     legacy average, the prompts answered and appeared in, and each live
 *     competitor's mentions and legacy average;
 *   • ai_visibility_aggregates_daily → the AI Visibility Score's
 *     components, the brand's and each live competitor's.
 *
 * A day's rows are written when its tracking run completes, as on the page.
 */
async function visibilitySummaryFromRollups(
  brand: { id: string; name: string },
  filters: { models: string[] | null; region: string | null; days: DayWindow },
): Promise<VisibilitySummary> {
  const args = {
    p_brand_id: brand.id,
    p_models: filters.models,
    p_region: filters.region,
    p_day_from: filters.days.dayFrom ?? null,
    p_day_to: filters.days.dayTo ?? null,
  };
  const [aggRes, aiVisRes] = await Promise.all([
    supabaseAdmin.rpc('competitor_aggregates_daily', args),
    supabaseAdmin.rpc('ai_visibility_aggregates_daily', args),
  ]);
  if (aggRes.error) throw new Error(aggRes.error.message);
  if (aiVisRes.error) throw new Error(aiVisRes.error.message);
  return visibilitySummaryOf(brand, aggRes.data, aiVisRes.data);
}

/**
 * The summary from competitor_aggregates(_daily) and ai_visibility_aggregates(_daily):
 * the prompts answered and appeared in are the aggregate's, or the KPI card's
 * pair when given.
 */
function visibilitySummaryOf(
  brand: { id: string; name: string },
  aggData: unknown,
  aiVisData: unknown,
  prompts?: { visiblePrompts: number; promptCount: number },
): VisibilitySummary {
  const agg = (aggData ?? {}) as CompetitorAggregatesPayload;
  const resultCount = Number(agg.brand_row_count ?? 0);
  const visiblePrompts = prompts?.visiblePrompts ?? Number(agg.brand_visible_prompts ?? 0);
  const promptCount = prompts?.promptCount ?? Number(agg.brand_prompt_count ?? 0);
  const { competitors: compScores, ...score } = foldAiVisibility(aiVisData);
  const scoreById = new Map(compScores.map((c) => [c.id, c.score]));
  // The legacy averages divide by the brand's answers, competitors' too (#478).
  const average = (sum: number | string | null | undefined) =>
    resultCount > 0 ? roundTenth(Number(sum ?? 0) / resultCount) : 0;

  return {
    brand: { id: brand.id, name: brand.name },
    totals: {
      resultCount,
      avgVisibility: average(agg.brand_sum_visibility),
      totalMentions: Number(agg.brand_total_mentions ?? 0),
      totalCitations: Number(agg.brand_total_citations ?? 0),
      visiblePrompts,
      promptCount,
      visibilityRatePct:
        promptCount > 0 ? Math.round((visiblePrompts / promptCount) * 1000) / 10 : 0,
      ...score,
    },
    topCompetitors:
      resultCount > 0
        ? (agg.by_competitor ?? [])
            .map((c) => ({
              name: c.name ?? '',
              mentions: Number(c.total_mentions ?? 0),
              avgVisibility: average(c.sum_visibility),
              score: scoreById.get(c.competitor_id) ?? null,
            }))
            .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name))
            .slice(0, 5)
        : [],
    everyCompetitor:
      resultCount > 0
        ? (agg.by_competitor ?? []).map((c) => ({
            id: c.competitor_id,
            name: c.name ?? '',
            score: scoreById.get(c.competitor_id) ?? null,
            visiblePrompts:
              c.visible_prompts === null || c.visible_prompts === undefined
                ? null
                : Number(c.visible_prompts),
          }))
        : [],
  };
}

// ── Topics ────────────────────────────────────────────────────────────────────

export interface TopicRow {
  id: string;
  name: string;
  is_active: boolean;
  prompt_count: number;
  created_at: string;
}

export async function listTopicsFor(
  auth: McpAuthContext,
  brandId: string,
): Promise<TopicRow[] | null> {
  if (!auth.organizationId) return null;

  // Ownership check — make sure the brand belongs to the caller's org.
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const { data: topics, error: tErr } = await supabaseAdmin
    .from('topics')
    .select('id, name, is_active, created_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true });
  if (tErr) throw new Error(tErr.message);

  const topicRows = (topics ?? []) as Array<{
    id: string;
    name: string;
    is_active: boolean | null;
    created_at: string;
  }>;
  if (topicRows.length === 0) return [];

  // Count prompts per topic in one round trip (instead of N+1) by selecting
  // topic_id from prompts joined to prompt_sets for this brand and bucketing
  // client-side. Topic-less prompts (topic_id null) are intentionally
  // dropped here — they show up in list_prompts but don't add to any topic.
  const { data: prompts } = await supabaseAdmin
    .from('prompts')
    .select('topic_id, prompt_sets!inner(brand_id)')
    .eq('prompt_sets.brand_id', brandId)
    .not('topic_id', 'is', null);

  const promptRows = (prompts as Array<{ topic_id: string | null }> | null) ?? [];
  const countByTopic = new Map<string, number>();
  for (const row of promptRows) {
    if (!row.topic_id) continue;
    countByTopic.set(row.topic_id, (countByTopic.get(row.topic_id) ?? 0) + 1);
  }

  return topicRows.map((t) => ({
    id: t.id,
    name: t.name,
    is_active: t.is_active ?? true,
    prompt_count: countByTopic.get(t.id) ?? 0,
    created_at: t.created_at,
  }));
}

// ── Topic suggestions (#498) ─────────────────────────────────────────────────
// Read/act on the AI-generated suggestions persisted by #497 (topic_suggestions
// table). Generation itself stays plan-gated behind the web UI's refresh
// button — these tools only list, accept, or dismiss what already exists.

export interface TopicSuggestionRow {
  id: string;
  name: string;
  reason: string | null;
  generated_at: string;
}

/**
 * List pending (status = 'new') topic suggestions for a brand. Ownership is
 * checked the same way as listTopicsFor — a wrong-org or missing brand id
 * returns null before any suggestion row is read.
 */
export async function listTopicSuggestionsFor(
  auth: McpAuthContext,
  brandId: string,
): Promise<TopicSuggestionRow[] | null> {
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const { data, error } = await supabaseAdmin
    .from('topic_suggestions')
    .select('id, name, reason, generated_at')
    .eq('brand_id', brandId)
    .eq('status', 'new')
    .order('generated_at', { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []) as TopicSuggestionRow[];
}

export interface DismissedTopicSuggestion {
  id: string;
  status: 'dismissed';
}

/**
 * Dismiss a pending suggestion so it never reappears in future refreshes.
 * Scoped to status = 'new' so dismissing an already-decided suggestion (added
 * or already dismissed) is a no-op that returns null rather than silently
 * "succeeding" twice. An admin's or a manager's call, as on the Topics page.
 */
export async function dismissTopicSuggestionFor(
  auth: McpAuthContext,
  suggestionId: string,
): Promise<DismissedTopicSuggestion | null> {
  if (!auth.organizationId) return null;
  requireManager(auth);

  const { data: ownership } = await supabaseAdmin
    .from('topic_suggestions')
    .select('id, brand_id, status, brands!inner(organization_id)')
    .eq('id', suggestionId)
    .eq('brands.organization_id', auth.organizationId)
    .eq('status', 'new')
    .maybeSingle();
  if (!ownership || !(await mayUseBrand(auth, ownership.brand_id))) return null;

  const { data, error } = await supabaseAdmin
    .from('topic_suggestions')
    .update({ status: 'dismissed', updated_at: new Date().toISOString() })
    .eq('id', suggestionId)
    .select('id, status')
    .single();
  if (error) throw new Error(error.message);

  return { id: data.id, status: 'dismissed' };
}

export interface AcceptedTopicSuggestion {
  suggestion_id: string;
  topic_id: string;
  topic_name: string;
}

/**
 * Accept a suggestion: create exactly ONE topic via a singular insert (never
 * a bulk replace of the brand's topic list — mirrors the web app's
 * createTopic action), then mark the suggestion added with a pointer to the
 * new topic. Scoped to status = 'new' up front, so accepting the same
 * suggestion twice fails the ownership lookup on the second call instead of
 * creating a second topic. An admin's or a manager's call, as on the Topics
 * page.
 */
export async function acceptTopicSuggestionFor(
  auth: McpAuthContext,
  suggestionId: string,
): Promise<AcceptedTopicSuggestion | null> {
  if (!auth.organizationId) return null;
  requireManager(auth);

  const { data: suggestion } = await supabaseAdmin
    .from('topic_suggestions')
    .select('id, brand_id, name, brands!inner(organization_id)')
    .eq('id', suggestionId)
    .eq('brands.organization_id', auth.organizationId)
    .eq('status', 'new')
    .maybeSingle();
  if (!suggestion || !(await mayUseBrand(auth, suggestion.brand_id))) return null;

  const { data: topic, error: topicErr } = await supabaseAdmin
    .from('topics')
    .insert({ brand_id: suggestion.brand_id, name: suggestion.name.trim() })
    .select('id, name')
    .single();
  if (topicErr) throw new Error(topicErr.message);

  const { error: updateErr } = await supabaseAdmin
    .from('topic_suggestions')
    .update({
      status: 'added',
      added_topic_id: topic.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', suggestionId);
  if (updateErr) throw new Error(updateErr.message);

  return { suggestion_id: suggestionId, topic_id: topic.id, topic_name: topic.name };
}

// ── Prompt suggestions (#918) ──────────────────────────────────────────────────
// These tools operate only on suggestions already persisted by the dashboard.
// Generation remains behind the existing plan-gated refresh action.

export interface PromptSuggestionRow {
  id: string;
  suggested_text: string;
  topic_name: string | null;
  topic_id: string | null;
  reason: string | null;
  est_volume: number | null;
  relevance: number | null;
  source: string;
  source_data: Record<string, unknown> | null;
  generated_at: string;
  expires_at: string;
}

export interface PromptSuggestionList {
  suggestions: PromptSuggestionRow[];
  stale: boolean;
}

/** List pending suggestions only after verifying that the brand belongs to this organization. */
export async function listPromptSuggestionsFor(
  auth: McpAuthContext,
  brandId: string,
): Promise<PromptSuggestionList | null> {
  if (!auth.organizationId) return null;

  const { data: brand, error: brandError } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (brandError) throw new Error(brandError.message);
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const { data, error } = await supabaseAdmin
    .from('prompt_suggestions')
    .select(
      'id, suggested_text, topic_name, topic_id, reason, est_volume, relevance, source, source_data, generated_at, expires_at',
    )
    .eq('brand_id', brandId)
    .eq('status', 'new')
    .order('generated_at', { ascending: false });
  if (error) throw new Error(error.message);

  const suggestions = (data ?? []) as unknown as PromptSuggestionRow[];
  return { suggestions, stale: promptSuggestionsAreStale(suggestions) };
}

export interface DismissedPromptSuggestion {
  id: string;
  status: 'dismissed';
}

/**
 * Dismiss only a pending suggestion belonging to the authenticated
 * organization. Any member but an agency partner may, as the table's update
 * rule.
 */
export async function dismissPromptSuggestionFor(
  auth: McpAuthContext,
  suggestionId: string,
): Promise<DismissedPromptSuggestion | null> {
  if (!auth.organizationId) return null;
  requireRole(auth, MEMBER_ROLES);

  const { data: owned, error: lookupError } = await supabaseAdmin
    .from('prompt_suggestions')
    .select('id, brand_id, brands!inner(organization_id)')
    .eq('id', suggestionId)
    .eq('brands.organization_id', auth.organizationId)
    .eq('status', 'new')
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (!owned || !(await mayUseBrand(auth, owned.brand_id))) return null;

  const { data, error } = await supabaseAdmin
    .from('prompt_suggestions')
    .update({ status: 'dismissed', updated_at: new Date().toISOString() })
    .eq('id', suggestionId)
    .eq('status', 'new')
    .select('id, status')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  return { id: data.id, status: 'dismissed' };
}

export interface AcceptedPromptSuggestion {
  suggestion_id: string;
  prompt_id: string;
  prompt_text: string;
  status: 'added';
  /**
   * The prompt was saved waiting for a spot, not tracked: the plan's prompt
   * locations were full. Absent when it is tracked.
   */
  waiting_for_spot?: true;
}

export type AcceptPromptSuggestionResult =
  | AcceptedPromptSuggestion
  | { error: string; code?: 'plan_limit' | typeof NO_TOPICS };

/**
 * The refusal for a brand with no topic yet, with what an agent can do about
 * it: topic suggestions are the topics it can add itself.
 */
export const MCP_NO_TOPICS_MESSAGE =
  'This brand has no topics yet. Prompts are grouped under topics, so add a topic first: accept one from list_topic_suggestions with accept_topic_suggestion, or add one in Ansvisor under Prompts › Topics. Then accept the prompt suggestion again.';

/**
 * Accept one pending prompt suggestion by creating a tracked prompt, then
 * marking the suggestion added. Mirrors the dashboard's target defaults,
 * plan engine filtering, shopping-mode behavior, region choice and location
 * quota check. Every lookup is organization-scoped; duplicate acceptance
 * removes any losing concurrent insert rather than leaving duplicate prompts.
 * Adding a prompt is an admin's or a manager's call, as on the Prompts page.
 * A brand with no topic yet is refused (`no_topics`), as on the dashboard.
 */
export async function acceptPromptSuggestionFor(
  auth: McpAuthContext,
  suggestionId: string,
): Promise<AcceptPromptSuggestionResult | null> {
  if (!auth.organizationId) return null;
  requireManager(auth);

  const { data: suggestion, error: suggestionError } = await supabaseAdmin
    .from('prompt_suggestions')
    .select(
      'id, brand_id, suggested_text, topic_name, source, source_data, generated_at, brands!inner(organization_id)',
    )
    .eq('id', suggestionId)
    .eq('brands.organization_id', auth.organizationId)
    .eq('status', 'new')
    .maybeSingle();
  if (suggestionError) throw new Error(suggestionError.message);
  if (!suggestion) return null;

  const { data: brand, error: brandError } = await supabaseAdmin
    .from('brands')
    .select('id, organization_id, region, state, shopping_mode_enabled')
    .eq('id', suggestion.brand_id)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (brandError) throw new Error(brandError.message);
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  if (!(await brandHasTopics(supabaseAdmin, brand.id))) {
    return { error: MCP_NO_TOPICS_MESSAGE, code: NO_TOPICS };
  }

  const { data: promptSet, error: promptSetError } = await supabaseAdmin
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brand.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (promptSetError) throw new Error(promptSetError.message);
  if (!promptSet) {
    return { error: 'No prompt set exists for this brand. Create one first.' };
  }

  const { data: defaults, error: defaultsError } = await supabaseAdmin
    .from('prompts')
    .select('platforms, models')
    .eq('prompt_set_id', promptSet.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (defaultsError) throw new Error(defaultsError.message);

  const defaultPlatforms =
    Array.isArray(defaults?.platforms) && defaults.platforms.length > 0
      ? (defaults.platforms as string[])
      : ['chatgpt-web'];
  const defaultModels = Array.isArray(defaults?.models) ? (defaults.models as string[]) : [];

  const { data: organization, error: organizationError } = await supabaseAdmin
    .from('organizations')
    .select(ORG_PLAN_COLUMNS)
    .eq('id', auth.organizationId)
    .maybeSingle();
  if (organizationError) throw new Error(organizationError.message);
  if (!organization) return { error: 'Could not load the organization plan.' };

  const plan = planFromOrgRow(organization);
  const filtered = filterPromptSuggestionEngines(plan.limits, defaultPlatforms, defaultModels);
  if (filtered.platforms.length === 0 && filtered.models.length === 0) {
    return { error: 'Your plan does not allow any of the default prompt engines.' };
  }

  const platforms = brand.shopping_mode_enabled
    ? Array.from(new Set([...filtered.platforms, 'chatgpt-shopping']))
    : filtered.platforms.filter((platform) => platform !== 'chatgpt-shopping');
  if (platforms.length === 0 && filtered.models.length === 0) {
    return { error: 'At least one platform or model must be selected.' };
  }

  // Counted across every brand of the organization. Full: saved waiting for
  // a spot, as on the dashboard.
  const usage = await getOrgLocationUsage(supabaseAdmin, auth.organizationId);
  const waiting = placeNewPrompt(plan, usage.total, 1) === 'wait';

  const country = (brand.region as string | null) ?? 'US';
  const candidateRegion = locationCode(country, brand.state as string | null);
  const region = isValidLocation(candidateRegion) ? candidateRegion : country;

  let topicId: string | null = null;
  // A ChatGPT Business Hub suggestion (00527) whose discovery topic fit none
  // of the brand's names it, and it is made now, as on the dashboard; taken
  // back below if the prompt isn't added.
  let madeTopicId: string | null = null;
  if (suggestion.topic_name) {
    const { data: topic, error: topicError } = await supabaseAdmin
      .from('topics')
      .select('id')
      .eq('brand_id', brand.id)
      .eq('name', suggestion.topic_name)
      .limit(1)
      .maybeSingle();
    if (topicError) throw new Error(topicError.message);
    topicId = topic?.id ?? null;
    if (!topicId && suggestion.source === 'business_hub') {
      const { data: made, error: madeError } = await supabaseAdmin
        .from('topics')
        .insert({ brand_id: brand.id, name: suggestion.topic_name, is_active: true })
        .select('id')
        .single();
      if (madeError) throw new Error(madeError.message);
      topicId = made?.id ?? null;
      madeTopicId = topicId;
    }
  }
  const takeBackTopic = async () => {
    if (madeTopicId) await supabaseAdmin.from('topics').delete().eq('id', madeTopicId);
  };

  // A catalog suggestion's prompt keeps the category or product it came
  // from (prompts.source_data, 00525), as on the dashboard.
  const sourceData = promptSourceData({
    source: suggestion.source as PromptSuggestionSource,
    sourceData: (suggestion.source_data ?? null) as SuggestionSourceData | null,
    generatedAt: suggestion.generated_at,
  });
  const promptRow = {
    prompt_set_id: promptSet.id,
    text: suggestion.suggested_text,
    category: suggestion.topic_name ?? null,
    topic_id: topicId,
    platforms,
    regions: [region],
    models: filtered.models,
    ...(waiting ? waitingPromptColumns() : { is_active: true }),
  };
  const insertPrompt = (withSource: boolean) =>
    supabaseAdmin
      .from('prompts')
      .insert(withSource && sourceData ? { ...promptRow, source_data: sourceData } : promptRow)
      .select('id, text')
      .single();
  let { data: prompt, error: promptError } = await insertPrompt(true);
  if (sourceData && sourceDataRefused(promptError)) {
    ({ data: prompt, error: promptError } = await insertPrompt(false));
  }
  if (promptError || !prompt) {
    await takeBackTopic();
    return { error: promptError?.message ?? 'Failed to add the prompt.' };
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('prompt_suggestions')
    .update({
      status: 'added',
      added_prompt_id: prompt.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', suggestionId)
    .eq('status', 'new')
    .select('id')
    .maybeSingle();

  if (updateError || !updated) {
    // A concurrent accept may have won after our initial read. Remove the
    // prompt we just inserted so the suggestion cannot create duplicates.
    const { error: cleanupError } = await supabaseAdmin
      .from('prompts')
      .delete()
      .eq('id', prompt.id);
    if (cleanupError) {
      throw new Error(
        updateError?.message ??
          'Suggestion was processed concurrently and the duplicate prompt could not be removed.',
      );
    }
    await takeBackTopic();
    if (updateError) throw new Error(updateError.message);
    return null;
  }

  return {
    suggestion_id: suggestionId,
    prompt_id: prompt.id,
    prompt_text: prompt.text,
    status: 'added',
    ...(waiting && { waiting_for_spot: true as const }),
  };
}

// ── Prompts ───────────────────────────────────────────────────────────────────

export interface PromptRow {
  id: string;
  text: string;
  topic_id: string | null;
  topic_name: string | null;
  platforms: string[];
  models: string[];
  regions: string[];
  is_active: boolean;
  created_at: string;
}

export interface ListPromptsParams {
  brandId: string;
  topicId?: string;
  isActive?: boolean;
  limit?: number;
  /** Rows before this page (Chat's pages). */
  offset?: number;
  /** Chat's lookup: these prompts only, by id (checked ids), whatever their topic or state. */
  ids?: readonly string[];
  /**
   * Chat's lookup: the prompts whose text holds every word of this, in any
   * order and case (lookup.ts searchWords), whatever their topic or state.
   * With asListed, the list's own search instead.
   */
  search?: string;
  /**
   * With search: the list as filtered (topic, active state), the prompts
   * whose text holds every word, newest first: the page's search (Chat's
   * as_listed, the maintainer's review of 2026-11-17), not a lookup.
   */
  asListed?: boolean;
}

const PROMPT_LIST_DEFAULT_LIMIT = 100;
const PROMPT_LIST_MAX_LIMIT = 500;

export async function listPromptsFor(
  auth: McpAuthContext,
  params: ListPromptsParams,
): Promise<PromptRow[] | null> {
  return (await promptsPageFor(auth, params))?.rows ?? null;
}

/** The brand's prompts from `offset`, newest first, with how many match in all. */
export async function promptsPageFor(
  auth: McpAuthContext,
  params: ListPromptsParams,
): Promise<{ rows: PromptRow[]; total: number } | null> {
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const limit = Math.min(
    Math.max(params.limit ?? PROMPT_LIST_DEFAULT_LIMIT, 1),
    PROMPT_LIST_MAX_LIMIT,
  );

  const offset = Math.max(Math.trunc(params.offset ?? 0), 0);
  // A lookup (Chat's ids or search) reads every topic and state, its organization joined on the
  // rows; a search as listed (asListed) reads the list as filtered, with its words.
  const lookup = params.ids !== undefined || (params.search !== undefined && !params.asListed);
  const words = searchWords(params.search);
  if (params.ids?.length === 0 || (params.search !== undefined && !words.length)) {
    return { rows: [], total: 0 };
  }
  const organizationId = auth.organizationId;
  const matching = (head = false) => {
    let query = supabaseAdmin
      .from('prompts')
      .select(
        lookup
          ? 'id, text, topic_id, platforms, models, regions, is_active, created_at, prompt_sets!inner(brand_id, brands!inner(organization_id)), topics(name)'
          : 'id, text, topic_id, platforms, models, regions, is_active, created_at, prompt_sets!inner(brand_id), topics(name)',
        { count: 'exact', head },
      )
      .eq('prompt_sets.brand_id', params.brandId);
    if (lookup) {
      query = query.eq('prompt_sets.brands.organization_id', organizationId);
      if (params.ids) query = query.in('id', [...params.ids]);
      // Each word as an escaped pattern: the text is data, never part of the filter's syntax.
      for (const word of words) query = query.ilike('text', containsPattern(word));
      return query;
    }
    if (params.topicId) query = query.eq('topic_id', params.topicId);
    if (typeof params.isActive === 'boolean') {
      query = query.eq('is_active', params.isActive);
    }
    // The list's search (asListed): each word, escaped, as the lookup matches it.
    for (const word of words) query = query.ilike('text', containsPattern(word));
    return query;
  };
  const { rows: data, total } = await pageRows(
    await matching()
      .order('created_at', { ascending: false })
      .order('id')
      .range(offset, offset + limit - 1),
    () => matching(true),
  );

  // Supabase's generated types model the prompts→topics FK as an array (it
  // can't tell single vs many from the schema alone), so the join returns
  // `topics: { name }[]` rather than `topics: { name } | null`. We know it's
  // a single relation, so peel the first element off.
  const rows =
    (data as unknown as Array<{
      id: string;
      text: string;
      topic_id: string | null;
      platforms: string[] | null;
      models: string[] | null;
      regions: string[] | null;
      is_active: boolean;
      created_at: string;
      topics: Array<{ name: string }> | { name: string } | null;
    }> | null) ?? [];

  const page = rows.map((r) => {
    const topic = Array.isArray(r.topics) ? (r.topics[0] ?? null) : r.topics;
    return {
      id: r.id,
      text: r.text,
      topic_id: r.topic_id,
      topic_name: topic?.name ?? null,
      platforms: r.platforms ?? [],
      models: r.models ?? [],
      regions: r.regions ?? [],
      is_active: r.is_active,
      created_at: r.created_at,
    };
  });
  return { rows: page, total };
}

/** What a lookup by ids and words found: its rows under the read's own key. */
export type LookupResult<K extends string, T> = { note: string; not_found: string[] } & {
  [key in K]: T[];
} & { total?: number; offset?: number; next_offset?: number | null };

/** The lookup's rows under `key`, with the search's page when there was a search. */
function asLookup<K extends string, T extends { id: string }>(
  key: K,
  lookup: IdAndSearchLookup<T>,
): LookupResult<K, T> {
  return {
    note: lookup.note,
    ...lookup.page,
    [key]: lookup.rows,
    not_found: lookup.not_found,
  } as LookupResult<K, T>;
}

/**
 * Rows by the ids and words a person named, through a list's own read
 * (`read`): the ids' rows (at most LOOKUP_MAX), and a page of the rows with
 * every word, from `offset`. Null when the read is null (a brand outside
 * the caller's organization or access).
 */
async function lookUpBy<T extends { id: string }>(
  words: LookupWords,
  params: { ids?: readonly string[]; search?: string; offset?: number },
  read: (find: {
    ids?: string[];
    search?: string;
    limit: number;
    offset: number;
  }) => Promise<{ rows: T[]; total: number } | null>,
) {
  const asked = askedIds(params.ids);
  const ids = keysOf<string>(asked, 'id');
  const terms = searchWords(params.search);
  const offset = Math.max(Math.trunc(params.offset ?? 0), 0);
  const [byIds, bySearch] = await Promise.all([
    ids.length > 0 ? read({ ids, limit: LOOKUP_MAX, offset: 0 }) : { rows: [], total: 0 },
    terms.length > 0
      ? read({ search: params.search, limit: PAGE_ROWS, offset })
      : { rows: [], total: 0 },
  ]);
  if (!byIds || !bySearch) return null;
  return idAndSearchLookup(
    words,
    asked.length > 0 ? { asked, rows: byIds.rows } : null,
    params.search !== undefined
      ? { text: params.search, terms, rows: bySearch.rows, total: bySearch.total, offset }
      : null,
  );
}

/**
 * The brand's prompts by the ids or words a person named, for Chat (the
 * owner's plan of 2026-11-16, item 2): every topic and state, active and
 * paused; the words matched in the prompt's text in any order and case.
 * Every id's prompt, and a page of 50 of those with the words. Only this
 * brand of the caller's organization: an id of another brand or workspace
 * is not found. Null for a brand outside the caller's organization or access.
 */
export async function lookUpPromptsFor(
  auth: McpAuthContext,
  params: { brandId: string; ids?: readonly string[]; search?: string; offset?: number },
): Promise<LookupResult<'prompts', PromptRow> | null> {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const lookup = await lookUpBy(LOOKUP_WORDS.prompts, params, (find) =>
    promptsPageFor(auth, { brandId: params.brandId, ...find }),
  );
  return lookup ? asLookup('prompts', lookup) : null;
}

// ── Content Opportunities ───────────────────────────────────────────────────

export interface ContentOpportunityRow {
  id: string;
  title: string;
  description: string | null;
  type: string;
  impact: string;
  opportunity_score: number;
  status: string;
  prompt_id: string | null;
  prompt_text: string | null;
  has_brief: boolean;
  created_at: string;
  updated_at: string;
}

export interface ListContentOpportunitiesParams {
  brandId: string;
  status?: 'new' | 'reviewed' | 'sent' | 'in_progress' | 'done' | 'dismissed' | 'archived';
  impact?: 'high' | 'medium' | 'low';
  type?: 'owned' | 'earned';
  limit?: number;
  /** Rows before this page (Chat's pages). */
  offset?: number;
  /** Chat's lookup: these opportunities only, by id (checked ids), in any status, archived too. */
  ids?: readonly string[];
  /**
   * Chat's lookup: the opportunities whose title holds every word of this,
   * in any status, archived too. With asListed, the list's own search instead.
   */
  search?: string;
  /**
   * With search: the list as filtered (status, impact, type; archived set
   * aside unless asked by status) and sorted, the opportunities whose title
   * holds every word: the page's search (Chat's as_listed, the maintainer's
   * review of 2026-11-17), not a lookup.
   */
  asListed?: boolean;
  /**
   * The Content page's Sort (lib/content/opportunity-list.ts), in its order:
   * newest or oldest by when each was suggested, score by its score, then
   * by id. Left out: highest score, newest on a tie (the MCP tool's order).
   */
  sort?: OpportunitySort;
}

/** A year in a search: Content shows a past year in a title as this one (refreshYears), so it isn't matched. */
const YEAR = /^(?:19|20)\d{2}$/;

export async function listContentOpportunitiesFor(
  auth: McpAuthContext,
  params: ListContentOpportunitiesParams,
): Promise<ContentOpportunityRow[] | null> {
  return (await contentOpportunitiesPageFor(auth, params))?.rows ?? null;
}

/** The opportunities from `offset`, highest score first, with how many match in all. */
export async function contentOpportunitiesPageFor(
  auth: McpAuthContext,
  params: ListContentOpportunitiesParams,
): Promise<{ rows: ContentOpportunityRow[]; total: number } | null> {
  if (!auth.organizationId) return null;

  // Ownership check
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const offset = Math.max(Math.trunc(params.offset ?? 0), 0);
  // A lookup (Chat's ids or search) reads every status, archived too, its organization joined;
  // a search as listed (asListed) reads the list as filtered and sorted, with its words.
  const lookup = params.ids !== undefined || (params.search !== undefined && !params.asListed);
  const searched = searchWords(params.search);
  const words = searched.some((w) => !YEAR.test(w))
    ? searched.filter((w) => !YEAR.test(w))
    : searched;
  if (params.ids?.length === 0 || (params.search !== undefined && !words.length)) {
    return { rows: [], total: 0 };
  }
  const organizationId = auth.organizationId;

  const matching = (head = false) => {
    let query = supabaseAdmin
      .from('content_opportunities')
      .select(
        lookup
          ? 'id, title, description, type, impact, opportunity_score, status, prompt_id, created_at, updated_at, brief, prompts(text), brands!inner(organization_id)'
          : 'id, title, description, type, impact, opportunity_score, status, prompt_id, created_at, updated_at, brief, prompts(text)',
        { count: 'exact', head },
      )
      .eq('brand_id', params.brandId);
    if (lookup) {
      query = query.eq('brands.organization_id', organizationId);
      if (params.ids) query = query.in('id', [...params.ids]);
      // Each word as an escaped pattern: the text is data, never part of the filter's syntax.
      for (const word of words) query = query.ilike('title', containsPattern(word));
      return query;
    }
    // The archived per-prompt backlog (#857) only when asked for by status.
    query = params.status ? query.eq('status', params.status) : query.neq('status', 'archived');
    if (params.impact) query = query.eq('impact', params.impact);
    if (params.type) query = query.eq('type', params.type);
    // The list's search (asListed): each word, escaped, as the lookup matches it.
    for (const word of words) query = query.ilike('title', containsPattern(word));
    return query;
  };
  // The Content page's sorts as its list orders them (server/src/routes/content.js), else the score's.
  const sorted = () => {
    const query = matching();
    if (params.sort === 'score') return query.order('opportunity_score', { ascending: false });
    if (params.sort === 'newest' || params.sort === 'oldest') {
      return query.order('created_at', { ascending: params.sort === 'oldest' });
    }
    return query
      .order('opportunity_score', { ascending: false })
      .order('created_at', { ascending: false });
  };
  const { rows: data, total } = await pageRows(
    await sorted()
      .order('id')
      .range(offset, offset + limit - 1),
    () => matching(true),
  );

  const rows =
    (data as unknown as Array<{
      id: string;
      title: string;
      description: string | null;
      type: string;
      impact: string;
      opportunity_score: number | null;
      status: string;
      prompt_id: string | null;
      created_at: string | null;
      updated_at: string | null;
      brief: Record<string, unknown> | null;
      prompts: Array<{ text: string }> | { text: string } | null;
    }> | null) ?? [];

  const page = rows.map((r) => {
    const prompt = Array.isArray(r.prompts) ? (r.prompts[0] ?? null) : r.prompts;
    return {
      id: r.id,
      // A past year in it reads as this year, as Content shows it (current-year.ts).
      title: refreshYears(r.title),
      description: r.description,
      type: r.type,
      impact: r.impact,
      opportunity_score: Number(r.opportunity_score ?? 0),
      status: r.status,
      prompt_id: r.prompt_id,
      prompt_text: prompt?.text ?? null,
      has_brief: r.brief !== null,
      created_at: r.created_at ?? '',
      updated_at: r.updated_at ?? '',
    };
  });
  return { rows: page, total };
}

/**
 * The brand's content opportunities by the ids or title words a person
 * named, for Chat (the owner's plan of 2026-11-16, item 2): every status,
 * archived included, highest score first. A year in the words isn't matched,
 * as Content shows a past year in a title as this one. Only this brand of
 * the caller's organization: an id of another brand or workspace is not
 * found. Null for a brand outside the caller's organization or access.
 */
export async function lookUpOpportunitiesFor(
  auth: McpAuthContext,
  params: { brandId: string; ids?: readonly string[]; search?: string; offset?: number },
): Promise<LookupResult<'opportunities', ContentOpportunityRow> | null> {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const lookup = await lookUpBy(LOOKUP_WORDS.opportunities, params, (find) =>
    contentOpportunitiesPageFor(auth, { brandId: params.brandId, ...find }),
  );
  return lookup ? asLookup('opportunities', lookup) : null;
}

export interface ContentOpportunityDetail {
  id: string;
  title: string;
  description: string | null;
  type: string;
  impact: string;
  opportunity_score: number;
  status: string;
  prompt_id: string | null;
  prompt_text: string | null;
  /**
   * Its estimated AI searches a month, as the Content page shows it: its
   * question's (prompt_text), one of `of_prompts` it answers
   * (question-volume.ts). Null when its prompt has no volume.
   */
  volume: OpportunityVolumeForMcp | null;
  source_data: Record<string, unknown> | null;
  brief: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface GeneratedBrief {
  id: string;
  brief: Record<string, unknown>;
  generated_at: string;
  regenerated: boolean;
}

/**
 * Generate (or re-generate) the AI content brief for an opportunity.
 *
 * Org-ownership is verified *first* via supabaseAdmin — a wrong-org or
 * missing id returns `null` (→ 404 upstream) and never reaches the
 * aeo-server, so the LLM is never invoked for a tenant that doesn't own
 * the opportunity. Only after ownership passes do we call the internal
 * brief endpoint at `${NEXT_PUBLIC_API_URL}/api/internal/content/:id/brief`
 * with `Authorization: Bearer ${CRON_SECRET}` — same pattern as the
 * `/api/cron/daily-tracking` route. The `ans_` API key never leaves the
 * web layer.
 *
 * Always passes `force: true` because MCP callers explicitly want a fresh
 * brief; cached reads belong on `getContentOpportunityFor`.
 */
export async function generateBriefFor(
  auth: McpAuthContext,
  opportunityId: string,
): Promise<GeneratedBrief | null> {
  if (!auth.organizationId) return null;
  // Generating costs AI: an admin's or a manager's, as in the dashboard.
  requireManager(auth);

  // Ownership check first — wrong-org or missing id returns null with no
  // outbound call, so no LLM cost or data leak for an attacker probing ids.
  const { data: ownership } = await supabaseAdmin
    .from('content_opportunities')
    .select('id, brand_id, brands!inner(organization_id)')
    .eq('id', opportunityId)
    .eq('brands.organization_id', auth.organizationId)
    .maybeSingle();
  if (!ownership || !(await mayUseBrand(auth, ownership.brand_id))) return null;
  // No brief (an LLM call) on the demo brand, nor for a read-only workspace, whoever asks.
  // Only Ansvisor Cloud has demo brands: self-hosted reads nothing for it.
  if (
    await callOnDemoBrand('generate_content_brief', auth.organizationId, {
      opportunity_id: opportunityId,
    })
  ) {
    throw new DemoBrandError();
  }
  await assertSubscriptionActive(auth.organizationId);

  const apiUrl = API_BASE_URL;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error('CRON_SECRET must be configured for MCP brief generation');
  }

  const res = await fetch(`${apiUrl}/api/internal/content/${opportunityId}/brief`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify({ force: true }),
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Internal brief endpoint returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const body = (await res.json()) as {
    brief: Record<string, unknown>;
    generated_at: string;
    regenerated?: boolean;
  };

  return {
    id: opportunityId,
    brief: body.brief,
    generated_at: body.generated_at,
    regenerated: Boolean(body.regenerated),
  };
}

export interface SiteAuditRun {
  id: string;
  brandId: string;
  url: string;
  /** "running", or "recently_audited": the page's audit of minutes ago, not run again. */
  status: string;
  /** The page's audit already running: no new credit was used. */
  alreadyRunning?: boolean;
  /** When the recent audit finished. */
  finishedAt?: string;
  message?: string;
}

export interface SiteAuditListRow {
  id: string;
  url: string;
  status: string;
  totalScore: number | null;
  signalsEvaluated: number | null;
  signalsTotal: number | null;
  createdAt: string;
}

/**
 * List a brand's recent Site Audits (newest first). Pure DB read, no quota —
 * ownership is verified via the brand belonging to the caller's org, so a
 * foreign or unknown brand returns `null`. Lets an agent find a past audit by
 * url/date instead of needing its id.
 */
export async function listSiteAuditsFor(
  auth: McpAuthContext,
  brandId: string,
): Promise<SiteAuditListRow[] | null> {
  return (await siteAuditsPageFor(auth, brandId))?.rows ?? null;
}

/** The brand's Site Audits from `offset`, newest first, with how many there are in all. */
export async function siteAuditsPageFor(
  auth: McpAuthContext,
  brandId: string,
  page: { limit?: number; offset?: number } = {},
): Promise<{ rows: SiteAuditListRow[]; total: number } | null> {
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const limit = Math.min(Math.max(Math.trunc(page.limit ?? 50), 1), 50);
  const offset = Math.max(Math.trunc(page.offset ?? 0), 0);
  const matching = (head = false) =>
    supabaseAdmin
      .from('site_audits')
      .select('id, url, status, total_score, signals_evaluated, signals_total, created_at', {
        count: 'exact',
        head,
      })
      .eq('brand_id', brandId);
  const { rows, total } = await pageRows(
    await matching()
      .order('created_at', { ascending: false })
      .order('id')
      .range(offset, offset + limit - 1),
    () => matching(true),
  );

  const audits = (rows as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    url: r.url as string,
    status: r.status as string,
    totalScore: r.total_score == null ? null : Number(r.total_score),
    signalsEvaluated: r.signals_evaluated == null ? null : Number(r.signals_evaluated),
    signalsTotal: r.signals_total == null ? null : Number(r.signals_total),
    createdAt: r.created_at as string,
  }));
  return { rows: audits, total };
}

export interface SiteAuditQuota {
  used: number;
  limit: number;
  remaining: number;
}

/**
 * The org's monthly Site Audit allowance ({ used, limit, remaining };
 * limit -1 = unlimited). Delegates to the server's `getSiteAuditQuotaStatus`
 * via the CRON_SECRET internal endpoint so plan-limit + usage-counting logic
 * stays single-sourced on the server. No quota is charged.
 */
export async function getSiteAuditQuotaFor(auth: McpAuthContext): Promise<SiteAuditQuota | null> {
  if (!auth.organizationId) return null;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error('CRON_SECRET must be configured for MCP site audit quota');
  }

  const url = `${API_BASE_URL}/api/internal/site-audit-quota?orgId=${encodeURIComponent(
    auth.organizationId,
  )}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cronSecret}` },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Internal site-audit-quota endpoint returned ${res.status}`);
  }

  const body = (await res.json()) as { quota: SiteAuditQuota };
  return body.quota;
}

/**
 * The Tracked Prompts usage cards for a brand (PROMPT-012), so the Agent Chat
 * can answer "how many prompt slots do we have left?" with the page's own
 * numbers: prompt_usage_counters for the counts, the organization's effective
 * plan (Enterprise overrides merged) for the limit.
 */
export async function getPromptUsageFor(
  auth: McpAuthContext,
  brandId: string,
): Promise<PromptUsageSummary | null> {
  if (!auth.organizationId || !(await brandAllowed(auth, brandId))) return null;

  const [{ data: org, error: orgError }, row] = await Promise.all([
    supabaseAdmin
      .from('organizations')
      .select(ORG_PLAN_COLUMNS)
      .eq('id', auth.organizationId)
      .maybeSingle(),
    fetchPromptUsageRow(supabaseAdmin, brandId),
  ]);
  if (orgError) throw new Error(orgError.message);
  if (!row) return null;
  const { plan, ended } = usagePlanFromOrgRow(org);
  return toPromptUsageSummary(row, plan, new Date(), { ended });
}

/**
 * Start a Site Audit for a brand + URL via MCP.
 *
 * Org-ownership is verified *first* via supabaseAdmin — a wrong-org or missing
 * brand returns `null` (→ 404 upstream) and never reaches the aeo-server, so
 * no audit is created and no quota is charged for a tenant that doesn't own the
 * brand. Only after ownership passes do we call the internal audit endpoint at
 * `${API_BASE_URL}/api/internal/site-audits` with `Authorization: Bearer
 * ${CRON_SECRET}` — same pattern as `generateBriefFor`. The `ans_` API key
 * never leaves the web layer. The audit runs async (~30s); the caller polls
 * `getSiteAuditFor` with the returned id.
 */
export async function runSiteAuditFor(
  auth: McpAuthContext,
  brandId: string,
  url: string,
  options: { force?: boolean } = {},
): Promise<SiteAuditRun | null> {
  if (!auth.organizationId) return null;

  // Ownership check first — a wrong-org or missing brand returns null with no
  // outbound call, so probing brand ids costs nothing and starts no audit.
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;
  // No audit (quota and crawling) on the demo brand, nor for a read-only workspace, whoever asks.
  await assertNotDemoBrand(auth.organizationId, brandId);
  await assertSubscriptionActive(auth.organizationId);

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error('CRON_SECRET must be configured for MCP site audits');
  }

  const res = await fetch(`${API_BASE_URL}/api/internal/site-audits`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify({ brandId, url, ...(options.force ? { force: true } : {}) }),
  });

  if (res.status === 404) return null;

  // Audited in the last minutes (00431): not run again, so the agent asks first.
  if (res.status === 409) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      message?: string;
      recent?: { auditId: string; finishedAt: string };
    } | null;
    if (body?.error === 'recently_audited' && body.recent) {
      return {
        id: body.recent.auditId,
        brandId,
        url,
        status: 'recently_audited',
        finishedAt: body.recent.finishedAt,
        message: `${body.message ?? 'This page was audited minutes ago.'} Read it with get_site_audit, or ask the user, and run run_site_audit again with force: true to audit it again (uses one audit).`,
      };
    }
  }

  if (!res.ok) {
    // Surface the server's message (e.g. the monthly-quota / inactive-subscription
    // text) so the agent can relay it instead of a generic failure.
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Internal site-audit endpoint returned ${res.status}`);
  }

  const body = (await res.json()) as {
    audit: { id: string; brandId: string; url: string; status: string };
    alreadyRunning?: boolean;
  };
  return {
    id: body.audit.id,
    brandId: body.audit.brandId,
    url: body.audit.url,
    status: body.audit.status,
    ...(body.alreadyRunning ? { alreadyRunning: true } : {}),
  };
}

export interface SiteAuditSignal {
  key: string;
  category: string | null;
  status: string;
  score: number | null;
  evidence: Record<string, unknown>;
}

export interface SiteAuditResult {
  id: string;
  brandId: string;
  url: string;
  finalUrl: string | null;
  status: string;
  totalScore: number | null;
  categoryScores: Record<string, unknown>;
  signalsEvaluated: number | null;
  signalsTotal: number | null;
  /**
   * The score's range, "64 ± 2" in the report (customer priorities item 1):
   * ± `plusMinus` points, from the page's last `audits` complete audits up to
   * this one, which scored `low` to `high` out of 100. Null with fewer than 3
   * such audits, and for an audit that isn't compared (running, failed or
   * partial).
   */
  scoreRange: ScoreRange | null;
  /**
   * The AI checks couldn't run, so the score leaves them out and isn't
   * compared with the page's other audits: no range and no previous score.
   */
  partial: boolean;
  /**
   * The page's audit before this one, as the audit report compares with it
   * ("+3 since Oct 21"): its score (0–1, as totalScore) and when it ran.
   * Null for a page audited once, and for an audit that isn't compared.
   */
  previousScore: number | null;
  previousCreatedAt: string | null;
  recommendations: unknown[];
  signals: SiteAuditSignal[];
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

/**
 * Read a Site Audit by id for the caller's org. Pure DB read (no LLM, no
 * quota) — the org-ownership filter is applied in the query via the
 * `brands!inner(organization_id)` join, so a foreign or unknown id returns
 * `null`. Returns the status + scores + the score's range and the page's
 * previous score + signals + AI recommendations. The range and the previous
 * score are read from the page's earlier audits as Site Audit's report reads
 * them; when that read fails, the audit comes back without them.
 */
export async function getSiteAuditFor(
  auth: McpAuthContext,
  auditId: string,
): Promise<SiteAuditResult | null> {
  if (!auth.organizationId) return null;

  const { data: audit } = await supabaseAdmin
    .from('site_audits')
    .select('*, brands!inner(organization_id)')
    .eq('id', auditId)
    .eq('brands.organization_id', auth.organizationId)
    .maybeSingle();
  if (!audit || !(await mayUseBrand(auth, audit.brand_id))) return null;

  const [{ data: signalRows }, compared] = await Promise.all([
    supabaseAdmin
      .from('audit_signal_results')
      .select('signal_key, category, status, score, evidence')
      .eq('audit_id', auditId),
    readPageComparison(supabaseAdmin, audit as RangedAuditRow).catch((err: unknown) => {
      console.warn('[mcp] site audit range read failed:', (err as Error).message);
      return { range: null, previous: null };
    }),
  ]);

  const signals: SiteAuditSignal[] = ((signalRows ?? []) as Array<Record<string, unknown>>).map(
    (r) => ({
      key: r.signal_key as string,
      category: (r.category as string | null) ?? null,
      status: r.status as string,
      score: r.score === null || r.score === undefined ? null : Number(r.score),
      evidence: (r.evidence as Record<string, unknown>) ?? {},
    }),
  );

  const a = audit as Record<string, unknown>;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: a.id as string,
    brandId: a.brand_id as string,
    url: a.url as string,
    finalUrl: (a.final_url as string | null) ?? null,
    status: a.status as string,
    totalScore: num(a.total_score),
    categoryScores: (a.category_scores as Record<string, unknown>) ?? {},
    signalsEvaluated: a.signals_evaluated == null ? null : Number(a.signals_evaluated),
    signalsTotal: a.signals_total == null ? null : Number(a.signals_total),
    scoreRange: compared.range,
    partial: a.partial === true,
    previousScore: compared.previous?.score ?? null,
    previousCreatedAt: compared.previous?.createdAt ?? null,
    recommendations: (a.recommendations as unknown[]) ?? [],
    signals,
    error: (a.error as string | null) ?? null,
    createdAt: a.created_at as string,
    completedAt: (a.completed_at as string | null) ?? null,
  };
}

/** An opportunity's question and asset titles, a past year read as this one, as Content shows them. */
function withCurrentYear(sd: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!sd) return null;
  return {
    ...sd,
    ...(typeof sd.promptText === 'string' ? { promptText: refreshYears(sd.promptText) } : {}),
    ...(Array.isArray(sd.assets)
      ? {
          assets: sd.assets.map((a: unknown) =>
            a && typeof a === 'object' && typeof (a as { title?: unknown }).title === 'string'
              ? { ...a, title: refreshYears((a as { title: string }).title) }
              : a,
          ),
        }
      : {}),
  };
}

export async function getContentOpportunityFor(
  auth: McpAuthContext,
  opportunityId: string,
): Promise<ContentOpportunityDetail | null> {
  if (!auth.organizationId) return null;

  const { data, error } = await supabaseAdmin
    .from('content_opportunities')
    .select(
      'id, brand_id, title, description, type, impact, opportunity_score, status, prompt_id, created_at, updated_at, source_data, brief, prompts(text), brands!inner(organization_id)',
    )
    .eq('id', opportunityId)
    .eq('brands.organization_id', auth.organizationId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || !(await mayUseBrand(auth, data.brand_id))) return null;

  const r = data as unknown as {
    id: string;
    brand_id: string;
    title: string;
    description: string | null;
    type: string;
    impact: string;
    opportunity_score: number | null;
    status: string;
    prompt_id: string | null;
    created_at: string | null;
    updated_at: string | null;
    source_data: Record<string, unknown> | null;
    brief: Record<string, unknown> | null;
    prompts: Array<{ text: string }> | { text: string } | null;
  };

  const prompt = Array.isArray(r.prompts) ? (r.prompts[0] ?? null) : r.prompts;
  // The organization is checked above: its prompt is read as the brand's.
  const question = r.prompt_id
    ? await readQuestionVolume(supabaseAdmin, r.brand_id, r.prompt_id)
    : null;
  const kept = r.source_data?.prompts;
  const prompts = Array.isArray(kept) ? kept.length : 1;

  return {
    id: r.id,
    title: refreshYears(r.title),
    description: r.description,
    type: r.type,
    impact: r.impact,
    opportunity_score: Number(r.opportunity_score ?? 0),
    status: r.status,
    prompt_id: r.prompt_id,
    // The tracked prompt's own text, as it is tracked.
    prompt_text: prompt?.text ?? null,
    volume: opportunityVolumeForMcp(question, prompts),
    source_data: withCurrentYear(r.source_data),
    brief: r.brief ?? null,
    created_at: r.created_at ?? '',
    updated_at: r.updated_at ?? '',
  };
}

export const CONTENT_OPPORTUNITY_STATUSES = [
  'new',
  'reviewed',
  'sent',
  'in_progress',
  'done',
  'dismissed',
] as const;

export type ContentOpportunityStatus = (typeof CONTENT_OPPORTUNITY_STATUSES)[number];

export interface UpdatedOpportunityStatus {
  id: string;
  status: ContentOpportunityStatus;
  updated_at: string;
}

/**
 * Move a content opportunity between workflow states (`new` → `sent` →
 * `in_progress` → `done`, or `dismissed`). Closes the loop for MCP-driven
 * content workflows — without this, the user analyses an opportunity in
 * Claude and still has to click through the dashboard to mark progress.
 *
 * Ownership-check-first: the update only runs after we've verified the
 * opportunity's brand belongs to the caller's org. Wrong-org or missing
 * id returns null (→ 404) with no DB write. Any member may record progress;
 * dismissing one, or bringing a dismissed one back, is an admin's or a
 * manager's call.
 */
export async function updateOpportunityStatusFor(
  auth: McpAuthContext,
  opportunityId: string,
  status: ContentOpportunityStatus,
): Promise<UpdatedOpportunityStatus | null> {
  if (!auth.organizationId) return null;

  // Ownership check via the same brands!inner join used by the read tools.
  // A wrong-org id misses here and we return null *before* any update.
  const { data: ownership } = await supabaseAdmin
    .from('content_opportunities')
    .select('id, brand_id, status, brands!inner(organization_id)')
    .eq('id', opportunityId)
    .eq('brands.organization_id', auth.organizationId)
    .maybeSingle();
  if (!ownership || !(await mayUseBrand(auth, ownership.brand_id))) return null;
  if (status === 'dismissed' || ownership.status === 'dismissed') requireManager(auth);

  const updatedAt = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('content_opportunities')
    .update({ status, updated_at: updatedAt })
    .eq('id', opportunityId)
    .select('id, status, updated_at')
    .single();

  if (error) throw new Error(error.message);

  return {
    id: data.id,
    status: data.status as ContentOpportunityStatus,
    updated_at: data.updated_at ?? updatedAt,
  };
}

// ── Competitor comparison + share of voice ───────────────────────────────────

export interface CompetitorComparisonParams {
  brandId: string;
  model?: string;
  region?: string;
  dateFrom?: string;
  dateTo?: string;
  topicId?: string;
  /**
   * Only competitors of this type (00542): a type's name or key in any case,
   * or "none" for the ones without a type (matchesCompetitorType).
   */
  type?: string;
}

export interface CompetitorComparisonOutput {
  brand: {
    id: string;
    name: string;
    avg_visibility_score: number;
    total_mentions: number;
    total_citations: number;
    appearance_count: number;
    /** Distinct prompts the brand appeared in. */
    visible_prompts: number;
    /** Distinct prompts that produced results (shared denominator for all entries). */
    prompt_count: number;
    /**
     * DEPRECATED as the headline — coverage: visible_prompts / prompt_count
     * × 100. Prefer ai_visibility_score.
     */
    visibility_rate_pct: number;
    /**
     * HEADLINE metric (0-100): 0.6 × mention rate + 0.25 × citation rate +
     * 0.15 × position factor over the brand's filtered answers. Matches the
     * dashboard leaderboard. Null when the window has no answers.
     */
    ai_visibility_score: number | null;
  };
  competitors: Array<{
    competitor_id: string;
    name: string;
    avg_visibility_score: number;
    total_mentions: number;
    total_citations: number;
    appearance_count: number;
    /** Distinct prompts this competitor appeared in. */
    visible_prompts: number;
    /**
     * visible_prompts / prompt_count × 100, where prompt_count is the brand's
     * denominator so all entries are on the same scale.
     */
    visibility_rate_pct: number;
    /** Same prompt_count denominator as the brand for transparency. */
    prompt_count: number;
    /** AI Visibility Score over the brand's answers (shared denominator). */
    ai_visibility_score: number | null;
    /** Its type as the Competitors page names it (00542); null for none. */
    type: string | null;
  }>;
  share_of_voice: {
    overall_sov_pct: number;
    total_brand_mentions: number;
    total_competitor_mentions: number;
    by_platform: Array<{
      model_used: string | null;
      platform: string | null;
      brand_mentions: number;
      competitor_mentions: number;
      sov_pct: number;
    }>;
    /**
     * With a type filter: the brand's mentions against only the listed
     * competitors' (their total_mentions). The figures above count every
     * competitor.
     */
    of_type?: {
      type: string;
      overall_sov_pct: number;
      total_brand_mentions: number;
      total_competitor_mentions: number;
    };
  };
}

interface CompetitorAggRpc {
  brand_row_count: number;
  brand_sum_visibility: number;
  brand_total_mentions: number;
  brand_total_citations: number;
  /** Distinct prompts that produced result rows (shared denominator for all rates). */
  brand_prompt_count: number;
  /** Distinct prompts the brand appeared in (mention_count > 0 OR citation_count > 0). */
  brand_visible_prompts: number;
  by_competitor: Array<{
    competitor_id: string;
    name: string | null;
    sum_visibility: number;
    row_count: number;
    total_mentions: number;
    total_citations: number;
    /** Distinct prompts this competitor appeared in, using brand_prompt_count as denominator. */
    visible_prompts: number;
  }>;
}

interface SoVAggRpc {
  total_brand_mentions: number;
  total_competitor_mentions: number;
  by_platform: Array<{
    model_used: string | null;
    platform: string | null;
    brand_mentions: number;
    competitor_mentions: number;
  }>;
}

/**
 * The stored type (00542) of each of a brand's competitors, by id, for a read
 * that has already checked the brand: the rows are the brand's, inner-joined
 * on the key's organization.
 */
export async function competitorTypesFor(
  auth: McpAuthContext,
  brandId: string,
): Promise<Map<string, string | null>> {
  if (!auth.organizationId) return new Map();
  const { data, error } = await supabaseAdmin
    .from('competitors')
    .select('id, type, brands!inner(organization_id)')
    .eq('brand_id', brandId)
    .eq('brands.organization_id', auth.organizationId);
  // A database without 00542 (the web deployed ahead of it): no types.
  if (missingCompetitorTypeColumn(error)) return new Map();
  if (error) throw new Error(error.message);
  return new Map(
    (data ?? []).map((row) => [row.id as string, (row.type as string | null) ?? null]),
  );
}

/**
 * Return a brand's competitor benchmark + share of voice for a window. Combines
 * two existing RPCs (`competitor_aggregates`, `share_of_voice_aggregates`) so the
 * MCP tool and REST surface answer "how do I compare?" / "who's gaining share of
 * voice?" in one round trip.
 *
 * Ownership-check first — wrong-org or missing brand returns null (→ 404
 * upstream) before either RPC fires. Deltas vs a previous window are out of
 * scope for V1 (matches the snapshot-shaped existing MCP tools); a caller that
 * wants a delta can issue a second tool call for the prior period.
 */
export async function getCompetitorComparisonFor(
  auth: McpAuthContext,
  params: CompetitorComparisonParams,
): Promise<CompetitorComparisonOutput | null> {
  if (!auth.organizationId) return null;

  // Ownership check + grab brand name in one query.
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id, name')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const p_models = params.model
    ? params.model
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  const rpcArgs = {
    p_brand_id: params.brandId,
    p_platform: null as string | null,
    p_models: p_models && p_models.length > 0 ? p_models : null,
    p_region: params.region ?? null,
    p_date_from: params.dateFrom ?? null,
    p_date_to: expandDateToEndOfDay(params.dateTo) ?? null,
    p_prompt_id: null as string | null,
    p_topic_id: params.topicId ?? null,
  };

  // Both RPCs are SECURITY DEFINER per the existing pattern — they trust the
  // caller's brand_id, which we've just verified above. The competitors'
  // types (00542) come from the brand's own rows, scoped to the organization.
  const [compRes, sovRes, aiVisRes, typeById] = await Promise.all([
    supabaseAdmin.rpc('competitor_aggregates', rpcArgs),
    supabaseAdmin.rpc('share_of_voice_aggregates', rpcArgs),
    supabaseAdmin.rpc('ai_visibility_aggregates', rpcArgs),
    competitorTypesFor(auth, params.brandId),
  ]);
  if (compRes.error) throw new Error(compRes.error.message);
  if (sovRes.error) throw new Error(sovRes.error.message);
  if (aiVisRes.error) throw new Error(aiVisRes.error.message);

  const aiVis = (aiVisRes.data ?? {}) as {
    answers?: number;
    mention_answers?: number;
    citation_answers?: number;
    position_factor?: number | null;
    by_competitor?: Array<{
      competitor_id: string;
      mention_answers?: number;
      citation_answers?: number;
      position_factor?: number | null;
    }>;
  };
  const aiAnswers = Number(aiVis.answers ?? 0);
  const brandScore = computeAiVisibilityScore({
    answers: aiAnswers,
    mentionAnswers: Number(aiVis.mention_answers ?? 0),
    citationAnswers: Number(aiVis.citation_answers ?? 0),
    positionFactor: aiVis.position_factor ?? null,
  });
  const compScoreById = new Map<string, number | null>();
  for (const c of aiVis.by_competitor ?? []) {
    compScoreById.set(
      c.competitor_id,
      computeAiVisibilityScore({
        answers: aiAnswers,
        mentionAnswers: Number(c.mention_answers ?? 0),
        citationAnswers: Number(c.citation_answers ?? 0),
        positionFactor: c.position_factor ?? null,
      }),
    );
  }

  const comp = compRes.data as unknown as CompetitorAggRpc;
  const sov = sovRes.data as unknown as SoVAggRpc;

  const brandAvg =
    comp.brand_row_count > 0 ? Math.round(comp.brand_sum_visibility / comp.brand_row_count) : 0;

  const brandPromptCount = Number(comp.brand_prompt_count ?? 0);
  const brandVisiblePrompts = Number(comp.brand_visible_prompts ?? 0);
  const brandRatePct =
    brandPromptCount > 0 ? Math.round((brandVisiblePrompts / brandPromptCount) * 1000) / 10 : 0;

  const rateOf = (visible: number, total: number): number =>
    total > 0 ? Math.round((Number(visible) / total) * 1000) / 10 : 0;

  const allCompetitors = comp.by_competitor.map((c) => ({
    competitor_id: c.competitor_id,
    name: c.name && c.name.trim() !== '' ? c.name : c.competitor_id,
    // Same denominator as the brand's average (every filtered row, absence
    // counts as 0) — mirrors getCompetitorComparison in actions/tracking.ts
    // so the MCP surface ranks brands the same way the Insights page does.
    avg_visibility_score:
      comp.brand_row_count > 0 ? Math.round(Number(c.sum_visibility) / comp.brand_row_count) : 0,
    total_mentions: Number(c.total_mentions),
    total_citations: Number(c.total_citations),
    appearance_count: c.row_count,
    visible_prompts: Number(c.visible_prompts ?? 0),
    // Use brand_prompt_count as the shared denominator so all entries are
    // directly comparable — matches the leaderboard semantics from PR #490.
    visibility_rate_pct: rateOf(c.visible_prompts ?? 0, brandPromptCount),
    prompt_count: brandPromptCount,
    ai_visibility_score: compScoreById.get(c.competitor_id) ?? null,
    type: competitorTypeLabel(typeById.get(c.competitor_id)),
  }));
  const competitors = allCompetitors.filter((c) =>
    matchesCompetitorType(typeById.get(c.competitor_id), params.type),
  );

  const totalBrandMentions = Number(sov.total_brand_mentions);
  const totalCompMentions = Number(sov.total_competitor_mentions);
  const totalAll = totalBrandMentions + totalCompMentions;
  const overallSovPct = totalAll > 0 ? Math.round((totalBrandMentions / totalAll) * 1000) / 10 : 0;

  const byPlatform = sov.by_platform.map((bp) => {
    const brandM = Number(bp.brand_mentions);
    const compM = Number(bp.competitor_mentions);
    const total = brandM + compM;
    return {
      model_used: bp.model_used,
      platform: bp.platform,
      brand_mentions: brandM,
      competitor_mentions: compM,
      sov_pct: total > 0 ? Math.round((brandM / total) * 1000) / 10 : 0,
    };
  });

  // With a type: the brand against only those competitors, from the same
  // totals the entries show.
  const typeMentions = competitors.reduce((sum, c) => sum + c.total_mentions, 0);
  const brandTypeMentions = Number(comp.brand_total_mentions);
  const ofType = params.type?.trim()
    ? {
        type: params.type.trim(),
        overall_sov_pct:
          brandTypeMentions + typeMentions > 0
            ? Math.round((brandTypeMentions / (brandTypeMentions + typeMentions)) * 1000) / 10
            : 0,
        total_brand_mentions: brandTypeMentions,
        total_competitor_mentions: typeMentions,
      }
    : undefined;

  return {
    brand: {
      id: brand.id,
      name: brand.name,
      avg_visibility_score: brandAvg,
      total_mentions: Number(comp.brand_total_mentions),
      total_citations: Number(comp.brand_total_citations),
      appearance_count: comp.brand_row_count,
      visible_prompts: brandVisiblePrompts,
      prompt_count: brandPromptCount,
      visibility_rate_pct: brandRatePct,
      ai_visibility_score: brandScore,
    },
    competitors,
    share_of_voice: {
      overall_sov_pct: overallSovPct,
      total_brand_mentions: totalBrandMentions,
      total_competitor_mentions: totalCompMentions,
      by_platform: byPlatform,
      ...(ofType ? { of_type: ofType } : {}),
    },
  };
}

// ── Citations ────────────────────────────────────────────────────────────────

/**
 * Scope a citations query by the source category each URL is classified into
 * (#297). `owned` = the brand's own domains (`you`), `competitor` = a tracked
 * competitor domain, `external` = everything else (editorial / forum / social /
 * review / institutional / other), `all` = no filter (default, current output).
 */
export type CitationSourceFilter = 'all' | 'owned' | 'competitor' | 'external';

export const CITATION_SOURCE_FILTERS: CitationSourceFilter[] = [
  'all',
  'owned',
  'competitor',
  'external',
];

/** Does a classified category pass the requested source filter? */
function citationCategoryMatches(category: SourceCategory, filter: CitationSourceFilter): boolean {
  switch (filter) {
    case 'owned':
      return category === 'you';
    case 'competitor':
      return category === 'competitor';
    case 'external':
      return category !== 'you' && category !== 'competitor';
    case 'all':
    default:
      return true;
  }
}

export interface ListCitationsParams {
  brandId: string;
  dateFrom?: string;
  dateTo?: string;
  /** Comma-separated model_used slugs (e.g. `gpt-4o,claude-sonnet-4-6`). */
  model?: string;
  region?: string;
  topicId?: string;
  /** Cap on the top_domains / top_urls arrays. Default 50, max 200. */
  limit?: number;
  /** Domains and pages before this page, most cited first (Chat's pages). */
  offset?: number;
  /** Restrict to owned / competitor / external citations. Default `all`. */
  sourceFilter?: CitationSourceFilter;
  /**
   * Chat's, when Sources came from the Citations page: beside the filtered
   * lists, the citations of every source and their average per answer, as
   * the page's cards count them (`all_sources_totals`), from the same scan.
   */
  allSourcesTotals?: boolean;
}

/** What the Citations page's cards count over every source, whatever Sources the table shows. */
export interface AllSourcesTotals {
  citations: number;
  avg_citations_per_result: number;
}

export interface CitationsOverviewOutput {
  totals: {
    domains: number;
    urls: number;
    citations: number;
    results_with_citations: number;
    avg_citations_per_result: number;
  };
  source_type_breakdown: Array<{
    category: SourceCategory;
    count: number;
    pct: number;
  }>;
  top_domains: Array<{
    domain: string;
    category: SourceCategory;
    total_citations: number;
    results_citing: number;
    usage_pct: number;
    models: string[];
    article_types: Array<{ type: string; count: number }>;
  }>;
  top_urls: Array<{
    url: string;
    domain: string;
    category: SourceCategory;
    title: string;
    total_citations: number;
    results_citing: number;
    usage_pct: number;
    article_type: string | null;
  }>;
  /**
   * Only when the window held more answers than the bounded read takes
   * (answers-read.ts): what the figures read from answers cover, in its note.
   */
  answers_cut?: AnswersCut;
  /**
   * Only with allSourcesTotals and a source filter: the citations of every
   * source and their average per answer (the page's cards), beside the
   * filtered lists and totals.
   */
  all_sources_totals?: AllSourcesTotals;
}

const CITATIONS_DEFAULT_LIMIT = 50;
const CITATIONS_MAX_LIMIT = 200;

/** A cited domain as the citations reads count it: a row of the Citations page's table. */
interface CitedDomainAgg {
  domain: string;
  category: SourceCategory;
  totalCitations: number;
  /** Answers citing it. */
  resultsCiting: number;
  models: string[];
  articleTypes: Array<{ type: string; count: number }>;
}
/** A cited page as the citations reads count it. */
interface CitedUrlAgg {
  url: string;
  domain: string;
  category: SourceCategory;
  title: string;
  totalCitations: number;
  /** Answers citing it, of the answers read. */
  resultsCiting: number;
  models: string[];
  articleType: string | null;
}

/** The cited domains and pages of the brand's answers in a window, most cited first. */
interface CitationAggregates {
  /** The answers the domains and totals are counted over (chatgpt-shopping aside). */
  results: number;
  totalCitations: number;
  /** Every source's citations, whatever the filter: the Citations page's cards. */
  allSourcesCitations: number;
  /** Answers read with a citation of the filter's sources. */
  resultsWithCitations: number;
  domains: CitedDomainAgg[];
  /** From the answers read (readCitedAnswers): every answer of the window unless `cut`. */
  urls: CitedUrlAgg[];
  /** The answers read: the pages' share of answers is of these. */
  answersRead: number;
  /** The answers read citing each domain and page, by domain and by page. */
  citing: { domains: Map<string, Set<string>>; urls: Map<string, Set<string>> };
  /** Each answer's prompt, by the answer's id, of the answers read. */
  promptOf: Map<string, string>;
  /** Null when the answers read were every answer of the window; else what they cover. */
  cut: AnswersCut | null;
}

/** citations_domains_daily's rows (00118): a domain over the window's daily rollups. */
interface DomainDailyRow {
  domain: string;
  total_citations: number | string;
  results_citing: number | string;
  models: string[] | null;
}

/** One answer of the window, as the bounded read takes it. */
interface CitedAnswerRow {
  id: string;
  prompt_id: string | null;
  platform: string | null;
  model_used: string | null;
  created_at: string | null;
  citations: Citation[] | null;
}

/** The same address however it is tracked: query, fragment and a trailing slash aside. */
function citedUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

/**
 * The answers read, each citation classified and counted by domain and by
 * page; with a source filter, only the citations it keeps (an answer counts
 * toward results_with_citations when it cites one of them, #297), while
 * every source's citations are counted beside them in the same pass.
 */
function aggregateCitedAnswers(
  rows: readonly CitedAnswerRow[],
  classifyCtx: Parameters<typeof classifyDomain>[1],
  sourceFilter: CitationSourceFilter,
) {
  interface Counting {
    total: number;
    results: Set<string>;
    models: Set<string>;
  }
  const domainMap = new Map<
    string,
    Counting & { category: SourceCategory; types: Map<string, number> }
  >();
  const urlMap = new Map<
    string,
    Counting & { domain: string; category: SourceCategory; title: string; type: string | null }
  >();
  const promptOf = new Map<string, string>();
  let totalCitations = 0;
  let allSourcesCitations = 0;
  let resultsWithCitations = 0;
  const hasSourceFilter = sourceFilter !== 'all';

  for (const result of rows) {
    const citations = Array.isArray(result.citations) ? result.citations : [];
    if (citations.length === 0) continue;
    if (result.prompt_id) promptOf.set(result.id, result.prompt_id);
    const modelKey = result.model_used || result.platform || '';
    let matchedInResult = false;
    for (const cite of citations) {
      const host = extractHostname(cite.url);
      if (!host) continue;
      allSourcesCitations += 1;
      const category = classifyDomain(host, classifyCtx);
      if (hasSourceFilter && !citationCategoryMatches(category, sourceFilter)) continue;
      matchedInResult = true;
      totalCitations += 1;

      const domain = domainMap.get(host) ?? {
        category,
        total: 0,
        results: new Set<string>(),
        models: new Set<string>(),
        types: new Map<string, number>(),
      };
      domain.total += 1;
      domain.results.add(result.id);
      if (modelKey) domain.models.add(modelKey);
      const articleType = classifyArticleType(cite.url, cite.title);
      if (articleType) domain.types.set(articleType, (domain.types.get(articleType) ?? 0) + 1);
      domainMap.set(host, domain);

      const key = citedUrlKey(cite.url);
      const url = urlMap.get(key) ?? {
        domain: host,
        category,
        title: cite.title || '',
        total: 0,
        results: new Set<string>(),
        models: new Set<string>(),
        type: articleType,
      };
      url.total += 1;
      url.results.add(result.id);
      if (modelKey) url.models.add(modelKey);
      if (!url.title && cite.title) url.title = cite.title;
      urlMap.set(key, url);
    }
    if (!hasSourceFilter || matchedInResult) resultsWithCitations += 1;
  }

  const byTotal = <T extends { totalCitations: number }>(a: T, b: T) =>
    b.totalCitations - a.totalCitations;
  return {
    totalCitations,
    allSourcesCitations,
    resultsWithCitations,
    domains: [...domainMap]
      .map(
        ([domain, agg]): CitedDomainAgg => ({
          domain,
          category: agg.category,
          totalCitations: agg.total,
          resultsCiting: agg.results.size,
          models: [...agg.models].sort(),
          articleTypes: [...agg.types]
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 3),
        }),
      )
      .sort(byTotal),
    urls: [...urlMap]
      .map(
        ([url, agg]): CitedUrlAgg => ({
          url,
          domain: agg.domain,
          category: agg.category,
          title: agg.title,
          totalCitations: agg.total,
          resultsCiting: agg.results.size,
          models: [...agg.models].sort(),
          articleType: agg.type,
        }),
      )
      .sort(byTotal),
    citing: {
      domains: new Map([...domainMap].map(([domain, agg]) => [domain, agg.results])),
      urls: new Map([...urlMap].map(([url, agg]) => [url, agg.results])),
    },
    promptOf,
  };
}

/**
 * The citations reads' aggregates, as the Citations page counts them (the
 * maintainer's review of 2026-11-16): over whole UTC days, the domains, the
 * citations and the answers come from the page's own daily rollups (00118:
 * citations_domains_daily, citations_window_stats_daily), which read the
 * rollup tables by brand as security invoker, so the service role runs them
 * once the brand is the caller's. Each domain is classified here, as the page
 * classifies its rows, and the Sources filter keeps its own (the page filters
 * its uncapped domain list the same way); every source's citations are
 * counted beside them from the same rows.
 *
 * What no rollup the service role may read holds, the pages and the prompts
 * citing them (citations_urls_daily and citation_url_occurrences check the
 * person's brand access and answer the service role nothing), comes from one
 * bounded read of the window's newest answers (answers-read.ts), never paged.
 * A window that starts or ends inside a day, which only the raw functions
 * answer (they refuse the service role too), is counted from that read
 * alone. Either way `cut` says what the read covered when the window held
 * more answers than it takes.
 *
 * Ownership-check first; nothing is read before the brand belongs to the
 * caller's organization and access.
 */
async function readCitationAggregates(
  auth: McpAuthContext,
  params: ListCitationsParams,
): Promise<CitationAggregates | null> {
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  // Brand + competitor domains feed `classifyDomain` so a URL hosted on the
  // user's own domain comes back as `'you'`, competitor URLs as `'competitor'`.
  const [{ data: brandDomainRows }, { data: competitorRows }] = await Promise.all([
    supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', params.brandId),
    supabaseAdmin.from('competitors').select('domain').eq('brand_id', params.brandId),
  ]);
  const brandDomains = (brandDomainRows ?? [])
    .map((r) => normalizeDomain((r as { domain: string }).domain))
    .filter(Boolean);
  const competitorDomains = (competitorRows ?? [])
    .map((r) => normalizeDomain((r as { domain: string }).domain))
    .filter(Boolean);
  const classifyCtx = { brandDomains, competitorDomains };
  const sourceFilter = params.sourceFilter ?? 'all';

  const models = params.model
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const modelList = models && models.length > 0 ? models : null;
  let topicPromptIds: string[] | null = null;
  if (params.topicId) {
    const { data: topicPrompts } = await supabaseAdmin
      .from('prompts')
      .select('id')
      .eq('topic_id', params.topicId);
    topicPromptIds = ((topicPrompts ?? []) as { id: string }[]).map((p) => p.id);
  }

  const days = wholeDayWindow(params.dateFrom, params.dateTo);
  // #155 — Citations summary is part of the Insights surface; chatgpt-shopping
  // rows are isolated from these aggregations (the rollups leave them out too).
  // One request, newest first: the window's answers, up to ANSWERS_READ_ROWS.
  // Off the rollups it also counts them, for what the read covers.
  const expandedDateTo = expandDateToEndOfDay(params.dateTo);
  let answers = supabaseAdmin
    .from('prompt_results')
    .select('id, prompt_id, platform, model_used, created_at, citations', {
      count: days ? undefined : 'exact',
    })
    .eq('brand_id', params.brandId)
    .neq('platform', 'chatgpt-shopping');
  if (params.dateFrom) answers = answers.gte('created_at', params.dateFrom);
  if (expandedDateTo) answers = answers.lte('created_at', expandedDateTo);
  if (params.region) answers = answers.eq('region', params.region);
  if (modelList) {
    answers =
      modelList.length > 1
        ? answers.in('model_used', modelList)
        : answers.eq('model_used', modelList[0]);
  }
  if (topicPromptIds) {
    answers = answers.in(
      'prompt_id',
      topicPromptIds.length > 0 ? topicPromptIds : ['00000000-0000-0000-0000-000000000000'],
    );
  }
  const answersRead = answers
    .order('created_at', { ascending: false })
    .order('id')
    .limit(ANSWERS_READ_ROWS);

  if (!days) {
    // Inside a day: the raw functions refuse the service role, so the answers read are the counts.
    const { data, error, count } = await answersRead;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as CitedAnswerRow[];
    const read = aggregateCitedAnswers(rows, classifyCtx, sourceFilter);
    return {
      ...read,
      results: rows.length,
      answersRead: rows.length,
      cut: cutOf(rows, count ?? null),
    };
  }

  // The page's daily functions, with its arguments (actions/citations.ts dailyArgs).
  const daily = {
    p_brand_id: params.brandId,
    p_day_from: days.dayFrom,
    p_day_to: days.dayTo,
    p_models: modelList ?? undefined,
    p_regions: params.region ? [params.region] : undefined,
    p_topic_ids: params.topicId ? [params.topicId] : undefined,
  };
  const [domainRes, statsRes, answerRes] = await Promise.all([
    supabaseAdmin.rpc('citations_domains_daily', daily),
    supabaseAdmin.rpc('citations_window_stats_daily', daily),
    answersRead,
  ]);
  if (domainRes.error) throw new Error(domainRes.error.message);
  if (statsRes.error) throw new Error(statsRes.error.message);
  if (answerRes.error) throw new Error(answerRes.error.message);

  const stats = (statsRes.data as { results: number | string }[] | null)?.[0];
  const results = Number(stats?.results ?? 0);
  let allSourcesCitations = 0;
  const domains: CitedDomainAgg[] = [];
  for (const row of (domainRes.data as DomainDailyRow[] | null) ?? []) {
    const totalCitations = Number(row.total_citations);
    allSourcesCitations += totalCitations;
    const category = classifyDomain(row.domain, classifyCtx);
    if (sourceFilter !== 'all' && !citationCategoryMatches(category, sourceFilter)) continue;
    domains.push({
      domain: row.domain,
      category,
      totalCitations,
      resultsCiting: Number(row.results_citing),
      models: (row.models ?? []).slice().sort(),
      // As on the page: its rows carry no article types (CitationDomainRow).
      articleTypes: [],
    });
  }
  const rows = (answerRes.data ?? []) as CitedAnswerRow[];
  const read = aggregateCitedAnswers(rows, classifyCtx, sourceFilter);
  return {
    results,
    totalCitations: domains.reduce((sum, d) => sum + d.totalCitations, 0),
    allSourcesCitations,
    resultsWithCitations: read.resultsWithCitations,
    // In the page's order: most cited first, as its function returns them.
    domains,
    urls: read.urls,
    answersRead: rows.length,
    citing: read.citing,
    promptOf: read.promptOf,
    cut: cutOf(rows, results, citedPagesCutNote),
  };
}

/** A share of the answers counted, in percent to one decimal. */
const usagePct = (citing: number, results: number) =>
  results > 0 ? Math.round((citing / results) * 1000) / 10 : 0;

/** A cited domain as the citations reads give it. */
function citedDomainRow(agg: CitedDomainAgg, results: number) {
  return {
    domain: agg.domain,
    category: agg.category,
    total_citations: agg.totalCitations,
    results_citing: agg.resultsCiting,
    usage_pct: usagePct(agg.resultsCiting, results),
    models: agg.models,
    article_types: agg.articleTypes,
  };
}

/** A cited page as the citations reads give it. */
function citedUrlRow(agg: CitedUrlAgg, results: number) {
  return {
    url: agg.url,
    domain: agg.domain,
    category: agg.category,
    title: agg.title,
    total_citations: agg.totalCitations,
    results_citing: agg.resultsCiting,
    usage_pct: usagePct(agg.resultsCiting, results),
    article_type: agg.articleType,
  };
}

/**
 * Return the URLs and domains AI engines cite alongside a brand, classified by
 * source type (news / review / owned / social / forum), as the Citations page
 * counts them (readCitationAggregates): its daily rollups for the domains and
 * totals, one bounded read of the newest answers for the pages.
 *
 * Ownership-check first; nothing is read before the brand belongs to the
 * caller's org.
 */
export async function listCitationsFor(
  auth: McpAuthContext,
  params: ListCitationsParams,
): Promise<CitationsOverviewOutput | null> {
  const agg = await readCitationAggregates(auth, params);
  if (!agg) return null;

  const totalResults = agg.results;
  const limit = Math.min(Math.max(params.limit ?? CITATIONS_DEFAULT_LIMIT, 1), CITATIONS_MAX_LIMIT);
  const offset = Math.max(Math.trunc(params.offset ?? 0), 0);

  const allDomains = agg.domains;
  const topDomains = allDomains
    .slice(offset, offset + limit)
    .map((domain) => citedDomainRow(domain, totalResults));

  const allUrls = agg.urls;
  const topUrls = allUrls
    .slice(offset, offset + limit)
    .map((url) => citedUrlRow(url, agg.answersRead));

  // Source breakdown counts each *domain* once (matches the existing UI),
  // not each citation, so news/review/owned/social/forum percentages reflect
  // the diversity of cited sources rather than raw URL volume.
  const categoryCounts = new Map<SourceCategory, number>();
  for (const d of allDomains) {
    categoryCounts.set(d.category, (categoryCounts.get(d.category) ?? 0) + 1);
  }
  const totalDomains = allDomains.length;
  const sourceTypeBreakdown = SOURCE_CATEGORIES.map((category) => {
    const count = categoryCounts.get(category) ?? 0;
    return {
      category,
      count,
      pct: totalDomains > 0 ? Math.round((count / totalDomains) * 1000) / 10 : 0,
    };
  }).filter((b) => b.count > 0);

  const perResult = (citations: number) =>
    totalResults > 0 ? Math.round((citations / totalResults) * 10) / 10 : 0;
  return {
    totals: {
      domains: totalDomains,
      urls: allUrls.length,
      citations: agg.totalCitations,
      results_with_citations: agg.resultsWithCitations,
      avg_citations_per_result: perResult(agg.totalCitations),
    },
    source_type_breakdown: sourceTypeBreakdown,
    top_domains: topDomains,
    top_urls: topUrls,
    ...(agg.cut ? { answers_cut: agg.cut } : {}),
    ...(params.allSourcesTotals && (params.sourceFilter ?? 'all') !== 'all'
      ? {
          all_sources_totals: {
            citations: agg.allSourcesCitations,
            avg_citations_per_result: perResult(agg.allSourcesCitations),
          },
        }
      : {}),
  };
}

/** A prompt whose answers cite a domain or page: its text and how many of its answers do. */
export interface CitingPrompt {
  prompt_id: string;
  text: string;
  answers: number;
}

type CitedDomainRow = ReturnType<typeof citedDomainRow>;
type CitedUrlRow = ReturnType<typeof citedUrlRow>;

/** What a citations lookup found: each named domain and page, with the prompts whose answers cite it. */
export type CitationLookup = CitedLookup<
  CitedDomainRow & { prompts: CitingPrompt[]; prompts_total: number },
  CitedUrlRow & { prompts: CitingPrompt[]; prompts_total: number }
> & {
  period: { date_from: string | null; date_to: string | null };
  /** Only when the window held more answers than the bounded read takes (answers-read.ts). */
  answers_cut?: AnswersCut;
};

/**
 * The cited domains and pages a person named (the Citations page's rows,
 * the citation URL page's address), for Chat (the owner's plan of
 * 2026-11-16, item 2): from the same read as listCitationsFor, over the same
 * window, platforms, region and topic, every source type (sourceFilter and
 * the page don't apply). A domain finds itself and its subdomains, each with
 * its most cited pages; an address finds its page however it is written
 * (scheme, "www." and a trailing slash aside). Each comes with the prompts
 * whose answers cite it, most answers first, of the answers read. What isn't
 * cited in the window is in not_found. Null for a brand outside the caller's
 * organization or access.
 */
export async function lookUpCitationsFor(
  auth: McpAuthContext,
  params: Omit<ListCitationsParams, 'sourceFilter' | 'limit' | 'offset'> & {
    domains?: readonly string[];
    urls?: readonly string[];
  },
): Promise<CitationLookup | null> {
  const agg = await readCitationAggregates(auth, { ...params, sourceFilter: 'all' });
  if (!agg) return null;
  const found = lookUpCited(
    { domains: params.domains, urls: params.urls },
    {
      domains: agg.domains.map((d) => citedDomainRow(d, agg.results)),
      urls: agg.urls.map((u) => citedUrlRow(u, agg.answersRead)),
    },
    periodWords(params.dateFrom, params.dateTo),
  );

  // The prompts whose answers cite each: most answers first, the top CITED_TOP of each.
  const citing = (results: Set<string> | undefined) => {
    const counts = new Map<string, number>();
    for (const id of results ?? []) {
      const prompt = agg.promptOf.get(id);
      if (prompt) counts.set(prompt, (counts.get(prompt) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { top: ranked.slice(0, CITED_TOP), total: ranked.length };
  };
  const domainPrompts = found.domains.map((d) => citing(agg.citing.domains.get(d.domain)));
  const urlPrompts = found.urls.map((u) => citing(agg.citing.urls.get(u.url)));
  const promptIds = [
    ...new Set([...domainPrompts, ...urlPrompts].flatMap((p) => p.top.map(([id]) => id))),
  ];
  const texts = new Map<string, string>();
  if (promptIds.length > 0) {
    // The brand's own prompts only, by the ids its answers carry.
    const { data, error } = await supabaseAdmin
      .from('prompts')
      .select('id, text, prompt_sets!inner(brand_id)')
      .in('id', promptIds)
      .eq('prompt_sets.brand_id', params.brandId);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { id: string; text: string }[]) texts.set(row.id, row.text);
  }
  const withPrompts = (p: ReturnType<typeof citing>) => ({
    prompts: p.top.flatMap(([id, answers]) => {
      const text = texts.get(id);
      return text === undefined ? [] : [{ prompt_id: id, text, answers }];
    }),
    prompts_total: p.total,
  });

  return {
    ...found,
    period: { date_from: params.dateFrom ?? null, date_to: params.dateTo ?? null },
    domains: found.domains.map((d, i) => ({ ...d, ...withPrompts(domainPrompts[i]) })),
    urls: found.urls.map((u, i) => ({ ...u, ...withPrompts(urlPrompts[i]) })),
    ...(agg.cut ? { note: `${found.note} ${agg.cut.note}`, answers_cut: agg.cut } : {}),
  };
}

// ── Visibility trend ────────────────────────────────────────────────────────

export type VisibilityTrendGranularity = 'day' | 'week';

export interface VisibilityTrendParams {
  brandId: string;
  dateFrom?: string;
  dateTo?: string;
  /** Comma-separated model_used slugs (e.g. `gpt-4o,claude-sonnet-4-6`). */
  model?: string;
  region?: string;
  topicId?: string;
  granularity?: VisibilityTrendGranularity;
}

export interface VisibilityTrendOutput {
  granularity: VisibilityTrendGranularity;
  buckets: Array<{
    /** UTC bucket key in `YYYY-MM-DD` (week bucket = the ISO Monday). */
    date: string;
    result_count: number;
    avg_visibility_score: number;
    total_mentions: number;
    total_citations: number;
    /** Average competitor visibility unwrapped from `competitor_mentions`. */
    avg_competitor_score: number | null;
    /**
     * AI Visibility Score for the day (0-100) — the dashboard's Visibility
     * number. Only populated for day granularity; null on week buckets and
     * on payloads produced before the score shipped.
     */
    ai_visibility_score: number | null;
  }>;
}

interface VisibilityTrendBucketRpc {
  bucket_date: string;
  row_count: number;
  sum_visibility: number;
  sum_mentions: number;
  sum_citations: number;
  comp_sum_visibility: number;
  comp_count: number;
}

/**
 * Visibility / mentions / citations over time for a brand, with the
 * competitor average pulled out of `competitor_mentions` per row so a chart
 * can plot brand vs. competitor lines side by side.
 *
 * Aggregates server-side via the `visibility_trend_aggregates` RPC introduced
 * in 00008 — same pattern as the insights / competitor / SoV surfaces from
 * #114. The JS layer only divides and rounds; the row scan stays in
 * Postgres. Designed for the chart-rendering surfaces in the planned
 * in-product assistant (#94), which can fire a lot of these.
 *
 * Ownership-check first; wrong-org or missing brand returns null (→ 404)
 * before the RPC fires.
 */
export async function getVisibilityTrendFor(
  auth: McpAuthContext,
  params: VisibilityTrendParams,
): Promise<VisibilityTrendOutput | null> {
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const p_models = params.model
    ? params.model
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  const granularity: VisibilityTrendGranularity = params.granularity ?? 'day';

  const [{ data, error }, scoreRes] = await Promise.all([
    supabaseAdmin.rpc('visibility_trend_aggregates', {
      p_brand_id: params.brandId,
      p_models: p_models && p_models.length > 0 ? p_models : null,
      p_region: params.region ?? null,
      p_date_from: params.dateFrom ?? null,
      p_date_to: expandDateToEndOfDay(params.dateTo) ?? null,
      p_topic_id: params.topicId ?? null,
      p_granularity: granularity,
    }),
    // Per-day score components (00040); the trend RPC above only carries the
    // legacy sums. Day buckets merge by date; week buckets keep null.
    granularity === 'day'
      ? supabaseAdmin.rpc('visibility_rate_trend', {
          p_brand_id: params.brandId,
          p_platform: null,
          p_models: p_models && p_models.length > 0 ? p_models : null,
          p_region: params.region ?? null,
          p_date_from: params.dateFrom ?? null,
          p_date_to: expandDateToEndOfDay(params.dateTo) ?? null,
          p_topic_id: params.topicId ?? null,
        })
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (error) throw new Error(error.message);

  const scoreByDay = new Map<string, number | null>();
  for (const row of (scoreRes.data ?? []) as unknown as Array<{
    day: string;
    answers: number;
    mention_answers: number;
    citation_answers: number;
    position_factor: number | null;
  }>) {
    scoreByDay.set(
      row.day,
      computeAiVisibilityScore({
        answers: Number(row.answers ?? 0),
        mentionAnswers: Number(row.mention_answers ?? 0),
        citationAnswers: Number(row.citation_answers ?? 0),
        positionFactor: row.position_factor ?? null,
      }),
    );
  }

  const raw = (data as unknown as VisibilityTrendBucketRpc[]) ?? [];
  const buckets = raw.map((b) => ({
    date: b.bucket_date,
    result_count: Number(b.row_count),
    avg_visibility_score:
      b.row_count > 0 ? Math.round(Number(b.sum_visibility) / Number(b.row_count)) : 0,
    total_mentions: Number(b.sum_mentions),
    total_citations: Number(b.sum_citations),
    avg_competitor_score:
      b.comp_count > 0 ? Math.round(Number(b.comp_sum_visibility) / Number(b.comp_count)) : null,
    ai_visibility_score: scoreByDay.get(b.bucket_date) ?? null,
  }));

  return { granularity, buckets };
}

export interface AiTrafficParams {
  brandId: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface AiTrafficOutput {
  /**
   * Whether the tracking snippet is installed (traffic-sources.ts
   * snippetState): 'not_detected' (not seen on the site, so no visit can
   * be counted yet), 'installed_quiet' (installed, no AI visit in the last
   * 7 days) or 'active'.
   */
  tracking: SnippetState;
  total_visits: number;
  platform_breakdown: Array<{
    platform: string;
    visits: number;
  }>;
  top_pages: Array<{
    url: string;
    visits: number;
  }>;
  country_breakdown: Array<{
    country: string;
    visits: number;
  }>;
}

/**
 * Returns AI-referral breakdown (platform / pages / country) for the brand/range.
 * Enforces organization ownership.
 */
export async function getAiTrafficFor(
  auth: McpAuthContext,
  params: AiTrafficParams,
): Promise<AiTrafficOutput | null> {
  if (!auth.organizationId) return null;

  // Ownership check
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  // Visits, not pageviews: a row whose visit_of is null starts one (00172),
  // as the AI Traffic page counts them. The total by count, which no row cap
  // touches, and the breakdowns by paging through the range: one plain
  // select stopped at PostgREST's 1,000 rows.
  const range = {
    from: params.dateFrom,
    to: expandDateToEndOfDay(params.dateTo),
    toInclusive: true,
  };
  const rawRows: Array<{
    source_platform: string | null;
    url: string;
    country: string | null;
  }> = [];
  const [totalVisits, snippet] = await Promise.all([
    countTrafficLogs(supabaseAdmin, params.brandId, range),
    readSnippet(supabaseAdmin, params.brandId),
    scanTrafficLogs(
      supabaseAdmin,
      params.brandId,
      { ...range, columns: 'source_platform, url, country' },
      (row) => rawRows.push(row as (typeof rawRows)[number]),
    ),
  ]);

  // Platform breakdown
  const platformMap = new Map<string, number>();
  for (const r of rawRows) {
    const p = r.source_platform || 'unknown';
    platformMap.set(p, (platformMap.get(p) ?? 0) + 1);
  }
  const platform_breakdown = Array.from(platformMap.entries())
    .map(([platform, visits]) => ({ platform, visits }))
    .sort((a, b) => b.visits - a.visits);

  // Top pages
  const pageMap = new Map<string, number>();
  for (const r of rawRows) {
    const url = r.url;
    try {
      const path = new URL(url).pathname;
      pageMap.set(path, (pageMap.get(path) ?? 0) + 1);
    } catch {
      pageMap.set(url, (pageMap.get(url) ?? 0) + 1);
    }
  }
  const top_pages = Array.from(pageMap.entries())
    .map(([url, visits]) => ({ url, visits }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 10);

  // Country breakdown
  const countryMap = new Map<string, number>();
  for (const r of rawRows) {
    const c = r.country || 'unknown';
    countryMap.set(c, (countryMap.get(c) ?? 0) + 1);
  }
  const country_breakdown = Array.from(countryMap.entries())
    .map(([country, visits]) => ({ country, visits }))
    .sort((a, b) => b.visits - a.visits);

  return {
    tracking: snippetState(snippet),
    total_visits: totalVisits,
    platform_breakdown,
    top_pages,
    country_breakdown,
  };
}

// ── Prompt volumes ──────────────────────────────────────────────────────────

export interface PromptVolumesParams {
  brandId: string;
  /** Row cap on the returned prompts. Default 100, max 500. */
  limit?: number;
  /** Rows before this page (Chat's pages). */
  offset?: number;
}

export interface PromptVolumeRow {
  prompt_id: string;
  prompt_text: string | null;
  intent: string;
  keywords: string[];
  /** `{ keyword: monthly_google_volume }` map. */
  google_volumes: Record<string, number>;
  total_google_volume: number;
  est_ai_volume: number;
  /**
   * The estimate's likely range (PROMPT-013): from the spread of the measured
   * keyword volumes, never under half or over twice est_ai_volume.
   */
  est_ai_volume_low: number;
  est_ai_volume_high: number;
  /** How far the measured keywords agree; one level less after six months. */
  volume_confidence: EstimateConfidence;
  /** Always 'estimate': AI engines publish no search volumes. */
  volume_type: 'estimate';
  ai_volume_multiplier: number;
  /** Volume-weighted competition index 0-100, or null if unknown. */
  competition_index: number | null;
  /** Bucketed competition label ("LOW" | "MEDIUM" | "HIGH"), or null. */
  competition: string | null;
  fetched_at: string | null;
  /**
   * The prompt's real demand (PROMPT-014): Search Console, Google Trends,
   * People Also Ask and YouTube, with the level they come to. Null until the
   * nightly sweep read any.
   */
  measured_demand: PromptDemand | null;
}

const PROMPT_VOLUMES_DEFAULT_LIMIT = 100;
const PROMPT_VOLUMES_MAX_LIMIT = 500;

/**
 * Return per-prompt search-volume + competition rows for a brand, scoped
 * `brand → prompt_sets → prompts → prompt_volumes`. Surfaces the demand
 * (`total_google_volume`, the median of the keywords' volumes, and
 * `est_ai_volume`) and competition meter
 * (`competition_index` / `competition`, see #44) so callers can answer
 * "which prompts have the most demand / the least competition?".
 *
 * Ownership-check first; wrong-org or missing brand returns null (→ 404
 * upstream) before any volume rows are read. Triggering a fresh volume
 * analysis (the paid DataForSEO call) lives on the aeo-server and is out of
 * scope here — this is a read of already-computed rows.
 */
export async function getPromptVolumesFor(
  auth: McpAuthContext,
  params: PromptVolumesParams,
): Promise<PromptVolumeRow[] | null> {
  return (await promptVolumesPageFor(auth, params))?.rows ?? null;
}

/** Per-prompt volumes from `offset`, most AI demand first, with how many there are in all. */
export async function promptVolumesPageFor(
  auth: McpAuthContext,
  params: PromptVolumesParams,
): Promise<{ rows: PromptVolumeRow[]; total: number } | null> {
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const limit = Math.min(
    Math.max(params.limit ?? PROMPT_VOLUMES_DEFAULT_LIMIT, 1),
    PROMPT_VOLUMES_MAX_LIMIT,
  );

  const offset = Math.max(Math.trunc(params.offset ?? 0), 0);
  // prompt_volumes → prompts (1:1) → prompt_sets, filtered to this brand via
  // the nested inner joins. Sorted by AI demand so the highest-opportunity
  // prompts come first.
  const matching = (head = false) =>
    supabaseAdmin
      .from('prompt_volumes')
      .select(
        'prompt_id, intent, keywords, google_volumes, total_google_volume, est_ai_volume, ai_volume_multiplier, competition_index, competition, fetched_at, prompts!inner(text, prompt_sets!inner(brand_id))',
        { count: 'exact', head },
      )
      .eq('prompts.prompt_sets.brand_id', params.brandId);
  const { rows: data, total } = await pageRows(
    await matching()
      .order('est_ai_volume', { ascending: false })
      .order('prompt_id')
      .range(offset, offset + limit - 1),
    () => matching(true),
  );

  const rows =
    (data as unknown as Array<{
      prompt_id: string;
      intent: string;
      keywords: string[] | null;
      google_volumes: Record<string, number> | null;
      total_google_volume: number | null;
      est_ai_volume: number | null;
      ai_volume_multiplier: number | string | null;
      competition_index: number | null;
      competition: string | null;
      fetched_at: string | null;
      prompts: { text: string } | Array<{ text: string }> | null;
    }> | null) ?? [];

  const demand = await readPromptDemand(
    params.brandId,
    rows.map((r) => r.prompt_id),
  );
  const now = new Date();
  const page = rows.map((r) => {
    const prompt = Array.isArray(r.prompts) ? (r.prompts[0] ?? null) : r.prompts;
    const estimate = promptVolumeEstimate(
      {
        estAiVolume: Number(r.est_ai_volume ?? 0),
        googleVolumes: r.google_volumes ?? {},
        aiVolumeMultiplier: Number(r.ai_volume_multiplier ?? 0),
        keywords: r.keywords ?? [],
        fetchedAt: r.fetched_at as string,
      },
      now,
    );
    return {
      prompt_id: r.prompt_id,
      prompt_text: prompt?.text ?? null,
      intent: r.intent,
      keywords: r.keywords ?? [],
      google_volumes: r.google_volumes ?? {},
      total_google_volume: Number(r.total_google_volume ?? 0),
      est_ai_volume: Number(r.est_ai_volume ?? 0),
      est_ai_volume_low: estimate.low,
      est_ai_volume_high: estimate.high,
      volume_confidence: estimate.confidence,
      volume_type: 'estimate' as const,
      ai_volume_multiplier: Number(r.ai_volume_multiplier ?? 0),
      competition_index: r.competition_index,
      competition: r.competition,
      fetched_at: r.fetched_at,
      measured_demand: demand.get(r.prompt_id) ?? null,
    };
  });
  return { rows: page, total };
}

// ── Shopping Cards ────────────────────────────────────────────────────────────

/** A read of a feature the organization's plan doesn't include. */
export const NOT_IN_PLAN = 'not_in_plan';

/**
 * What a shopping read answers without the feature, as the API's
 * requireFeature does: the tools' error text, and the REST routes' 403 body.
 */
export const SHOPPING_NOT_IN_PLAN = {
  error: 'plan_limit',
  message:
    `Shopping analytics comes with the ${PLANS[getMinimumPlanForFeature('shopping_analytics')].name} ` +
    "plan and above, and this workspace's plan doesn't include it. An admin can upgrade in " +
    'Settings › Billing.',
} as const;

/**
 * Whether the organization's plan includes `feature`, for a read: once a plan
 * has ended (read-only), the plan it was on, as the dashboard and the API's
 * readOnly reads keep it. Self-hosted has every feature.
 */
export async function planIncludes(organizationId: string, feature: Feature): Promise<boolean> {
  if (!isCloud()) return true;
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select(ORG_PLAN_COLUMNS)
    .eq('id', organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return hasFeature(usagePlanFromOrgRow(data).plan, feature);
}

export interface ListShoppingCardsParams {
  brandId: string;
  role?: 'own' | 'competitor' | 'other';
  platform?: string;
  region?: string;
  limit?: number;
  cursor?: string;
}

export interface ShoppingCardRow {
  id: string;
  prompt_result_id: string;
  brand_id: string;
  position: number;
  product_title: string | null;
  product_brand: string | null;
  price_amount: number | null;
  price_currency: string | null;
  image_url: string | null;
  merchant_url: string | null;
  merchant_domain: string | null;
  rating: number | null;
  review_count: number | null;
  raw: Record<string, unknown>;
  matched_brand_id: string | null;
  matched_brand_role: string;
  platform: string;
  region: string | null;
  created_at: string;
}

export interface ListShoppingCardsOutput {
  cards: ShoppingCardRow[];
  next_cursor: string | null;
}

/** The brand's shopping cards: NOT_IN_PLAN on a plan without shopping analytics (Starter). */
export async function listShoppingCards(
  auth: McpAuthContext,
  params: ListShoppingCardsParams,
): Promise<ListShoppingCardsOutput | typeof NOT_IN_PLAN | null> {
  if (!auth.organizationId) return null;

  // Brand ownership check
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;
  if (!(await planIncludes(auth.organizationId, 'shopping_analytics'))) return NOT_IN_PLAN;

  const finalLimit = Math.min(Math.max(params.limit ?? 50, 1), 200);

  let cursorData: { created_at: string; id: string } | null = null;
  if (params.cursor) {
    try {
      cursorData = JSON.parse(Buffer.from(params.cursor, 'base64').toString('utf8'));
    } catch {
      // Ignore invalid cursor
    }
  }

  let query = supabaseAdmin
    .from('prompt_result_shopping_cards')
    .select('*')
    .eq('brand_id', params.brandId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(finalLimit + 1);

  if (params.role) {
    query = query.eq('matched_brand_role', params.role);
  }
  if (params.platform) {
    query = query.eq('platform', params.platform);
  }
  if (params.region) {
    query = query.eq('region', params.region);
  }

  if (cursorData) {
    query = query.or(
      `created_at.lt.${cursorData.created_at},and(created_at.eq.${cursorData.created_at},id.lt.${cursorData.id})`,
    );
  }

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  const cards = (rows ?? []) as ShoppingCardRow[];
  const hasNextPage = cards.length > finalLimit;
  const slicedCards = hasNextPage ? cards.slice(0, finalLimit) : cards;

  let nextCursor: string | null = null;
  if (hasNextPage && slicedCards.length > 0) {
    const lastItem = slicedCards[slicedCards.length - 1];
    nextCursor = Buffer.from(
      JSON.stringify({ created_at: lastItem.created_at, id: lastItem.id }),
    ).toString('base64');
  }

  return {
    cards: slicedCards,
    next_cursor: nextCursor,
  };
}

export interface ProductVisibilityOutput {
  product_title: string;
  total_appearances: number;
  by_platform: Array<{ platform: string; count: number }>;
  by_region: Array<{ region: string; count: number }>;
  by_date: Array<{ date: string; count: number }>;
  latest_appearance: string | null;
  average_rating: number | null;
  total_reviews: number | null;
  merchant_domains: Array<{ domain: string; count: number }>;
  /**
   * Only when it appeared more often than the bounded read takes
   * (answers-read.ts): total_appearances counts every one; the breakdowns,
   * ratings and merchants cover its newest appearances, from counted_from on.
   */
  answers_cut?: AnswersCut;
}

/** One product's visibility: NOT_IN_PLAN on a plan without shopping analytics (Starter). */
export async function getProductVisibility(
  auth: McpAuthContext,
  params: { brandId: string; productTitle: string },
): Promise<ProductVisibilityOutput | typeof NOT_IN_PLAN | null> {
  if (!auth.organizationId) return null;

  // Brand ownership check
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;
  if (!(await planIncludes(auth.organizationId, 'shopping_analytics'))) return NOT_IN_PLAN;

  // The Products page has no aggregate of a product's appearances: its
  // product page reads the cards themselves. One bounded request here, never
  // paged (answers-read.ts): every appearance counted, the newest read.
  const { data, error, count } = await supabaseAdmin
    .from('prompt_result_shopping_cards')
    .select(
      'id, platform, region, created_at, price_amount, price_currency, rating, review_count, merchant_domain',
      { count: 'exact' },
    )
    .eq('brand_id', params.brandId)
    .eq('product_title', params.productTitle)
    .order('created_at', { ascending: false })
    .order('id')
    .limit(ANSWERS_READ_ROWS);
  if (error) throw new Error(error.message);
  const cards = (data ?? []) as Array<{
    id: string;
    platform: string | null;
    region: string | null;
    created_at: string;
    price_amount: number | null;
    price_currency: string | null;
    rating: number | null;
    review_count: number | null;
    merchant_domain: string | null;
  }>;
  const cut = cutOf(cards, count ?? null, productCutNote);
  if (cards.length === 0) return null;

  const total_appearances = Math.max(count ?? 0, cards.length);

  const platformMap = new Map<string, number>();
  const regionMap = new Map<string, number>();
  const dateMap = new Map<string, number>();
  const domainMap = new Map<string, number>();

  let ratingSum = 0;
  let ratingCount = 0;
  let totalReviews: number | null = null;

  for (const card of cards) {
    const platform = card.platform || 'unknown';
    platformMap.set(platform, (platformMap.get(platform) ?? 0) + 1);

    const region = card.region || 'unknown';
    regionMap.set(region, (regionMap.get(region) ?? 0) + 1);

    const date = card.created_at ? card.created_at.slice(0, 10) : 'unknown';
    dateMap.set(date, (dateMap.get(date) ?? 0) + 1);

    if (card.merchant_domain) {
      domainMap.set(card.merchant_domain, (domainMap.get(card.merchant_domain) ?? 0) + 1);
    }

    if (card.rating !== null && card.rating !== undefined) {
      ratingSum += Number(card.rating);
      ratingCount += 1;
    }

    if (card.review_count !== null && card.review_count !== undefined) {
      if (totalReviews === null) totalReviews = 0;
      totalReviews += card.review_count;
    }
  }

  const by_platform = Array.from(platformMap.entries())
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count);

  const by_region = Array.from(regionMap.entries())
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count);

  const by_date = Array.from(dateMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => b.date.localeCompare(a.date)); // Sort chronologically descending

  const merchant_domains = Array.from(domainMap.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count);

  const average_rating = ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null;
  const latest_appearance = cards[0]?.created_at || null;

  return {
    product_title: params.productTitle,
    total_appearances,
    by_platform,
    by_region,
    by_date,
    latest_appearance,
    average_rating,
    total_reviews: totalReviews,
    merchant_domains,
    ...(cut ? { answers_cut: cut } : {}),
  };
}

// ── Prompt Performance ────────────────────────────────────────────────────────

export interface PromptPerformanceParams {
  brandId: string;
  dateFrom?: string;
  dateTo?: string;
  topicId?: string;
  /**
   * `visibility`: the average answer score (avg_visibility, the MCP tool's
   * default); `ai_visibility`: the AI Visibility Score, the Prompts page's
   * Visibility column and its order (needs withScore; Chat's default).
   */
  sortBy?: 'visibility' | 'ai_visibility' | 'mentions' | 'citations' | 'appearances';
  order?: 'desc' | 'asc';
  limit?: number;
  /** Prompts before this page, in the same order (Chat's pages). */
  offset?: number;
  model?: string;
  region?: string;
  /**
   * Chat's lookup: these prompts only (checked ids), each that has results,
   * whatever its topic; no page, and topicId doesn't apply.
   */
  promptIds?: readonly string[];
  /**
   * Also each prompt's AI Visibility Score and Coverage, as the Prompts page
   * shows them (prompt-scores.ts): Chat's; the MCP tool's output stays as it was.
   */
  withScore?: boolean;
}

export interface PromptPerformanceOutput {
  brand: { id: string; name: string };
  window: { dateFrom: string | null; dateTo: string | null };
  /** Every prompt with results in the window, not only this page's. */
  total: number;
  prompts: Array<{
    prompt_id: string;
    prompt_text: string;
    topic_name: string | null;
    result_count: number;
    avg_visibility: number;
    total_mentions: number;
    total_citations: number;
    avg_competitor_score: number;
    /** The Prompts page's Visibility: the AI Visibility Score (withScore only; null: no answers). */
    ai_visibility_score?: number | null;
    /** The Prompts page's Coverage: visible runs of runs, in percent (withScore only). */
    coverage_pct?: number;
  }>;
}

interface PromptPerformanceRpcResult {
  prompt_id: string;
  prompt_text: string;
  topic_name: string | null;
  result_count: number;
  sum_visibility: number;
  total_mentions: number;
  total_citations: number;
  comp_sum_visibility: number;
  comp_count: number;
}

/**
 * Aggregates prompt-level performance over the given window.
 * Enforces organization ownership.
 */
export async function getPromptPerformanceFor(
  auth: McpAuthContext,
  params: PromptPerformanceParams,
): Promise<PromptPerformanceOutput | null> {
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id, name')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const p_models = params.model
    ? params.model
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  const { data, error } = await supabaseAdmin.rpc('prompt_performance_aggregates', {
    p_brand_id: params.brandId,
    p_models: p_models && p_models.length > 0 ? p_models : null,
    p_region: params.region ?? null,
    p_date_from: params.dateFrom ?? null,
    p_date_to: expandDateToEndOfDay(params.dateTo) ?? null,
    // Prompts named by id are read whatever their topic.
    p_topic_id: params.promptIds ? null : (params.topicId ?? null),
  });

  if (error) throw new Error(error.message);

  // The Prompts page's Visibility and Coverage over the same window and region: its own
  // function, which counts every platform's answers as the page does (prompt-scores.ts).
  const scored = params.withScore
    ? await (
        await import('./prompt-scores')
      ).promptScoresFor(params.brandId, {
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        region: params.region,
      })
    : null;

  const named = params.promptIds ? new Set(params.promptIds) : null;
  const raw = ((data as unknown as PromptPerformanceRpcResult[]) ?? []).filter(
    (item) => !named || named.has(item.prompt_id),
  );

  let prompts = raw.map((item) => {
    const result_count = Number(item.result_count);
    const avg_visibility =
      result_count > 0 ? Math.round(Number(item.sum_visibility) / result_count) : 0;
    const avg_competitor_score =
      Number(item.comp_count) > 0
        ? Math.round(Number(item.comp_sum_visibility) / Number(item.comp_count))
        : 0;

    const score = scored?.get(item.prompt_id);
    return {
      prompt_id: item.prompt_id,
      prompt_text: item.prompt_text,
      topic_name: item.topic_name,
      result_count,
      avg_visibility,
      total_mentions: Number(item.total_mentions),
      total_citations: Number(item.total_citations),
      avg_competitor_score,
      ...(scored
        ? { ai_visibility_score: score?.score ?? null, coverage_pct: score?.coverage_pct ?? 0 }
        : {}),
    };
  });

  // Sorting
  const sortBy = params.sortBy ?? 'visibility';
  const order = params.order ?? 'desc';
  const isAsc = order === 'asc';

  prompts.sort((a, b) => {
    if (sortBy === 'ai_visibility') {
      // The Prompts table's own comparator on its Visibility column (prompt-sort.ts): a
      // prompt the page scores with no score counts as 0, one it doesn't score sorts last.
      const byScore = comparePromptSortRows(
        'visibility',
        promptSortRowOf(scored?.get(a.prompt_id)),
        promptSortRowOf(scored?.get(b.prompt_id)),
        order,
      );
      return byScore || a.prompt_id.localeCompare(b.prompt_id);
    }
    let valA = 0;
    let valB = 0;
    if (sortBy === 'visibility') {
      valA = a.avg_visibility;
      valB = b.avg_visibility;
    } else if (sortBy === 'mentions') {
      valA = a.total_mentions;
      valB = b.total_mentions;
    } else if (sortBy === 'citations') {
      valA = a.total_citations;
      valB = b.total_citations;
    } else if (sortBy === 'appearances') {
      valA = a.result_count;
      valB = b.result_count;
    }

    if (valA !== valB) {
      return isAsc ? valA - valB : valB - valA;
    }
    // Stable fallback sorting
    return a.prompt_id.localeCompare(b.prompt_id);
  });

  // Limiting: a page from `offset` (Chat's pages), with how many prompts there are in all;
  // prompts named by id all come back.
  const limit = named ? prompts.length : Math.min(Math.max(params.limit ?? 10, 1), 100);
  const offset = named ? 0 : Math.max(Math.trunc(params.offset ?? 0), 0);
  const total = prompts.length;
  prompts = prompts.slice(offset, offset + limit);

  return {
    brand: {
      id: brand.id,
      name: brand.name,
    },
    window: {
      dateFrom: params.dateFrom ?? null,
      dateTo: params.dateTo ?? null,
    },
    total,
    prompts,
  };
}

/** A prompt as the Prompts table's comparator reads its Visibility: its score, or none when unscored. */
function promptSortRowOf(score: { score: number | null } | undefined): PromptSortRow {
  return {
    createdAt: '',
    visibility: score
      ? { score: score.score, totalMentions: 0, totalCitations: 0, runs: 0, lastRunAt: '' }
      : undefined,
  };
}

/** Prompt performance for prompts named by id: theirs, those with no results, and the ids not found. */
export interface PromptPerformanceLookup extends PromptPerformanceOutput {
  note: string;
  /** Tracked prompts of this brand with no answers in the period, platforms and region read. */
  no_results: { prompt_id: string; prompt_text: string }[];
  /** Ids no prompt of this brand has, as written. */
  not_found: string[];
}

/**
 * Prompt performance for the prompts a person named (the prompt's page, or
 * prompts found by their words), for Chat (the owner's plan of 2026-11-16,
 * item 2): each one's figures over the period, platforms and region read,
 * whatever its topic, never cut to a page. A tracked prompt with no answers
 * in that window is in no_results; an id no prompt of this brand has (of
 * another brand or workspace too) is in not_found. Null for a brand outside
 * the caller's organization or access.
 */
export async function lookUpPromptPerformanceFor(
  auth: McpAuthContext,
  params: Omit<PromptPerformanceParams, 'promptIds' | 'topicId' | 'limit' | 'offset'> & {
    promptIds: readonly string[];
  },
): Promise<PromptPerformanceLookup | null> {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const asked = askedIds(params.promptIds);
  const ids = keysOf<string>(asked, 'id');
  const read = await getPromptPerformanceFor(auth, { ...params, promptIds: ids });
  if (!read) return null;
  const withResults = new Set(read.prompts.map((p) => p.prompt_id));
  const missing = ids.filter((id) => !withResults.has(id));
  const tracked = missing.length
    ? await promptsPageFor(auth, { brandId: params.brandId, ids: missing, limit: LOOKUP_MAX })
    : { rows: [], total: 0 };
  if (!tracked) return null;

  const rows = [
    ...read.prompts.map((p) => ({ id: p.prompt_id })),
    ...tracked.rows.map((p) => ({ id: p.id })),
  ];
  const { not_found, lines } = lookUpKeys(LOOKUP_WORDS.prompts, asked, rows, (row) => row.id);
  const noResults = tracked.rows.map((p) => ({ prompt_id: p.id, prompt_text: p.text }));
  if (noResults.length > 0) {
    lines.push(
      `${noResults.length === 1 ? 'One prompt has' : `${noResults.length} prompts have`} no answers in this period on these platforms and region (no_results): say so for each, by its text; it is tracked.`,
    );
  }
  lines.push(lookupEnd(LOOKUP_WORDS.prompts, not_found.length > 0));
  return { ...read, note: lines.join(' '), no_results: noResults, not_found };
}

// ── Action Center ────────────────────────────────────────────────────────────
//
// The engine's output: detected signals, the actions consolidated from them,
// each action's task plan and, once closed, its measured result. Read with the
// same field names as `lib/actions/action-center.ts`, but through the API-key
// context rather than the signed-in user. `kind` stays an opaque string: the
// server's definition registry grows on its own release cycle.

/** Task statuses an MCP client may set. Approval and its states stay with the
 *  dashboard, and nothing here lets an agent execute a task — only report on it. */
export const MCP_TASK_STATUSES = ['in_progress', 'completed', 'skipped', 'failed'] as const;
export type McpTaskStatus = (typeof MCP_TASK_STATUSES)[number];

/** Skipped and failed tasks are not outstanding work, so they leave the
 *  progress denominator — same rule as the dashboard. */
const UNCOUNTED_TASK_STATUSES = ['skipped', 'failed'];

const MCP_SIGNAL_COLUMNS =
  'id, brand_no, category, kind, impact, status, source, detected_at, last_detected_at, resolved_at, previous_value, current_value, change_value, payload, kpi_keys, action_id';

/**
 * Whether the person a key or a call acts for may use a brand now
 * (BRAND-ACCESS §5.3): one of their organization's that their access
 * reaches (All brands, the brands shared with them, the demo brand). An API
 * key carries its owner's access, since keys belong to people. A brand they
 * may not use answers as another organization's does: not found.
 */
export async function brandAllowed(auth: McpAuthContext, brandId: string): Promise<boolean> {
  if (!auth.organizationId) return false;
  const [{ data }, access] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select('id')
      .eq('id', brandId)
      .eq('organization_id', auth.organizationId)
      .maybeSingle(),
    brandAccessFor(auth),
  ]);
  return Boolean(data) && hasBrandAccess(access, brandId);
}

/**
 * Whether the person's access reaches a brand already found in their
 * organization: a brand read by id and organization, or the brand of a row
 * read through `brands!inner(organization_id)`. All brands reach every one.
 */
export async function mayUseBrand(
  auth: McpAuthContext,
  brandId: string | null | undefined,
): Promise<boolean> {
  const access = await brandAccessFor(auth);
  return access === 'all' || (Boolean(brandId) && hasBrandAccess(access, brandId as string));
}

/** Each assignee's name, by their profile id: shared with Chat's own list of actions. */
export async function assigneeNames(ids: (string | null)[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .in('id', unique);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? null]));
}

export interface ActionListRow {
  id: string;
  action_no: number;
  /** Its code as the app shows it: "AC-03" (its number in its brand, 00534), or "AC-648" before its brand is numbered. */
  code: string;
  category: string;
  kind: string;
  impact: string;
  status: string;
  outcome: string | null;
  assignee: { id: string; full_name: string | null } | null;
  due_date: string | null;
  task_progress: { completed: number; total: number };
  priority: ActionPriorityForMcp | null;
  /** New for 30 days or more with no one's event (00432); never set on another status. */
  stale: boolean;
  stale_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * An action's priority (AC-006): its 0–100 score, its level, and the facts
 * the score rests on (change, subject, demand, commercial intent, whether the
 * ground was held before, days since the evidence, and each factor 0–1).
 * Null until the server has scored the action.
 */
export interface ActionPriorityForMcp {
  score: number;
  level: string | null;
  reason: Record<string, unknown> | null;
  /**
   * How sure the score is of what it rests on, as a level (`reason.factors.
   * confidence` is the raw factor), and why: "one kind of finding from one
   * source". Null from a scorer before it was kept.
   */
  confidence: ConfidenceLevel | null;
  confidence_note: string | null;
  /** The raw 0–1 factor, as `reason.factors.confidence`. */
  confidence_score: number | null;
}

function priorityFor(row: {
  priority_score?: number | null;
  priority_level?: string | null;
  priority_reason?: unknown;
}): ActionPriorityForMcp | null {
  if (row.priority_score === null || row.priority_score === undefined) return null;
  const confidence = parsePriorityReason(row.priority_reason)?.confidence ?? null;
  return {
    score: Number(row.priority_score),
    level: row.priority_level ?? null,
    reason:
      row.priority_reason && typeof row.priority_reason === 'object'
        ? (row.priority_reason as Record<string, unknown>)
        : null,
    confidence: confidence?.level ?? null,
    confidence_note: confidence ? confidenceNote(confidence) : null,
    confidence_score: confidence?.score ?? null,
  };
}

/** Stale (00432) only while New: the stamp waits for the nightly pass to clear it. */
export function staleFor(row: { status?: string | null; stale_at?: string | null }) {
  const stale = row.status === 'new' && Boolean(row.stale_at);
  return { stale, stale_at: stale ? (row.stale_at ?? null) : null };
}

export interface ListActionsParams {
  brandId: string;
  status?: string;
  category?: string;
  limit?: number;
  /**
   * `priority` (default): highest priority score first, unscored last — the
   * order the app lists them in; `updated`: most recently updated first.
   */
  sort?: 'updated' | 'priority';
}

export async function listActionsFor(
  auth: McpAuthContext,
  params: ListActionsParams,
): Promise<ActionListRow[] | null> {
  if (!(await brandAllowed(auth, params.brandId))) return null;

  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  let query = supabaseAdmin
    .from('actions')
    .select(
      'id, action_no, brand_no, category, kind, impact, status, outcome, assignee_id, due_date, created_at, updated_at, priority_score, priority_level, priority_reason, stale_at, target_entity:payload->>targetEntity, target_count:payload->targetCount',
    )
    .eq('brand_id', params.brandId)
    // A deleted action (00168) is gone for everyone but the nightly generator.
    .is('deleted_at', null);
  query =
    params.sort === 'updated'
      ? query.order('updated_at', { ascending: false })
      : query
          .order('priority_score', { ascending: false, nullsFirst: false })
          .order('updated_at', { ascending: false });
  query = query.limit(limit);
  if (params.status) query = query.eq('status', params.status);
  if (params.category) query = query.eq('category', params.category);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const { data: tasks, error: taskError } = await supabaseAdmin
    .from('action_tasks')
    .select('action_id, status')
    .in(
      'action_id',
      rows.map((r) => r.id),
    );
  if (taskError) throw new Error(taskError.message);

  const progress = new Map<string, { completed: number; total: number }>();
  for (const task of tasks ?? []) {
    if (UNCOUNTED_TASK_STATUSES.includes(task.status)) continue;
    const acc = progress.get(task.action_id) ?? { completed: 0, total: 0 };
    acc.total += 1;
    if (task.status === 'completed') acc.completed += 1;
    progress.set(task.action_id, acc);
  }
  const [names, entityCounts] = await Promise.all([
    assigneeNames(rows.map((r) => r.assignee_id)),
    // Each action's list (AC-009): its reason names the count left, as get_action's does.
    readEntityCounts(
      supabaseAdmin,
      rows.map((r) => r.id),
    ),
  ]);

  return rows.map((r) => ({
    id: r.id,
    action_no: Number(r.action_no),
    code: actionCode({ actionNo: Number(r.action_no), brandNo: r.brand_no }),
    category: r.category,
    kind: r.kind,
    impact: r.impact,
    status: r.status,
    outcome: r.outcome ?? null,
    assignee: r.assignee_id
      ? { id: r.assignee_id, full_name: names.get(r.assignee_id) ?? null }
      : null,
    due_date: r.due_date ?? null,
    task_progress: progress.get(r.id) ?? { completed: 0, total: 0 },
    priority: priorityFor({
      ...r,
      priority_reason: currentPriorityReason(
        r.priority_reason,
        withEntityCounts(
          { targetEntity: r.target_entity, targetCount: r.target_count },
          entityCounts.get(r.id),
        ),
      ),
    }),
    ...staleFor(r),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export interface ActionDetailForMcp {
  id: string;
  action_no: number;
  /** Its code as the app shows it: "AC-03" (its number in its brand, 00534), or "AC-648" before its brand is numbered. */
  code: string;
  brand_id: string;
  category: string;
  kind: string;
  impact: string;
  status: string;
  outcome: string | null;
  /** Its change net of the brand's prompts it didn't touch (learning B2); null when not netted. */
  net_of_control: McpNetOfControl | null;
  /** Why it was dismissed, as the person said (learning A5); null otherwise. */
  dismiss_reason: ActionDismissReason | null;
  payload: Record<string, unknown>;
  kpi_keys: string[];
  assignee: { id: string; full_name: string | null } | null;
  due_date: string | null;
  priority: ActionPriorityForMcp | null;
  /** As on list_actions. */
  stale: boolean;
  stale_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  tasks: Array<{
    id: string;
    position: number;
    task_key: string | null;
    title: string | null;
    title_params: Record<string, unknown>;
    status: string;
    skip_reason: string | null;
    mode: string | null;
    permission: string | null;
    depends_on: string[];
    details: ReturnType<typeof mcpTaskDetails>;
  }>;
  /**
   * What it is about, item by item, as the drawer's Affected tab lists it
   * (AC-003): its prompts by text, its pages, competitors and topics. A
   * `prompt_total` above the prompts listed counts the ones a grouped
   * finding names no further.
   */
  affected: ActionAffectedForMcp;
  signals: Record<string, unknown>[];
  events: Array<{ event: string; data: Record<string, unknown>; created_at: string }>;
}

export interface ActionAffectedForMcp {
  prompts: Array<{ id: string | null; text: string }>;
  prompt_total: number;
  pages: string[];
  page_total: number;
  competitors: string[];
  topics: string[];
}

/**
 * The Affected list in get_action's compact form: names and ids only, so a
 * long one still fits beside the rest of the action (CH-02). What each row
 * says beyond that (platforms, leaders, lost pages) is in the signals.
 */
export function mcpAffected(affected: Affected): ActionAffectedForMcp {
  return {
    prompts: affected.prompts.map((p) => ({ id: p.id, text: p.text })),
    prompt_total: Math.max(affected.promptTotal, affected.prompts.length),
    pages: affected.pages.map((p) => p.url),
    page_total: Math.max(affected.pageTotal, affected.pages.length),
    competitors: affected.competitors,
    topics: affected.topics,
  };
}

/** A library task's Done when from its template (AC-010), in English as the rest of the output. */
const doneWhenT = createTranslator({
  locale: 'en',
  messages,
  namespace: 'actionCenter.taskDoneWhen' as never,
});
const templateDoneWhen = (taskKey: string) =>
  doneWhenT.has(taskKey as never) ? doneWhenT(taskKey as never) : null;

/** A task's details in the snake_case the rest of the MCP output uses. */
export function mcpTaskDetails(raw: unknown, taskKey: string | null = null) {
  const d = withTemplateCheck(
    withTemplateDoneWhen(parseTaskDetails(raw), taskKey, templateDoneWhen),
    taskKey,
  );
  if (!d) return null;
  return {
    // The exact page, the change to make there and how we check it (AC-010).
    url: d.url,
    where: d.where,
    why: d.why,
    change: d.change,
    how: d.how,
    done_when: d.doneWhen,
    check: d.check,
    type: d.type,
    effort: d.effort,
    role: d.role,
    body: d.body,
    platform: d.platform,
    platform_label: d.platformLabel,
    sources: d.sources,
    // Where it was sent (AC-004).
    sent_to_content: d.sent.content
      ? { opportunity_id: d.sent.content.opportunityId, at: d.sent.content.at }
      : null,
    sent_to_webhook: d.sent.webhook ? { at: d.sent.webhook.at } : null,
  };
}

/** An action as get_action reads it; dismiss_reason is absent on a database without 00366. */
interface ActionDetailRow {
  id: string;
  action_no: number;
  brand_no: number | null;
  brand_id: string;
  category: string;
  kind: string;
  impact: string;
  status: string;
  outcome: string | null;
  validation: unknown;
  dismiss_reason?: string | null;
  payload: unknown;
  kpi_keys: string[] | null;
  assignee_id: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  priority_score: number | null;
  priority_level: string | null;
  priority_reason: unknown;
}

const ACTION_DETAIL_COLUMNS =
  'id, action_no, brand_no, brand_id, category, kind, impact, status, outcome, validation, payload, kpi_keys, assignee_id, due_date, created_at, updated_at, completed_at, priority_score, priority_level, priority_reason, stale_at, brands!inner(organization_id)';

export async function getActionFor(
  auth: McpAuthContext,
  actionId: string,
): Promise<ActionDetailForMcp | null> {
  const organizationId = auth.organizationId;
  if (!organizationId) return null;

  const read = (columns: string) =>
    supabaseAdmin
      .from('actions')
      .select(columns)
      .eq('id', actionId)
      .eq('brands.organization_id', organizationId)
      .is('deleted_at', null)
      .maybeSingle();
  let { data, error } = await read(`${ACTION_DETAIL_COLUMNS}, dismiss_reason`);
  // A database without 00366 has no dismiss_reason (42703): the rest is read, no reason given.
  if (missingDismissReason(error)) ({ data, error } = await read(ACTION_DETAIL_COLUMNS));
  if (error) throw new Error(error.message);
  const action = data as unknown as ActionDetailRow | null;
  if (!action || !(await mayUseBrand(auth, action.brand_id))) return null;

  // Every read below is keyed by this action, found above in the run's
  // organization and a brand the person may use (CLAUDE.md rule 3).
  const [tasksRes, signalsRes, eventsRes, names, entityCounts, kept] = await Promise.all([
    supabaseAdmin
      .from('action_tasks')
      .select(
        'id, position, task_key, title, title_params, status, skip_reason, mode, permission, depends_on, details',
      )
      .eq('action_id', actionId)
      .order('position'),
    // Every signal the action has taken as evidence (AC-007), kept after a
    // signal moves on to a later cycle.
    supabaseAdmin
      .from('signals')
      .select(`${MCP_SIGNAL_COLUMNS}, action_signals!inner(action_id)`)
      .eq('brand_id', action.brand_id)
      .eq('action_signals.action_id', actionId)
      .order('detected_at', { ascending: false }),
    supabaseAdmin
      .from('action_events')
      .select('event, data, created_at')
      .eq('action_id', actionId)
      .order('created_at'),
    assigneeNames([action.assignee_id]),
    // Its list (AC-009): the count left, and what was removed since.
    readEntityCounts(supabaseAdmin, [actionId]),
    // And its rows, for the Affected list (AC-009).
    readKeptEntities(supabaseAdmin, action.id),
  ]);
  if (tasksRes.error) throw new Error(tasksRes.error.message);
  if (signalsRes.error) throw new Error(signalsRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);
  const payload = withEntityCounts(
    (action.payload ?? {}) as Record<string, unknown>,
    entityCounts.get(actionId),
  );
  const signalRows = (signalsRes.data ?? []) as Record<string, unknown>[];
  // The Affected list as the drawer works it out (action-export.ts does the
  // same): from the signals that support it, its kept list, its payload. The
  // prompts' names come from the signals' payloads, so their places (where
  // each is tracked) aren't read.
  const affected = affectedOf(
    affectedSignals(mapSignalRows(signalRows as unknown as SignalRow[]), action.id),
    payload,
    kept,
  );

  return {
    id: action.id,
    action_no: Number(action.action_no),
    code: actionCode({ actionNo: Number(action.action_no), brandNo: action.brand_no }),
    brand_id: action.brand_id,
    category: action.category,
    kind: action.kind,
    impact: action.impact,
    status: action.status,
    outcome: action.outcome ?? null,
    net_of_control: netOfControl(action.validation),
    // Only while it is dismissed: another status leaves an earlier reason in place.
    dismiss_reason: action.status === 'dismissed' ? dismissReasonOf(action.dismiss_reason) : null,
    // Without the up to a thousand ids a group keeps for its count: `affected` lists them.
    payload: withoutTargetIds({ payload }).payload,
    kpi_keys: action.kpi_keys ?? [],
    assignee: action.assignee_id
      ? { id: action.assignee_id, full_name: names.get(action.assignee_id) ?? null }
      : null,
    due_date: action.due_date ?? null,
    priority: priorityFor({
      ...action,
      priority_reason: currentPriorityReason(action.priority_reason, payload),
    }),
    ...staleFor(action),
    created_at: action.created_at,
    updated_at: action.updated_at,
    completed_at: action.completed_at ?? null,
    tasks: (tasksRes.data ?? []).map((t) => ({
      id: t.id,
      position: t.position,
      task_key: t.task_key ?? null,
      title: t.title ?? null,
      title_params: (currentTaskParams(
        (t.title_params ?? {}) as Record<string, string | number>,
        payload,
      ) ?? {}) as Record<string, unknown>,
      status: t.status,
      skip_reason: t.skip_reason ?? null,
      mode: t.mode ?? null,
      permission: t.permission ?? null,
      depends_on: (t.depends_on ?? []) as string[],
      // Where, why, how and done-when (AC-004), the exact page, the change and how
      // it's checked (AC-010); an Improve task's body and evidence.
      details: mcpTaskDetails(t.details, t.task_key ?? null),
    })),
    // Before the signals and events: a result cut for size (chat's fit.ts)
    // shortens the top-level lists, so the prompts' names outlast them (CH-02).
    affected: mcpAffected(affected),
    // The join that found them is not part of a signal.
    signals: signalRows.map((row) =>
      withoutTargetIds(
        Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'action_signals')),
      ),
    ),
    events: (eventsRes.data ?? []).map((e) => ({
      event: e.event,
      data: (e.data ?? {}) as Record<string, unknown>,
      created_at: e.created_at,
    })),
  };
}

export interface ListSignalsParams {
  brandId: string;
  status?: string;
  kind?: string;
  limit?: number;
}

/** Signal ids per action_signals read: 100 UUIDs keep the request line well under 8KB. */
const SIGNAL_LINK_CHUNK = 100;

type LinkedAction = {
  id: string;
  action_no: number;
  brand_no: number | null;
  kind: string;
  status: string;
};

/**
 * The actions each signal has been used by, through action_signals (AC-007):
 * its current action and the earlier ones, closed ones included, the latest
 * link first. They only add used_by_actions, so a failed read is logged and
 * leaves every signal's list empty rather than taking the signals down.
 */
export async function signalActionRefs(
  brandId: string,
  signalIds: string[],
): Promise<Map<string, SignalActionRef[]>> {
  const chunks: string[][] = [];
  for (let i = 0; i < signalIds.length; i += SIGNAL_LINK_CHUNK) {
    chunks.push(signalIds.slice(i, i + SIGNAL_LINK_CHUNK));
  }
  const results = await Promise.all(
    chunks.map((ids) =>
      supabaseAdmin
        .from('action_signals')
        .select('signal_id, actions!inner(id, action_no, brand_no, kind, status)')
        .in('signal_id', ids)
        .eq('actions.brand_id', brandId)
        .is('actions.deleted_at', null)
        .order('linked_at', { ascending: false }),
    ),
  );
  const bySignal = new Map<string, SignalActionRef[]>();
  for (const { data, error } of results) {
    if (error) {
      console.error('[mcp] signal actions read failed:', error.message);
      return new Map();
    }
    // The untyped admin client models the action_signals→actions FK as an
    // array; it is a single action, so peel it off.
    const links =
      (data as unknown as Array<{
        signal_id: string;
        actions: LinkedAction[] | LinkedAction | null;
      }> | null) ?? [];
    for (const link of links) {
      const a = Array.isArray(link.actions) ? (link.actions[0] ?? null) : link.actions;
      if (!a) continue;
      bySignal.set(link.signal_id, [
        ...(bySignal.get(link.signal_id) ?? []),
        {
          id: a.id,
          action_no: Number(a.action_no),
          code: actionCode({ actionNo: Number(a.action_no), brandNo: a.brand_no }),
          kind: a.kind,
          status: a.status,
        },
      ]);
    }
  }
  return bySignal;
}

export async function listSignalsFor(
  auth: McpAuthContext,
  params: ListSignalsParams,
): Promise<Record<string, unknown>[] | null> {
  if (!(await brandAllowed(auth, params.brandId))) return null;

  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  let query = supabaseAdmin
    .from('signals')
    .select(MCP_SIGNAL_COLUMNS)
    .eq('brand_id', params.brandId)
    .order('detected_at', { ascending: false })
    .limit(limit);
  if (params.status) query = query.eq('status', params.status);
  if (params.kind) query = query.eq('kind', params.kind);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SignalRow[];

  // Each signal also says where it happened, what changed with units and
  // period, what it rests on, and which actions use it (AC-001), the same
  // way the dashboard's signal drawer does. A signal is linked to an action
  // only by becoming its current one, so those without one have no links.
  const [prompts, actions] = await Promise.all([
    readPromptPlaces(supabaseAdmin, params.brandId),
    signalActionRefs(
      params.brandId,
      rows.filter((row) => row.action_id).map((row) => row.id),
    ),
  ]);
  const known = new Map(mapSignalRows(rows, prompts).map((signal) => [signal.id, signal]));

  return rows.map((row) => {
    const used = currentActionFirst(actions.get(row.id) ?? [], row.action_id);
    const signal = known.get(row.id);
    const lean = {
      ...withoutTargetIds(row as unknown as Record<string, unknown>),
      // "S-03", as the app shows it (00534); null until its brand is numbered.
      code: signalCode({ brandNo: row.brand_no }),
    };
    // A kind this build has no detail for still comes back, as it always did.
    return signal
      ? { ...lean, ...signalDetailForApi(signal, used) }
      : { ...lean, used_by_actions: used };
  });
}

export interface ActionHistoryRow {
  id: string;
  action_no: number;
  /** Its code as the app shows it: "AC-03" (its number in its brand, 00534), or "AC-648" before its brand is numbered. */
  code: string;
  category: string;
  kind: string;
  impact: string;
  status: string;
  outcome: string | null;
  created_at: string;
  completed_at: string | null;
  /** Before/after pairs the validation sweep measured; empty until it runs. */
  results: Array<{ metric: string; unit: string; before: number; after: number }>;
  /**
   * Whether `outcome` is the result rather than a reading so far (learning
   * B1): the day-30 reading is in, or it was measured once, before readings.
   */
  final: boolean;
  /** The day after closing its latest reading was taken on; null before one. */
  reading_day: number | null;
  /** Its change net of the brand's prompts it didn't touch (learning B2); null when not netted. */
  net_of_control: McpNetOfControl | null;
  /** Why it was dismissed, as the person said (learning A5); null otherwise. */
  dismiss_reason: ActionDismissReason | null;
}

/** An action's change net of a control basket's (learning B2). */
export interface McpNetOfControl {
  /** The control: the prompts of the same topics, or the brand's others. */
  basis: 'topics' | 'brand';
  control_prompts: number;
  /** Per metric: a rate's move in points, a count's in percent, minus the control's. */
  metrics: { metric: string; net: number; unit: 'points' | 'percent' }[];
}

/** The net result the validation sweep kept, if it could net one. */
function netOfControl(validation: unknown): McpNetOfControl | null {
  const control = controlNetOf(validation as Parameters<typeof controlNetOf>[0]);
  return control
    ? { basis: control.basis, control_prompts: control.prompts, metrics: control.net }
    : null;
}

interface ValidationMetric {
  metric: string;
  unit: string;
  before: number | null;
  after: number | null;
}

interface ValidationSnapshot {
  metrics?: ValidationMetric[];
  /** Its readings a week, two weeks and a month after it closed (learning B1). */
  readings?: { day?: unknown }[];
  final?: boolean;
}

/** A closed action as list_action_history reads it; dismiss_reason is absent without 00366. */
interface ActionHistoryDbRow {
  id: string;
  action_no: number;
  brand_no: number | null;
  category: string;
  kind: string;
  impact: string;
  status: string;
  outcome: string | null;
  validation: unknown;
  dismiss_reason?: string | null;
  created_at: string;
  completed_at: string | null;
}

const ACTION_HISTORY_COLUMNS =
  'id, action_no, brand_no, category, kind, impact, status, outcome, validation, created_at, completed_at';

export async function listActionHistoryFor(
  auth: McpAuthContext,
  params: { brandId: string; limit?: number },
): Promise<ActionHistoryRow[] | null> {
  return (await actionHistoryPageFor(auth, params))?.rows ?? null;
}

/** Closed actions from `offset`, latest first, with how many there are in all (Chat's pages). */
export async function actionHistoryPageFor(
  auth: McpAuthContext,
  params: { brandId: string; limit?: number; offset?: number },
): Promise<{ rows: ActionHistoryRow[]; total: number } | null> {
  if (!(await brandAllowed(auth, params.brandId))) return null;

  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const offset = Math.max(Math.trunc(params.offset ?? 0), 0);
  const matching = (columns: string, head = false) =>
    supabaseAdmin
      .from('actions')
      .select(columns, { count: 'exact', head })
      .eq('brand_id', params.brandId)
      .in('status', ['completed', 'dismissed'])
      .is('deleted_at', null);
  const read = (columns: string) =>
    matching(columns)
      .order('completed_at', { ascending: false, nullsFirst: false })
      .order('id')
      .range(offset, offset + limit - 1);
  let found = await read(`${ACTION_HISTORY_COLUMNS}, dismiss_reason`);
  // A database without 00366 has no dismiss_reason (42703): the rest is read, no reason given.
  if (missingDismissReason(found.error)) found = await read(ACTION_HISTORY_COLUMNS);
  const { rows: data, total } = await pageRows(found, () => matching('id', true));

  const rows = (data as unknown as ActionHistoryDbRow[]).map((r) => {
    const validation = r.validation as ValidationSnapshot | null;
    const metrics = validation?.metrics ?? [];
    const days = (Array.isArray(validation?.readings) ? validation.readings : [])
      .map((reading) => reading?.day)
      .filter((day): day is number => Number.isInteger(day));
    const outcome = r.outcome ?? null;
    return {
      id: r.id,
      action_no: Number(r.action_no),
      code: actionCode({ actionNo: Number(r.action_no), brandNo: r.brand_no }),
      category: r.category,
      kind: r.kind,
      impact: r.impact,
      status: r.status,
      outcome,
      created_at: r.created_at,
      completed_at: r.completed_at ?? null,
      // A metric missing either half was not measured; dropped, as on the dashboard.
      results: metrics
        .filter((m) => m.before != null && m.after != null)
        .map((m) => ({
          metric: m.metric,
          unit: m.unit,
          before: m.before as number,
          after: m.after as number,
        })),
      // A reading so far until the day-30 one; one measured once before the
      // readings came keeps its result, as History reads it.
      final:
        validation?.final === true ||
        (days.length === 0 && outcome != null && outcome !== 'pending_measurement'),
      reading_day: days.length ? Math.max(...days) : null,
      net_of_control: netOfControl(validation),
      // Only while it is dismissed: another status leaves an earlier reason in place.
      dismiss_reason: r.status === 'dismissed' ? dismissReasonOf(r.dismiss_reason) : null,
    };
  });
  return { rows, total };
}

export interface UpdatedTaskStatus {
  id: string;
  action_id: string;
  status: McpTaskStatus;
  skip_reason: string | null;
  updated_at: string;
}

/**
 * Move one task of an action — the MCP counterpart of the drawer's task menu.
 *
 * Ownership first: a task outside the caller's org returns null before any
 * write. Then the same rules and trail as the dashboard: a skip must say why,
 * the change is logged as a `task_status` event under the key's user, and the
 * action's updated stamp moves.
 */
export async function updateTaskStatusFor(
  auth: McpAuthContext,
  taskId: string,
  status: McpTaskStatus,
  skipReason?: string,
): Promise<UpdatedTaskStatus | null> {
  if (!auth.organizationId) return null;

  const reason = status === 'skipped' ? (skipReason ?? '').trim().slice(0, 200) : null;
  if (status === 'skipped' && !reason) throw new Error('A skipped task needs a skip_reason');

  const { data: owned } = await supabaseAdmin
    .from('action_tasks')
    .select('id, action_id, actions!inner(brand_id, brands!inner(organization_id))')
    .eq('id', taskId)
    .eq('actions.brands.organization_id', auth.organizationId)
    .is('actions.deleted_at', null)
    .maybeSingle();
  if (!owned) return null;
  const ownedAction = Array.isArray(owned.actions) ? (owned.actions[0] ?? null) : owned.actions;
  if (!(await mayUseBrand(auth, ownedAction?.brand_id))) return null;

  const updatedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('action_tasks')
    .update({ status, skip_reason: reason, updated_at: updatedAt })
    .eq('id', taskId)
    .select('id, action_id, status, skip_reason, updated_at')
    .single();
  if (error) throw new Error(error.message);

  // Best-effort, as on the dashboard: a missing trail entry must not fail the
  // change it records.
  await supabaseAdmin.from('action_events').insert({
    action_id: owned.action_id,
    event: 'task_status',
    data: { taskId, to: status, ...(reason ? { reason } : {}) },
    actor_id: auth.userId,
  });
  await supabaseAdmin.from('actions').update({ updated_at: updatedAt }).eq('id', owned.action_id);

  return {
    id: data.id,
    action_id: data.action_id,
    status: data.status as McpTaskStatus,
    skip_reason: data.skip_reason ?? null,
    updated_at: data.updated_at ?? updatedAt,
  };
}

export const IMPROVE_PRESETS = ['24h', '7d', '30d', '90d', 'custom'] as const;
export const IMPROVE_SOURCE_TYPES = [
  'fanout',
  'domain',
  'answer',
  'competitor_url',
  'brand_page',
] as const;

export interface CreateImproveActionInput {
  promptId: string;
  range: {
    preset: (typeof IMPROVE_PRESETS)[number];
    from: string;
    to?: string;
    region?: string;
  };
  idempotencyKey: string;
  suggestions: Array<{
    id: string;
    platform: string;
    title: string;
    body?: string;
    sources?: Array<{ type: (typeof IMPROVE_SOURCE_TYPES)[number]; ref: string }>;
  }>;
}

export interface CreatedImproveAction {
  actionId: string;
  actionNo: number;
  created: boolean;
  taskCount: number;
}

/**
 * Create a `prompt_improve` Action Center action from Improve suggestions —
 * the MCP counterpart of the Improve tab's "Send Actions".
 *
 * Org-ownership of the prompt is verified *first* via supabaseAdmin — a
 * wrong-org or missing id returns `null` (→ 404 upstream) with no outbound
 * call. Only then do we call the internal endpoint at
 * `${API_BASE_URL}/api/internal/prompts/:id/improve/action` with
 * `Authorization: Bearer ${CRON_SECRET}` and the key's user — same pattern as
 * `generateBriefFor`. The server checks the prompt_improve plan feature for
 * that user and dedupes on the idempotency key, so a retried call returns the
 * action the first one created (`created: false`).
 */
export async function createImproveActionFor(
  auth: McpAuthContext,
  input: CreateImproveActionInput,
): Promise<CreatedImproveAction | null> {
  if (!auth.organizationId) return null;
  // Improve costs AI: an admin's or a manager's, as in the dashboard.
  requireManager(auth);

  const { data: ownership } = await supabaseAdmin
    .from('prompts')
    .select('id, prompt_sets!inner(brand_id, brands!inner(organization_id))')
    .eq('id', input.promptId)
    .eq('prompt_sets.brands.organization_id', auth.organizationId)
    .maybeSingle();
  if (!ownership) return null;
  const promptSet = Array.isArray(ownership.prompt_sets)
    ? (ownership.prompt_sets[0] ?? null)
    : ownership.prompt_sets;
  if (!(await mayUseBrand(auth, promptSet?.brand_id))) return null;
  // No Improve action (an LLM call) on the demo brand, nor for a read-only workspace, whoever asks.
  // Only Ansvisor Cloud has demo brands: self-hosted reads nothing for it.
  if (
    await callOnDemoBrand('create_improve_action', auth.organizationId, {
      prompt_id: input.promptId,
    })
  ) {
    throw new DemoBrandError();
  }
  await assertSubscriptionActive(auth.organizationId);

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error('CRON_SECRET must be configured for MCP Improve actions');
  }

  const res = await fetch(`${API_BASE_URL}/api/internal/prompts/${input.promptId}/improve/action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify({
      userId: auth.userId,
      preset: input.range.preset,
      from: input.range.from,
      to: input.range.to,
      region: input.range.region ?? '',
      idempotencyKey: input.idempotencyKey,
      suggestions: input.suggestions,
    }),
  });

  if (!res.ok) {
    // Surface the server's message (plan without Improve, no suggestions for
    // this range yet, invalid suggestion) so the agent can relay it.
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Internal Improve endpoint returned ${res.status}`);
  }

  const body = (await res.json()) as CreatedImproveAction;
  return {
    actionId: body.actionId,
    actionNo: body.actionNo,
    created: body.created,
    taskCount: body.taskCount,
  };
}

// ── Read-only competitor and report tools (#918) ────────────────────────────

export interface McpCompetitorRow {
  id: string;
  name: string;
  domain: string;
  /**
   * Its type as the Competitors page names it (00542): a generic type
   * ("Direct competitor", "Marketplace / aggregator", "Publisher / review
   * site", "Other") or the brand's own label ("Tour operator"); null for none.
   */
  type: string | null;
  /**
   * The competitors merged into it (00543), by name and domain: answers
   * naming any of them count for it from their merge on. A merged competitor
   * is never listed on its own.
   */
  aliases: { name: string; domain: string }[];
}

/**
 * List a brand's competitors only after confirming the brand belongs to the
 * authenticated organization. The joined ownership predicate on the data
 * query prevents a brand reassignment between the check and the read. With
 * `type`, only the competitors of that type (matchesCompetitorType: a type's
 * name or key in any case, "none" for the ones without a type). Each comes
 * with the names merged into it (00543), read the same way.
 */
export async function listCompetitorsFor(
  auth: McpAuthContext,
  brandId: string,
  opts: { type?: string } = {},
): Promise<McpCompetitorRow[] | null> {
  if (!auth.organizationId) return null;

  const { data: brand, error: brandError } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (brandError) throw new Error(brandError.message);
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  // The brand's competitors, with their types; a database without 00542 (the
  // web deployed ahead of it): the list without types.
  const organizationId = auth.organizationId;
  const competitorRows = async () => {
    const typed = await supabaseAdmin
      .from('competitors')
      .select('id, name, domain, type, brands!inner(organization_id)')
      .eq('brand_id', brandId)
      .eq('brands.organization_id', organizationId)
      .order('created_at', { ascending: true });
    return missingCompetitorTypeColumn(typed.error)
      ? await supabaseAdmin
          .from('competitors')
          .select('id, name, domain, brands!inner(organization_id)')
          .eq('brand_id', brandId)
          .eq('brands.organization_id', organizationId)
          .order('created_at', { ascending: true })
      : typed;
  };
  const [{ data, error }, merged] = await Promise.all([
    competitorRows(),
    supabaseAdmin
      .from('merged_competitors')
      .select('id, merged_into_id, name, domain, brands!inner(organization_id)')
      .eq('brand_id', brandId)
      .eq('brands.organization_id', auth.organizationId)
      .order('merged_at', { ascending: true }),
  ]);
  if (error) throw new Error(error.message);
  // Without 00543 (or a failed read) the competitors come without their merged names.
  const aliases = aliasesByCompetitor(
    merged.error ? [] : ((merged.data ?? []) as MergedCompetitorRow[]),
  );

  return (data ?? [])
    .map((row) => ({ ...row, type: (row as { type?: string | null }).type ?? null }))
    .filter((row) => matchesCompetitorType(row.type, opts.type))
    .map((row) => ({
      id: row.id as string,
      name: row.name as string,
      domain: (row.domain as string | null) ?? '',
      type: competitorTypeLabel(row.type),
      aliases: (aliases.get(row.id as string) ?? []).map((alias) => ({
        name: alias.name,
        domain: alias.domain,
      })),
    }));
}

export interface McpReportListItem {
  id: string;
  brand_id: string;
  title: string;
  template: string;
  date_from: string;
  date_to: string;
  created_at: string;
}

/**
 * List saved immutable report snapshots for an organization-owned brand.
 * The database query repeats the ownership predicate to avoid a TOCTOU leak.
 */
export async function listReportsFor(
  auth: McpAuthContext,
  brandId: string,
  requestedLimit = 50,
): Promise<McpReportListItem[] | null> {
  return (await reportsPageFor(auth, brandId, requestedLimit))?.rows ?? null;
}

/** Saved reports from `offset`, newest first, with how many there are in all (Chat's pages). */
export async function reportsPageFor(
  auth: McpAuthContext,
  brandId: string,
  requestedLimit = 50,
  requestedOffset = 0,
  /** Chat's lookup: these reports only, by id (checked ids), or those with every word in their title. */
  find?: { ids?: readonly string[]; search?: string },
): Promise<{ rows: McpReportListItem[]; total: number } | null> {
  if (!auth.organizationId) return null;

  const { data: brand, error: brandError } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (brandError) throw new Error(brandError.message);
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 100)
    : 50;
  const offset = Math.max(Math.trunc(requestedOffset), 0);
  const organizationId = auth.organizationId;
  const words = searchWords(find?.search);
  if (find && (find.ids?.length === 0 || (find.search !== undefined && !words.length))) {
    return { rows: [], total: 0 };
  }
  const matching = (head = false) => {
    let query = supabaseAdmin
      .from('reports')
      .select(
        'id, brand_id, title, template, date_from, date_to, created_at, brands!inner(organization_id)',
        { count: 'exact', head },
      )
      .eq('brand_id', brandId)
      .eq('brands.organization_id', organizationId);
    if (find?.ids) query = query.in('id', [...find.ids]);
    // Each word as an escaped pattern: the text is data, never part of the filter's syntax.
    for (const word of words) query = query.ilike('title', containsPattern(word));
    return query;
  };
  const { rows, total } = await pageRows(
    await matching()
      .order('created_at', { ascending: false })
      .order('id')
      .range(offset, offset + limit - 1),
    () => matching(true),
  );

  const page = rows.map((row) => ({
    id: row.id as string,
    brand_id: row.brand_id as string,
    title: row.title as string,
    template: row.template as string,
    date_from: row.date_from as string,
    date_to: row.date_to as string,
    created_at: row.created_at as string,
  }));
  return { rows: page, total };
}

/**
 * The brand's saved reports by the ids or title words a person named, for
 * Chat (the owner's plan of 2026-11-16, item 2), newest first. Only this
 * brand of the caller's organization: an id of another brand or workspace
 * is not found. Null for a brand outside the caller's organization or access.
 */
export async function lookUpReportsFor(
  auth: McpAuthContext,
  params: { brandId: string; ids?: readonly string[]; search?: string; offset?: number },
): Promise<LookupResult<'reports', McpReportListItem> | null> {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const lookup = await lookUpBy(LOOKUP_WORDS.reports, params, (find) =>
    reportsPageFor(auth, params.brandId, find.limit, find.offset, {
      ids: find.ids,
      search: find.search,
    }),
  );
  return lookup ? asLookup('reports', lookup) : null;
}

export interface McpReportDetail extends McpReportListItem {
  payload: unknown;
}

/**
 * Read a saved report only if its parent brand belongs to the authenticated
 * organization. The joined ownership predicate is applied in the database.
 */
export async function getReportFor(
  auth: McpAuthContext,
  reportId: string,
): Promise<McpReportDetail | null> {
  if (!auth.organizationId) return null;

  const { data, error } = await supabaseAdmin
    .from('reports')
    .select(
      'id, brand_id, title, template, date_from, date_to, created_at, payload, brands!inner(organization_id)',
    )
    .eq('id', reportId)
    .eq('brands.organization_id', auth.organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !(await mayUseBrand(auth, data.brand_id as string))) return null;

  return {
    id: data.id as string,
    brand_id: data.brand_id as string,
    title: data.title as string,
    template: data.template as string,
    date_from: data.date_from as string,
    date_to: data.date_to as string,
    created_at: data.created_at as string,
    payload: data.payload,
  };
}
