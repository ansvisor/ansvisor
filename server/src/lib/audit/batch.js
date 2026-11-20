/**
 * A bulk audit's progress, read from the Pages list's rows (one per page,
 * newest run first, buildAuditPages): the pages with an audit running now,
 * and the pages the batch started at a given time covers. Pure, so the route
 * only reads the rows and this decides what they add up to.
 *
 * A batch has no row of its own: its pages are the ones whose latest run was
 * created at or after the time its first audit started, and it is done when
 * none of them is running.
 */

/** An ISO time from a query, as milliseconds; null for none or something that isn't one. */
export function parseSince(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

const latestRun = (page) => page.runs[0] ?? null;

/** Pages whose latest run was created at or after `sinceMs`. */
export function pagesSince(pages, sinceMs) {
  return pages.filter((page) => {
    const run = latestRun(page);
    return run !== null && Date.parse(run.createdAt) >= sinceMs;
  });
}

/**
 * The audits running now: how many pages have one, and when the oldest of
 * them started (the time a batch still running began at); null for none.
 *
 * @returns {{ count: number, since: string|null }}
 */
export function runningSummary(pages) {
  let count = 0;
  let oldest = null;
  for (const page of pages) {
    const run = latestRun(page);
    if (run?.status !== 'running') continue;
    count += 1;
    const at = Date.parse(run.createdAt);
    if (oldest === null || at < oldest) oldest = at;
  }
  return { count, since: oldest === null ? null : new Date(oldest).toISOString() };
}
