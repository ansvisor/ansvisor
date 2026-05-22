import { supabaseAdmin } from '@/lib/supabase/admin';
import type { McpAuthContext } from '@/lib/mcp-auth';

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

export async function listBrandsFor(
  auth: McpAuthContext,
): Promise<BrandRow[]> {
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

  let query = supabaseAdmin
    .from('prompt_results')
    .select(
      'visibility_score, mention_count, citation_count, sentiment, model_used, competitor_mentions',
    )
    .eq('brand_id', params.brandId);

  if (params.dateFrom) query = query.gte('created_at', params.dateFrom);
  if (params.dateTo) query = query.lte('created_at', params.dateTo);
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
      avgVisibility:
        Math.round((agg.visSum / Math.max(agg.mentions, 1)) * 10) / 10,
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

  const promptRows =
    (prompts as Array<{ topic_id: string | null }> | null) ?? [];
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
    const topic = Array.isArray(r.topics) ? r.topics[0] ?? null : r.topics;
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
      brief: any | null;
      prompts: Array<{ text: string }> | { text: string } | null;
    }> | null) ?? [];

  return rows.map((r) => {
    const prompt = Array.isArray(r.prompts) ? r.prompts[0] ?? null : r.prompts;
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
  source_data: Record<string, any> | null;
  brief: Record<string, any> | null;
  created_at: string;
  updated_at: string;
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
    source_data: any | null;
    brief: any | null;
    prompts: Array<{ text: string }> | { text: string } | null;
  };

  const prompt = Array.isArray(r.prompts) ? r.prompts[0] ?? null : r.prompts;

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
