import { describe, expect, it, vi } from 'vitest';

// gsc-sync imports the supabase admin client, whose config module hard-exits
// when SUPABASE_* env is absent (as in CI) — stub it before the import chain.
vi.mock('../config/supabase.js', () => ({ default: {} }));

import {
  mapAnalyticsRows,
  mapPageRows,
  PAGE_BACKFILL_DAYS,
  pageSyncWindows,
  pagesSyncPlan,
} from './gsc-sync.js';

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

describe('mapPageRows', () => {
  it('maps GSC rows keyed by [page, date] into gsc_page_stats rows (AT-008)', () => {
    expect(
      mapPageRows('brand-1', [
        {
          keys: ['https://acme.example/blog/x', '2026-08-01'],
          clicks: 4.4,
          impressions: 300,
          ctr: 0.015,
          position: 5.2,
        },
        { keys: ['https://acme.example/'] },
      ]),
    ).toEqual([
      {
        brand_id: 'brand-1',
        page: 'https://acme.example/blog/x',
        date: '2026-08-01',
        clicks: 4,
        impressions: 300,
        ctr: 0.015,
        position: 5.2,
      },
    ]);
  });
});

describe('pageSyncWindows', () => {
  it('reads the last 28 days once the 190 have been read', () => {
    expect(pageSyncWindows(true)).toEqual([{ from: 28, to: 0 }]);
  });

  it('reads 190 days in 28-day steps until then, with no gap', () => {
    const windows = pageSyncWindows(false);
    expect(windows[0]).toEqual({ from: 28, to: 0 });
    expect(windows.at(-1).from).toBe(PAGE_BACKFILL_DAYS);
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].to).toBe(windows[i - 1].from + 1);
      expect(windows[i].from - windows[i].to).toBeLessThanOrEqual(28);
    }
  });
});

describe('pagesSyncPlan', () => {
  const property = 'sc-domain:acme.com';

  it('reads the 190 days, and marks them read, until a sync gets through them for the property', () => {
    // A first sync, or one cut short after its first window: no marker yet.
    const plan = pagesSyncPlan({ gsc_property: property, gsc_pages_backfilled_property: null });
    expect(plan).toEqual({
      windows: pageSyncWindows(false),
      dropOldPages: false,
      markBackfilled: true,
    });
  });

  it('reads the last 28 days once the property has been read in full', () => {
    expect(
      pagesSyncPlan({ gsc_property: property, gsc_pages_backfilled_property: property }),
    ).toEqual({ windows: [{ from: 28, to: 0 }], dropOldPages: false, markBackfilled: false });
  });

  it("drops the old property's pages before reading a new one's 190 days", () => {
    expect(
      pagesSyncPlan({
        gsc_property: property,
        gsc_pages_backfilled_property: 'https://old.example/',
      }),
    ).toEqual({ windows: pageSyncWindows(false), dropOldPages: true, markBackfilled: true });
  });
});
