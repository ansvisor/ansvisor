import { describe, expect, it } from 'vitest';
import {
  AUDIT_RUN_TIMEOUT_MS,
  buildAuditPages,
  buildTrendPoints,
  pageKey,
  pageStatus,
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
  const row = (id, url, createdAt, score = '0.5') => ({
    id,
    url,
    final_url: null,
    total_score: score,
    category_scores: null,
    created_at: createdAt,
  });

  it('keeps primary-domain audits and returns them oldest first', () => {
    const newestFirst = [
      row('c', 'https://www.example.com/', '2026-03-03T00:00:00Z'),
      row('x', 'https://other.com/', '2026-03-02T12:00:00Z'),
      row('b', 'https://example.com/a', '2026-03-02T00:00:00Z'),
      row('a', 'https://example.com/', '2026-03-01T00:00:00Z', null),
    ];
    const points = buildTrendPoints(newestFirst, 'example.com');
    expect(points.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(points[0]).toEqual({
      id: 'a',
      createdAt: '2026-03-01T00:00:00Z',
      totalScore: null,
      categoryScores: {},
    });
    expect(points[2].totalScore).toBe(0.5);
  });

  it('matches on final_url before url', () => {
    const r = { ...row('a', 'https://old.com/', '2026-03-01T00:00:00Z') };
    r.final_url = 'https://example.com/';
    expect(buildTrendPoints([r], 'example.com')).toHaveLength(1);
  });

  it('returns nothing without a primary domain', () => {
    expect(buildTrendPoints([row('a', 'https://example.com/', 'x')], null)).toEqual([]);
    expect(buildTrendPoints(null, 'example.com')).toEqual([]);
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

  it('gives each page one row with its latest score, the previous one and its runs', () => {
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
      status: 'improving',
      lastAuditedAt: '2026-10-14T09:00:00Z',
      trend: [0.5, 0.58, 0.63],
      runCount: 3,
    });
    expect(pages[0].runs.map((r) => r.id)).toEqual(['a3', 'a2', 'a1']);
    expect(pages[1]).toMatchObject({ score: 0.74, previousScore: null, status: 'good' });
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
