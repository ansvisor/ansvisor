'use server';

import { dbClient } from '@/lib/supabase/scoped';
import { comparisonWindows } from '@/lib/insights-windows';
import type { BreakdownFilters, BreakdownMetric } from '@/lib/insights-breakdown';
import {
  answersCreatedAtBounds,
  answersPage,
  answersRange,
  emptyAnswersPage,
  mapAnswerRow,
  mentionedOnly,
  ANSWERS_PAGE_SIZE,
  type AnswerRow,
  type InsightsAnswersPage,
} from '@/lib/insights-answers';

/**
 * The answers behind an Insights card (the breakdown panel's Answers tab):
 * the prompt_results of the card's window and filters — model, region,
 * topic, the days or date range — newest first, 25 a page, with the total.
 * The same answers insights_breakdown_groups (00129) groups for the panel:
 * chatgpt-shopping stays out (#155).
 *
 * A read on the caller's own client, as getInsightsBreakdown: RLS scopes the
 * brand and its answers to the caller's organization, and a brand the caller
 * can't see reads as no answers.
 */
export async function getInsightsAnswers(
  brandId: string,
  metric: BreakdownMetric,
  filters?: BreakdownFilters,
  page = 1,
): Promise<InsightsAnswersPage> {
  const current = answersPage(page);
  const supabase = await dbClient();

  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select('id, name, brand_domains(domain)')
    .eq('id', brandId)
    .maybeSingle();
  if (brandError) throw new Error(brandError.message);
  if (!brand) return emptyAnswersPage(current);
  const b = brand as { name: string; brand_domains?: { domain?: string | null }[] | null };
  const terms = [b.name, ...(b.brand_domains ?? []).map((d) => d.domain ?? '')].filter(Boolean);

  const topicId = filters?.topicId || undefined;
  let query = supabase
    .from('prompt_results')
    .select(
      `id, prompt_id, platform, model_used, region, created_at, response, citations, mention_count, mention_position, citation_count, ${
        topicId ? 'prompts!inner(text, topic_id)' : 'prompts(text)'
      }`,
      { count: 'exact' },
    )
    .eq('brand_id', brandId)
    .neq('platform', 'chatgpt-shopping');

  const models = (filters?.model ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (models.length === 1) query = query.eq('model_used', models[0]);
  else if (models.length > 1) query = query.in('model_used', models);
  if (filters?.region) query = query.eq('region', filters.region);
  if (topicId) query = query.eq('prompts.topic_id', topicId);
  if (mentionedOnly(metric)) query = query.gt('mention_count', 0);

  const bounds = answersCreatedAtBounds(comparisonWindows(filters).cur);
  if (bounds.gte) query = query.gte('created_at', bounds.gte);
  if (bounds.lt) query = query.lt('created_at', bounds.lt);
  if (bounds.lte) query = query.lte('created_at', bounds.lte);

  const { from, to } = answersRange(current);
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as AnswerRow[];
  return {
    answers: rows.map((row) => mapAnswerRow(row, terms)),
    total: count ?? rows.length,
    page: current,
    pageSize: ANSWERS_PAGE_SIZE,
  };
}
