/**
 * What one `/api` request reads once and keeps until it ends: the caller's
 * brand access (lib/access.js), however many brands the route checks. Kept
 * per request, never longer, so access taken away counts from the next
 * request on. Outside a request (a job, a socket, a test) every read is
 * fresh.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const scope = new AsyncLocalStorage();

/** Express middleware: the request's own store, for the routes after it. */
export function requestScope(req, res, next) {
  scope.run(new Map(), next);
}

/**
 * `read()` once in this request, its promise kept under `key`; read again
 * outside one. A failed read isn't kept: the next caller tries again.
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} read
 * @returns {Promise<T>}
 */
export function oncePerRequest(key, read) {
  const kept = scope.getStore();
  if (!kept) return read();
  if (!kept.has(key)) {
    kept.set(
      key,
      read().catch((err) => {
        kept.delete(key);
        throw err;
      }),
    );
  }
  return kept.get(key);
}
