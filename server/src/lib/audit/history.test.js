import { describe, expect, it } from 'vitest';
import {
  AUDIT_RUN_TIMEOUT_MS,
  buildAuditPages,
  buildTrendPoints,
  findPreviousCompletedAudit,
  pageKey,
  pageStatus,
  pageTrendUpTo,
  parseListPage,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  PAGE_TREND_POINTS,
} from './history.js';

describe('parseListPage', () => {
  it('defaults to the first page of the default size', () => {
    expect(parseListPage({})).toEqual({ limit: LIST_DEFAULT_LIMIT, offset: 0 });
    expect(parseListPage()).toEqual({ limit: LIST_DEFAULT_LIMIT, offset: 0 });
  });

  it('reads limit and offset from query strings', () => {
    expect(parseListPage({ limit: '20', offset: '40' })).toEqual({ limit: 20, offset: 40 });
  });

  it('caps the limit', () => {
    expect(parseListPage({ limit: '10000' }).limit).toBe(LIST_MAX_LIMIT);
  });

  it('falls back on invalid values', () => {
    expect(parseListPage({ limit: '0', offset: '-5' })).toEqual({
      limit: LIST_DEFAULT_LIMIT,
      offset: 0,
    });
    expect(parseListPage({ limit: 'abc', offset: '1.5' })).toEqual({
      limit: LIST_DEFAULT_LIMIT,
      offset: 0,
    });
  });
});

describe('buildTrendPoints', () => {
  const row = (id, url, createdAt, score = '0.5', categories = null) => ({
    id,
    url,
    final_url: null,
    total_score: score,
    category_scores: categories,
    created_at: createdAt,
  });
  const cat = (eeat) => ({ eeat: { score: eeat, evaluated: 4, total: 4 } });

  it('gives the site score after each audit: each page once, through its latest', () => {
    const newestFirst = [
      // The home page again: the site moves by its share, not to its 0.9.
      row('c', 'https://www.example.com/', '2026-03-03T00:00:00Z', '0.9', cat(0.3)),
      row('x', 'https://other.com/', '2026-03-02T12:00:00Z', '0.1'),
      row('b', 'https://example.com/a', '2026-03-02T00:00:00Z', '0.4', cat(0.5)),
      row('a', 'https://example.com/', '2026-03-01T00:00:00Z', '0.6', cat(0.7)),
    ];
    const points = buildTrendPoints(newestFirst, 'example.com');
    expect(points.map((p) => [p.id, p.totalScore, p.pages])).toEqual([
      ['a', 0.6, 1],
      ['b', 0.5, 2],
      ['c', 0.65, 2],
    ]);
    expect(points[2].categoryScores.eeat).toEqual({ score: 0.4, evaluated: 2, total: 2 });
    expect(points[0]).toMatchObject({ id: 'a', createdAt: '2026-03-01T00:00:00Z' });
  });

  it('ends at the Site score card’s number', async () => {
    const { buildOverview, primaryPages } = await import('./overview.js');
    const newestFirst = [
      { ...row('d', 'https://example.com/b', '2026-03-04T00:00:00Z', '0.8'), partial: true },
      row('c', 'https://example.com/', '2026-03-03T00:00:00Z', '0.7'),
      row('b', 'https://example.com/a', '2026-03-02T00:00:00Z', '0.4'),
      row('a', 'https://example.com/', '2026-03-01T00:00:00Z', '0.6'),
    ].map((r) => ({ ...r, status: 'completed' }));
    const { own } = primaryPages(buildAuditPages(newestFirst), 'example.com');
    const card = buildOverview(own, new Map(), []).siteScore;
    expect(buildTrendPoints(newestFirst, 'example.com').at(-1).totalScore).toBeCloseTo(card, 10);
  });

  it('counts a page with only partial audits by its latest, and prefers a complete one', () => {
    const newestFirst = [
      { ...row('b', 'https://example.com/', '2026-03-02T00:00:00Z', '0.9'), partial: true },
      row('a', 'https://example.com/', '2026-03-01T00:00:00Z', '0.5'),
      { ...row('p', 'https://example.com/x', '2026-02-28T00:00:00Z', '0.3'), partial: true },
    ];
    const points = buildTrendPoints(newestFirst, 'example.com');
    // After b: home stays at its complete 0.5; /x at its partial 0.3.
    expect(points.at(-1).totalScore).toBeCloseTo(0.4, 10);
  });

  it('matches on final_url before url, and skips unscored or unfinished audits', () => {
    const r = { ...row('a', 'https://old.com/', '2026-03-01T00:00:00Z') };
    r.final_url = 'https://example.com/';
    expect(buildTrendPoints([r], 'example.com')).toHaveLength(1);
    expect(buildTrendPoints([row('n', 'https://example.com/', 'x', null)], 'example.com')).toEqual(
      [],
    );
    expect(
      buildTrendPoints(
        [{ ...row('r', 'https://example.com/', 'x'), status: 'running' }],
        'example.com',
      ),
    ).toEqual([]);
  });

  it('counts only the site’s pages when they are known, as the card does', () => {
    const newestFirst = [
      row('b', 'https://example.com/not-in-sitemap', '2026-03-02T00:00:00Z', '0.2'),
      row('a', 'https://example.com/', '2026-03-01T00:00:00Z', '0.8'),
    ];
    const points = buildTrendPoints(
      newestFirst,
      'example.com',
      undefined,
      new Set(['example.com/']),
    );
    expect(points.map((p) => [p.id, p.totalScore, p.pages])).toEqual([['a', 0.8, 1]]);
  });

  it('returns nothing without a primary domain, and the newest points past the limit', () => {
    expect(buildTrendPoints([row('a', 'https://example.com/', 'x')], null)).toEqual([]);
    expect(buildTrendPoints(null, 'example.com')).toEqual([]);
    const many = ['c', 'b', 'a'].map((id, i) =>
      row(id, `https://example.com/${id}`, `2026-03-0${3 - i}T00:00:00Z`),
    );
    expect(buildTrendPoints(many, 'example.com', 2).map((p) => p.id)).toEqual(['b', 'c']);
  });
});

describe('pageKey', () => {
  it('reads repeat audits of a page as the same page', () => {
    const keys = [
      'https://acme.com/pricing',
      'https://www.acme.com/pricing/',
      'http://ACME.com/pricing?utm_source=x#plans',
    ].map((u) => pageKey(u).key);
    expect(new Set(keys)).toEqual(new Set(['acme.com/pricing']));
  });

  it('keeps the root, path case and other hosts apart', () => {
    expect(pageKey('https://acme.com')).toEqual({ key: 'acme.com/', host: 'acme.com', path: '/' });
    expect(pageKey('https://acme.com/Blog').key).not.toBe(pageKey('https://acme.com/blog').key);
    expect(pageKey('https://blog.acme.com/pricing').key).toBe('blog.acme.com/pricing');
    expect(pageKey('not a url')).toBeNull();
  });
});

describe('pageStatus', () => {
  const run = (status) => ({ status });
  const audit = (totalScore) => ({ totalScore });

  it('is Good from 70, whatever the previous audit was', () => {
    expect(pageStatus(run('completed'), audit(0.7), audit(0.9))).toBe('good');
  });

  it('reads the score shown: a 69.6 shown as 70 is Good, a 69.4 shown as 69 isn’t', () => {
    expect(pageStatus(run('completed'), audit(0.696), null)).toBe('good');
    expect(pageStatus(run('completed'), audit(0.694), null)).toBe('needs_work');
  });

  it('is Improving below 70 when at least a point up on the previous audit', () => {
    expect(pageStatus(run('completed'), audit(0.65), audit(0.6))).toBe('improving');
    expect(pageStatus(run('completed'), audit(0.654), audit(0.646))).toBe('needs_work');
    expect(pageStatus(run('completed'), audit(0.6), audit(0.65))).toBe('needs_work');
    expect(pageStatus(run('completed'), audit(0.3), null)).toBe('needs_work');
  });

  it('is Running while a run is in progress, and Failed when none ever completed', () => {
    expect(pageStatus(run('running'), audit(0.8), null)).toBe('running');
    expect(pageStatus(run('failed'), null, null)).toBe('failed');
    // A failed retry doesn't hide the last completed score.
    expect(pageStatus(run('failed'), audit(0.8), null)).toBe('good');
  });
});

describe('buildAuditPages', () => {
  const row = (id, url, created_at, total_score, status = 'completed', final_url = url) => ({
    id,
    url,
    final_url: status === 'completed' ? final_url : null,
    status,
    total_score,
    created_at,
  });

  it('gives each page one row with its latest score, the previous one, the first and its runs', () => {
    const pages = buildAuditPages([
      row('a3', 'https://acme.com/pricing/', '2026-10-14T09:00:00Z', '0.63'),
      row('b1', 'https://acme.com/blog', '2026-10-12T09:00:00Z', '0.74'),
      row('a2', 'https://www.acme.com/pricing', '2026-10-01T09:00:00Z', '0.58'),
      row('a1', 'https://acme.com/pricing', '2026-09-20T09:00:00Z', '0.5'),
    ]);

    expect(pages.map((p) => p.key)).toEqual(['acme.com/pricing', 'acme.com/blog']);
    expect(pages[0]).toMatchObject({
      host: 'acme.com',
      path: '/pricing',
      url: 'https://acme.com/pricing/',
      auditId: 'a3',
      score: 0.63,
      previousScore: 0.58,
      firstScore: 0.5,
      firstAuditedAt: '2026-09-20T09:00:00Z',
      status: 'improving',
      lastAuditedAt: '2026-10-14T09:00:00Z',
      trend: [0.5, 0.58, 0.63],
      runCount: 3,
    });
    expect(pages[0].runs.map((r) => r.id)).toEqual(['a3', 'a2', 'a1']);
    // Audited once: its first score is its current one.
    expect(pages[1]).toMatchObject({
      score: 0.74,
      previousScore: null,
      firstScore: 0.74,
      firstAuditedAt: '2026-10-12T09:00:00Z',
      status: 'good',
    });
  });

  it('takes the first score from the oldest completed audit, not a failed or unscored one', () => {
    const [page] = buildAuditPages([
      row('a4', 'https://acme.com/pricing', '2026-10-20T09:00:00Z', '0.7'),
      row('a3', 'https://acme.com/pricing', '2026-10-10T09:00:00Z', '0.6'),
      row('a2', 'https://acme.com/pricing', '2026-10-01T09:00:00Z', null),
      row('a1', 'https://acme.com/pricing', '2026-09-20T09:00:00Z', null, 'failed'),
    ]);
    expect(page).toMatchObject({ firstScore: 0.6, firstAuditedAt: '2026-10-10T09:00:00Z' });

    const [never] = buildAuditPages([
      row('b1', 'https://acme.com/blog', '2026-10-01T09:00:00Z', null, 'failed'),
    ]);
    expect(never).toMatchObject({ score: null, firstScore: null, firstAuditedAt: null });
  });

  it("says whether the audit a row opens was an auto-audit run's", () => {
    const pages = buildAuditPages([
      { ...row('a2', 'https://acme.com/pricing', '2026-10-19T06:00:00Z', '0.6'), source: 'auto' },
      row('a1', 'https://acme.com/pricing', '2026-10-01T09:00:00Z', '0.5'),
      row('b2', 'https://acme.com/blog', '2026-10-18T09:00:00Z', null, 'running'),
      { ...row('b1', 'https://acme.com/blog', '2026-10-01T09:00:00Z', '0.7'), source: 'auto' },
    ]);
    expect(pages[0]).toMatchObject({ auditId: 'a2', lastAuditSource: 'auto' });
    expect(pages[0].runs.map((r) => r.source)).toEqual(['auto', 'user']);
    // A row opens its latest completed audit, a run's here, while a user's re-audit runs.
    expect(pages[1]).toMatchObject({ auditId: 'b1', lastAuditSource: 'auto' });
  });

  it('counts a run repeated at a read boundary once', () => {
    const a2 = row('a2', 'https://acme.com/pricing', '2026-10-14T09:00:00Z', '0.6');
    const a1 = row('a1', 'https://acme.com/pricing', '2026-10-01T09:00:00Z', '0.5');
    const [page] = buildAuditPages([a2, a1, a1]);
    expect(page.runCount).toBe(2);
    expect(page.trend).toEqual([0.5, 0.6]);
  });

  it('groups by the final URL after a redirect', () => {
    const pages = buildAuditPages([
      row(
        'a2',
        'http://acme.com/old',
        '2026-10-14T09:00:00Z',
        '0.6',
        'completed',
        'https://acme.com/new',
      ),
      row('a1', 'https://acme.com/new', '2026-10-01T09:00:00Z', '0.5'),
    ]);
    expect(pages).toHaveLength(1);
    expect(pages[0].runCount).toBe(2);
  });

  it('keeps the last completed score while a re-audit runs or after one fails', () => {
    const [running] = buildAuditPages(
      [
        row('a3', 'https://acme.com/pricing', '2026-10-15T09:00:00Z', null, 'running'),
        row('a2', 'https://acme.com/pricing', '2026-10-14T09:00:00Z', null, 'failed'),
        row('a1', 'https://acme.com/pricing', '2026-10-01T09:00:00Z', '0.58'),
      ],
      Date.parse('2026-10-15T09:05:00Z'),
    );
    expect(running).toMatchObject({
      status: 'running',
      score: 0.58,
      auditId: 'a1',
      lastAuditedAt: '2026-10-01T09:00:00Z',
      runCount: 3,
    });

    const [failed] = buildAuditPages([
      row('b1', 'https://acme.com/blog', '2026-10-15T09:00:00Z', null, 'failed'),
    ]);
    expect(failed).toMatchObject({ status: 'failed', score: null, auditId: 'b1', trend: [] });
  });

  it('reads a run left running past the timeout, cut short by a restart, as failed', () => {
    const rows = [
      row('a2', 'https://acme.com/pricing', '2026-10-15T09:00:00Z', null, 'running'),
      row('a1', 'https://acme.com/pricing', '2026-10-01T09:00:00Z', '0.58'),
    ];
    const start = Date.parse('2026-10-15T09:00:00Z');

    const [stillRunning] = buildAuditPages(rows, start + AUDIT_RUN_TIMEOUT_MS);
    expect(stillRunning.status).toBe('running');

    const [cutShort] = buildAuditPages(rows, start + AUDIT_RUN_TIMEOUT_MS + 1);
    expect(cutShort).toMatchObject({ status: 'needs_work', score: 0.58, auditId: 'a1' });
    expect(cutShort.runs[0]).toMatchObject({ id: 'a2', status: 'failed' });
  });

  it('keeps the last complete score after a partial audit, which is never compared', () => {
    const partial = (r) => ({ ...r, partial: true });
    const [page] = buildAuditPages([
      partial(row('a3', 'https://acme.com/pricing', '2026-10-15T09:00:00Z', '0.72')),
      row('a2', 'https://acme.com/pricing', '2026-10-14T09:00:00Z', '0.63'),
      row('a1', 'https://acme.com/pricing', '2026-10-01T09:00:00Z', '0.58'),
    ]);
    expect(page).toMatchObject({
      auditId: 'a2',
      score: 0.63,
      previousScore: 0.58,
      status: 'improving',
      trend: [0.58, 0.63],
      runCount: 3,
    });
    expect(page.runs[0]).toMatchObject({ id: 'a3', partial: true });

    // A page with only partial audits shows the latest, with nothing to compare.
    const [only] = buildAuditPages([
      partial(row('b2', 'https://acme.com/blog', '2026-10-15T09:00:00Z', '0.65')),
      partial(row('b1', 'https://acme.com/blog', '2026-10-14T09:00:00Z', '0.55')),
    ]);
    expect(only).toMatchObject({
      auditId: 'b2',
      score: 0.65,
      previousScore: null,
      firstScore: null,
      firstAuditedAt: null,
      status: 'needs_work',
      trend: [],
    });
  });

  it('skips partial runs for the first score too', () => {
    const partial = (r) => ({ ...r, partial: true });
    const [page] = buildAuditPages([
      row('a3', 'https://acme.com/pricing', '2026-10-20T09:00:00Z', '0.7'),
      row('a2', 'https://acme.com/pricing', '2026-10-10T09:00:00Z', '0.6'),
      // The page's oldest run was partial: never its first score.
      partial(row('a1', 'https://acme.com/pricing', '2026-10-01T09:00:00Z', '0.4')),
    ]);
    expect(page).toMatchObject({ firstScore: 0.6, firstAuditedAt: '2026-10-10T09:00:00Z' });
  });

  it('draws the trend from the newest completed scores, oldest first', () => {
    const rows = Array.from({ length: PAGE_TREND_POINTS + 3 }, (_, i) =>
      row(
        `a${i}`,
        'https://acme.com/',
        `2026-10-${String(20 - i).padStart(2, '0')}T09:00:00Z`,
        String(0.9 - i / 100),
      ),
    );
    const [page] = buildAuditPages(rows);
    expect(page.trend).toHaveLength(PAGE_TREND_POINTS);
    expect(page.trend.at(-1)).toBe(0.9);
    expect(page.trend[0]).toBeCloseTo(0.81);
  });
});

describe('findPreviousCompletedAudit', () => {
  const row = (id, url, created_at, total_score, status = 'completed', final_url = url) => ({
    id,
    url,
    final_url,
    status,
    total_score,
    created_at,
  });

  it('chooses the nearest earlier completed audit of the same normalized URL', () => {
    const rows = [
      row('later', 'https://acme.com/pricing', '2026-10-20T09:00:00Z', '0.8'),
      row('current', 'https://www.acme.com/pricing/?campaign=x', '2026-10-10T09:00:00Z', '0.7'),
      row('failed', 'https://acme.com/pricing/', '2026-10-09T09:00:00Z', '0.99', 'failed'),
      row('previous', 'http://ACME.com/pricing?utm_source=x', '2026-10-08T09:00:00Z', '0.61'),
      row('older', 'https://acme.com/pricing', '2026-09-20T09:00:00Z', '0.55'),
      row('other-page', 'https://acme.com/blog', '2026-10-09T09:00:00Z', '0.9'),
    ];

    expect(findPreviousCompletedAudit(rows, 'current')).toEqual({
      auditId: 'previous',
      totalScore: 0.61,
      createdAt: '2026-10-08T09:00:00Z',
    });
  });

  it('uses final_url for page identity when an audit followed a redirect', () => {
    const rows = [
      row(
        'current',
        'http://acme.com/old',
        '2026-10-10T09:00:00Z',
        '0.7',
        'completed',
        'https://acme.com/new',
      ),
      row('previous', 'https://www.acme.com/new/?utm_source=x', '2026-10-01T09:00:00Z', '0.6'),
    ];

    expect(findPreviousCompletedAudit(rows, 'current')?.auditId).toBe('previous');
  });

  it('ignores unscored rows and rows with the same or later created_at', () => {
    const rows = [
      row('current', 'https://acme.com/', '2026-10-10T09:00:00Z', '0.7'),
      row('same-time', 'https://acme.com/', '2026-10-10T09:00:00Z', '0.8'),
      row('unscored', 'https://acme.com/', '2026-10-09T09:00:00Z', null),
      row('later', 'https://acme.com/', '2026-10-11T09:00:00Z', '0.9'),
    ];

    expect(findPreviousCompletedAudit(rows, 'current')).toBeNull();
  });

  it('never compares a partial audit, as the current one or the previous', () => {
    const rows = [
      { ...row('current', 'https://acme.com/', '2026-10-10T09:00:00Z', '0.7'), partial: false },
      { ...row('partial', 'https://acme.com/', '2026-10-09T09:00:00Z', '0.9'), partial: true },
      row('previous', 'https://acme.com/', '2026-10-08T09:00:00Z', '0.6'),
    ];
    expect(findPreviousCompletedAudit(rows, 'current')?.auditId).toBe('previous');
    expect(findPreviousCompletedAudit(rows, 'partial')).toBeNull();
  });

  it('returns null when the current audit is missing, unfinished, or has no score', () => {
    expect(findPreviousCompletedAudit([], 'missing')).toBeNull();
    expect(
      findPreviousCompletedAudit(
        [row('running', 'https://acme.com/', '2026-10-10T09:00:00Z', null, 'running')],
        'running',
      ),
    ).toBeNull();
    expect(
      findPreviousCompletedAudit(
        [row('unscored', 'https://acme.com/', '2026-10-10T09:00:00Z', null)],
        'unscored',
      ),
    ).toBeNull();
  });
});

describe('pageTrendUpTo', () => {
  const row = (id, created_at, total_score, over = {}) => ({
    id,
    url: 'https://acme.com/pricing',
    final_url: 'https://acme.com/pricing',
    status: 'completed',
    total_score,
    created_at,
    ...over,
  });
  const day = (d) => `2026-10-${String(d).padStart(2, '0')}T09:00:00Z`;

  it("reads the page's completed scores up to the audit, oldest first, ending with it", () => {
    const rows = [
      row('later', day(20), '0.9'),
      row('current', day(14), '0.64'),
      row('other-page', day(13), '0.2', { url: 'https://acme.com/blog', final_url: null }),
      row('failed', day(12), null, { status: 'failed' }),
      row('partial', day(11), '0.4', { partial: true }),
      row('b', day(10), '0.62'),
      row('www', day(5), '0.66', { url: 'https://www.acme.com/pricing/', final_url: null }),
    ];
    expect(pageTrendUpTo(rows, 'current')).toEqual([0.66, 0.62, 0.64]);
  });

  it('stops at the Pages list trend length', () => {
    const rows = Array.from({ length: PAGE_TREND_POINTS + 4 }, (_, i) =>
      row(`a${i}`, day(25 - i), String(0.5 + i / 100)),
    );
    const trend = pageTrendUpTo(rows, 'a0');
    expect(trend).toHaveLength(PAGE_TREND_POINTS);
    expect(trend.at(-1)).toBe(0.5);
  });

  it('is empty for an audit that is never compared: partial, unfinished or not found', () => {
    const rows = [
      row('partial', day(14), '0.7', { partial: true }),
      row('running', day(13), null, { status: 'running' }),
      row('older', day(10), '0.6'),
    ];
    expect(pageTrendUpTo(rows, 'partial')).toEqual([]);
    expect(pageTrendUpTo(rows, 'running')).toEqual([]);
    expect(pageTrendUpTo(rows, 'missing')).toEqual([]);
    expect(pageTrendUpTo(rows, 'older')).toEqual([0.6]);
  });
});

describe('buildAuditPages and analytics placeholders', () => {
  it('leaves an audited "/(not%20set)" out of the pages', () => {
    const rows = [
      {
        id: 'n',
        url: 'https://acme.com/(not%20set)',
        final_url: null,
        status: 'failed',
        total_score: null,
        created_at: '2026-10-22T00:00:00Z',
      },
      {
        id: 'p',
        url: 'https://acme.com/pricing',
        final_url: null,
        status: 'completed',
        total_score: '0.7',
        created_at: '2026-10-22T00:00:00Z',
      },
    ];
    expect(buildAuditPages(rows).map((p) => p.path)).toEqual(['/pricing']);
  });
});
