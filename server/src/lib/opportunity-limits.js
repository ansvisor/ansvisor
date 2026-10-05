/**
 * How content opportunities are counted, ranked and scored (#857).
 *
 * Opportunities are generated per prompt cluster: a group of prompts in one
 * topic that a single piece of content can answer (lib/prompt-clusters.js).
 * A cluster's figures are built from its member prompts, and the score keeps
 * its components so the detail page can say why it is what it is.
 */

/**
 * Opportunities one generation run may produce. A short list that gets read
 * beats a long one that gets scrolled past, and generation runs nightly, so
 * three a night reaches every cluster over time.
 */
export const OPPORTUNITIES_PER_RUN = 3;

/** Window the cluster metrics are measured over. */
export const OPPORTUNITY_WINDOW_DAYS = 30;

/**
 * Estimated monthly AI volume at which the demand component tops out. The
 * scale is logarithmic: a cluster adds up its prompts' volumes, and on a
 * linear scale with the old per-prompt ceiling of 50,000 most clusters sat
 * at 100 and demand stopped telling them apart. 1,000 scores 50, 10,000
 * scores 67, 150,000 scores 86.
 */
const DEMAND_CEILING = 1_000_000;

const INTENT_WEIGHTS = {
  comparison: 1.0,
  'best-top': 0.95,
  'vs-review': 0.9,
  recommendation: 0.85,
  'how-to': 0.75,
  'problem-solving': 0.7,
  'what-is': 0.6,
  other: 0.5,
};

/** Score weights per component, out of 100. */
export const SCORE_WEIGHTS = { demand: 40, visibilityGap: 30, competitorGap: 20, intent: 10 };

const round1 = (n) => Math.round(n * 10) / 10;

function mostFrequent(values, limit) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([v]) => v);
}

/**
 * A cluster's figures from its member prompts.
 *
 * Demand adds up: one piece of content answers every member. Visibility and
 * the strongest competitor's visibility are averaged over the members that
 * have answers in the window, weighted by how many engine-days each has.
 *
 * @param {string[]} promptIds - the cluster's members
 * @param {Map<string, {text: string, volume?: object, metrics?: object}>} prompts
 */
export function clusterMetrics(promptIds, prompts) {
  const members = promptIds.map((id) => ({ id, ...prompts.get(id) })).filter((m) => m.text);
  const tested = members.filter((m) => m.metrics?.cells > 0);
  const cells = tested.reduce((s, m) => s + m.metrics.cells, 0);
  const weighted = (key) =>
    cells ? tested.reduce((s, m) => s + m.metrics[key] * m.metrics.cells, 0) / cells : 0;

  const volume = (m) => m.volume?.est_ai_volume || 0;
  const visibility = round1(weighted('visibility'));
  const topCompetitorVisibility = round1(weighted('top_competitor_visibility'));
  const representative = [...(tested.length ? tested : members)].sort(
    (a, b) => volume(b) - volume(a),
  )[0];

  return {
    tested: tested.length,
    demand: members.reduce((s, m) => s + volume(m), 0),
    visibility,
    topCompetitorVisibility,
    competitorGap: round1(topCompetitorVisibility - visibility),
    intent:
      mostFrequent(
        members.map((m) => m.volume?.intent || 'other'),
        1,
      )[0] || 'other',
    keywords: mostFrequent(
      members.flatMap((m) => m.volume?.keywords || []),
      8,
    ),
    competitorsCited: mostFrequent(
      tested.flatMap((m) => m.metrics.competitors || []),
      5,
    ),
    representative: representative ? { id: representative.id, text: representative.text } : null,
  };
}

/** Each score component on a 0–100 scale. */
export function scoreComponents({ demand, visibility, competitorGap, intent }) {
  return {
    demand: round1(Math.min(Math.log10(1 + demand) / Math.log10(1 + DEMAND_CEILING), 1) * 100),
    visibilityGap: round1(100 - visibility),
    competitorGap: round1(Math.min(Math.max(competitorGap, 0), 100)),
    intent: round1((INTENT_WEIGHTS[intent] || INTENT_WEIGHTS.other) * 100),
  };
}

/** The weighted total of the components, 0–100. */
export function opportunityScore(components) {
  const total = Object.entries(SCORE_WEIGHTS).reduce(
    (s, [key, weight]) => s + (components[key] * weight) / 100,
    0,
  );
  return Math.round(total * 100) / 100;
}

/**
 * Clusters that already have an opportunity, as its own cluster or a merged
 * one. Any status counts: a cluster gets one opportunity, and a dismissed one
 * is not suggested again in other words.
 */
export function coveredClusterIds(rows) {
  const ids = new Set();
  for (const r of rows || []) {
    if (r.cluster_id) ids.add(r.cluster_id);
    for (const id of r.related_cluster_ids || []) ids.add(id);
  }
  return ids;
}

/**
 * The highest-scoring clusters with answers and no opportunity yet, at most
 * one per topic, so a run's few suggestions spread across the brand's topics
 * instead of all landing in its strongest one. The no-topic scope (null)
 * counts as one topic.
 */
export function pickClusters(candidates, covered, count = OPPORTUNITIES_PER_RUN) {
  const topics = new Set();
  const picked = [];
  for (const c of [...candidates]
    .filter((c) => c.metrics.tested > 0 && !covered.has(c.id))
    .sort((a, b) => b.score - a.score)) {
    const topic = c.topicId ?? null;
    if (topics.has(topic)) continue;
    topics.add(topic);
    picked.push(c);
    if (picked.length === count) break;
  }
  return picked;
}
