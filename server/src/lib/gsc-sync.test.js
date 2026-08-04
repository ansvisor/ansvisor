import { describe, expect, it } from 'vitest';
import { mapAnalyticsRows } from './gsc-sync.js';

describe('mapAnalyticsRows', () => {
  it('maps GSC rows keyed by [query, date] into table rows', () => {
    const rows = mapAnalyticsRows('brand-1', [
      {
        keys: ['best aeo tool', '2026-08-01'],
        clicks: 3,
        impressions: 120,
        ctr: 0.025,
        position: 7.4,
      },
      { keys: ['ai visibility', '2026-08-02'], clicks: 0, impressions: 40, ctr: 0, position: 12.1 },
    ]);
    expect(rows).toEqual([
      {
        brand_id: 'brand-1',
        query: 'best aeo tool',
        date: '2026-08-01',
        clicks: 3,
        impressions: 120,
        ctr: 0.025,
        position: 7.4,
      },
      {
        brand_id: 'brand-1',
        query: 'ai visibility',
        date: '2026-08-02',
        clicks: 0,
        impressions: 40,
        ctr: 0,
        position: 12.1,
      },
    ]);
  });

  it('drops malformed rows and defaults missing metrics to zero', () => {
    const rows = mapAnalyticsRows('brand-1', [
      { keys: ['only-query'] },
      { keys: [] },
      {},
      { keys: ['ok', '2026-08-01'] },
    ]);
    expect(rows).toEqual([
      {
        brand_id: 'brand-1',
        query: 'ok',
        date: '2026-08-01',
        clicks: 0,
        impressions: 0,
        ctr: 0,
        position: 0,
      },
    ]);
  });

  it('rounds fractional click/impression counts from aggregated responses', () => {
    const rows = mapAnalyticsRows('b', [
      { keys: ['q', '2026-08-01'], clicks: 2.6, impressions: 99.4, ctr: 0.1, position: 3 },
    ]);
    expect(rows[0].clicks).toBe(3);
    expect(rows[0].impressions).toBe(99);
  });

  it('handles an empty or missing rows array', () => {
    expect(mapAnalyticsRows('b', [])).toEqual([]);
    expect(mapAnalyticsRows('b', undefined)).toEqual([]);
  });
});
