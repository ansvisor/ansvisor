import { describe, expect, it } from 'vitest';
import {
  aiVisitsByPage,
  buildOpportunities,
  compareOpportunities,
  opportunityKey,
} from './opportunities.js';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

const audit = (url, score, days, status = 'completed') => ({
  key: opportunityKey(url),
  url,
  score,
  auditId: `a-${url}`,
  lastAuditedAt: daysAgo(days),
  status,
});

const build = (over = {}) =>
  buildOpportunities({
    primaryHost: 'acme.com',
    staleDays: 90,
    now: NOW,
    ...over,
  });

describe('opportunityKey', () => {
  it('reads every spelling of a page, in any case, as one page', () => {
    expect(
      new Set(
        [
          'https://acme.com/Pricing',
          'https://www.acme.com/pricing/',
          'http://ACME.com/pricing?utm_source=x',
        ].map(opportunityKey),
      ),
    ).toEqual(new Set(['acme.com/pricing']));
    expect(opportunityKey('not a url')).toBeNull();
  });
});

describe('buildOpportunities', () => {
  it("lists GA's valuable pages without AI traffic, with their last audit", () => {
    const { rows } = build({
      gaPages: [
        {
          landing_page: '/pricing',
          value_signal: 'revenue',
          value_percentile: '95',
          sessions: 1200,
          citation_state: 'targeted_not_cited',
          citations: 0,
        },
      ],
      auditPages: [audit('https://acme.com/pricing/', 0.63, 3)],
    });
    expect(rows).toEqual([
      expect.objectContaining({
        key: 'acme.com/pricing',
        url: 'https://acme.com/pricing',
        path: '/pricing',
        pinned: false,
        running: false,
        sessions: 1200,
        reasons: [
          {
            type: 'no_ai_traffic',
            signal: 'revenue',
            percentile: 95,
            citationState: 'targeted_not_cited',
          },
        ],
        lastAudit: { at: daysAgo(3), score: 0.63, auditId: 'a-https://acme.com/pricing/' },
      }),
    ]);
  });

  it('lists site pages never audited or audited too long ago, and leaves fresh audits out', () => {
    const { rows } = build({
      sitePages: [
        { url: 'https://acme.com/blog/guide', title: 'Guide', ga_sessions: 40, ai_citations: 3 },
        { url: 'https://acme.com/compare', title: 'Compare', ga_sessions: 90, ai_citations: 0 },
        { url: 'https://acme.com/about', title: 'About', ga_sessions: 10, ai_citations: 0 },
        // A failed audit doesn't count as one.
        { url: 'https://acme.com/team', title: 'Team', ga_sessions: 5, ai_citations: 0 },
      ],
      auditPages: [
        audit('https://acme.com/compare', 0.7, 120),
        audit('https://acme.com/about', 0.8, 10),
        audit('https://acme.com/team', null, 2, 'failed'),
      ],
    });
    expect(rows.map((r) => [r.path, r.reasons])).toEqual([
      ['/blog/guide', [{ type: 'never_audited' }]],
      ['/team', [{ type: 'never_audited' }]],
      ['/compare', [{ type: 'stale_audit', days: 120 }]],
    ]);
    expect(rows[0]).toMatchObject({ title: 'Guide', citations: 3, sessions: 40, lastAudit: null });
  });

  it('merges one page from both sources and keeps checkout-like pages out', () => {
    const { rows } = build({
      gaPages: [
        {
          landing_page: '/pricing',
          value_signal: 'key_events',
          value_percentile: 80,
          sessions: 50,
        },
      ],
      sitePages: [
        { url: 'https://acme.com/Pricing/', title: 'Pricing', ga_sessions: 48, ai_citations: 1 },
        { url: 'https://acme.com/legal/terms', title: 'Terms', ga_sessions: 2, ai_citations: 0 },
        { url: 'https://acme.com/cart', title: 'Cart', ga_sessions: 30, ai_citations: 0 },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].reasons.map((r) => r.type)).toEqual(['no_ai_traffic', 'never_audited']);
    expect(rows[0]).toMatchObject({ title: 'Pricing', sessions: 50 });
  });

  it('puts pinned pages first, even with nothing to fix, and lists excluded ones apart', () => {
    const { rows, excluded } = build({
      gaPages: [
        { landing_page: '/pricing', value_signal: 'revenue', value_percentile: 99, sessions: 10 },
      ],
      sitePages: [
        { url: 'https://acme.com/blog', title: 'Blog', ga_sessions: 1, ai_citations: 0 },
        { url: 'https://acme.com/about', title: 'About', ga_sessions: 1, ai_citations: 0 },
      ],
      auditPages: [audit('https://acme.com/about', 0.9, 5)],
      prefs: [
        { page_key: 'acme.com/about', url: 'https://acme.com/about', state: 'pinned' },
        { page_key: 'acme.com/blog', url: 'https://acme.com/blog', state: 'excluded' },
        { page_key: 'acme.com/old', url: 'https://acme.com/old', state: 'excluded' },
      ],
    });
    expect(rows.map((r) => [r.path, r.pinned])).toEqual([
      ['/about', true],
      ['/pricing', false],
    ]);
    expect(excluded.map((e) => [e.path, e.title])).toEqual([
      ['/blog', 'Blog'],
      ['/old', null],
    ]);
  });

  it('marks a page being audited, and lists GA pages only with a primary host', () => {
    const { rows } = build({
      sitePages: [{ url: 'https://acme.com/new', title: null, ga_sessions: 0, ai_citations: 0 }],
      auditPages: [audit('https://acme.com/new', null, 0, 'running')],
    });
    expect(rows[0]).toMatchObject({ path: '/new', running: true, lastAudit: null });

    expect(
      build({
        primaryHost: null,
        gaPages: [
          { landing_page: '/pricing', value_signal: 'revenue', value_percentile: 90, sessions: 5 },
        ],
      }).rows,
    ).toEqual([]);
  });
});

describe('compareOpportunities', () => {
  const row = (path, over = {}) => ({ path, pinned: false, reasons: [], ...over });

  it('orders pinned, then GA value, then never audited, then citations and visits', () => {
    const rows = [
      row('/stale', { reasons: [{ type: 'stale_audit', days: 100 }], citations: 9 }),
      row('/never-quiet', { reasons: [{ type: 'never_audited' }], citations: 0, sessions: 1 }),
      row('/never-cited', { reasons: [{ type: 'never_audited' }], citations: 4 }),
      row('/ga-80', { reasons: [{ type: 'no_ai_traffic', percentile: 80 }] }),
      row('/ga-95', { reasons: [{ type: 'no_ai_traffic', percentile: 95 }] }),
      row('/pinned', { pinned: true }),
    ];
    expect(rows.sort(compareOpportunities).map((r) => r.path)).toEqual([
      '/pinned',
      '/ga-95',
      '/ga-80',
      '/never-cited',
      '/never-quiet',
      '/stale',
    ]);
  });
});

describe('aiVisitsByPage', () => {
  it('takes Google Analytics where it has the page, else the snippet, never both', () => {
    const visits = aiVisitsByPage({
      analytics: [
        { page: 'https://acme.com/a', platform: 'chatgpt', cur_sessions: 4 },
        { page: 'https://acme.com/a', platform: 'perplexity', cur_sessions: 2 },
      ],
      snippet: [
        { page: 'https://acme.com/a', platform: 'chatgpt', cur_sessions: 9 },
        { page: 'https://acme.com/b', platform: 'chatgpt', cur_sessions: 3 },
        { page: null, platform: 'chatgpt', cur_sessions: 50 },
      ],
    });
    expect([...visits]).toEqual([
      ['https://acme.com/a', 6],
      ['https://acme.com/b', 3],
    ]);
    expect(aiVisitsByPage(null).size).toBe(0);
  });
});
