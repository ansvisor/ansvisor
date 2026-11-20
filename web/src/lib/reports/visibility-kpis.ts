import type { ReportVisibilityRate } from '@/lib/actions/reports';

/**
 * The visibility tiles a report's KPI row leads with (RP-01, RP-02; D1–D3),
 * shared by the report page and its PDF:
 *  - the Visibility score, out of 100 and never with a %;
 *  - Prompts with a mention, the share of the period's answered prompts that
 *    named or cited the brand, with the counts it is worked out from.
 *
 * The older intensity score ("Avg. Score", `insights.avgVisibilityScore`)
 * is no longer shown: two scores on different scales read as one metric.
 * A report saved before a field existed shows only the tiles it has.
 */
export type VisibilityKpi =
  | { kind: 'score'; score: number }
  | { kind: 'promptsWithMention'; ratePct: number; visible: number; total: number };

export function visibilityKpis(rate: ReportVisibilityRate | undefined): VisibilityKpi[] {
  if (!rate) return [];
  return [
    ...(typeof rate.score === 'number' ? [{ kind: 'score' as const, score: rate.score }] : []),
    {
      kind: 'promptsWithMention',
      ratePct: rate.ratePct,
      visible: rate.visiblePrompts,
      total: rate.promptCount,
    },
  ];
}

/**
 * The KPI row's grid for its number of tiles (the visibility tiles plus
 * Mentions, Brand Citations and Positive Sentiment), and the span of the note
 * under it, so no row is left with an empty column.
 */
export function kpiGridClasses(tiles: number): { grid: string; note: string } {
  if (tiles >= 5) {
    return {
      grid: 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-5',
      note: 'col-span-2 sm:col-span-3 xl:col-span-5',
    };
  }
  if (tiles === 4)
    return { grid: 'sm:grid-cols-2 lg:grid-cols-4', note: 'sm:col-span-2 lg:col-span-4' };
  return { grid: 'sm:grid-cols-3', note: 'sm:col-span-3' };
}
