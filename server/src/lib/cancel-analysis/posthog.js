import { logger } from '../logger.js';

/**
 * What one person did in Ansvisor lately, read from PostHog's query API for
 * the cancel analysis (index.js): their page views, their product events and
 * their rage and dead clicks, as rows. activity.js makes sense of them.
 *
 * The person is their user id: the web identifies with session.user.id
 * (auth-provider.tsx), and the server's own events use it too
 * (product-events.js). It goes to PostHog only as the {id} placeholder.
 *
 * Read with a personal API key that has only the query:read scope
 * (POSTHOG_PERSONAL_API_KEY) for POSTHOG_PROJECT_ID. Either unset (the
 * self-hosted default): null, and nothing is read. Never throws: a refused,
 * failed, malformed or slow answer is logged by status or error name and
 * comes back as { ok: false }.
 */

const DEFAULT_APP_HOST = 'https://us.posthog.com';
/** One deadline for the three queries. Nothing waits on them: the customer has their answer. */
const TIMEOUT_MS = 10_000;
/** The most rows a query brings back; the newest are kept. */
export const ROW_LIMIT = 2000;
export const CLICK_ROW_LIMIT = 500;

/** Whether the analysis can read PostHog: a key and a project. */
export function posthogConfigured(env = process.env) {
  return Boolean(env.POSTHOG_PERSONAL_API_KEY && env.POSTHOG_PROJECT_ID);
}

/**
 * PostHog's app (where the API, the people and the replays are), which isn't
 * the ingestion host the events go to: POSTHOG_APP_HOST, else POSTHOG_HOST
 * with a cloud ingestion host (https://us.i.posthog.com) turned into its app
 * (https://us.posthog.com), any other host as it is (a self-hosted PostHog
 * serves both), else the US cloud.
 */
export function posthogAppHost({
  appHost = process.env.POSTHOG_APP_HOST,
  host = process.env.POSTHOG_HOST,
} = {}) {
  if (appHost) return appHost.replace(/\/+$/, '');
  if (!host) return DEFAULT_APP_HOST;
  try {
    const url = new URL(host);
    const cloud = url.hostname.match(/^([a-z]+)\.i\.posthog\.com$/);
    if (cloud) return `https://${cloud[1]}.posthog.com`;
    return url.origin;
  } catch {
    return DEFAULT_APP_HOST;
  }
}

/**
 * The three queries, newest rows first so a limit cuts the oldest. The person
 * is the {id} placeholder, filled by PostHog from `values`.
 *
 *   * pageviews: each $pageview, its path and session;
 *   * events: each product event (PostHog's own, $…, left out), with the
 *     properties the friction and cancel events carry;
 *   * clicks: rage and dead clicks per page address and session, from
 *     PostHog's `heatmaps` table. A $$heatmap event never reaches `events`:
 *     PostHog's ingestion turns its $heatmap_data into one `heatmaps` row per
 *     point and keeps nothing else.
 */
export function personQueries(days) {
  const since = `timestamp >= now() - INTERVAL ${days} DAY`;
  return {
    pageviews: `SELECT timestamp, properties.$pathname AS pathname, properties.$session_id AS sid
FROM events
WHERE event = '$pageview' AND distinct_id = {id} AND ${since}
ORDER BY timestamp DESC
LIMIT ${ROW_LIMIT}`,
    events: `SELECT event, timestamp, properties.$pathname AS pathname, properties.$session_id AS sid,
  properties.feature AS feature, properties.reason AS reason, properties.source AS source,
  properties.kind AS kind, properties.flow AS flow, properties.target AS target,
  properties.error_code AS error_code
FROM events
WHERE NOT startsWith(event, '$') AND distinct_id = {id} AND ${since}
ORDER BY timestamp DESC
LIMIT ${ROW_LIMIT}`,
    clicks: `SELECT current_url AS url, session_id AS sid, type, count() AS n, min(timestamp) AS first_at
FROM heatmaps
WHERE distinct_id = {id} AND type IN ('rageclick', 'deadclick') AND ${since}
GROUP BY url, sid, type
ORDER BY n DESC
LIMIT ${CLICK_ROW_LIMIT}`,
  };
}

/** A query's rows as objects, by the columns PostHog names (HogQLQueryResponse). */
function rowsOf(body) {
  if (!Array.isArray(body?.results)) throw new TypeError('PostHog answered without results');
  const columns = Array.isArray(body.columns) ? body.columns : [];
  return body.results.map((row) =>
    Object.fromEntries(columns.map((column, i) => [column, Array.isArray(row) ? row[i] : null])),
  );
}

/**
 * The person's rows for the last `days` days.
 *
 * @param {string} distinctId the user id
 * @param {{ days?: number, key?: string, projectId?: string, appHost?: string,
 *   fetcher?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<null | { ok: false } | { ok: true, days: number, appHost: string,
 *   projectId: string, pageviews: object[], events: object[], clicks: object[] }>}
 */
export async function readPersonRows(
  distinctId,
  {
    days = 14,
    key = process.env.POSTHOG_PERSONAL_API_KEY,
    projectId = process.env.POSTHOG_PROJECT_ID,
    appHost,
    fetcher = fetch,
    timeoutMs = TIMEOUT_MS,
  } = {},
) {
  if (!key || !projectId || !distinctId) return null;

  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(Object.assign(new Error('PostHog took too long'), { name: 'TimeoutError' })),
    timeoutMs,
  );
  // One deadline for all three, even for a fetcher that doesn't listen to the signal.
  const deadline = new Promise((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
      once: true,
    });
  });
  deadline.catch(() => {});

  try {
    const host = (appHost || posthogAppHost()).replace(/\/+$/, '');
    const url = `${host}/api/projects/${encodeURIComponent(projectId)}/query/`;
    const span = Math.min(Math.max(Math.trunc(Number(days)) || 14, 1), 90);
    const run = async (name, query) => {
      const response = await fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          query: { kind: 'HogQLQuery', query, values: { id: String(distinctId) } },
          // Shown in PostHog's query_log, to tell these apart.
          name: `cancel analysis: ${name}`,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw Object.assign(new Error('PostHog refused the query'), { status: response.status });
      }
      return rowsOf(await response.json());
    };

    const queries = personQueries(span);
    const [pageviews, events, clicks] = await Promise.race([
      Promise.all([
        run('pageviews', queries.pageviews),
        run('events', queries.events),
        run('clicks', queries.clicks),
      ]),
      deadline,
    ]);
    return {
      ok: true,
      days: span,
      appHost: host,
      projectId: String(projectId),
      pageviews,
      events,
      clicks,
    };
  } catch (err) {
    if (err?.status) {
      logger.warn({ status: err.status }, '[cancel-analysis] PostHog not read');
    } else {
      logger.warn({ err: { name: err?.name } }, '[cancel-analysis] PostHog not read');
    }
    return { ok: false };
  } finally {
    clearTimeout(timer);
    // Whatever is still running is no longer wanted.
    controller.abort();
  }
}
