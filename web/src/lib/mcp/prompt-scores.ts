import { getPromptVisibilitySummaries } from '@/lib/actions/tracking';
import { expandDateToEndOfDay } from '@/lib/dates';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { computeAiVisibilityScore } from '@/lib/visibility-score';
import { readAnswerPages, type AnswersCut } from './answer-pages';
import { asService } from './chat-facts';

/**
 * Each prompt's Visibility and Coverage as the Prompts page shows them (the
 * owner's plan of 2026-11-16, item 7): the AI Visibility Score over the
 * prompt's answers in the window (0.6 × mention rate + 0.25 × citation rate
 * + 0.15 × position factor), and its visible runs of its runs. With no
 * platform asked it is the page's own read (getPromptVisibilitySummaries),
 * run with the service role; the page has no platform filter, so with one
 * the same sums are taken from the window's answers of those platforms
 * (promptScoresOfAnswers). Server only; the caller checks the brand first.
 */

/** One prompt's figures, as the Prompts table's Visibility and Coverage columns. */
export interface PromptScore {
  /** The AI Visibility Score (0–100, one decimal); null when the prompt has no answers. */
  score: number | null;
  /** Visible runs (named or cited) of its runs, in percent to one decimal. */
  coverage_pct: number;
}

/** All time: the page's read starts 30 days back when it is given no start. */
const ALL_TIME_FROM = '1970-01-01T00:00:00.000Z';

/** One answer as the sums take it (prompt_visibility_summaries, 00434). */
export interface PromptAnswerRow {
  id: string;
  prompt_id: string | null;
  mention_count: number | null;
  citation_count: number | null;
  mention_position: number | null;
  created_at?: string | null;
}

const rate = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

/**
 * Each prompt's score and coverage from its answers, as
 * prompt_visibility_summaries adds them up: every answer a run, named or
 * cited a visible run, the position factor the mean of 1 / position over
 * the answers that have one.
 */
export function promptScoresOfAnswers(rows: readonly PromptAnswerRow[]): Map<string, PromptScore> {
  const sums = new Map<
    string,
    { runs: number; visible: number; named: number; cited: number; inv: number; positions: number }
  >();
  for (const row of rows) {
    if (!row.prompt_id) continue;
    const sum = sums.get(row.prompt_id) ?? {
      runs: 0,
      visible: 0,
      named: 0,
      cited: 0,
      inv: 0,
      positions: 0,
    };
    const named = (row.mention_count ?? 0) > 0;
    const cited = (row.citation_count ?? 0) > 0;
    sum.runs += 1;
    if (named || cited) sum.visible += 1;
    if (named) sum.named += 1;
    if (cited) sum.cited += 1;
    if (
      row.mention_position !== null &&
      row.mention_position !== undefined &&
      row.mention_position > 0
    ) {
      sum.inv += 1 / row.mention_position;
      sum.positions += 1;
    }
    sums.set(row.prompt_id, sum);
  }
  return new Map(
    [...sums].map(([id, sum]) => [
      id,
      {
        score: computeAiVisibilityScore({
          answers: sum.runs,
          mentionAnswers: sum.named,
          citationAnswers: sum.cited,
          positionFactor: sum.positions > 0 ? sum.inv / sum.positions : null,
        }),
        coverage_pct: rate(sum.visible, sum.runs),
      },
    ]),
  );
}

export interface PromptScoresParams {
  dateFrom?: string;
  dateTo?: string;
  region?: string;
  /** Model slugs; none or empty: every platform, as the page reads. */
  models?: readonly string[] | null;
}

/** Each prompt's score and coverage over the window, and what was left out when it held too many answers. */
export async function promptScoresFor(
  brandId: string,
  params: PromptScoresParams,
): Promise<{ scores: Map<string, PromptScore>; cut: AnswersCut | null }> {
  const dateTo = expandDateToEndOfDay(params.dateTo);
  if (!params.models?.length) {
    const summaries = await asService(() =>
      getPromptVisibilitySummaries(brandId, {
        from: params.dateFrom ?? ALL_TIME_FROM,
        to: dateTo,
        region: params.region,
      }),
    );
    return {
      scores: new Map(
        Object.entries(summaries).map(([id, s]) => [
          id,
          { score: s.score, coverage_pct: s.visibilityRate },
        ]),
      ),
      cut: null,
    };
  }
  const models = [...params.models];
  const { rows, cut } = await readAnswerPages<PromptAnswerRow>((from, to) => {
    let query = supabaseAdmin
      .from('prompt_results')
      .select('id, prompt_id, mention_count, citation_count, mention_position, created_at')
      .eq('brand_id', brandId)
      .not('prompt_id', 'is', null)
      .neq('platform', 'chatgpt-shopping');
    if (params.dateFrom) query = query.gte('created_at', params.dateFrom);
    if (dateTo) query = query.lte('created_at', dateTo);
    if (params.region) query = query.eq('region', params.region);
    query = models.length > 1 ? query.in('model_used', models) : query.eq('model_used', models[0]);
    return query.order('created_at', { ascending: false }).order('id').range(from, to);
  });
  return { scores: promptScoresOfAnswers(rows), cut };
}
