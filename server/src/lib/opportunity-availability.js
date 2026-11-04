/**
 * What "+ New" (CONTENT-003) can still write for, read when its dialog opens.
 *
 * A need (prompt cluster) gets one opportunity (coveredClusterIds), and only
 * a need with tracked answers in the window has anything to write from. The
 * dialog shows, per topic and in all, how many needs are still open, so a
 * request that would write nothing isn't sent; and which prompts' needs have
 * an open opportunity, so it can offer that one instead. The run's own
 * duplicate checks (CONTENT-004, same question) may still take a few more.
 * `angles` counts the covered needs a request may write another angle on
 * once the open ones run out (opportunity-angles.js).
 */

import supabaseAdmin from '../config/supabase.js';
import { loadClusterOpportunities } from './open-opportunities.js';
import { loadClusters } from './prompt-clusters.js';
import {
  OPPORTUNITY_WINDOW_DAYS,
  coveredClusterIds,
  openOpportunityOn,
} from './opportunity-limits.js';
import { angleCandidates } from './opportunity-angles.js';
import { round } from './priority-core.js';

/** The no-topic scope's key in `topics`. */
export const NO_TOPIC = 'none';

/**
 * @param {{
 *   clusters: { id: string, topic_id: string | null, prompt_ids: string[] }[],
 *   opportunities: { id: string, status: string, cluster_id: string, related_cluster_ids?: string[] }[],
 *   promptMetrics: Map<string, { cells: number, visibility: number }>,
 *   now?: number,
 * }} input - `promptMetrics`: each prompt's answers in the window
 *   (brand_prompt_opportunity_metrics)
 * @returns {{
 *   needs: number, open: number, covered: number, noAnswers: number, angles: number,
 *   topics: Record<string, { open: number, covered: number, noAnswers: number, angles: number }>,
 *   promptOpportunity: Record<string, string>,
 * }}
 */
export function needAvailability({ clusters, opportunities, promptMetrics, now = Date.now() }) {
  const covered = coveredClusterIds(opportunities, now);
  // Each need's answers and visibility, weighted by answers, as the generator's.
  const candidates = clusters.map((c) => {
    const tested = c.prompt_ids.map((p) => promptMetrics.get(p)).filter((m) => m?.cells > 0);
    const cells = tested.reduce((sum, m) => sum + m.cells, 0);
    // Rounded to one place, as clusterMetrics rounds it: 19.96 is 20, no angle.
    const visibility = cells
      ? round(tested.reduce((sum, m) => sum + m.visibility * m.cells, 0) / cells, 1)
      : 0;
    return { id: c.id, score: 0, metrics: { tested: tested.length, visibility } };
  });
  const angleIds = new Set(
    angleCandidates(candidates, opportunities, { covered, now }).map((c) => c.id),
  );

  const total = { open: 0, covered: 0, noAnswers: 0, angles: 0 };
  const topics = {};
  const promptOpportunity = {};
  clusters.forEach((c, i) => {
    const topic = (topics[c.topic_id ?? NO_TOPIC] ??= {
      open: 0,
      covered: 0,
      noAnswers: 0,
      angles: 0,
    });
    let state = 'noAnswers';
    if (covered.has(c.id)) {
      state = 'covered';
      const id = openOpportunityOn(opportunities, c.id);
      if (id) for (const p of c.prompt_ids) promptOpportunity[p] = id;
    } else if (candidates[i].metrics.tested > 0) {
      state = 'open';
    }
    topic[state] += 1;
    total[state] += 1;
    if (angleIds.has(c.id)) {
      topic.angles += 1;
      total.angles += 1;
    }
  });
  return { needs: clusters.length, ...total, topics, promptOpportunity };
}

/** A brand's needAvailability, from its clusters, opportunities and tracked answers. */
export async function loadNeedAvailability(brandId) {
  const since = new Date(Date.now() - OPPORTUNITY_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [clusters, opportunities, metrics] = await Promise.all([
    loadClusters(brandId),
    loadClusterOpportunities(brandId),
    supabaseAdmin.rpc('brand_prompt_opportunity_metrics', {
      p_brand_id: brandId,
      p_since: since,
    }),
  ]);
  if (metrics.error) throw new Error(metrics.error.message);
  const promptMetrics = new Map(
    (metrics.data || []).map((m) => [m.prompt_id, { cells: m.cells, visibility: m.visibility }]),
  );
  return needAvailability({ clusters, opportunities, promptMetrics });
}
