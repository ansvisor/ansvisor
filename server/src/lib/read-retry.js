/**
 * Runs a page read, retrying once after a pause when it times out or is
 * aborted. A second timeout gives `{ incomplete: true }` instead of a throw,
 * so the caller can't mistake a missed page for an empty or read one. Any
 * other error passes through. Mirrors web's readWithRetry.
 */
export const RETRY_DELAY_MS = 1_500;

export const isTimeout = (err) =>
  err?.code === 'timeout' ||
  err?.code === 'ETIMEDOUT' ||
  err?.name === 'TimeoutError' ||
  err?.name === 'AbortError';

/**
 * @template T
 * @param {() => Promise<T>} read
 * @param {{ delayMs?: number }} [opts]
 * @returns {Promise<{ incomplete: false, value: T } | { incomplete: true }>}
 */
export async function readWithRetry(read, { delayMs = RETRY_DELAY_MS } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return { incomplete: false, value: await read() };
    } catch (err) {
      if (!isTimeout(err)) throw err;
      if (attempt >= 1) return { incomplete: true };
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
