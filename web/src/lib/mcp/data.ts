import { supabaseAdmin } from '@/lib/supabase/admin';
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
import { API_BASE_URL } from '@/config/api';

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
}

export async function listBrandsFor(auth: McpAuthContext): Promise<BrandRow[]> {
  if (!auth.organizationId) return [];

  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('id, name, slug, industry, region, created_at')
    .eq('organization_id', auth.organizationId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as BrandRow[];
}

export interface VisibilitySummaryParams {
  brandId: string;
  dateFrom?: string;
  dateTo?: string;
  model?: string;
  region?: string;
}

export interface VisibilitySummary {
  brand: { id: string; name: string };
  totals: {
    resultCount: number;
    avgVisibility: number;
    totalMentions: number;
    totalCitations: number;
  };
  topCompetitors: Array<{
    name: string;
    mentions: number;
    avgVisibility: number;
  }>;
}

interface CompetitorMentionRow {
  name: string;
  mention_count: number;
  visibility_score: number;
}

export async function getVisibilitySummaryFor(
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
  if (!brand) return null;

  // #155 — getVisibilitySummaryFor mirrors the insights_aggregates RPC and
  // excludes chatgpt-shopping for the same reason: its model isn't
  // comparable to a normal ChatGPT answer and would skew brand visibility.
  let query = supabaseAdmin
    .from('prompt_results')
    .select(
      'visibility_score, mention_count, citation_count, sentiment, model_used, competitor_mentions',
    )
    .eq('brand_id', params.brandId)
    .neq('platform', 'chatgpt-shopping');

  if (params.dateFrom) query = query.gte('created_at', params.dateFrom);
  const expandedDateTo = expandDateToEndOfDay(params.dateTo);
  if (expandedDateTo) query = query.lte('created_at', expandedDateTo);
  if (params.region) query = query.eq('region', params.region);
  if (params.model) {
    const list = params.model
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    query =
      list.length > 1
        ? query.in('model_used', list)
        : query.eq('model_used', list[0] ?? params.model);
  }

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  const results = (rows ?? []) as Array<{
    visibility_score: number;
    mention_count: number;
    citation_count: number;
    sentiment: string;
    model_used: string | null;
    competitor_mentions: CompetitorMentionRow[] | null;
  }>;

  if (results.length === 0) {
    return {
      brand: { id: brand.id, name: brand.name },
      totals: {
        resultCount: 0,
        avgVisibility: 0,
        totalMentions: 0,
        totalCitations: 0,
      },
      topCompetitors: [],
    };
  }

  let totalMentions = 0;
  let totalCitations = 0;
  let sumVis = 0;
  const compTotals = new Map<string, { mentions: number; visSum: number }>();

  for (const r of results) {
    sumVis += r.visibility_score ?? 0;
    totalMentions += r.mention_count ?? 0;
    totalCitations += r.citation_count ?? 0;
    for (const cm of r.competitor_mentions ?? []) {
      const agg = compTotals.get(cm.name) ?? { mentions: 0, visSum: 0 };
      agg.mentions += cm.mention_count ?? 0;
      agg.visSum += cm.visibility_score ?? 0;
      compTotals.set(cm.name, agg);
    }
  }

  const avgVisibility = Math.round((sumVis / results.length) * 10) / 10;

  const topCompetitors = [...compTotals.entries()]
    .map(([name, agg]) => ({
      name,
      mentions: agg.mentions,
      avgVisibility: Math.round((agg.visSum / Math.max(agg.mentions, 1)) * 10) / 10,
    }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 5);

  return {
    brand: { id: brand.id, name: brand.name },
    totals: {
      resultCount: results.length,
      avgVisibility,
      totalMentions,
      totalCitations,
    },
    topCompetitors,
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
  if (!brand) return null;

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
}

const PROMPT_LIST_DEFAULT_LIMIT = 100;
const PROMPT_LIST_MAX_LIMIT = 500;

export async function listPromptsFor(
  auth: McpAuthContext,
  params: ListPromptsParams,
): Promise<PromptRow[] | null> {
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand) return null;

  const limit = Math.min(
    Math.max(params.limit ?? PROMPT_LIST_DEFAULT_LIMIT, 1),
    PROMPT_LIST_MAX_LIMIT,
  );

  let query = supabaseAdmin
    .from('prompts')
    .select(
      'id, text, topic_id, platforms, models, regions, is_active, created_at, prompt_sets!inner(brand_id), topics(name)',
    )
    .eq('prompt_sets.brand_id', params.brandId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (params.topicId) query = query.eq('topic_id', params.topicId);
  if (typeof params.isActive === 'boolean') {
    query = query.eq('is_active', params.isActive);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

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

  return rows.map((r) => {
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
  status?: 'new' | 'sent' | 'in_progress' | 'done' | 'dismissed';
  impact?: 'high' | 'medium' | 'low';
  type?: 'owned' | 'earned';
  limit?: number;
}

export async function listContentOpportunitiesFor(
  auth: McpAuthContext,
  params: ListContentOpportunitiesParams,
): Promise<ContentOpportunityRow[] | null> {
  if (!auth.organizationId) return null;

  // Ownership check
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand) return null;

  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);

  let query = supabaseAdmin
    .from('content_opportunities')
    .select(
      'id, title, description, type, impact, opportunity_score, status, prompt_id, created_at, updated_at, brief, prompts(text)',
    )
    .eq('brand_id', params.brandId)
    .order('opportunity_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (params.status) query = query.eq('status', params.status);
  if (params.impact) query = query.eq('impact', params.impact);
  if (params.type) query = query.eq('type', params.type);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

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

  return rows.map((r) => {
    const prompt = Array.isArray(r.prompts) ? (r.prompts[0] ?? null) : r.prompts;
    return {
      id: r.id,
      title: r.title,
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

  // Ownership check first — wrong-org or missing id returns null with no
  // outbound call, so no LLM cost or data leak for an attacker probing ids.
  const { data: ownership } = await supabaseAdmin
    .from('content_opportunities')
    .select('id, brands!inner(organization_id)')
    .eq('id', opportunityId)
    .eq('brands.organization_id', auth.organizationId)
    .maybeSingle();
  if (!ownership) return null;

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
  status: string;
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
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand) return null;

  const { data, error } = await supabaseAdmin
    .from('site_audits')
    .select('id, url, status, total_score, signals_evaluated, signals_total, created_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    url: r.url as string,
    status: r.status as string,
    totalScore: r.total_score == null ? null : Number(r.total_score),
    signalsEvaluated: r.signals_evaluated == null ? null : Number(r.signals_evaluated),
    signalsTotal: r.signals_total == null ? null : Number(r.signals_total),
    createdAt: r.created_at as string,
  }));
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
  if (!brand) return null;

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
    body: JSON.stringify({ brandId, url }),
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    // Surface the server's message (e.g. the monthly-quota / inactive-subscription
    // text) so the agent can relay it instead of a generic failure.
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Internal site-audit endpoint returned ${res.status}`);
  }

  const body = (await res.json()) as {
    audit: { id: string; brandId: string; url: string; status: string };
  };
  return {
    id: body.audit.id,
    brandId: body.audit.brandId,
    url: body.audit.url,
    status: body.audit.status,
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
 * `null`. Returns the status + scores + signals + AI recommendations.
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
  if (!audit) return null;

  const { data: signalRows } = await supabaseAdmin
    .from('audit_signal_results')
    .select('signal_key, category, status, score, evidence')
    .eq('audit_id', auditId);

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
    recommendations: (a.recommendations as unknown[]) ?? [],
    signals,
    error: (a.error as string | null) ?? null,
    createdAt: a.created_at as string,
    completedAt: (a.completed_at as string | null) ?? null,
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
      'id, title, description, type, impact, opportunity_score, status, prompt_id, created_at, updated_at, source_data, brief, prompts(text), brands!inner(organization_id)',
    )
    .eq('id', opportunityId)
    .eq('brands.organization_id', auth.organizationId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const r = data as unknown as {
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
    source_data: Record<string, unknown> | null;
    brief: Record<string, unknown> | null;
    prompts: Array<{ text: string }> | { text: string } | null;
  };

  const prompt = Array.isArray(r.prompts) ? (r.prompts[0] ?? null) : r.prompts;

  return {
    id: r.id,
    title: r.title,
    description: r.description,
    type: r.type,
    impact: r.impact,
    opportunity_score: Number(r.opportunity_score ?? 0),
    status: r.status,
    prompt_id: r.prompt_id,
    prompt_text: prompt?.text ?? null,
    source_data: r.source_data ?? null,
    brief: r.brief ?? null,
    created_at: r.created_at ?? '',
    updated_at: r.updated_at ?? '',
  };
}

export const CONTENT_OPPORTUNITY_STATUSES = [
  'new',
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
 * id returns null (→ 404) with no DB write.
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
    .select('id, brands!inner(organization_id)')
    .eq('id', opportunityId)
    .eq('brands.organization_id', auth.organizationId)
    .maybeSingle();
  if (!ownership) return null;

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
}

export interface CompetitorComparisonOutput {
  brand: {
    id: string;
    name: string;
    avg_visibility_score: number;
    total_mentions: number;
    total_citations: number;
    appearance_count: number;
  };
  competitors: Array<{
    competitor_id: string;
    name: string;
    avg_visibility_score: number;
    total_mentions: number;
    total_citations: number;
    appearance_count: number;
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
  };
}

interface CompetitorAggRpc {
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
  if (!brand) return null;

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
  // caller's brand_id, which we've just verified above.
  const [compRes, sovRes] = await Promise.all([
    supabaseAdmin.rpc('competitor_aggregates', rpcArgs),
    supabaseAdmin.rpc('share_of_voice_aggregates', rpcArgs),
  ]);
  if (compRes.error) throw new Error(compRes.error.message);
  if (sovRes.error) throw new Error(sovRes.error.message);

  const comp = compRes.data as unknown as CompetitorAggRpc;
  const sov = sovRes.data as unknown as SoVAggRpc;

  const brandAvg =
    comp.brand_row_count > 0 ? Math.round(comp.brand_sum_visibility / comp.brand_row_count) : 0;

  const competitors = comp.by_competitor.map((c) => ({
    competitor_id: c.competitor_id,
    name: c.name && c.name.trim() !== '' ? c.name : c.competitor_id,
    avg_visibility_score: c.row_count > 0 ? Math.round(Number(c.sum_visibility) / c.row_count) : 0,
    total_mentions: Number(c.total_mentions),
    total_citations: Number(c.total_citations),
    appearance_count: c.row_count,
  }));

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

  return {
    brand: {
      id: brand.id,
      name: brand.name,
      avg_visibility_score: brandAvg,
      total_mentions: Number(comp.brand_total_mentions),
      total_citations: Number(comp.brand_total_citations),
      appearance_count: comp.brand_row_count,
    },
    competitors,
    share_of_voice: {
      overall_sov_pct: overallSovPct,
      total_brand_mentions: totalBrandMentions,
      total_competitor_mentions: totalCompMentions,
      by_platform: byPlatform,
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
  /** Restrict to owned / competitor / external citations. Default `all`. */
  sourceFilter?: CitationSourceFilter;
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
}

const CITATIONS_DEFAULT_LIMIT = 50;
const CITATIONS_MAX_LIMIT = 200;

/**
 * Return the URLs and domains AI engines cite alongside a brand, classified by
 * source type (news / review / owned / social / forum). Ports the JS-side
 * aggregation from `getCitationsOverview` in `actions/citations.ts` — citations
 * are stored as JSONB inside `prompt_results.citations` and each URL needs the
 * `classifyDomain` / `classifyArticleType` helpers, so this can't be folded
 * into a Postgres aggregate the way the competitor / SoV surfaces were in #114.
 *
 * Ownership-check first; the prompt_results scan only runs after the brand
 * belongs to the caller's org.
 */
export async function listCitationsFor(
  auth: McpAuthContext,
  params: ListCitationsParams,
): Promise<CitationsOverviewOutput | null> {
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand) return null;

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

  // #155 — Citations summary is part of the Insights surface; chatgpt-shopping
  // rows are isolated from these aggregations.
  let query = supabaseAdmin
    .from('prompt_results')
    .select('id, prompt_id, platform, model_used, region, created_at, citations, citation_count')
    .eq('brand_id', params.brandId)
    .neq('platform', 'chatgpt-shopping');

  if (params.dateFrom) query = query.gte('created_at', params.dateFrom);
  const expandedDateTo = expandDateToEndOfDay(params.dateTo);
  if (expandedDateTo) query = query.lte('created_at', expandedDateTo);
  if (params.region) query = query.eq('region', params.region);
  if (params.model) {
    const list = params.model
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    query =
      list.length > 1
        ? query.in('model_used', list)
        : query.eq('model_used', list[0] ?? params.model);
  }
  if (params.topicId) {
    const { data: topicPrompts } = await supabaseAdmin
      .from('prompts')
      .select('id')
      .eq('topic_id', params.topicId);
    const topicPromptIds = ((topicPrompts ?? []) as { id: string }[]).map((p) => p.id);
    query = query.in(
      'prompt_id',
      topicPromptIds.length > 0 ? topicPromptIds : ['00000000-0000-0000-0000-000000000000'],
    );
  }

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  const results = (rows ?? []) as Array<{
    id: string;
    platform: string | null;
    model_used: string | null;
    citations: Citation[] | null;
  }>;

  interface DomainAgg {
    domain: string;
    category: SourceCategory;
    totalCitations: number;
    resultsCiting: Set<string>;
    models: Set<string>;
    articleTypeCounts: Map<string, number>;
  }
  interface UrlAgg {
    url: string;
    domain: string;
    category: SourceCategory;
    title: string;
    totalCitations: number;
    resultsCiting: Set<string>;
    models: Set<string>;
    articleType: string | null;
  }

  const domainMap = new Map<string, DomainAgg>();
  const urlMap = new Map<string, UrlAgg>();
  let totalCitations = 0;
  let resultsWithCitations = 0;
  const sourceFilter = params.sourceFilter ?? 'all';
  const hasSourceFilter = sourceFilter !== 'all';

  for (const result of results) {
    const citations = Array.isArray(result.citations) ? result.citations : [];
    if (citations.length === 0) continue;
    const modelKey = result.model_used || result.platform || '';
    // #297 — when a source_filter is set, a result only counts toward
    // results_with_citations if it contributes at least one matching citation.
    // With `all` (the default) we never call the matcher, so the aggregation is
    // byte-identical to the pre-#297 output.
    let matchedInResult = false;

    for (const cite of citations) {
      const host = extractHostname(cite.url);
      if (!host) continue;

      const category = classifyDomain(host, classifyCtx);
      if (hasSourceFilter && !citationCategoryMatches(category, sourceFilter)) continue;
      matchedInResult = true;
      totalCitations += 1;

      const existingDomain = domainMap.get(host) ?? {
        domain: host,
        category,
        totalCitations: 0,
        resultsCiting: new Set<string>(),
        models: new Set<string>(),
        articleTypeCounts: new Map<string, number>(),
      };
      existingDomain.totalCitations += 1;
      existingDomain.resultsCiting.add(result.id);
      if (modelKey) existingDomain.models.add(modelKey);
      const articleType = classifyArticleType(cite.url, cite.title);
      if (articleType) {
        existingDomain.articleTypeCounts.set(
          articleType,
          (existingDomain.articleTypeCounts.get(articleType) ?? 0) + 1,
        );
      }
      domainMap.set(host, existingDomain);

      // De-dupe URLs by stripping query/fragment + trailing slash so the same
      // article cited with different tracking params still aggregates.
      let normalizedUrl = cite.url;
      try {
        const parsed = new URL(cite.url);
        parsed.search = '';
        parsed.hash = '';
        normalizedUrl = parsed.toString().replace(/\/$/, '');
      } catch {
        // leave as-is
      }
      const existingUrl = urlMap.get(normalizedUrl) ?? {
        url: normalizedUrl,
        domain: host,
        category,
        title: cite.title || '',
        totalCitations: 0,
        resultsCiting: new Set<string>(),
        models: new Set<string>(),
        articleType,
      };
      existingUrl.totalCitations += 1;
      existingUrl.resultsCiting.add(result.id);
      if (modelKey) existingUrl.models.add(modelKey);
      if (!existingUrl.title && cite.title) existingUrl.title = cite.title;
      urlMap.set(normalizedUrl, existingUrl);
    }
    // `all`: count every result that had citations (original behavior).
    // Filtered: only results that contributed a matching citation.
    if (!hasSourceFilter || matchedInResult) resultsWithCitations += 1;
  }

  const totalResults = results.length;
  const limit = Math.min(Math.max(params.limit ?? CITATIONS_DEFAULT_LIMIT, 1), CITATIONS_MAX_LIMIT);

  const allDomains = Array.from(domainMap.values()).sort(
    (a, b) => b.totalCitations - a.totalCitations,
  );
  const topDomains = allDomains.slice(0, limit).map((agg) => {
    const resultsCiting = agg.resultsCiting.size;
    const articleTypes = Array.from(agg.articleTypeCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    return {
      domain: agg.domain,
      category: agg.category,
      total_citations: agg.totalCitations,
      results_citing: resultsCiting,
      usage_pct: totalResults > 0 ? Math.round((resultsCiting / totalResults) * 1000) / 10 : 0,
      models: Array.from(agg.models).sort(),
      article_types: articleTypes,
    };
  });

  const allUrls = Array.from(urlMap.values()).sort((a, b) => b.totalCitations - a.totalCitations);
  const topUrls = allUrls.slice(0, limit).map((agg) => {
    const resultsCiting = agg.resultsCiting.size;
    return {
      url: agg.url,
      domain: agg.domain,
      category: agg.category,
      title: agg.title,
      total_citations: agg.totalCitations,
      results_citing: resultsCiting,
      usage_pct: totalResults > 0 ? Math.round((resultsCiting / totalResults) * 1000) / 10 : 0,
      article_type: agg.articleType,
    };
  });

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

  return {
    totals: {
      domains: totalDomains,
      urls: allUrls.length,
      citations: totalCitations,
      results_with_citations: resultsWithCitations,
      avg_citations_per_result:
        totalResults > 0 ? Math.round((totalCitations / totalResults) * 10) / 10 : 0,
    },
    source_type_breakdown: sourceTypeBreakdown,
    top_domains: topDomains,
    top_urls: topUrls,
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
  if (!brand) return null;

  const p_models = params.model
    ? params.model
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  const granularity: VisibilityTrendGranularity = params.granularity ?? 'day';

  const { data, error } = await supabaseAdmin.rpc('visibility_trend_aggregates', {
    p_brand_id: params.brandId,
    p_models: p_models && p_models.length > 0 ? p_models : null,
    p_region: params.region ?? null,
    p_date_from: params.dateFrom ?? null,
    p_date_to: expandDateToEndOfDay(params.dateTo) ?? null,
    p_topic_id: params.topicId ?? null,
    p_granularity: granularity,
  });
  if (error) throw new Error(error.message);

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
  }));

  return { granularity, buckets };
}

export interface AiTrafficParams {
  brandId: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface AiTrafficOutput {
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
  if (!brand) return null;

  let query = supabaseAdmin
    .from('ai_traffic_logs')
    .select('source_platform, url, country')
    .eq('brand_id', params.brandId);

  if (params.dateFrom) query = query.gte('created_at', params.dateFrom);
  const expandedDateTo = expandDateToEndOfDay(params.dateTo);
  if (expandedDateTo) query = query.lte('created_at', expandedDateTo);

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  const rawRows =
    (rows as Array<{
      source_platform: string | null;
      url: string;
      country: string | null;
    }> | null) ?? [];

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
    total_visits: rawRows.length,
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
  ai_volume_multiplier: number;
  /** Volume-weighted competition index 0-100, or null if unknown. */
  competition_index: number | null;
  /** Bucketed competition label ("LOW" | "MEDIUM" | "HIGH"), or null. */
  competition: string | null;
  fetched_at: string | null;
}

const PROMPT_VOLUMES_DEFAULT_LIMIT = 100;
const PROMPT_VOLUMES_MAX_LIMIT = 500;

/**
 * Return per-prompt search-volume + competition rows for a brand, scoped
 * `brand → prompt_sets → prompts → prompt_volumes`. Surfaces the demand
 * (`total_google_volume` / `est_ai_volume`) and competition meter
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
  if (!auth.organizationId) return null;

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand) return null;

  const limit = Math.min(
    Math.max(params.limit ?? PROMPT_VOLUMES_DEFAULT_LIMIT, 1),
    PROMPT_VOLUMES_MAX_LIMIT,
  );

  // prompt_volumes → prompts (1:1) → prompt_sets, filtered to this brand via
  // the nested inner joins. Sorted by AI demand so the highest-opportunity
  // prompts come first.
  const { data, error } = await supabaseAdmin
    .from('prompt_volumes')
    .select(
      'prompt_id, intent, keywords, google_volumes, total_google_volume, est_ai_volume, ai_volume_multiplier, competition_index, competition, fetched_at, prompts!inner(text, prompt_sets!inner(brand_id))',
    )
    .eq('prompts.prompt_sets.brand_id', params.brandId)
    .order('est_ai_volume', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

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

  return rows.map((r) => {
    const prompt = Array.isArray(r.prompts) ? (r.prompts[0] ?? null) : r.prompts;
    return {
      prompt_id: r.prompt_id,
      prompt_text: prompt?.text ?? null,
      intent: r.intent,
      keywords: r.keywords ?? [],
      google_volumes: r.google_volumes ?? {},
      total_google_volume: Number(r.total_google_volume ?? 0),
      est_ai_volume: Number(r.est_ai_volume ?? 0),
      ai_volume_multiplier: Number(r.ai_volume_multiplier ?? 0),
      competition_index: r.competition_index,
      competition: r.competition,
      fetched_at: r.fetched_at,
    };
  });
}

// ── Shopping Cards ────────────────────────────────────────────────────────────

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

export async function listShoppingCards(
  auth: McpAuthContext,
  params: ListShoppingCardsParams,
): Promise<ListShoppingCardsOutput | null> {
  if (!auth.organizationId) return null;

  // Brand ownership check
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand) return null;

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
}

export async function getProductVisibility(
  auth: McpAuthContext,
  params: { brandId: string; productTitle: string },
): Promise<ProductVisibilityOutput | null> {
  if (!auth.organizationId) return null;

  // Brand ownership check
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (!brand) return null;

  const { data: cards, error } = await supabaseAdmin
    .from('prompt_result_shopping_cards')
    .select(
      'platform, region, created_at, price_amount, price_currency, rating, review_count, merchant_domain',
    )
    .eq('brand_id', params.brandId)
    .eq('product_title', params.productTitle)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  if (!cards || cards.length === 0) return null;

  const total_appearances = cards.length;

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
  };
}

// ── Prompt Performance ────────────────────────────────────────────────────────

export interface PromptPerformanceParams {
  brandId: string;
  dateFrom?: string;
  dateTo?: string;
  topicId?: string;
  sortBy?: 'visibility' | 'mentions' | 'citations' | 'appearances';
  order?: 'desc' | 'asc';
  limit?: number;
  model?: string;
  region?: string;
}

export interface PromptPerformanceOutput {
  brand: { id: string; name: string };
  window: { dateFrom: string | null; dateTo: string | null };
  prompts: Array<{
    prompt_id: string;
    prompt_text: string;
    topic_name: string | null;
    result_count: number;
    avg_visibility: number;
    total_mentions: number;
    total_citations: number;
    avg_competitor_score: number;
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
  if (!brand) return null;

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
    p_topic_id: params.topicId ?? null,
  });

  if (error) throw new Error(error.message);

  const raw = (data as unknown as PromptPerformanceRpcResult[]) ?? [];

  let prompts = raw.map((item) => {
    const result_count = Number(item.result_count);
    const avg_visibility =
      result_count > 0 ? Math.round(Number(item.sum_visibility) / result_count) : 0;
    const avg_competitor_score =
      Number(item.comp_count) > 0
        ? Math.round(Number(item.comp_sum_visibility) / Number(item.comp_count))
        : 0;

    return {
      prompt_id: item.prompt_id,
      prompt_text: item.prompt_text,
      topic_name: item.topic_name,
      result_count,
      avg_visibility,
      total_mentions: Number(item.total_mentions),
      total_citations: Number(item.total_citations),
      avg_competitor_score,
    };
  });

  // Sorting
  const sortBy = params.sortBy ?? 'visibility';
  const order = params.order ?? 'desc';
  const isAsc = order === 'asc';

  prompts.sort((a, b) => {
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

  // Limiting
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 100);
  prompts = prompts.slice(0, limit);

  return {
    brand: {
      id: brand.id,
      name: brand.name,
    },
    window: {
      dateFrom: params.dateFrom ?? null,
      dateTo: params.dateTo ?? null,
    },
    prompts,
  };
}
