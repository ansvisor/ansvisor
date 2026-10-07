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
import { reopenStrengthened } from './opportunity-reopen.js';
import {
  ASSET_TYPES,
  DECISIONS,
  MAX_SUPPORTING_ASSETS,
  buildAssets,
  candidatePages,
} from './page-matching.js';

/** Existing opportunities shown to the model for the cross-topic check. */
const EXISTING_SHOWN = 60;
/**
 * Clusters an opportunity may absorb from other topics. Past this it stops
 * being offered as a merge target: one opportunity that keeps absorbing
 * neighbouring needs turns into a catch-all no single page can answer.
 */
export const MAX_MERGED_CLUSTERS = 3;
/** Included fan-out queries kept on an opportunity, most searched first. */
const QUERIES_KEPT = 15;
const PROMPTS_SHOWN = 12;

const SYSTEM_PROMPT = `You are an AEO content strategist. Each cluster below is a group of prompts that one piece of content can answer. Write one content opportunity per cluster.

Rules:
- One opportunity per cluster, for the content that answers all of its prompts. Name the need, not a single prompt.
- Be concrete and actionable, and reference the data: volume, visibility, the strongest competitor's visibility, competitors.
- Categorize as "owned" (content the brand controls) or "earned" (third-party content, PR, reviews).
- Existing opportunities from other topics are listed. If a cluster needs the same content as one of them — the same user need and the same piece of content, answering the cluster's prompts without becoming a different page — set sameAs to its bracketed E index. Otherwise set sameAs to null. Sharing words, a topic or a product category is not enough.
- Decide what the content is, given the brand's pages listed under each cluster:
  - create: no listed page answers this need. Write a new page.
  - optimize: a listed page already targets this need. Make it the answer AI engines pick: structure, evidence, direct answers, FAQ.
  - expand: a listed page covers part of the need. Add the angles it misses.
  - refresh: a listed page covers the need but is out of date (old year, old last-modified date, stale facts).
  - consolidate: two or more listed pages are each mainly about this same need, close to duplicates, and split its signals. Merge them into one. Pages of different kinds (a head-to-head comparison and a general list, a glossary entry and a guide) are not duplicates: pick the page closest to the need and expand or optimize it instead.
  - defend: the brand is already visible for this need and a listed page answers it. Keep it ahead of competitors.
  Set pageIndexes to the bracketed P indexes of the pages the decision is about, and leave it empty for create. The title should say what to do with which page, for example "Expand the AI rank tracker comparison with Google AI Overviews coverage".
- The opportunity is the primary asset above. Set assetType to what that content is.
- Add supporting assets only when the data calls for them, up to ${MAX_SUPPORTING_ASSETS}, each a different piece of work. For example: a comparison page when people compare named products; a glossary or FAQ page for a definition the main content relies on; an earned third-party article when competitors are visible and the brand is not; a backlink when the brand's page exists but is not cited. Give each a short title saying what to make or do. Most opportunities need none or one.
- Earned assets (third_party_article, backlink) live on other sites: set their channel to "earned", decision to "create" and pageIndexes to empty.
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
          decision: z.enum(DECISIONS),
          pageIndexes: z
            .array(z.number())
            .describe('The P indexes of the existing pages the decision is about'),
          assetType: z.enum(ASSET_TYPES).describe('What the primary content is'),
          supportingAssets: z
            .array(
              z.object({
                type: z.enum(ASSET_TYPES),
                channel: z.enum(['owned', 'earned']),
                decision: z.enum(DECISIONS),
                pageIndexes: z.array(z.number()),
                title: z.string().describe('What to make or do, in a few words'),
              }),
            )
            .describe('Further assets the data calls for; often empty'),
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
 * @returns {Promise<{ generated: number, merged: number, reopened?: number }>}
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
  const [prompts, volumes, metricsRes, topicsRes, domainsRes, existing, pagesRes] =
    await Promise.all([
      loadPromptTexts(memberIds),
      selectInChunks(memberIds, (chunk) =>
        supabaseAdmin
          .from('prompt_volumes')
          .select('prompt_id, est_ai_volume, intent, keywords')
          .in('prompt_id', chunk),
      ),
      supabaseAdmin.rpc('brand_prompt_opportunity_metrics', {
        p_brand_id: brandId,
        p_since: since,
      }),
      supabaseAdmin.from('topics').select('id, name').eq('brand_id', brandId),
      supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', brandId),
      loadClusterOpportunities(brandId),
      // Pages that answered when last read; a 404 is not a page to work on.
      supabaseAdmin
        .from('site_pages')
        .select('url, title, h1, description, lastmod, ai_citations, ga_sessions')
        .eq('brand_id', brandId)
        .eq('fetch_status', 200),
    ]);
  if (volumes.error) throw new Error(volumes.error.message);
  if (pagesRes.error) throw new Error(pagesRes.error.message);
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

  // Finished opportunities whose signals moved go back to New before any new
  // ones are written; they keep their clusters, so nothing is duplicated.
  let reopened = 0;
  try {
    reopened = await reopenStrengthened(brandId, existing, measure);
  } catch (err) {
    logger.error({ err, brandId }, '[opportunities] re-opening finished opportunities failed');
  }

  const candidates = clusters.map((c) => ({ id: c.id, topicId: c.topic_id, ...measure([c.id]) }));
  const picked = pickClusters(candidates, coveredClusterIds(existing));
  if (!picked.length) {
    logger.info(
      { brandId, clusters: clusters.length, opportunities: existing.length, reopened },
      '[opportunities] every cluster with answers already has an opportunity',
    );
    return { generated: 0, merged: 0, reopened };
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
    .filter(
      (o) =>
        o.status !== 'dismissed' &&
        clusterById.has(o.cluster_id) &&
        (o.related_cluster_ids || []).length < MAX_MERGED_CLUSTERS,
    )
    .sort((a, b) => b.opportunity_score - a.opportunity_score)
    .slice(0, EXISTING_SHOWN);

  // Each cluster's candidate pages, by the words its need shares with them.
  const pagesFor = new Map(
    picked.map((cand) => {
      const c = clusterById.get(cand.id);
      const basket = basketSummary([c.id], basketRows || []);
      const need = [c.label, c.primary_intent, ...c.promptTexts, ...basket.top.map((q) => q.query)];
      return [cand.id, candidatePages(need.join(' '), pagesRes.data || [])];
    }),
  );
  const pageLine = (p, i) =>
    `[P${i}] ${p.title || p.h1 || p.url} — ${p.url} | AI citations (30d): ${p.ai_citations} | GA sessions (30d): ${p.ga_sessions} | Last modified: ${p.lastmod ? p.lastmod.slice(0, 10) : 'unknown'}`;

  const clusterLine = (cand, i) => {
    const c = clusterById.get(cand.id);
    const m = cand.metrics;
    const basket = basketSummary([c.id], basketRows || []);
    const pages = pagesFor.get(cand.id);
    return `[${i}] ${c.label} (topic: ${topicName(c) || 'none'})
Need: ${c.primary_intent}
Prompts:
${c.promptTexts
  .slice(0, PROMPTS_SHOWN)
  .map((t) => `- ${t}`)
  .join('\n')}
Searches AI engines ran for these prompts: ${basket.top.map((q) => q.query).join('; ') || 'none recorded'}
Est. AI volume: ${m.demand}/mo | Brand visibility: ${m.visibility}% | Strongest competitor: ${m.topCompetitorVisibility}% | Competitors visible: ${m.competitorsCited.join(', ') || 'none'}
Brand pages that may cover this need:
${pages.map(pageLine).join('\n') || 'none found'}`;
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
          source_data: {
            ...sourceData({
              clusters: ids.map((id) => clusterById.get(id)),
              topicName,
              metrics,
              components,
              queries: basketSummary(ids, basketRows || []),
            }),
            // The decision, its pages and the assets stay as first made.
            ...(target.targetPages ? { targetPages: target.targetPages } : {}),
            ...(target.assets ? { assets: target.assets } : {}),
          },
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
    const assets = buildAssets(
      {
        type: opp.assetType,
        channel: opp.type,
        decision: opp.decision,
        pageIndexes: opp.pageIndexes,
        title: opp.title,
      },
      opp.supportingAssets,
      pagesFor.get(cand.id),
    );
    const [primary] = assets;
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
      decision: primary.decision,
      source_data: {
        ...sourceData({
          clusters: [c],
          topicName,
          metrics: cand.metrics,
          components: cand.components,
          queries: basketSummary([c.id], basketRows || []),
        }),
        targetPages: primary.pages,
        assets,
      },
    });
  }

  if (inserts.length) {
    const { error } = await supabaseAdmin.from('content_opportunities').insert(inserts);
    if (error) throw new Error(error.message);
  }
  logger.info(
    { brandId, generated: inserts.length, merged, reopened, clusters: clusters.length },
    '[opportunities] generated',
  );
  return { generated: inserts.length, merged, reopened };
}
