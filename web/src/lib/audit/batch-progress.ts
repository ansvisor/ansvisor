/**
 * A bulk audit's progress on the Site Audit page: "N of M done · about X min
 * left". A batch has no row of its own; the server says how many pages have
 * an audit running and when the oldest started (AuditedPages.running), and
 * the batch is what those reads add up to. Pure, so the page only feeds it
 * reads and shows what it returns.
 */

export interface Batch {
  /** When the batch's first audit started, by the server's clock: what "This batch" lists from. */
  since: string;
  /** The audits the batch started, counting any added while it ran. */
  total: number;
  /** Audits still running at the last read. */
  running: number;
  /** When this page first saw the batch (this browser's clock): the ETA is measured from it. */
  seenAt: number;
  /** No audit is running any more. */
  finished: boolean;
}

/**
 * The batch after a read of the running audits: a new one when audits run and
 * none was being followed (or the last one finished), the same one with its
 * running count and total updated while audits run, finished once none does.
 * `now` is this browser's clock, in ms.
 */
export function nextBatch(
  batch: Batch | null,
  running: { count: number; since: string | null },
  now: number,
): Batch | null {
  if (running.count > 0 && running.since) {
    if (!batch || batch.finished) {
      return {
        since: running.since,
        total: running.count,
        running: running.count,
        seenAt: now,
        finished: false,
      };
    }
    // More audits started while it ran: the total grows by what's new.
    const done = batch.total - batch.running;
    const total = Math.max(batch.total, done + running.count);
    return { ...batch, total, running: running.count };
  }
  if (batch && !batch.finished) return { ...batch, running: 0, finished: true };
  return batch;
}

export interface BatchProgress {
  done: number;
  total: number;
  /** 0 to 1. */
  fraction: number;
  /** Whole minutes left, at least 1; null until an audit has finished since the page saw the batch. */
  minutesLeft: number | null;
}

/** How far the batch is, and about how long it has left at the pace it has kept so far. */
export function batchProgress(batch: Batch, now: number): BatchProgress {
  const done = Math.max(0, Math.min(batch.total, batch.total - batch.running));
  // What was done when the page first saw the batch isn't this page's pace: the
  // batch is followed from its first read, where nothing had finished.
  const elapsed = now - batch.seenAt;
  const minutesLeft =
    batch.finished || batch.running === 0 || done === 0 || elapsed <= 0
      ? null
      : Math.max(1, Math.ceil((batch.running * (elapsed / done)) / 60_000));
  return {
    done,
    total: batch.total,
    fraction: batch.total === 0 ? 0 : done / batch.total,
    minutesLeft,
  };
}
