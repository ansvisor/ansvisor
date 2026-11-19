/** A row with the key the Pages list tracks it by (the page's key, one across www and non-www). */
interface Keyed {
  key: string;
}

/**
 * Fold a fresh read of the audited pages into the rows already shown, so a
 * poll during a bulk run updates statuses in place: each shown row is
 * replaced by its fresh version (same position, same key, so open histories
 * and Load more survive), rows the read doesn't reach are kept as they are,
 * and rows it newly lists are put on top. A row missing from the read is
 * dropped only when the read covered the whole list (`complete`), since
 * otherwise it may have moved past the read.
 */
export function mergePages<T extends Keyed>(current: T[], fresh: T[], complete: boolean): T[] {
  const freshByKey = new Map(fresh.map((p) => [p.key, p]));
  const shown = new Set(current.map((p) => p.key));
  const kept: T[] = [];
  for (const page of current) {
    const next = freshByKey.get(page.key);
    if (next) kept.push(next);
    else if (!complete) kept.push(page);
  }
  const added = fresh.filter((p) => !shown.has(p.key));
  return [...added, ...kept];
}

/**
 * The selection after a read: kept by page key, whether or not the row is
 * loaded. A key leaves it only once the read shows its page running, or (when
 * the read covered the whole list) gone.
 */
export function pruneSelection<T extends Keyed & { status: string }>(
  selected: Set<string>,
  fresh: T[],
  complete: boolean,
): Set<string> {
  const freshByKey = new Map(fresh.map((p) => [p.key, p]));
  return new Set(
    [...selected].filter((key) => {
      const page = freshByKey.get(key);
      if (!page) return !complete;
      return page.status !== 'running';
    }),
  );
}
