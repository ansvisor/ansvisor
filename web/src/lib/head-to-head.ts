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
 */

import type { Sentiment } from '@/types';

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
  brandScore: number;
  competitorScore: number;
  diff: number;
  latestAt: string;
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

/** The `prompt_results` columns the aggregation reads. */
export interface HeadToHeadResultRow {
  prompt_id: string | null;
  platform: string | null;
  model_used: string | null;
  region: string | null;
  visibility_score: number | null;
  competitor_mentions: unknown;
  created_at: string;
}

interface CompetitorMention {
  competitor_id?: string;
  visibility_score?: number;
}

const GAP_STRENGTH_LIMIT = 10;

export function emptyHeadToHead(): HeadToHeadData {
  return { groups: [], platformRows: [], brandAvg: 0, competitorAvg: 0, gaps: [], strengths: [] };
}

/** The competitor's score in one answer, or null when the answer doesn't list it. */
export function competitorScoreIn(mentions: unknown, competitorId: string): number | null {
  if (!Array.isArray(mentions)) return null;
  const hit = (mentions as CompetitorMention[]).find((m) => m?.competitor_id === competitorId);
  return hit ? (hit.visibility_score ?? 0) : null;
}

export function aggregateHeadToHead(
  rows: HeadToHeadResultRow[],
  competitorId: string,
  prompts: Map<string, { text: string; category?: string }>,
  resolveProvider: (modelUsed: string | null, platform: string | null) => string,
): HeadToHeadData {
  type GroupAcc = Omit<HeadToHeadGroup, 'brandScore' | 'competitorScore' | 'diff'> & {
    brandTotal: number;
    compTotal: number;
  };
  type Totals = { brandTotal: number; brandCount: number; compTotal: number; compCount: number };
  const newTotals = (): Totals => ({ brandTotal: 0, brandCount: 0, compTotal: 0, compCount: 0 });

  const groups = new Map<string, GroupAcc>();
  const byProvider = new Map<string, Totals>();
  const overall = newTotals();

  for (const row of rows) {
    const brandScore = row.visibility_score ?? 0;
    const compScore = competitorScoreIn(row.competitor_mentions, competitorId);
    const provider = resolveProvider(row.model_used, row.platform);

    // Averages over answers that list the competitor, as before: an answer
    // from before the competitor was added says nothing about it.
    const providerTotals = byProvider.get(provider) ?? newTotals();
    byProvider.set(provider, providerTotals);
    for (const totals of [overall, providerTotals]) {
      totals.brandTotal += brandScore;
      totals.brandCount += 1;
      if (compScore !== null) {
        totals.compTotal += compScore;
        totals.compCount += 1;
      }
    }

    // Results without a prompt still count towards the averages above.
    if (!row.prompt_id) continue;
    const key = [row.prompt_id, row.platform ?? '', row.model_used ?? '', row.region ?? ''].join(
      '\u0000',
    );
    const group = groups.get(key) ?? {
      promptId: row.prompt_id,
      promptText: prompts.get(row.prompt_id)?.text ?? '',
      promptCategory: prompts.get(row.prompt_id)?.category,
      platform: provider,
      rawPlatform: row.platform,
      modelUsed: row.model_used ?? '',
      rawModelUsed: row.model_used,
      region: row.region ?? undefined,
      runs: 0,
      latestAt: row.created_at,
      brandTotal: 0,
      compTotal: 0,
    };
    // Group averages count a missing competitor as 0, as the page always did.
    group.runs += 1;
    group.brandTotal += brandScore;
    group.compTotal += compScore ?? 0;
    if (row.created_at > group.latestAt) group.latestAt = row.created_at;
    groups.set(key, group);
  }

  const groupList: HeadToHeadGroup[] = [...groups.values()].map(
    ({ brandTotal, compTotal, ...g }) => {
      const brandScore = brandTotal / g.runs;
      const competitorScore = compTotal / g.runs;
      return { ...g, brandScore, competitorScore, diff: brandScore - competitorScore };
    },
  );

  const avg = (total: number, count: number) => (count > 0 ? Math.round(total / count) : 0);
  const platformRows = [...byProvider.entries()]
    .map(([platform, a]) => {
      const brandScore = avg(a.brandTotal, a.brandCount);
      const competitorScore = avg(a.compTotal, a.compCount);
      return { platform, brandScore, competitorScore, diff: brandScore - competitorScore };
    })
    .sort((a, b) => a.platform.localeCompare(b.platform));

  const byDiff = [...groupList].sort((a, b) => a.diff - b.diff);
  return {
    groups: groupList,
    platformRows,
    brandAvg: avg(overall.brandTotal, overall.brandCount),
    competitorAvg: avg(overall.compTotal, overall.compCount),
    gaps: byDiff.filter((g) => g.diff < 0).slice(0, GAP_STRENGTH_LIMIT),
    strengths: byDiff
      .filter((g) => g.diff > 0)
      .reverse()
      .slice(0, GAP_STRENGTH_LIMIT),
  };
}
