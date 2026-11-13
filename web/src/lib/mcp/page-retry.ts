/**
 * A page read that times out is tried once more after a short pause. If it
 * times out again the result says so ({ ok: false, code: 'timeout',
 * incomplete: true, message }) instead of throwing or looking like a success,
 * so what the model says of that page is marked incomplete. Any other
 * refusal or error is passed on as before.
 */

export const RETRY_PAUSE_MS = 1500;

const isTimeoutError = (err: unknown) =>
  err instanceof Error &&
  (err.name === 'TimeoutError' ||
    err.name === 'AbortError' ||
    (err as { code?: unknown }).code === 'ETIMEDOUT');

type Read = { ok: boolean; code?: string };

export async function readWithRetry<T extends Read>(
  read: () => Promise<T>,
  incompleteMessage: () => string,
  pauseMs: number = RETRY_PAUSE_MS,
): Promise<T | { ok: false; code: 'timeout'; message: string; incomplete: true }> {
  const attempt = async (): Promise<T | null> => {
    try {
      const res = await read();
      return !res.ok && res.code === 'timeout' ? null : res;
    } catch (err) {
      if (isTimeoutError(err)) return null;
      throw err;
    }
  };
  const first = await attempt();
  if (first) return first;
  await new Promise((resolve) => setTimeout(resolve, pauseMs));
  const second = await attempt();
  if (second) return second;
  return { ok: false, code: 'timeout', message: incompleteMessage(), incomplete: true };
}
