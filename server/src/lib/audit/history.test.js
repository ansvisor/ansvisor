import { describe, expect, it } from 'vitest';
import { buildTrendPoints, parseListPage, LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT } from './history.js';

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
