'use server';

import { createClient } from '@/lib/supabase/server';
import { computeAiVisibilityScore } from '@/lib/visibility-score';
import type { Topic } from '@/types';

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

export async function getPromptCountByTopic(brandId: string, topicId: string): Promise<number> {
  const supabase = await createClient();

  const { data: sets } = await supabase.from('prompt_sets').select('id').eq('brand_id', brandId);

  if (!sets || sets.length === 0) return 0;

  const setIds = sets.map((s) => s.id as string);
  const { count, error } = await supabase
    .from('prompts')
    .select('id', { count: 'exact', head: true })
    .in('prompt_set_id', setIds)
    .eq('topic_id', topicId);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

// ─── Topic Analytics ────────────────────────────────────────────────────────

export interface TopicOverviewRow {
  id: string;
  name: string;
  promptCount: number;
  /** % of the topic's prompts with results where the brand appeared at least once (#490 semantics). */
  visibilityRate: number;
  /** Distinct prompts with ≥1 mention/citation in the window (rate numerator). */
  visiblePrompts: number;
  /** Distinct prompts that produced results in the window (rate denominator). */
  activePrompts: number;
  /** Rate difference in points: (current 7d) − (previous 7d). */
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
 * Looks at last 30 days of prompt_results and derives visibility rate,
 * mentions, citations, SoV, top competitor and a short sparkline per topic.
 * Visibility uses the prompt-level rate from #490 (prompts appeared in ÷
 * prompts with results), NOT the raw score average — the Topics page must
 * read on the same scale as the Insights headline (#493). Change is
 * (current 7d rate) − (previous 7d rate) in points. Like every analytical
 * surface, chatgpt-shopping rows are excluded (#155) — totals here must
 * agree with the Insights KPIs on the same 30d window (#464).
 */
/**
 * The roster read still pages: PostgREST silently caps an un-paginated select
 * at 1000 rows, and a brand can hold more prompts than that (#464).
 *
 * The result window no longer has a ceiling. It used to stop at 50,000 rows —
 * the largest brand was already at 32,607, and crossing it would have
 * truncated the scan silently, understating every figure on the page (#721).
 * Aggregating in Postgres removes the cliff rather than raising it.
 */
const TOPIC_RESULTS_PAGE_SIZE = 1000;
const TOPIC_PROMPTS_MAX_ROWS = 10_000;

export async function getTopicsOverview(brandId: string): Promise<TopicOverviewSummary> {
  const supabase = await createClient();

  // Only the sparkline's day keys are built here now; every window boundary
  // is resolved inside the aggregate, from the database's clock.
  const now = Date.now();

  const [topicsRes, setsRes] = await Promise.all([
    supabase
      .from('topics')
      .select('id, name, created_at')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
    supabase.from('prompt_sets').select('id').eq('brand_id', brandId),
  ]);

  if (topicsRes.error) throw new Error(topicsRes.error.message);
  if (setsRes.error) throw new Error(setsRes.error.message);

  const topics = (topicsRes.data ?? []) as {
    id: string;
    name: string;
    created_at: string;
  }[];
  const brandSetIds = ((setsRes.data ?? []) as { id: string }[]).map((s) => s.id);

  // Brand-scoped at the DB level (the old version fetched every org prompt and
  // filtered client-side — the same silent-1000-cap trap for large orgs).
  const prompts: { id: string; topic_id: string | null }[] = [];
  if (brandSetIds.length > 0) {
    for (let from = 0; from < TOPIC_PROMPTS_MAX_ROWS; from += TOPIC_RESULTS_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('prompts')
        .select('id, topic_id')
        .in('prompt_set_id', brandSetIds)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + TOPIC_RESULTS_PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as { id: string; topic_id: string | null }[];
      prompts.push(...batch);
      if (batch.length < TOPIC_RESULTS_PAGE_SIZE) break;
    }
  }

  let unassignedPromptCount = 0;
  const promptCountByTopic = new Map<string, number>();
  for (const p of prompts) {
    if (!p.topic_id) {
      unassignedPromptCount += 1;
      continue;
    }
    promptCountByTopic.set(p.topic_id, (promptCountByTopic.get(p.topic_id) ?? 0) + 1);
  }

  // One aggregate per brand instead of downloading the window (#721). The page
  // used to page through every result row — 33 requests and 73 MB on the
  // largest brand — to compute twenty table rows in JavaScript. The arithmetic
  // now runs where the data is; only the AI Visibility Score stays here, over
  // ~20 rows, so this page and the Insights headline keep one implementation.
  const { data: aggRows, error: aggError } = await supabase.rpc('topics_overview_aggregates', {
    p_brand_id: brandId,
  });
  if (aggError) throw new Error(aggError.message);

  interface TopicAggRow {
    topic_id: string;
    answers: number;
    mention_answers: number;
    citation_answers: number;
    pos_sum: number;
    pos_n: number;
    cur_answers: number;
    cur_mention_answers: number;
    cur_citation_answers: number;
    cur_pos_sum: number;
    cur_pos_n: number;
    prev_answers: number;
    prev_mention_answers: number;
    prev_citation_answers: number;
    prev_pos_sum: number;
    prev_pos_n: number;
    total_mentions: number;
    total_citations: number;
    comp_mentions: number;
    active_prompts: number;
    visible_prompts: number;
    last_run_at: string | null;
    competitors: Record<string, { name: string; sov: number }>;
    daily: Record<string, { visible: number; count: number }>;
  }

  const aggByTopic = new Map<string, TopicAggRow>(
    ((aggRows ?? []) as unknown as TopicAggRow[]).map((row) => [row.topic_id, row]),
  );

  const scoreOf = (
    answers: number,
    mention: number,
    citation: number,
    posSum: number,
    posN: number,
  ) =>
    computeAiVisibilityScore({
      answers,
      mentionAnswers: mention,
      citationAnswers: citation,
      positionFactor: posN > 0 ? posSum / posN : null,
    }) ?? 0;

  const rows: TopicOverviewRow[] = topics.map((t) => {
    const agg = aggByTopic.get(t.id);
    const promptCount = promptCountByTopic.get(t.id) ?? 0;

    if (!agg) {
      // A topic with prompts but no answers in the window still belongs in the
      // table — dropping it would make the roster disagree with itself.
      return {
        id: t.id,
        name: t.name,
        promptCount,
        visibilityRate: 0,
        visiblePrompts: 0,
        activePrompts: 0,
        visibilityChange: null,
        totalMentions: 0,
        totalCitations: 0,
        shareOfVoice: 0,
        topCompetitor: null,
        lastRunAt: null,
        trendSparkline: Array.from({ length: 14 }, () => 0),
      };
    }

    // Visibility Rate IS the AI Visibility Score over the topic's answers —
    // same blend as the Insights headline (see lib/visibility-score).
    const visibilityRate = scoreOf(
      agg.answers,
      agg.mention_answers,
      agg.citation_answers,
      agg.pos_sum,
      agg.pos_n,
    );
    const change =
      agg.cur_answers > 0 && agg.prev_answers > 0
        ? Math.round(
            (scoreOf(
              agg.cur_answers,
              agg.cur_mention_answers,
              agg.cur_citation_answers,
              agg.cur_pos_sum,
              agg.cur_pos_n,
            ) -
              scoreOf(
                agg.prev_answers,
                agg.prev_mention_answers,
                agg.prev_citation_answers,
                agg.prev_pos_sum,
                agg.prev_pos_n,
              )) *
              10,
          ) / 10
        : null;

    // The brand's own mentions are the same total the table shows.
    const totalForSov = agg.total_mentions + agg.comp_mentions;
    const shareOfVoice =
      totalForSov > 0 ? Math.round((agg.total_mentions / totalForSov) * 1000) / 10 : 0;

    let topCompetitor: TopicOverviewRow['topCompetitor'] = null;
    if (totalForSov > 0) {
      let best: { name: string; sov: number } | null = null;
      for (const c of Object.values(agg.competitors ?? {})) {
        const pct = Math.round((c.sov / totalForSov) * 1000) / 10;
        if (!best || pct > best.sov) best = { name: c.name, sov: pct };
      }
      topCompetitor = best;
    }

    // Daily visible-answer share (result-level) — a trend proxy for the
    // headline rate; sparklines have no axis, only shape matters.
    const sparklineDays: number[] = [];
    for (let i = 13; i >= 0; i--) {
      const key = new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const bucket = agg.daily?.[key];
      sparklineDays.push(
        bucket && bucket.count > 0 ? Math.round((bucket.visible / bucket.count) * 100) : 0,
      );
    }

    return {
      id: t.id,
      name: t.name,
      promptCount,
      visibilityRate,
      visiblePrompts: agg.visible_prompts,
      activePrompts: agg.active_prompts,
      visibilityChange: change,
      totalMentions: agg.total_mentions,
      totalCitations: agg.total_citations,
      shareOfVoice,
      topCompetitor,
      lastRunAt: agg.last_run_at,
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
