import { describe, expect, it, vi } from 'vitest';

// The module imports the supabase admin client, whose config hard-exits when
// SUPABASE_* env is absent (as in CI) — stub it before the import chain.
vi.mock('../config/supabase.js', () => ({ default: {} }));

import {
  aggregateAiTraffic,
  aggregatePages,
  detectPageOpportunities,
  pickValueSignal,
  scorePages,
} from './page-opportunities.js';

/**
 * Page opportunity detection (#719).
 *
 * The signal-selection and scoring paths carry most of the weight here,
 * because the only connected property reports no revenue, no transactions and
 * no key events. Those three branches cannot be exercised against real data
 * today, so they are pinned here instead — a customer connecting a property
 * with real conversions must get the right answer on the first night, with no
 * code change.
 */

const page = (over = {}) => ({
  landingPage: '/p',
  sessions: 100,
  engagedSessions: 50,
  keyEvents: 0,
  transactions: 0,
  revenue: 0,
  engagementSeconds: 1000,
  ...over,
});

describe('pickValueSignal', () => {
  it('ranks on revenue when the property reports any', () => {
    expect(pickValueSignal([page({ revenue: 10, transactions: 1, keyEvents: 3 })])).toBe('revenue');
  });

  it('falls to transactions when revenue is absent', () => {
    // A property tracking purchases without passing a value still knows what
    // sold; ranking on engagement there would ignore real conversions.
    expect(pickValueSignal([page({ transactions: 2, keyEvents: 5 })])).toBe('transactions');
  });

  it('falls to key events when nothing was purchased', () => {
    // Lead-generation sites: no ecommerce at all, but signups and demo
    // requests are exactly what "valuable" means for them.
    expect(pickValueSignal([page({ keyEvents: 4 })])).toBe('key_events');
  });

  it('falls to engagement when the property reports no conversions at all', () => {
    // The state of the only property connected today. Without this fallback
    // the engine would tell a customer there is nothing to look at, when what
    // is actually missing is their conversion tracking.
    expect(pickValueSignal([page()])).toBe('engagement');
  });

  it('picks the strongest signal present anywhere, not on the first page', () => {
    const pages = [page({ landingPage: '/a' }), page({ landingPage: '/b', revenue: 5 })];
    expect(pickValueSignal(pages)).toBe('revenue');
  });

  it('ignores a signal that is present but always zero', () => {
    expect(pickValueSignal([page({ revenue: 0, transactions: 0, keyEvents: 7 })])).toBe(
      'key_events',
    );
  });

  it('handles an empty page list', () => {
    expect(pickValueSignal([])).toBe('engagement');
    expect(pickValueSignal(undefined)).toBe('engagement');
  });
});

describe('scorePages', () => {
  it('ranks by the chosen signal, best first', () => {
    const scored = scorePages(
      [
        page({ landingPage: '/low', revenue: 10 }),
        page({ landingPage: '/high', revenue: 900 }),
        page({ landingPage: '/mid', revenue: 100 }),
      ],
      'revenue',
    );
    expect(scored.map((p) => p.landingPage)).toEqual(['/high', '/mid', '/low']);
    expect(scored[0].valueRank).toBe(1);
  });

  it('puts the top page at 100 and the bottom at 0', () => {
    const scored = scorePages(
      [page({ landingPage: '/a', revenue: 1 }), page({ landingPage: '/b', revenue: 2 })],
      'revenue',
    );
    expect(scored[0].valuePercentile).toBe(50);
    expect(scored[1].valuePercentile).toBe(0);
  });

  it('gives tied pages the same percentile', () => {
    // Two pages with identical revenue must not be separated by whichever
    // happened to sort first — the percentile is a claim about the data.
    const scored = scorePages(
      [
        page({ landingPage: '/a', revenue: 50 }),
        page({ landingPage: '/b', revenue: 50 }),
        page({ landingPage: '/c', revenue: 1 }),
      ],
      'revenue',
    );
    const [a, b] = scored;
    expect(a.valuePercentile).toBe(b.valuePercentile);
  });

  it('scores a single page as the top of its own site', () => {
    const [only] = scorePages([page({ revenue: 5 })], 'revenue');
    expect(only.valuePercentile).toBe(100);
    expect(only.valueRank).toBe(1);
  });

  it('breaks ties on sessions so the order is stable, not arbitrary', () => {
    const scored = scorePages(
      [
        page({ landingPage: '/quiet', revenue: 50, sessions: 10 }),
        page({ landingPage: '/busy', revenue: 50, sessions: 900 }),
      ],
      'revenue',
    );
    expect(scored[0].landingPage).toBe('/busy');
  });
});

describe('detectPageOpportunities', () => {
  // Ten pages so percentiles are meaningful: /top is the best earner.
  const many = (over) =>
    Array.from({ length: 10 }, (_, i) =>
      page({ landingPage: `/p${i}`, revenue: i + 1, sessions: 100, ...over }),
    );

  it('raises a valuable page with no AI traffic', () => {
    const found = detectPageOpportunities({ pages: many(), aiByPage: new Map() });
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].kind).toBe('no_ai_traffic');
    expect(found[0].value_signal).toBe('revenue');
  });

  it('does not raise a page AI engines already send traffic to', () => {
    const pages = many();
    const top = pages[pages.length - 1].landingPage;
    const found = detectPageOpportunities({
      pages,
      aiByPage: new Map([[top, { sessions: 4, platforms: ['chatgpt.com'] }]]),
    });
    expect(found.map((f) => f.landing_page)).not.toContain(top);
  });

  it('ignores a page with too little traffic to argue from', () => {
    // The absolute floor. A page can rank first on its site and still be one
    // visit; raising it would be a finding about nothing.
    const pages = [page({ landingPage: '/tiny', revenue: 999, sessions: 2 })];
    expect(detectPageOpportunities({ pages, aiByPage: new Map() })).toEqual([]);
  });

  it('ignores a page with no value on the chosen signal', () => {
    const pages = [
      ...many(),
      page({ landingPage: '/zero', revenue: 0, sessions: 5000, engagementSeconds: 99999 }),
    ];
    const found = detectPageOpportunities({ pages, aiByPage: new Map() });
    expect(found.map((f) => f.landing_page)).not.toContain('/zero');
  });

  it('raises fewer findings on a site with less to fix, not the same fraction', () => {
    // The percentile alone would qualify a constant share of any site. The
    // session floor is what makes the count follow the site, so a brand with
    // one real page gets one finding rather than a list padded to length.
    const busy = many();
    const quiet = [
      page({ landingPage: '/one', revenue: 10, sessions: 50 }),
      ...Array.from({ length: 9 }, (_, i) =>
        page({ landingPage: `/q${i}`, revenue: 1, sessions: 2 }),
      ),
    ];
    const busyFound = detectPageOpportunities({ pages: busy, aiByPage: new Map() });
    const quietFound = detectPageOpportunities({ pages: quiet, aiByPage: new Map() });
    expect(quietFound.length).toBeLessThan(busyFound.length);
    expect(quietFound).toHaveLength(1);
  });

  it('falls back to engagement and says so, for a property without conversions', () => {
    // The live case: the finding must be labelled 'engagement' so no surface
    // can describe it as revenue.
    const pages = Array.from({ length: 10 }, (_, i) =>
      page({ landingPage: `/e${i}`, engagementSeconds: (i + 1) * 100 }),
    );
    const found = detectPageOpportunities({ pages, aiByPage: new Map() });
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((f) => f.value_signal === 'engagement')).toBe(true);
    expect(found.every((f) => f.revenue === 0)).toBe(true);
  });

  it('carries the evidence the finding was raised from', () => {
    const found = detectPageOpportunities({
      pages: many({ engagedSessions: 40, keyEvents: 3, transactions: 2 }),
      aiByPage: new Map(),
    });
    const top = found[0];
    expect(top.sessions).toBe(100);
    expect(top.engaged_sessions).toBe(40);
    expect(top.ai_sessions).toBe(0);
    expect(top.window_days).toBe(28);
  });

  it('returns nothing for a brand with no pages', () => {
    expect(detectPageOpportunities({ pages: [], aiByPage: new Map() })).toEqual([]);
  });
});

describe('aggregatePages', () => {
  it('sums a page across its daily rows', () => {
    const rows = [
      { landing_page: '/a', sessions: 3, purchase_revenue: 10.5, key_events: 1 },
      { landing_page: '/a', sessions: 4, purchase_revenue: 4.5, key_events: 0 },
    ];
    const [a] = aggregatePages(rows);
    expect(a.sessions).toBe(7);
    expect(a.revenue).toBe(15);
    expect(a.keyEvents).toBe(1);
  });

  it('drops rows GA could not attribute to a page', () => {
    expect(aggregatePages([{ landing_page: '', sessions: 9 }])).toEqual([]);
  });

  it('treats missing metrics as zero rather than NaN', () => {
    const [a] = aggregatePages([{ landing_page: '/a' }]);
    expect(a.sessions).toBe(0);
    expect(a.revenue).toBe(0);
  });
});

describe('aggregateAiTraffic', () => {
  it('sums AI sessions and collects the platforms per page', () => {
    const map = aggregateAiTraffic([
      { landing_page: '/a', platform: 'chatgpt.com', sessions: 3 },
      { landing_page: '/a', platform: 'claude.ai', sessions: 2 },
    ]);
    expect(map.get('/a').sessions).toBe(5);
    expect(map.get('/a').platforms.sort()).toEqual(['chatgpt.com', 'claude.ai']);
  });

  it('counts sessions from an unclassified source, which still arrived', () => {
    const map = aggregateAiTraffic([{ landing_page: '/a', platform: null, sessions: 4 }]);
    expect(map.get('/a').sessions).toBe(4);
    expect(map.get('/a').platforms).toEqual([]);
  });
});
