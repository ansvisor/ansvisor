/**
 * A read's own call (CHAT-20 §11b): a time limit, and one more try after 2 s
 * when it failed. A read that ran out of time isn't tried again: the same
 * read takes as long the second time, while the first is still running in
 * the database, so the retry only doubled the wait (Visibility read on a
 * customer brand, 2026-11-11: "Timed out" after 42 s, twice in one run).
 * A Stop ends it at once. Server only.
 */

/** A read's time limit, and the wait before its one retry (CHAT-20 §11b). */
export const READ_TIMEOUT_MS = 20_000;
export const READ_RETRY_MS = 2_000;

export type ReadAttempt =
  | { ok: true; value: unknown }
  | { ok: false; timedOut: boolean; error: string };

/**
 * A read that ran out of time, as the models get it (the owner's rule,
 * 2026-11-16: never "it couldn't be read"): the same input would run as
 * long, so one narrower try, and the answer says the figure isn't available
 * right now (Help: "When something goes wrong").
 */
export const READ_TIMED_OUT =
  "This read took too long and was stopped. Try it once more, narrower: a shorter period, a filter or a smaller page (limit); never with the same input. Meanwhile go on with the other reads. If the narrower read also takes too long, answer from the rest and say this figure isn't available right now and the person can ask again in a moment; never say it couldn't be read or hit a limit.";

/** A second read of the same tool that ran out of time: no third try. */
export const READ_TIMED_OUT_AGAIN =
  "This read took too long again: don't call it again in this run. Answer from the other reads, and say this figure isn't available right now and the person can ask again in a moment; never say it couldn't be read or hit a limit.";

/** A read that failed after its own retry, or whose scope couldn't be set, as the models get it. */
export const READ_FAILED =
  "This read didn't come back this time. Try the same data once another way if one fits (a summary read, a narrower filter, a shorter period). Otherwise answer from the other reads and say this figure isn't available right now and the person can ask again; never say it couldn't be read.";

class ReadTimeout extends Error {}

export async function attemptRead(
  run: () => Promise<unknown>,
  signal: AbortSignal,
  limits: { timeoutMs: number; retryMs: number } = {
    timeoutMs: READ_TIMEOUT_MS,
    retryMs: READ_RETRY_MS,
  },
): Promise<ReadAttempt> {
  let last: { timedOut: boolean; error: string } = { timedOut: false, error: '' };
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, limits.retryMs));
    if (signal.aborted) return { ok: false, timedOut: false, error: 'stopped' };
    let timer: ReturnType<typeof setTimeout> | null = null;
    let onAbort: (() => void) | null = null;
    try {
      const value = await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ReadTimeout()), limits.timeoutMs);
          // A Stop doesn't wait for the read.
          onAbort = () => reject(new Error('stopped'));
          signal.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
      return { ok: true, value };
    } catch (err) {
      last = {
        timedOut: err instanceof ReadTimeout,
        error: err instanceof Error ? err.message : String(err),
      };
      if (signal.aborted || last.timedOut) break;
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }
  return { ok: false, ...last };
}
