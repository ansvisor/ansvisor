/**
 * Head-to-head aggregation for the Competitors page (#923).
 *
 * A plain module rather than part of `lib/actions/tracking.ts`, because that
 * file is `'use server'` and its runtime exports must be async server actions.
 *
 * The page used to receive one row per tracked answer — answer text and
 * citations included — and group them in the browser. On large brands that is
 * hundreds of thousands of rows. It now receives one summary per (prompt,
 * engine, model, region) and loads a group's individual runs only when the
 * user opens it.
 *
 * The summaries come from the daily rollups (head_to_head_daily, 00169, over
 * the picker's days since head_to_head_window_daily, 00552), so every answer
 * counts: a read of the raw answers stopped at PostgREST's 1,000-row page and
 * compared large brands on their newest answers only.
 *
 * Every score is the Visibility score the competitor cards show (0–100, one
 * decimal; lib/visibility-score), for the brand and the competitor alike over
 * the brand's answers in the scope: a group, a prompt, a platform, the
 * comparison as a whole, a single answer (UX audit CP-01, decision D3). It
 * replaces the per-answer score averaged over each side's own answers, a
 * different scale the page showed with a "%".
 */

import type { Sentiment } from '@/types';
import { computeAiVisibilityScore } from '@/lib/visibility-score';

/** What a Visibility score is made of, summed over a scope's answers. */
export interface ScoreParts {
  /** The brand's answers in the scope: the denominator for both sides. */
  answers: number;
  mentionAnswers: number;
  citationAnswers: number;
  /** Sum of 1/position over the answers that name the side, and how many. */
  invPosition: number;
  positionCount: number;
}

const NO_PARTS: ScoreParts = {
  answers: 0,
  mentionAnswers: 0,
  citationAnswers: 0,
  invPosition: 0,
  positionCount: 0,
};

const addParts = (a: ScoreParts, b: ScoreParts): ScoreParts => ({
  answers: a.answers + b.answers,
  mentionAnswers: a.mentionAnswers + b.mentionAnswers,
  citationAnswers: a.citationAnswers + b.citationAnswers,
  invPosition: a.invPosition + b.invPosition,
  positionCount: a.positionCount + b.positionCount,
});

/** The Visibility score of the parts; 0 with no answers. */
export function scoreOf(parts: ScoreParts): number {
  return (
    computeAiVisibilityScore({
      answers: parts.answers,
      mentionAnswers: parts.mentionAnswers,
      citationAnswers: parts.citationAnswers,
      positionFactor: parts.positionCount > 0 ? parts.invPosition / parts.positionCount : null,
    }) ?? 0
  );
}

/** A difference of two scores, one decimal, as the scores read. */
const diffOf = (a: number, b: number) => Math.round((a - b) * 10) / 10;

/**
 * Both sides' scores over several groups (a prompt's engines, a prompt's
 * gaps): from their summed parts, not an average of their scores.
 */
export function foldScores(groups: readonly Pick<HeadToHeadGroup, 'parts'>[]): {
  brandScore: number;
  competitorScore: number;
  diff: number;
} {
  const brand = groups.reduce((sum, g) => addParts(sum, g.parts.brand), NO_PARTS);
  const competitor = groups.reduce((sum, g) => addParts(sum, g.parts.competitor), NO_PARTS);
  const brandScore = scoreOf(brand);
  const competitorScore = scoreOf(competitor);
  return { brandScore, competitorScore, diff: diffOf(brandScore, competitorScore) };
}

/** One (prompt, engine, model, region) combination, averaged over its runs. */
export interface HeadToHeadGroup {
  promptId: string;
  promptText: string;
  promptCategory?: string;
  /** Display provider, e.g. "ChatGPT". */
  platform: string;
  /** Raw `prompt_results.platform`, used to load this group's runs. */
  rawPlatform: string | null;
  modelUsed: string;
  rawModelUsed: string | null;
  region?: string;
  runs: number;
  /** Visibility scores (0–100, one decimal) over the group's answers. */
  brandScore: number;
  competitorScore: number;
  diff: number;
  latestAt: string;
  /** What both scores are made of, so several groups fold into one score. */
  parts: { brand: ScoreParts; competitor: ScoreParts };
}

/** One tracked answer inside a group, loaded on demand. */
export interface HeadToHeadRun {
  resultId: string;
  createdAt: string;
  brandScore: number;
  competitorScore: number;
  sentiment: Sentiment;
}

export interface HeadToHeadPlatformRow {
  platform: string;
  brandScore: number;
  competitorScore: number;
  diff: number;
}

export interface HeadToHeadData {
  groups: HeadToHeadGroup[];
  platformRows: HeadToHeadPlatformRow[];
  brandAvg: number;
  competitorAvg: number;
  gaps: HeadToHeadGroup[];
  strengths: HeadToHeadGroup[];
}

/** The Visibility score's parts for both sides, as 00552 sums them. */
interface RollupScoreParts {
  brand_mention_answers?: number | null;
  brand_citation_answers?: number | null;
  brand_inv_position?: number | null;
  brand_position_count?: number | null;
  comp_mention_answers?: number | null;
  comp_citation_answers?: number | null;
  comp_inv_position?: number | null;
  comp_position_count?: number | null;
}

/** One (prompt, engine, model, region) as head_to_head_window_daily sums it. */
export interface HeadToHeadRollupGroup extends RollupScoreParts {
  prompt_id: string;
  platform: string | null;
  model_used: string | null;
  region: string | null;
  runs: number;
  /** The brand's visibility summed over the group's answers. */
  brand_total: number;
  /** The competitor's, an answer that doesn't list it counting 0. */
  comp_total: number;
  latest_at: string;
}

/** One (platform, model) over every answer, for the averages. */
export interface HeadToHeadRollupEngine extends RollupScoreParts {
  platform: string | null;
  model_used: string | null;
  /** Answers, those without a prompt included. */
  brand_count: number;
  brand_total: number;
  /** Answers that list the competitor, and its visibility over them. */
  comp_count: number;
  comp_total: number;
}

/** head_to_head_daily's payload (00169). */
export interface HeadToHeadRollups {
  groups: HeadToHeadRollupGroup[];
  engines: HeadToHeadRollupEngine[];
  prompts: { id: string; text: string | null; category: string | null }[];
}

interface CompetitorMention {
  competitor_id?: string;
  mention_count?: number | null;
  citation_count?: number | null;
  mention_position?: number | null;
}

const GAP_STRENGTH_LIMIT = 10;

export function emptyHeadToHead(): HeadToHeadData {
  return { groups: [], platformRows: [], brandAvg: 0, competitorAvg: 0, gaps: [], strengths: [] };
}

/**
 * One answer's Visibility score for a side that it named or cited (or not):
 * the score's formula over a single answer.
 */
export function answerScore(answer: {
  mention_count?: number | null;
  citation_count?: number | null;
  mention_position?: number | null;
}): number {
  const named = (answer.mention_count ?? 0) > 0;
  const position = answer.mention_position ?? null;
  return scoreOf({
    answers: 1,
    mentionAnswers: named ? 1 : 0,
    citationAnswers: (answer.citation_count ?? 0) > 0 ? 1 : 0,
    invPosition: position ? 1 / position : 0,
    positionCount: position ? 1 : 0,
  });
}

/** The competitor's score in one answer, or null when the answer doesn't list it. */
export function competitorScoreIn(mentions: unknown, competitorId: string): number | null {
  if (!Array.isArray(mentions)) return null;
  const hit = (mentions as CompetitorMention[]).find((m) => m?.competitor_id === competitorId);
  return hit ? answerScore(hit) : null;
}

const n = (value: number | string | null | undefined) => Number(value ?? 0);

/** Both sides' parts from a rollup row, over `answers` of the brand. */
function partsOf(
  row: RollupScoreParts,
  answers: number,
): { brand: ScoreParts; competitor: ScoreParts } {
  return {
    brand: {
      answers,
      mentionAnswers: n(row.brand_mention_answers),
      citationAnswers: n(row.brand_citation_answers),
      invPosition: n(row.brand_inv_position),
      positionCount: n(row.brand_position_count),
    },
    competitor: {
      answers,
      mentionAnswers: n(row.comp_mention_answers),
      citationAnswers: n(row.comp_citation_answers),
      invPosition: n(row.comp_inv_position),
      positionCount: n(row.comp_position_count),
    },
  };
}

/**
 * The page's summaries from head_to_head_window_daily (00552). Each group,
 * each display provider and the comparison as a whole get both sides'
 * Visibility scores over the brand's answers in them, as the cards score a
 * competitor. Groups come most recently run first, the order the page lists
 * prompts in.
 */
export function headToHeadFromRollups(
  rollups: HeadToHeadRollups,
  resolveProvider: (modelUsed: string | null, platform: string | null) => string,
): HeadToHeadData {
  const prompts = new Map(rollups.prompts.map((p) => [p.id, p]));
  type Both = { brand: ScoreParts; competitor: ScoreParts };
  const add = (a: Both, b: Both): Both => ({
    brand: addParts(a.brand, b.brand),
    competitor: addParts(a.competitor, b.competitor),
  });
  const none: Both = { brand: NO_PARTS, competitor: NO_PARTS };

  const byProvider = new Map<string, Both>();
  let overall = none;
  for (const engine of rollups.engines) {
    const provider = resolveProvider(engine.model_used, engine.platform);
    const parts = partsOf(engine, n(engine.brand_count));
    byProvider.set(provider, add(byProvider.get(provider) ?? none, parts));
    overall = add(overall, parts);
  }

  const groupList: HeadToHeadGroup[] = rollups.groups
    .filter((g) => n(g.runs) > 0)
    .map((g) => {
      const runs = n(g.runs);
      const parts = partsOf(g, runs);
      const brandScore = scoreOf(parts.brand);
      const competitorScore = scoreOf(parts.competitor);
      const prompt = prompts.get(g.prompt_id);
      return {
        promptId: g.prompt_id,
        promptText: prompt?.text ?? '',
        promptCategory: prompt?.category ?? undefined,
        platform: resolveProvider(g.model_used, g.platform),
        rawPlatform: g.platform,
        modelUsed: g.model_used ?? '',
        rawModelUsed: g.model_used,
        region: g.region ?? undefined,
        runs,
        brandScore,
        competitorScore,
        diff: diffOf(brandScore, competitorScore),
        latestAt: g.latest_at,
        parts,
      };
    })
    .sort((a, b) => (a.latestAt < b.latestAt ? 1 : a.latestAt > b.latestAt ? -1 : 0));

  const platformRows = [...byProvider.entries()]
    .map(([platform, parts]) => {
      const brandScore = scoreOf(parts.brand);
      const competitorScore = scoreOf(parts.competitor);
      return { platform, brandScore, competitorScore, diff: diffOf(brandScore, competitorScore) };
    })
    .sort((a, b) => a.platform.localeCompare(b.platform));

  const byDiff = [...groupList].sort((a, b) => a.diff - b.diff);
  return {
    groups: groupList,
    platformRows,
    brandAvg: scoreOf(overall.brand),
    competitorAvg: scoreOf(overall.competitor),
    gaps: byDiff.filter((g) => g.diff < 0).slice(0, GAP_STRENGTH_LIMIT),
    strengths: byDiff
      .filter((g) => g.diff > 0)
      .reverse()
      .slice(0, GAP_STRENGTH_LIMIT),
  };
}
