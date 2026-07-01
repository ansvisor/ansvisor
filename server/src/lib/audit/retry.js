/**
 * Retry wrapper for the audit's LLM calls. Provider blips (rate limits,
 * transient 5xx, the occasional malformed structured-output response) should
 * not silently drop a whole audit's LLM verdicts or recommendations — one bad
 * round-trip is usually fixed by trying again a moment later.
 */

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ attempts?: number, baseDelayMs?: number, label?: string }} [opts]
 * @returns {Promise<T>}
 */
import { logger } from '../logger.js';

export async function withRetry(fn, { attempts = 3, baseDelayMs = 500, label = 'llm' } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const delay = baseDelayMs * 2 ** i;
        logger.warn(
          { label, attempt: i + 1, attempts, delayMs: delay, err: err.message },
          `[audit] ${label} attempt ${i + 1}/${attempts} failed; retrying`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastErr;
}
