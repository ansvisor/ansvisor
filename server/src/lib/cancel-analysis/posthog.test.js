import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { logger } = await import('../logger.js');
const { posthogAppHost, posthogConfigured, readPersonRows } = await import('./posthog.js');

/**
 * The person's rows from PostHog's query API, for the cancel analysis: only
 * with a key and a project, the person only as a placeholder, and
 * { ok: false } rather than a throw when PostHog fails.
 */

const USER = '5f0c6a8e-1b2d-4c3e-9f4a-0123456789ab';
const config = { key: 'phx_test', projectId: '12345', appHost: 'https://eu.posthog.com' };

const answer = (columns, results) => ({
  ok: true,
  status: 200,
  json: async () => ({ columns, results, types: [] }),
});

/** PostHog's answers by query name. */
function posthog({
  pageviews = [['2026-11-09T16:45:00+03:00', '/dashboard', 's1']],
  events = [['cancel_dialog_opened', '2026-11-09T16:50:00Z', '/dashboard/settings/billing', 's1']],
  clicks = [['https://app.ansvisor.com/dashboard', 's1', 'rageclick', 3, '2026-11-09T16:46:00Z']],
} = {}) {
  return vi.fn(async (_url, init) => {
    const { name } = JSON.parse(init.body);
    if (name.endsWith('pageviews')) return answer(['timestamp', 'pathname', 'sid'], pageviews);
    if (name.endsWith('events')) return answer(['event', 'timestamp', 'pathname', 'sid'], events);
    return answer(['url', 'sid', 'type', 'n', 'first_at'], clicks);
  });
}

/** The HogQL a fetcher was sent under that name. */
const queryNamed = (fetcher, name) =>
  fetcher.mock.calls
    .map(([, init]) => JSON.parse(init.body))
    .find((body) => body.name.endsWith(name)).query.query;

beforeEach(() => {
  logger.warn.mockClear();
});

describe('posthogConfigured', () => {
  it('needs both the key and the project', () => {
    expect(posthogConfigured({ POSTHOG_PERSONAL_API_KEY: 'k', POSTHOG_PROJECT_ID: '1' })).toBe(
      true,
    );
    expect(posthogConfigured({ POSTHOG_PERSONAL_API_KEY: 'k' })).toBe(false);
    expect(posthogConfigured({ POSTHOG_PROJECT_ID: '1' })).toBe(false);
    expect(posthogConfigured({})).toBe(false);
  });
});

describe('readPersonRows', () => {
  it('reads nothing without a key or a project, as a self-hosted install has neither', async () => {
    const fetcher = vi.fn();
    expect(await readPersonRows(USER, { ...config, key: '', fetcher })).toBeNull();
    expect(await readPersonRows(USER, { ...config, key: undefined, fetcher })).toBeNull();
    expect(await readPersonRows(USER, { ...config, projectId: '', fetcher })).toBeNull();
    expect(await readPersonRows('', { ...config, fetcher })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('asks the query API with the key, the person only as the {id} placeholder', async () => {
    const fetcher = posthog();
    await readPersonRows(USER, { ...config, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe('https://eu.posthog.com/api/projects/12345/query/');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer phx_test',
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const body = JSON.parse(init.body);
      expect(body.query.kind).toBe('HogQLQuery');
      expect(body.query.values).toEqual({ id: USER });
      expect(body.query.query).toContain('distinct_id = {id}');
      expect(body.query.query).toContain('INTERVAL 14 DAY');
      expect(body.query.query).not.toContain(USER);
    }
  });

  it('reads page views, product events and rage and dead clicks, newest first', async () => {
    const fetcher = posthog();
    await readPersonRows(USER, { ...config, fetcher });
    const pageviews = queryNamed(fetcher, 'pageviews');
    expect(pageviews).toContain("event = '$pageview'");
    expect(pageviews).toContain('properties.$pathname AS pathname');
    expect(pageviews).toContain('properties.$session_id AS sid');
    expect(pageviews).toContain('ORDER BY timestamp DESC');
    expect(pageviews).toContain('LIMIT 2000');
    // Product events only, with the friction and cancel events' properties.
    const events = queryNamed(fetcher, 'events');
    expect(events).toContain("NOT startsWith(event, '$')");
    for (const property of [
      'feature',
      'reason',
      'source',
      'kind',
      'flow',
      'target',
      'error_code',
    ]) {
      expect(events).toContain(`properties.${property} AS ${property}`);
    }
    expect(events).toContain('LIMIT 2000');
    // PostHog keeps a $$heatmap event's points in `heatmaps`, one row each.
    const clicks = queryNamed(fetcher, 'clicks');
    expect(clicks).toContain('FROM heatmaps');
    expect(clicks).toContain("type IN ('rageclick', 'deadclick')");
    expect(clicks).toContain('GROUP BY url, sid, type');
    expect(clicks).toContain('LIMIT 500');
  });

  it('keeps the placeholder for an id that looks like HogQL', async () => {
    const fetcher = posthog();
    const id = "x' OR 1=1 --";
    await readPersonRows(id, { ...config, fetcher });
    for (const [, init] of fetcher.mock.calls) {
      const { query } = JSON.parse(init.body);
      expect(query.values).toEqual({ id });
      expect(query.query).not.toContain('OR 1=1');
    }
  });

  it('answers the rows by column, with where they came from', async () => {
    expect(await readPersonRows(USER, { ...config, fetcher: posthog() })).toEqual({
      ok: true,
      days: 14,
      appHost: 'https://eu.posthog.com',
      projectId: '12345',
      pageviews: [{ timestamp: '2026-11-09T16:45:00+03:00', pathname: '/dashboard', sid: 's1' }],
      events: [
        {
          event: 'cancel_dialog_opened',
          timestamp: '2026-11-09T16:50:00Z',
          pathname: '/dashboard/settings/billing',
          sid: 's1',
        },
      ],
      clicks: [
        {
          url: 'https://app.ansvisor.com/dashboard',
          sid: 's1',
          type: 'rageclick',
          n: 3,
          first_at: '2026-11-09T16:46:00Z',
        },
      ],
    });
  });

  it('answers { ok: false } for a refused query, without throwing', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect(await readPersonRows(USER, { ...config, fetcher })).toEqual({ ok: false });
    expect(logger.warn).toHaveBeenCalledWith({ status: 500 }, '[cancel-analysis] PostHog not read');
  });

  it('answers { ok: false } for an answer that is not JSON, or has no results', async () => {
    const badJson = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    }));
    expect(await readPersonRows(USER, { ...config, fetcher: badJson })).toEqual({ ok: false });
    expect(logger.warn).toHaveBeenCalledWith(
      { err: { name: 'SyntaxError' } },
      '[cancel-analysis] PostHog not read',
    );
    const noResults = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    expect(await readPersonRows(USER, { ...config, fetcher: noResults })).toEqual({ ok: false });
  });

  it('gives up at the deadline, even on a fetcher that ignores the signal', async () => {
    const hangs = vi.fn(() => new Promise(() => {}));
    const started = Date.now();
    expect(await readPersonRows(USER, { ...config, fetcher: hangs, timeoutMs: 30 })).toEqual({
      ok: false,
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(logger.warn).toHaveBeenCalledWith(
      { err: { name: 'TimeoutError' } },
      '[cancel-analysis] PostHog not read',
    );
    // One that listens is aborted, and the others with it.
    const signals = [];
    const listens = vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signals.push(signal);
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );
    expect(await readPersonRows(USER, { ...config, fetcher: listens, timeoutMs: 30 })).toEqual({
      ok: false,
    });
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('reads from POSTHOG_APP_HOST, or the app of POSTHOG_HOST', async () => {
    vi.stubEnv('POSTHOG_APP_HOST', '');
    vi.stubEnv('POSTHOG_HOST', 'https://eu.i.posthog.com');
    try {
      const fetcher = posthog();
      const rows = await readPersonRows(USER, { key: 'phx_test', projectId: '7', fetcher });
      expect(fetcher.mock.calls[0][0]).toBe('https://eu.posthog.com/api/projects/7/query/');
      expect(rows.appHost).toBe('https://eu.posthog.com');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('posthogAppHost', () => {
  it('prefers POSTHOG_APP_HOST, without a trailing slash', () => {
    expect(
      posthogAppHost({ appHost: 'https://ph.example.com/', host: 'https://eu.i.posthog.com' }),
    ).toBe('https://ph.example.com');
  });

  it('turns a cloud ingestion host into its app', () => {
    expect(posthogAppHost({ appHost: '', host: 'https://us.i.posthog.com' })).toBe(
      'https://us.posthog.com',
    );
    expect(posthogAppHost({ appHost: '', host: 'https://eu.i.posthog.com/' })).toBe(
      'https://eu.posthog.com',
    );
  });

  it('keeps a self-hosted PostHog as it is, and uses the US cloud by default', () => {
    expect(posthogAppHost({ appHost: '', host: 'https://posthog.example.com/' })).toBe(
      'https://posthog.example.com',
    );
    expect(posthogAppHost({ appHost: '', host: '' })).toBe('https://us.posthog.com');
    expect(posthogAppHost({ appHost: undefined, host: 'not a url' })).toBe(
      'https://us.posthog.com',
    );
  });
});
