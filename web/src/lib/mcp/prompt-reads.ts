import type { McpAuthContext } from '@/lib/mcp-auth';
import { getQueryFanout } from '@/lib/actions/fanout';
import { getPromptResults } from '@/lib/actions/tracking';
import { brandAllowed, getPromptVolumesFor } from './data';
import { asService, latestAnswerAt, newestOf, planPlatforms } from './chat-facts';

/**
 * Chat's Prompts reads (CHAT-20 §9 rows 14, 16, 18): the Query Fan-outs
 * tab and its gaps (where the brand is absent), a prompt's AI answers and
 * the Insights tab, read by the pages' own loaders with the service role
 * once the brand is the caller's. Each answers `data_as_of` (§15a); the
 * engines and answers are the plan's platforms only. Null for a brand
 * outside the organization.
 */

/** Sub-queries listed, the most searched first. */
const SUB_QUERIES_SHOWN = 50;
/** Answers read to find the newest few on the plan's platforms. */
const ANSWERS_READ = 50;
/** Characters of an answer's text: enough to quote it, not a whole page. */
const ANSWER_CHARS = 1500;

export async function getFanoutsFor(
  auth: McpAuthContext,
  params: { brandId: string; days?: number },
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const days = params.days ?? 30;
  // The plan's platforms only, from the rows up: every count is theirs.
  const platforms = await planPlatforms(auth.organizationId!);
  const [fanout, asOf] = await Promise.all([
    asService(() => getQueryFanout(params.brandId, { days, ...(platforms ? { platforms } : {}) })),
    latestAnswerAt(params.brandId, platforms),
  ]);
  return {
    days,
    total_observed: fanout.totalObserved,
    truncated: fanout.truncated,
    engines: fanout.engines.map((e) => ({
      platform: e.platform,
      answers: e.answers,
      answers_with_fanout: e.answersWithFanout,
      sub_queries: e.subQueries,
    })),
    sub_queries: fanout.subQueries.slice(0, SUB_QUERIES_SHOWN).map((q) => ({
      query: q.query,
      engines: q.engines,
      times_searched: q.timesSearched,
      prompts: q.sourcedPrompts.length,
      tracked: q.tracked,
    })),
    sub_queries_total: fanout.subQueries.length,
    data_as_of: asOf,
  };
}

/** Fan-out gaps listed, the most searched first. */
const GAPS_SHOWN = 20;
/** Tracked prompts named behind each gap, and competitors named in its answers. */
const GAP_PROMPTS_SHOWN = 3;
const GAP_RIVALS_SHOWN = 3;

/**
 * The fan-out gaps (AGENTS plan §3 #9, the /fanout skill): the sub-queries
 * engines searched behind the brand's tracked answers where none of those
 * answers named the brand or cited its site. Each with the engines that
 * searched it, how often, the tracked prompts whose answers ran it (to draft
 * from) and the competitors those answers named instead. The Query Fan-outs
 * tab's own read, on the plan's platforms, with who each answer named.
 */
export async function getFanoutGapsFor(
  auth: McpAuthContext,
  params: { brandId: string; days?: number; limit?: number },
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const days = params.days ?? 30;
  const platforms = await planPlatforms(auth.organizationId!);
  const [fanout, asOf] = await Promise.all([
    asService(() =>
      getQueryFanout(params.brandId, {
        days,
        presence: true,
        ...(platforms ? { platforms } : {}),
      }),
    ),
    latestAnswerAt(params.brandId, platforms),
  ]);
  const gaps = fanout.subQueries.filter((q) => q.presence?.brandAnswers === 0);
  return {
    days,
    truncated: fanout.truncated,
    sub_queries_total: fanout.subQueries.length,
    gaps_total: gaps.length,
    gaps: gaps.slice(0, params.limit ?? GAPS_SHOWN).map((q) => ({
      query: q.query,
      engines: q.engines,
      times_searched: q.timesSearched,
      tracked: q.tracked,
      from_prompts: q.sourcedPrompts
        .slice(0, GAP_PROMPTS_SHOWN)
        .map((p) => ({ prompt_id: p.id, text: p.text })),
      competitors_named: (q.presence?.rivals ?? []).slice(0, GAP_RIVALS_SHOWN),
    })),
    data_as_of: asOf,
  };
}

export async function listAiAnswersFor(
  auth: McpAuthContext,
  params: {
    brandId: string;
    promptId: string;
    platform?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  },
) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const limit = params.limit ?? 5;
  const [read, platforms] = await Promise.all([
    // The brand's own answers only: the read filters by brand, so another brand's prompt has none.
    // More than asked, so the plan's platforms still fill the page once the rest are left out.
    asService(() =>
      getPromptResults(params.brandId, {
        promptId: params.promptId,
        platform: params.platform,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        limit: ANSWERS_READ,
      }),
    ),
    planPlatforms(auth.organizationId!),
  ]);
  const answers = read.results
    .filter((r) => !platforms || platforms.includes(r.platform))
    .slice(0, limit);
  return {
    answers: answers.map((r) => ({
      id: r.id,
      platform: r.platform,
      created_at: r.createdAt,
      region: r.region ?? null,
      mention_count: r.mentionCount,
      citation_count: r.citationCount,
      sentiment: r.sentiment,
      visibility_score: r.visibilityScore,
      answer:
        r.response.length > ANSWER_CHARS ? `${r.response.slice(0, ANSWER_CHARS)}…` : r.response,
    })),
    data_as_of: newestOf(answers.map((r) => r.createdAt)),
  };
}

/** Prompts the volume read takes at most (getPromptVolumesFor's ceiling). */
const VOLUMES_READ = 500;
/** Prompts listed by estimated AI volume. */
const TOP_PROMPTS = 10;

export async function getPromptInsightsFor(
  auth: McpAuthContext,
  params: { brandId: string; limit?: number },
) {
  const rows = await getPromptVolumesFor(auth, { brandId: params.brandId, limit: VOLUMES_READ });
  if (!rows) return null;
  const byIntent: Record<string, number> = {};
  for (const row of rows) byIntent[row.intent] = (byIntent[row.intent] ?? 0) + 1;
  return {
    prompts_with_volume: rows.length,
    // The volume read stops at VOLUMES_READ prompts: the sums cover those.
    truncated: rows.length === VOLUMES_READ,
    total_est_ai_volume: rows.reduce((sum, row) => sum + (row.est_ai_volume || 0), 0),
    by_intent: byIntent,
    top: [...rows]
      .sort((a, b) => (b.est_ai_volume || 0) - (a.est_ai_volume || 0))
      .slice(0, params.limit ?? TOP_PROMPTS)
      .map((row) => ({
        prompt_id: row.prompt_id,
        prompt_text: row.prompt_text,
        intent: row.intent,
        est_ai_volume: row.est_ai_volume,
        est_ai_volume_low: row.est_ai_volume_low,
        est_ai_volume_high: row.est_ai_volume_high,
        total_google_volume: row.total_google_volume,
        volume_confidence: row.volume_confidence,
      })),
    data_as_of: newestOf(rows.map((row) => row.fetched_at)),
  };
}
