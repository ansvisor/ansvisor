import { describe, expect, it, vi } from 'vitest';

// The module imports the supabase admin client, whose config hard-exits when
// SUPABASE_* env is absent (as in CI) — stub it before the import chain.
vi.mock('../config/supabase.js', () => ({ default: {} }));

import { classifyGaSource } from './ga-sources.js';
import {
  dayRange,
  gaDateToIso,
  mapAiTrafficRows,
  mapItemRows,
  mapPageRows,
  readReportRows,
  unclassifiedSources,
} from './ga-sync.js';

/**
 * GA4 traffic sync mapping (#704).
 *
 * Everything here is the part of the sync that turns a GA4 report into rows —
 * the half that can be wrong without anything failing, since a mis-parsed
 * report still upserts cleanly and only shows up as numbers nobody can
 * reconcile later.
 */

const report = ({ dims, metrics, rows }) => ({
  dimensionHeaders: dims.map((name) => ({ name })),
  metricHeaders: metrics.map((name) => ({ name })),
  rows: rows.map((row) => ({
    dimensionValues: row.slice(0, dims.length).map((value) => ({ value })),
    metricValues: row.slice(dims.length).map((value) => ({ value })),
  })),
});

const TRAFFIC_METRICS = [
  'sessions',
  'engagedSessions',
  'keyEvents',
  'totalUsers',
  'transactions',
  'purchaseRevenue',
  'userEngagementDuration',
];

describe('classifyGaSource', () => {
  it('collapses an engine’s several source strings onto one platform', () => {
    // All three arrive from the same product in real data.
    expect(classifyGaSource('chatgpt.com')).toBe('chatgpt.com');
    expect(classifyGaSource('chatgpt')).toBe('chatgpt.com');
    expect(classifyGaSource('openai')).toBe('chatgpt.com');
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(classifyGaSource('  Perplexity.AI ')).toBe('perplexity.ai');
  });

  it('does not match a host that merely contains an engine name', () => {
    // The case that motivated an explicit list: a workers.dev subdomain with
    // "claude" in it is an ordinary referrer, not AI traffic.
    expect(classifyGaSource('claude-proxy.example.workers.dev')).toBeNull();
    expect(classifyGaSource('notchatgpt.com')).toBeNull();
  });

  it('returns null for GA placeholders and non-strings', () => {
    expect(classifyGaSource('(direct)')).toBeNull();
    expect(classifyGaSource('(not set)')).toBeNull();
    expect(classifyGaSource(undefined)).toBeNull();
  });
});

describe('gaDateToIso', () => {
  it('converts GA4’s compact date to a storable one', () => {
    expect(gaDateToIso('20260721')).toBe('2026-07-21');
  });

  it('rejects anything that is not eight digits', () => {
    expect(gaDateToIso('2026-07-21')).toBeNull();
    expect(gaDateToIso('(other)')).toBeNull();
    expect(gaDateToIso(undefined)).toBeNull();
  });
});

describe('readReportRows', () => {
  it('reads values by header name rather than by position', () => {
    // GA4 echoes the requested order, but reading positionally would write
    // sessions into the revenue column if it ever stopped doing so, and
    // nothing downstream could tell.
    const swapped = report({
      dims: ['date'],
      metrics: ['purchaseRevenue', 'sessions'],
      rows: [['20260721', '99.5', '4']],
    });

    expect(readReportRows(swapped)[0]).toEqual({
      date: '20260721',
      purchaseRevenue: '99.5',
      sessions: '4',
    });
  });

  it('returns an empty list for a report with no rows', () => {
    expect(readReportRows({ dimensionHeaders: [], metricHeaders: [] })).toEqual([]);
    expect(readReportRows(undefined)).toEqual([]);
  });
});

describe('mapAiTrafficRows', () => {
  const AI_DIMS = ['date', 'sessionSource', 'landingPage', 'landingPagePlusQueryString'];
  const raw = report({
    dims: AI_DIMS,
    metrics: TRAFFIC_METRICS,
    rows: [
      [
        '20260721',
        'chatgpt.com',
        '/pricing',
        '/pricing?ref=x',
        '10',
        '3',
        '1',
        '9',
        '2',
        '149.9',
        '106',
      ],
    ],
  });

  it('maps a row onto its storage columns', () => {
    expect(mapAiTrafficRows('brand-1', raw)).toEqual([
      {
        brand_id: 'brand-1',
        date: '2026-07-21',
        source: 'chatgpt.com',
        platform: 'chatgpt.com',
        landing_page: '/pricing',
        landing_page_query: '/pricing?ref=x',
        sessions: 10,
        engaged_sessions: 3,
        key_events: 1,
        total_users: 9,
        transactions: 2,
        purchase_revenue: 149.9,
        engagement_duration_seconds: 106,
      },
    ]);
  });

  it('keeps the path separately from the full entry URL', () => {
    // The path is what joins ga_page_stats, which drops query strings to stay
    // a manageable size; the full URL is what attribution needs.
    const [row] = mapAiTrafficRows('brand-1', raw);
    expect(row.landing_page).toBe('/pricing');
    expect(row.landing_page_query).toBe('/pricing?ref=x');
  });

  it('keeps the raw source when it cannot be classified', () => {
    const unknown = report({
      dims: AI_DIMS,
      metrics: TRAFFIC_METRICS,
      rows: [['20260721', 'some-new-assistant.ai', '/', '/', '3', '1', '0', '3', '0', '0', '12']],
    });

    const [row] = mapAiTrafficRows('brand-1', unknown);
    expect(row.source).toBe('some-new-assistant.ai');
    expect(row.platform).toBeNull();
  });

  it('keeps an empty landing page instead of dropping the row', () => {
    // GA4 reports a blank landing page for sessions it cannot attribute to
    // one; those sessions still happened.
    const blank = report({
      dims: AI_DIMS,
      metrics: TRAFFIC_METRICS,
      rows: [['20260721', 'chatgpt.com', '', '', '5', '2', '0', '5', '0', '0', '30']],
    });

    expect(mapAiTrafficRows('brand-1', blank)[0].landing_page).toBe('');
  });

  it('drops rows whose date is unusable rather than storing a null date', () => {
    const broken = report({
      dims: AI_DIMS,
      metrics: TRAFFIC_METRICS,
      rows: [['(other)', 'chatgpt.com', '/', '/', '5', '2', '0', '5', '0', '0', '30']],
    });

    expect(mapAiTrafficRows('brand-1', broken)).toEqual([]);
  });

  it('treats missing or non-numeric metrics as zero', () => {
    const messy = report({
      dims: AI_DIMS,
      metrics: TRAFFIC_METRICS,
      rows: [['20260721', 'chatgpt.com', '/', '/', '4', '', 'n/a', '4', '', '', '']],
    });

    const [row] = mapAiTrafficRows('brand-1', messy);
    expect(row.sessions).toBe(4);
    expect(row.key_events).toBe(0);
    expect(row.purchase_revenue).toBe(0);
  });
});

describe('mapPageRows', () => {
  it('maps landing-page totals without a source column', () => {
    const raw = report({
      dims: ['date', 'landingPage'],
      metrics: TRAFFIC_METRICS,
      rows: [['20260810', '/', '29', '21', '2', '23', '1', '80', '3407']],
    });

    expect(mapPageRows('brand-1', raw)).toEqual([
      {
        brand_id: 'brand-1',
        date: '2026-08-10',
        landing_page: '/',
        sessions: 29,
        engaged_sessions: 21,
        key_events: 2,
        total_users: 23,
        transactions: 1,
        purchase_revenue: 80,
        engagement_duration_seconds: 3407,
      },
    ]);
  });
});

describe('mapItemRows', () => {
  it('maps product rows', () => {
    const raw = report({
      dims: ['date', 'itemName', 'itemId', 'itemCategory'],
      metrics: ['itemsViewed', 'itemsAddedToCart', 'itemsPurchased', 'itemRevenue'],
      rows: [['20260721', 'Blue Shirt', 'SKU-1', 'Apparel', '40', '7', '3', '89.7']],
    });

    expect(mapItemRows('brand-1', raw)).toEqual([
      {
        brand_id: 'brand-1',
        date: '2026-07-21',
        item_id: 'SKU-1',
        item_name: 'Blue Shirt',
        item_category: 'Apparel',
        items_viewed: 40,
        items_added_to_cart: 7,
        items_purchased: 3,
        item_revenue: 89.7,
      },
    ]);
  });

  it('returns nothing for a property without ecommerce, which is not an error', () => {
    expect(mapItemRows('brand-1', { dimensionHeaders: [], metricHeaders: [], rows: [] })).toEqual(
      [],
    );
  });
});

describe('dayRange', () => {
  it('covers today plus the requested number of days back, newest first', () => {
    const days = dayRange(3);
    expect(days).toHaveLength(4);
    expect(new Date(days[0]).getTime()).toBeGreaterThan(new Date(days[3]).getTime());
  });

  it('still returns today when asked for zero days back', () => {
    expect(dayRange(0)).toHaveLength(1);
  });

  it('returns each day exactly once, so no day is fetched twice', () => {
    const days = dayRange(90);
    expect(new Set(days).size).toBe(91);
  });
});

describe('unclassifiedSources', () => {
  const raw = report({
    dims: ['sessionSource'],
    metrics: ['sessions'],
    rows: [
      ['(direct)', '1477'],
      ['google', '367'],
      ['chatgpt.com', '47'],
      ['some-new-assistant.ai', '9'],
    ],
  });

  it('reports unknown sources ordered by sessions, excluding known ones', () => {
    expect(unclassifiedSources(raw, { limit: 3 })).toEqual([
      { source: '(direct)', sessions: 1477 },
      { source: 'google', sessions: 367 },
      { source: 'some-new-assistant.ai', sessions: 9 },
    ]);
  });

  it('honours the session floor', () => {
    expect(unclassifiedSources(raw, { minSessions: 400 })).toEqual([
      { source: '(direct)', sessions: 1477 },
    ]);
  });
});
