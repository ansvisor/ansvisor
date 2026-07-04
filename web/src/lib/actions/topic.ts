'use server';

import { createClient } from '@/lib/supabase/server';
import type { CompetitorMention, Topic } from '@/types';

function mapTopicRow(row: Record<string, unknown>): Topic {
  return {
    id: row.id as string,
    brandId: row.brand_id as string,
    name: row.name as string,
    isActive: row.is_active as boolean,
    createdAt: row.created_at as string,
  };
}

export async function createTopics(brandId: string, names: string[]): Promise<Topic[]> {
  const supabase = await createClient();

  // Remove existing topics for this brand to avoid duplicates
  // (e.g. user navigated back and re-submitted)
  await supabase.from('topics').delete().eq('brand_id', brandId);

  const rows = names.map((name) => ({
    brand_id: brandId,
    name: name.trim(),
  }));

  const { data, error } = await supabase.from('topics').insert(rows).select();

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapTopicRow(r as Record<string, unknown>));
}

export async function getTopics(brandId: string): Promise<Topic[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('topics')
    .select('*')
    .eq('brand_id', brandId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapTopicRow(r as Record<string, unknown>));
}

/**
 * Fetch a single active topic by id, scoped to the brand. Returns null when the
 * topic doesn't exist, isn't this brand's, or is inactive — the detail page
 * renders "not found". The `is_active = true` filter mirrors getTopics(), which
 * the page used before (via .find() over the active list), so inactive topics
 * stay hidden. Cheaper than fetching the whole list just to read one name.
 */
export async function getTopicById(brandId: string, topicId: string): Promise<Topic | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('topics')
    .select('id, brand_id, name, is_active, created_at')
    .eq('brand_id', brandId)
    .eq('id', topicId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapTopicRow(data as Record<string, unknown>) : null;
}

export async function createTopic(brandId: string, name: string): Promise<Topic> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('topics')
    .insert({ brand_id: brandId, name: name.trim() })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapTopicRow(data as Record<string, unknown>);
}

export async function updateTopic(topicId: string, name: string): Promise<Topic> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('topics')
    .update({ name: name.trim() })
    .eq('id', topicId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapTopicRow(data as Record<string, unknown>);
}

export async function getPromptCountByTopic(brandId: string, topicName: string): Promise<number> {
  const supabase = await createClient();

  const { data: sets } = await supabase.from('prompt_sets').select('id').eq('brand_id', brandId);

  if (!sets || sets.length === 0) return 0;

  const setIds = sets.map((s) => s.id as string);
  const { count, error } = await supabase
    .from('prompts')
    .select('id', { count: 'exact', head: true })
    .in('prompt_set_id', setIds)
    .eq('category', topicName);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

// ─── Topic Analytics ────────────────────────────────────────────────────────

export interface TopicOverviewRow {
  id: string;
  name: string;
  promptCount: number;
  avgVisibilityScore: number;
  visibilityChange: number | null;
  totalMentions: number;
  totalCitations: number;
  shareOfVoice: number;
  topCompetitor: { name: string; sov: number } | null;
  lastRunAt: string | null;
  trendSparkline: number[];
}

export interface TopicOverviewSummary {
  topics: TopicOverviewRow[];
  unassignedPromptCount: number;
}

/**
 * Aggregate per-topic analytics for a brand.
 * Looks at last 30 days of prompt_results and derives visibility, mentions,
 * citations, SoV, top competitor and a short sparkline per topic.
 * Change is computed as (current 7d avg) - (previous 7d avg) to mirror
 * the logic used by Insights KPI cards.
 */
export async function getTopicsOverview(brandId: string): Promise<TopicOverviewSummary> {
  const supabase = await createClient();

  const now = Date.now();
  const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const curFrom = new Date(now - 7 * 24 * 60 * 60 * 1000).getTime();
  const prevFrom = new Date(now - 14 * 24 * 60 * 60 * 1000).getTime();

  const [topicsRes, promptsRes, resultsRes] = await Promise.all([
    supabase
      .from('topics')
      .select('id, name, created_at')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
    supabase.from('prompts').select('id, topic_id, prompt_set_id').eq('is_active', true),
    supabase
      .from('prompt_results')
      .select(
        'prompt_id, created_at, visibility_score, mention_count, citation_count, competitor_mentions',
      )
      .eq('brand_id', brandId)
      .gte('created_at', since30d),
  ]);

  if (topicsRes.error) throw new Error(topicsRes.error.message);
  if (promptsRes.error) throw new Error(promptsRes.error.message);
  if (resultsRes.error) throw new Error(resultsRes.error.message);

  const topics = (topicsRes.data ?? []) as {
    id: string;
    name: string;
    created_at: string;
  }[];
  const allPrompts = (promptsRes.data ?? []) as unknown as {
    id: string;
    topic_id: string | null;
    prompt_set_id: string;
  }[];
  const results = (resultsRes.data ?? []) as Record<string, unknown>[];

  // Restrict prompts to those owned by this brand's prompt_sets
  const { data: brandSets } = await supabase
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);
  const brandSetIds = new Set(((brandSets ?? []) as { id: string }[]).map((s) => s.id));
  const prompts = allPrompts.filter((p) => brandSetIds.has(p.prompt_set_id));

  const promptTopicMap = new Map<string, string | null>();
  for (const p of prompts) promptTopicMap.set(p.id, p.topic_id);

  interface Agg {
    curScoreSum: number;
    curCount: number;
    prevScoreSum: number;
    prevCount: number;
    allScoreSum: number;
    allCount: number;
    totalMentions: number;
    totalCitations: number;
    brandMentions: number;
    compMentions: number;
    lastRunAt: number;
    competitors: Map<string, { name: string; sov: number }>;
    daily: Map<string, { sum: number; count: number }>;
  }
  const emptyAgg = (): Agg => ({
    curScoreSum: 0,
    curCount: 0,
    prevScoreSum: 0,
    prevCount: 0,
    allScoreSum: 0,
    allCount: 0,
    totalMentions: 0,
    totalCitations: 0,
    brandMentions: 0,
    compMentions: 0,
    lastRunAt: 0,
    competitors: new Map(),
    daily: new Map(),
  });

  const aggByTopic = new Map<string, Agg>();
  let unassignedPromptCount = 0;
  for (const p of prompts) {
    if (!p.topic_id) {
      unassignedPromptCount += 1;
      continue;
    }
    if (!aggByTopic.has(p.topic_id)) aggByTopic.set(p.topic_id, emptyAgg());
  }

  const promptCountByTopic = new Map<string, number>();
  for (const p of prompts) {
    if (!p.topic_id) continue;
    promptCountByTopic.set(p.topic_id, (promptCountByTopic.get(p.topic_id) ?? 0) + 1);
  }

  for (const row of results) {
    const promptId = row.prompt_id as string;
    const topicId = promptTopicMap.get(promptId);
    if (!topicId) continue;

    const agg = aggByTopic.get(topicId);
    if (!agg) continue;

    const createdAt = row.created_at as string;
    const ts = new Date(createdAt).getTime();
    const score = (row.visibility_score as number) ?? 0;
    const mentions = (row.mention_count as number) ?? 0;
    const citations = (row.citation_count as number) ?? 0;

    agg.allScoreSum += score;
    agg.allCount += 1;
    agg.totalMentions += mentions;
    agg.totalCitations += citations;
    agg.brandMentions += mentions;
    if (ts > agg.lastRunAt) agg.lastRunAt = ts;

    if (ts >= curFrom) {
      agg.curScoreSum += score;
      agg.curCount += 1;
    } else if (ts >= prevFrom) {
      agg.prevScoreSum += score;
      agg.prevCount += 1;
    }

    const day = createdAt.slice(0, 10);
    const d = agg.daily.get(day) ?? { sum: 0, count: 0 };
    d.sum += score;
    d.count += 1;
    agg.daily.set(day, d);

    const compMentions = (row.competitor_mentions as CompetitorMention[] | null) ?? [];
    const compTotalsForRow = new Map<string, { name: string; mentions: number }>();
    for (const cm of compMentions) {
      agg.compMentions += cm.mention_count;
      const existing = compTotalsForRow.get(cm.competitor_id) ?? {
        name: cm.name,
        mentions: 0,
      };
      existing.mentions += cm.mention_count;
      compTotalsForRow.set(cm.competitor_id, existing);
    }
    for (const [compId, info] of compTotalsForRow) {
      const ec = agg.competitors.get(compId) ?? { name: info.name, sov: 0 };
      ec.sov += info.mentions;
      agg.competitors.set(compId, ec);
    }
  }

  const rows: TopicOverviewRow[] = topics.map((t) => {
    const agg = aggByTopic.get(t.id) ?? emptyAgg();
    const promptCount = promptCountByTopic.get(t.id) ?? 0;

    const avg = agg.allCount > 0 ? Math.round(agg.allScoreSum / agg.allCount) : 0;
    const change =
      agg.curCount > 0 && agg.prevCount > 0
        ? Math.round((agg.curScoreSum / agg.curCount - agg.prevScoreSum / agg.prevCount) * 10) / 10
        : null;

    const totalForSov = agg.brandMentions + agg.compMentions;
    const shareOfVoice =
      totalForSov > 0 ? Math.round((agg.brandMentions / totalForSov) * 1000) / 10 : 0;

    let topCompetitor: TopicOverviewRow['topCompetitor'] = null;
    if (totalForSov > 0 && agg.competitors.size > 0) {
      let best: { name: string; sov: number } | null = null;
      for (const c of agg.competitors.values()) {
        const pct = Math.round((c.sov / totalForSov) * 1000) / 10;
        if (!best || pct > best.sov) best = { name: c.name, sov: pct };
      }
      topCompetitor = best;
    }

    const sparklineDays: number[] = [];
    const todayMs = now;
    for (let i = 13; i >= 0; i--) {
      const d = new Date(todayMs - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      const bucket = agg.daily.get(key);
      sparklineDays.push(bucket && bucket.count > 0 ? Math.round(bucket.sum / bucket.count) : 0);
    }

    return {
      id: t.id,
      name: t.name,
      promptCount,
      avgVisibilityScore: avg,
      visibilityChange: change,
      totalMentions: agg.totalMentions,
      totalCitations: agg.totalCitations,
      shareOfVoice,
      topCompetitor,
      lastRunAt: agg.lastRunAt > 0 ? new Date(agg.lastRunAt).toISOString() : null,
      trendSparkline: sparklineDays,
    };
  });

  return { topics: rows, unassignedPromptCount };
}

export async function deleteTopic(topicId: string): Promise<void> {
  const supabase = await createClient();

  // Fetch topic to get name and brand_id
  const { data: topic, error: fetchErr } = await supabase
    .from('topics')
    .select('name, brand_id')
    .eq('id', topicId)
    .single();

  if (fetchErr) throw new Error(fetchErr.message);

  // Clear category on prompts that belong to this brand and use this topic name
  const { data: sets } = await supabase
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', topic.brand_id as string);

  if (sets && sets.length > 0) {
    const setIds = sets.map((s) => s.id as string);
    await supabase
      .from('prompts')
      .update({ category: null })
      .in('prompt_set_id', setIds)
      .eq('category', topic.name as string);
  }

  // Delete the topic
  const { error } = await supabase.from('topics').delete().eq('id', topicId);
  if (error) throw new Error(error.message);
}
