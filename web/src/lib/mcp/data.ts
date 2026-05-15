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
