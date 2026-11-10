import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { logger } = await import('./logger.js');
const { normalisePath, posthogAppHost, readPersonSummary } =
  await import('./posthog-person-summary.js');

/**
 * The person's last 14 days, from PostHog's query API, for the team's cancel
 * e-mail: only with a key and a project, the person as a placeholder, and
 * { ok: false } rather than a throw when PostHog fails.
 */

const USER = '5f0c6a8e-1b2d-4c3e-9f4a-0123456789ab';
const config = {
  key: 'phx_test',
  projectId: '12345',
  appHost: 'https://eu.posthog.com',
};

const answer = (columns, results) => ({
  ok: true,
  status: 200,
  json: async () => ({ columns, results, types: [] }),
});

/** PostHog's answers by query name: totals, top pages, top events. */
function posthog({
  totals = [[42, 5, 3, '2026-11-09T16:45:00Z']],
  pages = [
    ['/dashboard/brands/:id/prompts', 20],
    ['/dashboard', 12],
  ],
  events = [
    ['cancel_dialog_opened', 2],
    ['chat_starter_clicked', 1],
  ],
} = {}) {
  return vi.fn(async (_url, init) => {
    const { name } = JSON.parse(init.body);
    if (name.endsWith('totals')) {
      return answer(['pageviews', 'sessions', 'active_days', 'last_seen'], totals);
    }
    if (name.endsWith('top pages')) return answer(['path', 'views'], pages);
    return answer(['event', 'n'], events);
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

describe('readPersonSummary', () => {
  it('reads nothing without a key or a project, as a self-hosted install has neither', async () => {
    const fetcher = vi.fn();
    expect(await readPersonSummary(USER, { ...config, key: '', fetcher })).toBeNull();
    expect(await readPersonSummary(USER, { ...config, key: undefined, fetcher })).toBeNull();
    expect(await readPersonSummary(USER, { ...config, projectId: '', fetcher })).toBeNull();
    expect(await readPersonSummary('', { ...config, fetcher })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('asks the query API with the key, the person only as the {id} placeholder', async () => {
    const fetcher = posthog();
    await readPersonSummary(USER, { ...config, fetcher });
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
      // Never written into the query itself.
      expect(body.query.query).not.toContain(USER);
    }
    const totals = queryNamed(fetcher, 'totals');
    expect(totals).toContain("event = '$pageview'");
    expect(totals).toContain('count(DISTINCT properties.$session_id)');
    expect(totals).toContain('count(DISTINCT toDate(timestamp))');
    expect(queryNamed(fetcher, 'top pages')).toContain('LIMIT 8');
    // Product events only, by name: PostHog's own ($pageview, $autocapture…) are left out.
    const events = queryNamed(fetcher, 'top events');
    expect(events).toContain("NOT startsWith(event, '$')");
    expect(events).toContain('LIMIT 10');
  });

  it('keeps the placeholder for an id that looks like HogQL', async () => {
    const fetcher = posthog();
    const id = "x' OR 1=1 --";
    await readPersonSummary(id, { ...config, fetcher });
    for (const [, init] of fetcher.mock.calls) {
      const { query } = JSON.parse(init.body);
      expect(query.values).toEqual({ id });
      expect(query.query).not.toContain('OR 1=1');
    }
  });

  it('maps the answers, with a link to the person in PostHog', async () => {
    const summary = await readPersonSummary(USER, { ...config, fetcher: posthog() });
    expect(summary).toEqual({
      ok: true,
      days: 14,
      pageviews: 42,
      sessions: 5,
      activeDays: 3,
      lastSeen: '2026-11-09T16:45:00.000Z',
      topPages: [
        { path: '/dashboard/brands/:id/prompts', views: 20 },
        { path: '/dashboard', views: 12 },
      ],
      events: [
        { event: 'cancel_dialog_opened', count: 2 },
        { event: 'chat_starter_clicked', count: 1 },
      ],
      personUrl: `https://eu.posthog.com/project/12345/person/${USER}`,
    });
  });

  it('says nobody was seen when there were no page views', async () => {
    // ClickHouse's max() of no rows is the epoch.
    const summary = await readPersonSummary('u 1', {
      ...config,
      fetcher: posthog({ totals: [[0, 0, 0, '1970-01-01T00:00:00Z']], pages: [], events: [] }),
    });
    expect(summary).toMatchObject({
      ok: true,
      pageviews: 0,
      sessions: 0,
      activeDays: 0,
      lastSeen: null,
      topPages: [],
      events: [],
      personUrl: 'https://eu.posthog.com/project/12345/person/u%201',
    });
  });

  it('shows pages with ids as :id and without /en, grouped', async () => {
    const fetcher = posthog({
      pages: [
        ['/en/dashboard/brands/0f1e2d3c-4b5a-4968-8776-655443322110/prompts', 7],
        ['/dashboard/brands/AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE/prompts', 5],
        ['/en', 2],
      ],
    });
    const summary = await readPersonSummary(USER, { ...config, fetcher });
    expect(summary.topPages).toEqual([
      { path: '/dashboard/brands/:id/prompts', views: 12 },
      { path: '/', views: 2 },
    ]);
    // The same patterns group them in PostHog, so the top 8 are of the grouped pages.
    const pages = queryNamed(fetcher, 'top pages');
    expect(pages).toContain("replaceRegexpAll(properties.$pathname, '[0-9a-fA-F]{8}-");
    expect(pages).toContain("'^/en(/|$)', '/') AS path");
    expect(pages).toContain('GROUP BY path');
  });

  it('answers { ok: false } for a refused query, without throwing', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect(await readPersonSummary(USER, { ...config, fetcher })).toEqual({ ok: false });
    expect(logger.warn).toHaveBeenCalledWith({ status: 500 }, '[posthog-person-summary] not read');
  });

  it('answers { ok: false } for an answer that is not JSON, or has no results', async () => {
    const badJson = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    }));
    expect(await readPersonSummary(USER, { ...config, fetcher: badJson })).toEqual({ ok: false });
    expect(logger.warn).toHaveBeenCalledWith(
      { err: { name: 'SyntaxError' } },
      '[posthog-person-summary] not read',
    );

    const noResults = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    expect(await readPersonSummary(USER, { ...config, fetcher: noResults })).toEqual({
      ok: false,
    });
  });

  it('gives up at the deadline, even on a fetcher that ignores the signal', async () => {
    const hangs = vi.fn(() => new Promise(() => {}));
    const started = Date.now();
    expect(await readPersonSummary(USER, { ...config, fetcher: hangs, timeoutMs: 30 })).toEqual({
      ok: false,
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(logger.warn).toHaveBeenCalledWith(
      { err: { name: 'TimeoutError' } },
      '[posthog-person-summary] not read',
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
    expect(await readPersonSummary(USER, { ...config, fetcher: listens, timeoutMs: 30 })).toEqual({
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
      const summary = await readPersonSummary(USER, {
        key: 'phx_test',
        projectId: '7',
        fetcher,
      });
      expect(fetcher.mock.calls[0][0]).toBe('https://eu.posthog.com/api/projects/7/query/');
      expect(summary.personUrl).toBe(`https://eu.posthog.com/project/7/person/${USER}`);
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

describe('normalisePath', () => {
  it('turns ids into :id and drops the /en prefix, and only that', () => {
    expect(normalisePath(`/en/dashboard/brands/${USER}/content/${USER}`)).toBe(
      '/dashboard/brands/:id/content/:id',
    );
    expect(normalisePath('/en')).toBe('/');
    expect(normalisePath('/enterprise')).toBe('/enterprise');
    expect(normalisePath('/dashboard/settings/billing')).toBe('/dashboard/settings/billing');
  });
});
