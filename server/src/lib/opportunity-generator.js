/**
 * Content opportunity generation, per prompt cluster (#857).
 *
 * Shared by the nightly run after each tracking cycle and the queued job
 * behind the Generate button. Each run takes the highest-scoring clusters
 * that have no opportunity yet and asks the model to write one opportunity
 * per cluster. A cluster that needs the same content as an existing
 * opportunity in another topic is merged into it instead.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from './ai-provider.js';
import { getLanguageName } from './languages.js';
import supabaseAdmin from '../config/supabase.js';
import { selectInChunks } from './chunked-in.js';
import { logger } from './logger.js';
import {
  OPPORTUNITY_WINDOW_DAYS,
  clusterMetrics,
  coveredClusterIds,
  opportunityScore,
  pickClusters,
  scoreComponents,
} from './opportunity-limits.js';
import { loadClusterOpportunities } from './open-opportunities.js';
import { loadClusters } from './prompt-clusters.js';

/** Existing opportunities shown to the model for the cross-topic check. */
const EXISTING_SHOWN = 60;
/** Included fan-out queries kept on an opportunity, most searched first. */
const QUERIES_KEPT = 15;
const PROMPTS_SHOWN = 12;

const SYSTEM_PROMPT = `You are an AEO content strategist. Each cluster below is a group of prompts that one piece of content can answer. Write one content opportunity per cluster.

Rules:
- One opportunity per cluster, for the content that answers all of its prompts. Name the need, not a single prompt.
- Be concrete and actionable, and reference the data: volume, visibility, the strongest competitor's visibility, competitors.
- Categorize as "owned" (content the brand controls) or "earned" (third-party content, PR, reviews).
- Existing opportunities from other topics are listed. If a cluster needs the same content as one of them — the same user need and the same piece of content — set sameAs to its bracketed E index. Otherwise set sameAs to null. Sharing words or a topic is not enough.
- Write for the brand's marketing team: do not use the words "cluster" or "prompt" in titles or descriptions.
- Refer to clusters and existing opportunities only through clusterIndex and sameAs. Never mention a bracketed index in a title or description.`;

function buildSchema(count) {
  return z.object({
    opportunities: z
      .array(
        z.object({
          clusterIndex: z.number().describe('The bracketed index of the cluster'),
          sameAs: z
            .number()
            .nullable()
            .describe('The E index of an existing opportunity needing the same content, or null'),
          title: z.string().describe('A specific, actionable content recommendation'),
          description: z
            .string()
            .describe('1-2 sentences on why it matters, referencing the metrics'),
          type: z.enum(['owned', 'earned']),
          impact: z.enum(['high', 'medium', 'low']),
        }),
      )
      .max(count),
  });
}

/** Everything the opportunity carries about its cluster(s), for the detail page and the brief. */
function sourceData({ clusters, topicName, metrics, components, queries }) {
  const [primary, ...related] = clusters;
  return {
    promptText: metrics.representative?.text,
    clusterLabel: primary.label,
    topicName: topicName(primary),
    relatedTopics: related.map(topicName),
    prompts: clusters.flatMap((c) => c.promptTexts),
    estAiVolume: metrics.demand,
    visibilityScore: metrics.visibility,
    topCompetitorVisibility: metrics.topCompetitorVisibility,
    competitorGap: metrics.competitorGap,
    intent: metrics.intent,
    keywords: metrics.keywords,
    competitorsCited: metrics.competitorsCited,
    queries,
    scoreComponents: components,
    windowDays: OPPORTUNITY_WINDOW_DAYS,
  };
}

/** Included/excluded counts and the most searched included queries across clusters. */
function basketSummary(clusterIds, basketRows) {
  const rows = basketRows.filter((r) => clusterIds.includes(r.cluster_id));
  const times = new Map();
  for (const r of rows)
    if (r.included) times.set(r.query, (times.get(r.query) || 0) + r.times_searched);
  return {
    included: new Set(rows.filter((r) => r.included).map((r) => r.query)).size,
    excluded: new Set(rows.filter((r) => !r.included).map((r) => r.query)).size,
    top: [...times]
      .sort((a, b) => b[1] - a[1])
      .slice(0, QUERIES_KEPT)
      .map(([query, timesSearched]) => ({ query, timesSearched })),
  };
}

async function loadPromptTexts(promptIds) {
  const { data, error } = await selectInChunks(promptIds, (chunk) =>
    supabaseAdmin.from('prompts').select('id, text').in('id', chunk),
  );
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * @param {string} brandId
 * @param {{ model?: string, onProgress?: (p: {phase: string, message: string}) => void }} [opts]
 * @returns {Promise<{ generated: number, merged: number }>}
 */
export async function generateContentOpportunities(brandId, { model, onProgress } = {}) {
  onProgress?.({ phase: 'collecting_data', message: 'Fetching clusters and metrics...' });

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id, name, industry, language')
    .eq('id', brandId)
    .single();
  if (!brand) return { generated: 0, merged: 0 };

  const clusters = await loadClusters(brandId);
  if (!clusters.length) return { generated: 0, merged: 0 };

  const since = new Date(Date.now() - OPPORTUNITY_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const memberIds = clusters.flatMap((c) => c.prompt_ids);
  const [prompts, volumes, metricsRes, topicsRes, domainsRes, existing] = await Promise.all([
    loadPromptTexts(memberIds),
    selectInChunks(memberIds, (chunk) =>
      supabaseAdmin
        .from('prompt_volumes')
        .select('prompt_id, est_ai_volume, intent, keywords')
        .in('prompt_id', chunk),
    ),
    supabaseAdmin.rpc('brand_prompt_opportunity_metrics', { p_brand_id: brandId, p_since: since }),
    supabaseAdmin.from('topics').select('id, name').eq('brand_id', brandId),
    supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', brandId),
    loadClusterOpportunities(brandId),
  ]);
  if (volumes.error) throw new Error(volumes.error.message);
  if (metricsRes.error) throw new Error(metricsRes.error.message);

  const byPrompt = new Map(prompts.map((p) => [p.id, { text: p.text }]));
  for (const v of volumes.data || []) {
    if (byPrompt.has(v.prompt_id)) byPrompt.get(v.prompt_id).volume = v;
  }
  for (const m of metricsRes.data || []) {
    if (byPrompt.has(m.prompt_id)) byPrompt.get(m.prompt_id).metrics = m;
  }

  const topicNames = new Map((topicsRes.data || []).map((t) => [t.id, t.name]));
  const topicName = (c) => (c.topic_id ? topicNames.get(c.topic_id) || null : null);
  const clusterById = new Map(
    clusters.map((c) => [
      c.id,
      {
        ...c,
        promptTexts: c.prompt_ids.map((id) => byPrompt.get(id)?.text).filter(Boolean),
      },
    ]),
  );

  const measure = (clusterIds) => {
    const metrics = clusterMetrics(
      clusterIds.flatMap((id) => clusterById.get(id)?.prompt_ids || []),
      byPrompt,
    );
    const components = scoreComponents(metrics);
    return { metrics, components, score: opportunityScore(components) };
  };

  const candidates = clusters.map((c) => ({ id: c.id, topicId: c.topic_id, ...measure([c.id]) }));
  const picked = pickClusters(candidates, coveredClusterIds(existing));
  if (!picked.length) {
    logger.info(
      { brandId, clusters: clusters.length, opportunities: existing.length },
      '[opportunities] every cluster with answers already has an opportunity',
    );
    return { generated: 0, merged: 0 };
  }

  const { data: basketRows, error: basketErr } = await supabaseAdmin
    .from('prompt_cluster_queries')
    .select('cluster_id, query, times_searched, included')
    .in(
      'cluster_id',
      picked.map((c) => c.id),
    );
  if (basketErr) throw new Error(basketErr.message);

  const shown = existing
    .filter((o) => o.status !== 'dismissed' && clusterById.has(o.cluster_id))
    .sort((a, b) => b.opportunity_score - a.opportunity_score)
    .slice(0, EXISTING_SHOWN);

  const clusterLine = (cand, i) => {
    const c = clusterById.get(cand.id);
    const m = cand.metrics;
    const basket = basketSummary([c.id], basketRows || []);
    return `[${i}] ${c.label} (topic: ${topicName(c) || 'none'})
Need: ${c.primary_intent}
Prompts:
${c.promptTexts
  .slice(0, PROMPTS_SHOWN)
  .map((t) => `- ${t}`)
  .join('\n')}
Searches AI engines ran for these prompts: ${basket.top.map((q) => q.query).join('; ') || 'none recorded'}
Est. AI volume: ${m.demand}/mo | Brand visibility: ${m.visibility}% | Strongest competitor: ${m.topCompetitorVisibility}% | Competitors visible: ${m.competitorsCited.join(', ') || 'none'}`;
  };

  const userPrompt = `Brand: ${brand.name}
Industry: ${brand.industry || 'Not specified'}
Domain: ${(domainsRes.data || []).map((d) => d.domain).join(', ') || 'N/A'}

Clusters (highest opportunity first):
${picked.map(clusterLine).join('\n\n')}

Existing opportunities in other topics:
${shown.map((o, i) => `[E${i}] ${o.title} (topic: ${topicName(clusterById.get(o.cluster_id)) || 'none'})`).join('\n') || 'none'}

Write every title and description in ${getLanguageName(brand.language)}.`;

  onProgress?.({ phase: 'analyzing', message: 'Generating opportunities with AI...' });
  const { object } = await generateObject({
    model: resolveModel(model),
    schema: buildSchema(picked.length),
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
  });

  onProgress?.({ phase: 'saving', message: 'Saving opportunities...' });
  const done = new Set();
  const inserts = [];
  let merged = 0;

  for (const opp of object.opportunities) {
    const cand = picked[opp.clusterIndex];
    if (!Number.isInteger(opp.clusterIndex) || !cand || done.has(cand.id)) continue;
    done.add(cand.id);

    const target = Number.isInteger(opp.sameAs) ? shown[opp.sameAs] : null;
    if (target) {
      // Related clusters deleted by a re-clustering since are dropped here.
      const ids = [target.cluster_id, ...(target.related_cluster_ids || []), cand.id].filter((id) =>
        clusterById.has(id),
      );
      const { metrics, components, score } = measure(ids);
      const { error } = await supabaseAdmin
        .from('content_opportunities')
        .update({
          related_cluster_ids: ids.slice(1),
          opportunity_score: score,
          source_data: sourceData({
            clusters: ids.map((id) => clusterById.get(id)),
            topicName,
            metrics,
            components,
            queries: basketSummary(ids, basketRows || []),
          }),
          updated_at: new Date().toISOString(),
        })
        .eq('id', target.id);
      if (error) throw new Error(error.message);
      // A later cluster in this run may name the same target.
      target.related_cluster_ids = ids.slice(1);
      merged += 1;
      continue;
    }

    const c = clusterById.get(cand.id);
    inserts.push({
      brand_id: brandId,
      cluster_id: c.id,
      prompt_id: cand.metrics.representative?.id ?? null,
      title: opp.title,
      description: opp.description,
      type: opp.type,
      impact: opp.impact,
      opportunity_score: cand.score,
      status: 'new',
      source_data: sourceData({
        clusters: [c],
        topicName,
        metrics: cand.metrics,
        components: cand.components,
        queries: basketSummary([c.id], basketRows || []),
      }),
    });
  }

  if (inserts.length) {
    const { error } = await supabaseAdmin.from('content_opportunities').insert(inserts);
    if (error) throw new Error(error.message);
  }
  logger.info(
    { brandId, generated: inserts.length, merged, clusters: clusters.length },
    '[opportunities] generated',
  );
  return { generated: inserts.length, merged };
}
