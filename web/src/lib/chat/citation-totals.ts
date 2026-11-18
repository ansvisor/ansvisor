/**
 * Citations as its page shows them (the owner's decision, 2026-11-16): the
 * domain and page lists follow the page's Sources, as its table does, while
 * Total Citations and the average per answer count every source, as its
 * cards do. When a citations read took Sources from the page, the engine
 * asks the read for both (ChatToolContext.allSourcesTotals): the one scan
 * that builds the filtered lists also counts every source's citations, and
 * the result carries them as `all_sources_totals` beside the filtered
 * lists. The same read, the same filters and window: only Sources differs.
 * Plain module: the engine and its tests.
 */

/** The read whose lists follow the page's Sources. */
export const SOURCES_READ = 'list_citations';

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
