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
 * A read that ran out of time, as the models get it: the same read would too,
 * so they go on without it, and the answer says what it couldn't read (Help:
 * "When something goes wrong").
 */
export const READ_TIMED_OUT =
  "This read took too long and was stopped, and it would again: don't call it again in this run, with any dates or filters. Go on with the other reads, and say in the answer that this data couldn't be read now.";

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
