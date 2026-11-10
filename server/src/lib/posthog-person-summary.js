import { logger } from './logger.js';

/**
 * What one person did in Ansvisor lately, read from PostHog for the team's
 * cancel e-mail (cancel-feedback.js): their sessions, active days and page
 * views, the pages they opened most and the product events they sent, with
 * a link to their PostHog profile (its Recordings tab has the replays).
 *
 * The person is their user id: the web identifies with session.user.id
 * (auth-provider.tsx), and the server's own events use it too
 * (product-events.js).
 *
 * Read through PostHog's query API with a personal API key that has only
 * the query:read scope (POSTHOG_PERSONAL_API_KEY) for POSTHOG_PROJECT_ID.
 * Either unset (the self-hosted default): null, and nothing is read. Never
 * throws: a refused, failed, malformed or slow answer is logged by status or
 * error name and comes back as { ok: false }.
 */

const DEFAULT_APP_HOST = 'https://us.posthog.com';
const TIMEOUT_MS = 6_000;
const TOP_PAGES = 8;
const TOP_EVENTS = 10;

/** A UUID anywhere in a path, and the web's locale prefix (web/src/i18n/routing.ts). */
const UUID_PATTERN = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const LOCALE_PATTERN = '^/en(/|$)';

/**
 * A page as the team reads it: ids as :id and no /en prefix, so a brand's
 * pages group together and no id leaves PostHog. The same patterns run in
 * the query (ClickHouse's regexes read them as JavaScript does).
 */
export function normalisePath(path) {
  return String(path ?? '')
    .replace(new RegExp(UUID_PATTERN, 'g'), ':id')
    .replace(new RegExp(LOCALE_PATTERN), '/');
}

/**
 * PostHog's app (where the API and the person pages are), which isn't the
 * ingestion host the events go to: POSTHOG_APP_HOST, else POSTHOG_HOST with
 * a cloud ingestion host (https://us.i.posthog.com) turned into its app
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

/** The three queries. The person is the {id} placeholder, filled by PostHog from values. */
function personQueries(days) {
  const since = `distinct_id = {id} AND timestamp >= now() - INTERVAL ${days} DAY`;
  return {
    totals: `SELECT count() AS pageviews, count(DISTINCT properties.$session_id) AS sessions,
  count(DISTINCT toDate(timestamp)) AS active_days, max(timestamp) AS last_seen
FROM events
WHERE event = '$pageview' AND ${since}`,
    pages: `SELECT replaceRegexpOne(replaceRegexpAll(properties.$pathname, '${UUID_PATTERN}', ':id'), '${LOCALE_PATTERN}', '/') AS path,
  count() AS views
FROM events
WHERE event = '$pageview' AND properties.$pathname IS NOT NULL AND ${since}
GROUP BY path
ORDER BY views DESC
LIMIT ${TOP_PAGES}`,
    events: `SELECT event, count() AS n
FROM events
WHERE NOT startsWith(event, '$') AND ${since}
GROUP BY event
ORDER BY n DESC
LIMIT ${TOP_EVENTS}`,
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

const count = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** The last page view, or null with none (ClickHouse's max of nothing is 1970). */
function lastSeenOf(value, pageviews) {
  if (!pageviews || !value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() > 2000
    ? date.toISOString()
    : null;
}

/** Pages normalised once more here, so an id PostHog's regex missed still can't show. */
function topPagesOf(rows) {
  const views = new Map();
  for (const row of rows) {
    const path = normalisePath(row.path);
    if (!path) continue;
    views.set(path, (views.get(path) ?? 0) + count(row.views));
  }
  return [...views]
    .map(([path, n]) => ({ path, views: n }))
    .sort((a, b) => b.views - a.views)
    .slice(0, TOP_PAGES);
}

/**
 * The person's last `days` days.
 *
 * @param {string} distinctId the user id
 * @param {{ days?: number, key?: string, projectId?: string, appHost?: string,
 *   fetcher?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<null | { ok: false } | { ok: true, days: number, pageviews: number,
 *   sessions: number, activeDays: number, lastSeen: string | null,
 *   topPages: Array<{ path: string, views: number }>,
 *   events: Array<{ event: string, count: number }>, personUrl: string }>}
 */
export async function readPersonSummary(
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
          name: `cancel e-mail: ${name}`,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw Object.assign(new Error('PostHog refused the query'), { status: response.status });
      }
      return rowsOf(await response.json());
    };

    const queries = personQueries(span);
    const [totals, pages, events] = await Promise.race([
      Promise.all([
        run('totals', queries.totals),
        run('top pages', queries.pages),
        run('top events', queries.events),
      ]),
      deadline,
    ]);

    const total = totals[0] ?? {};
    const pageviews = count(total.pageviews);
    return {
      ok: true,
      days: span,
      pageviews,
      sessions: count(total.sessions),
      activeDays: count(total.active_days),
      lastSeen: lastSeenOf(total.last_seen, pageviews),
      topPages: topPagesOf(pages),
      events: events
        .filter((row) => typeof row.event === 'string' && row.event)
        .map((row) => ({ event: row.event, count: count(row.n) })),
      personUrl: `${host}/project/${encodeURIComponent(projectId)}/person/${encodeURIComponent(distinctId)}`,
    };
  } catch (err) {
    if (err?.status) {
      logger.warn({ status: err.status }, '[posthog-person-summary] not read');
    } else {
      logger.warn({ err: { name: err?.name } }, '[posthog-person-summary] not read');
    }
    return { ok: false };
  } finally {
    clearTimeout(timer);
    // Whatever is still running is no longer wanted.
    controller.abort();
  }
}
