import { getPromptVisibilitySummaries } from '@/lib/actions/tracking';
import { expandDateToEndOfDay } from '@/lib/dates';
import { asService } from './chat-facts';

/**
 * Each prompt's Visibility and Coverage as the Prompts page shows them (the
 * owner's plan of 2026-11-16, item 7): the AI Visibility Score over the
 * prompt's answers in the window (0.6 × mention rate + 0.25 × citation rate
 * + 0.15 × position factor), and its visible runs of its runs. Always the
 * page's own read (getPromptVisibilitySummaries, over
 * prompt_visibility_summaries), run with the service role, which the
 * function lets through (00434). The function takes no platform
 * (p_brand_id, p_date_from, p_date_to, p_region): the page has no platform
 * filter and counts every platform's answers, the plan's or not, so the
 * scores do too, on every plan, Starter's included (the maintainer's
 * review of 2026-11-16). Server only; the caller checks the brand first.
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

export interface PromptScoresParams {
  dateFrom?: string;
  dateTo?: string;
  region?: string;
}

/** Each prompt's score and coverage over the window, by prompt id: every prompt the page scores. */
export async function promptScoresFor(
  brandId: string,
  params: PromptScoresParams,
): Promise<Map<string, PromptScore>> {
  const summaries = await asService(() =>
    getPromptVisibilitySummaries(brandId, {
      from: params.dateFrom ?? ALL_TIME_FROM,
      to: expandDateToEndOfDay(params.dateTo),
      region: params.region,
    }),
  );
  return new Map(
    Object.entries(summaries).map(([id, s]) => [
      id,
      { score: s.score, coverage_pct: s.visibilityRate },
    ]),
  );
}
