import { describe, expect, it } from 'vitest';
import {
  auditPageKey,
  auditScoreView,
  auditSnapshotFrom,
  type AuditSnapshotRow,
} from './audit-score';

/**
 * The report's Site Audit section: the score in the 0–100 points the audit
 * report shows, compared with the same page's audit before it. Reports saved
 * before kept the 0–1 score to one decimal ("0.6" for 64).
 */

const row = (
  url: string,
  score: number | string | null,
  at: string,
  finalUrl: string | null = null,
): AuditSnapshotRow => ({ url, final_url: finalUrl, total_score: score, created_at: at });

describe('auditPageKey', () => {
  it('groups a page the way the Pages list does', () => {
    expect(auditPageKey(row('https://www.Shop.com/Bags/?ref=x#top', 0, ''))).toBe('shop.com/Bags');
    expect(auditPageKey(row('https://shop.com', 0, ''))).toBe('shop.com/');
    expect(auditPageKey(row('http://old.shop.com/a', 0, '', 'https://shop.com/a/'))).toBe(
      'shop.com/a',
    );
  });

  it('keeps something that isn’t a URL as it is', () => {
    expect(auditPageKey(row('not a url', 0, ''))).toBe('not a url');
  });
});

describe('auditSnapshotFrom', () => {
  it('is null without an audit', () => {
    expect(auditSnapshotFrom([])).toBeNull();
  });

  it('gives the latest score in points, and the same page’s score before it', () => {
    expect(
      auditSnapshotFrom([
        row('https://shop.com/bags', 0.6421, '2026-10-30T00:00:00Z'),
        row('https://shop.com/shoes', 0.91, '2026-10-29T00:00:00Z'),
        row('https://www.shop.com/bags/', '0.598', '2026-10-20T00:00:00Z'),
        row('https://shop.com/bags', 0.2, '2026-10-01T00:00:00Z'),
      ]),
    ).toEqual({
      url: 'https://shop.com/bags',
      totalScore: 64,
      previousScore: 60,
      auditedAt: '2026-10-30T00:00:00Z',
      scale: 100,
    });
  });

  it('has no previous score on the page’s first audit, even with other pages audited', () => {
    const snap = auditSnapshotFrom([
      row('https://shop.com/bags', 0.64, '2026-10-30T00:00:00Z'),
      row('https://shop.com/shoes', 0.91, '2026-10-29T00:00:00Z'),
    ]);
    expect(snap?.previousScore).toBeNull();
  });

  it('matches the page by its final URL after a redirect', () => {
    const snap = auditSnapshotFrom([
      row('https://shop.com/new', 0.7, '2026-10-30T00:00:00Z'),
      row('https://shop.com/old', 0.5, '2026-10-20T00:00:00Z', 'https://shop.com/new'),
    ]);
    expect(snap?.previousScore).toBe(50);
  });

  it('skips the page’s audits without a score', () => {
    const snap = auditSnapshotFrom([
      row('https://shop.com/bags', null, '2026-10-30T00:00:00Z'),
      row('https://shop.com/bags', null, '2026-10-25T00:00:00Z'),
      row('https://shop.com/bags', 0.55, '2026-10-20T00:00:00Z'),
    ]);
    expect(snap).toMatchObject({ totalScore: null, previousScore: 55 });
  });
});

describe('auditScoreView', () => {
  it('shows the score and the change in points', () => {
    expect(
      auditScoreView({ url: 'u', totalScore: 64, previousScore: 60, auditedAt: 'd', scale: 100 }),
    ).toEqual({ score: '64', change: 4 });
    expect(
      auditScoreView({ url: 'u', totalScore: 58, previousScore: 63, auditedAt: 'd', scale: 100 }),
    ).toEqual({ score: '58', change: -5 });
  });

  it('shows no change on the page’s first audit, and a dash without a score', () => {
    expect(
      auditScoreView({ url: 'u', totalScore: 64, previousScore: null, auditedAt: 'd', scale: 100 }),
    ).toEqual({ score: '64', change: null });
    expect(
      auditScoreView({ url: 'u', totalScore: null, previousScore: 60, auditedAt: 'd', scale: 100 }),
    ).toEqual({ score: '—', change: null });
  });

  it('shows a report saved on the 0–1 scale as about that many points, with no change', () => {
    expect(
      auditScoreView({ url: 'u', totalScore: 0.6, previousScore: 0.5, auditedAt: 'd' }),
    ).toEqual({ score: '~60', change: null });
    expect(
      auditScoreView({ url: 'u', totalScore: null, previousScore: null, auditedAt: 'd' }),
    ).toEqual({ score: '—', change: null });
  });
});
