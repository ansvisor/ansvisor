import { logger } from './logger.js';

/**
 * Product events the server sends itself, to the same PostHog project as the
 * web's (web/src/lib/analytics.ts): what a job does with nobody's browser
 * open, such as a daily suggestion sent (CHAT-26 §7). The same rules as the
 * web's helper: nothing is sent unless POSTHOG_KEY is set (the cloud sets it
 * to the web's NEXT_PUBLIC_POSTHOG_KEY; a self-hosted install leaves it
 * unset, so no telemetry leaves it), the person is their user id (the web's
 * identify), and properties carry ids, kinds and counts, never a customer's
 * names, domains or texts.
 *
 * Through PostHog's public batch endpoint with fetch: no SDK. Never throws:
 * an event that doesn't go is logged by count and dropped, as a browser's
 * would be.
 */

const DEFAULT_HOST = 'https://us.i.posthog.com';
/** Events per request: well under PostHog's 20 MB batch limit. */
const BATCH = 500;
const TIMEOUT_MS = 10_000;

/**
 * Sends events; says how many went (0 with no key).
 *
 * @param {Array<{ event: string, distinctId: string, properties?: Record<string, unknown>,
 *   timestamp?: string }>} events
 * @param {{ key?: string, host?: string, fetcher?: typeof fetch }} [options]
 * @returns {Promise<number>}
 */
export async function captureProductEvents(
  events,
  { key = process.env.POSTHOG_KEY, host = process.env.POSTHOG_HOST, fetcher = fetch } = {},
) {
  if (!key || events.length === 0) return 0;
  const url = `${(host || DEFAULT_HOST).replace(/\/+$/, '')}/batch/`;
  let sent = 0;
  for (let i = 0; i < events.length; i += BATCH) {
    const chunk = events.slice(i, i + BATCH);
    try {
      const response = await fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: key,
          batch: chunk.map(({ event, distinctId, properties = {}, timestamp }) => ({
            event,
            distinct_id: distinctId,
            properties: { ...properties, distinct_id: distinctId, $lib: 'ansvisor-server' },
            ...(timestamp ? { timestamp } : {}),
          })),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        logger.warn({ status: response.status, events: chunk.length }, '[product-events] not sent');
        continue;
      }
      sent += chunk.length;
    } catch (err) {
      logger.warn({ err: { name: err?.name }, events: chunk.length }, '[product-events] not sent');
    }
  }
  return sent;
}
