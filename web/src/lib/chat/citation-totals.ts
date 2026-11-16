/**
 * Citations as its page shows them (the owner's decision, 2026-11-16): the
 * domain and page lists follow the page's Sources, as its table does, while
 * Total Citations and the average per answer count every source, as its
 * cards do. When a citations read took Sources from the page, the engine
 * reads it a second time over every source, beside it, and puts that read's
 * totals next to the filtered lists as `all_sources_totals`. The same read,
 * the same filters and window: only Sources differs. Plain module: the
 * engine and its tests.
 */

/** The read whose lists follow the page's Sources. */
export const SOURCES_READ = 'list_citations';

/** What the Citations page's cards count over every source. */
export interface AllSourcesTotals {
  citations: number;
  avg_citations_per_result: number;
}

/** Whether a read took a Sources filter from the page: it needs the cards' totals beside it. */
export function needsAllSources(
  toolName: string,
  input: Record<string, unknown>,
  used: { page?: readonly string[] },
): boolean {
  return (
    toolName === SOURCES_READ &&
    (used.page?.includes('sources') ?? false) &&
    typeof input.source_filter === 'string' &&
    input.source_filter !== 'all'
  );
}

/** The same read over every source: one row is enough, its totals count them all. */
export function allSourcesInput(input: Record<string, unknown>): Record<string, unknown> {
  return { ...input, source_filter: 'all', limit: 1, offset: 0 };
}

/** The totals a read over every source gave; null when it gave none. */
export function allSourcesTotalsOf(value: unknown): AllSourcesTotals | null {
  const totals = (value as { totals?: Record<string, unknown> } | null)?.totals;
  if (!totals || typeof totals.citations !== 'number') return null;
  const average = totals.avg_citations_per_result;
  return {
    citations: totals.citations,
    avg_citations_per_result: typeof average === 'number' ? average : 0,
  };
}

/** The filtered read with the cards' totals beside its own; as it was without them. */
export function withAllSources(value: unknown, totals: AllSourcesTotals | null): unknown {
  if (!totals || !value || typeof value !== 'object' || Array.isArray(value)) return value;
  return { ...(value as Record<string, unknown>), all_sources_totals: totals };
}
