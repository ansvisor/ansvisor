import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../messages/en.json';
import type { SourceState } from '@/lib/actions/integrations';
import type { TrafficConversions } from '@/lib/actions/traffic';
import {
  BYTE_ORDER_MARK,
  TRAFFIC_EXPORT_SECTIONS,
  filtersTable,
  tableCsv,
  trafficExportFileName,
  trafficTable,
  trafficWorkbook,
  type ExportLabel,
  type TrafficExportData,
} from './traffic-export';

/**
 * AT-015: the AI Traffic page as files. Every section as a table with the
 * page's own numbers, numbers kept as numbers, and a reason wherever the
 * page would show no number.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'traffic.export' });
const label: ExportLabel = (key, values) => t(key as never, values as never);

const source = (over: Partial<SourceState> = {}): SourceState => ({
  configured: true,
  connected: true,
  mapped: true,
  firstDataAt: '2026-09-01T06:00:00Z',
  lastDataAt: '2026-10-18T06:00:00Z',
  property: '123',
  ...over,
});

const data = (over: Partial<TrafficExportData> = {}): TrafficExportData => ({
  brandName: 'Acme Coffee',
  rangeLabel: 'last 7 days',
  from: '2026-10-11',
  to: '2026-10-18',
  platform: null,
  search: null,
  exportedAt: new Date('2026-10-18T10:05:00Z'),
  summary: {
    totalVisits: 55,
    totalVisitsPrev: 39,
    totalPageviews: 59,
    analyticsDays: [],
    hasPreviousPeriod: true,
    platformBreakdown: [
      {
        platform: 'chatgpt.com',
        visits: 40,
        visitsPrev: 33,
        analytics: { sessions: 44, engagedSessions: 33, keyEvents: 6, keyEventSessions: 5 },
      },
      { platform: 'gemini.google.com', visits: 12, visitsPrev: 5, analytics: null },
      { platform: 'claude.ai', visits: 3, visitsPrev: 0, analytics: null },
    ],
    topPages: [{ url: '/pricing', visits: 35, visitsPrev: 30, citations: 4 }],
    hasAnyData: true,
  },
  trend: [
    { date: '2026-10-17', 'chatgpt.com': 5, 'gemini.google.com': 1 },
    { date: '2026-10-18', 'chatgpt.com': 2, 'gemini.google.com': 0 },
  ],
  visits: [
    {
      id: 'v1',
      brandId: 'b1',
      url: 'https://acme.example/menu/?utm_source=gemini',
      referrer: 'https://gemini.google.com/',
      sourcePlatform: 'gemini.google.com',
      country: 'TR',
      language: 'tr',
      screen: null,
      createdAt: '2026-10-17T09:30:12.000Z',
      pageviews: 3,
    },
  ],
  pageStatus: {
    counts: { noAiTraffic: 1, citedNotClicked: 1, trafficNoPrompt: 1, all: 3 },
    rows: [
      {
        page: '/shop/beans',
        aiVisits: 0,
        aiKeyEvents: 0,
        aiPlatforms: [],
        citations: 25,
        targetingPrompts: 2,
        sessions: 440,
        engagedSessions: 220,
        keyEvents: 70,
        transactions: 0,
        revenue: 0,
        engagementSeconds: 0,
        inSitemap: true,
        valueRank: 3,
      },
      {
        page: '/menu',
        aiVisits: 12,
        aiKeyEvents: 2,
        aiPlatforms: ['chatgpt.com', 'gemini.google.com'],
        citations: 0,
        targetingPrompts: 0,
        sessions: 0,
        engagedSessions: 0,
        keyEvents: 0,
        transactions: 0,
        revenue: 0,
        engagementSeconds: 0,
        inSitemap: false,
        valueRank: null,
      },
    ],
  },
  sources: {
    snippetLastVisitAt: new Date().toISOString(),
    ga: source(),
    gsc: source({ connected: false }),
  },
  ...over,
});

describe('trafficTable', () => {
  it('gives the KPIs with the change as a number once both periods have 30 visits', () => {
    const table = trafficTable('kpis', data(), label);
    expect(table.headers).toEqual(['Metric', 'Value', 'Note']);
    expect(table.rows).toEqual([
      ['AI-referred visits', 55, null],
      ['Pageviews', 59, null],
      ['Visits, previous period', 39, null],
      ['Change vs previous period (%)', 41, null],
      ['Top platform', 'ChatGPT', null],
      ['Top platform visits', 40, null],
      ['Platforms', 3, null],
    ]);
  });

  it('leaves a change the page would not show empty, and says why (F4)', () => {
    const table = trafficTable('platforms', data(), label);
    expect(table.rows).toEqual([
      ['ChatGPT', 40, 33, 21, 72.7, 75, 6, null],
      ['Gemini', 12, 5, null, 21.8, null, null, expect.stringContaining('Low sample')],
      ['Claude', 3, 0, null, 5.5, null, null, expect.stringContaining('New')],
    ]);
  });

  it("adds Google Analytics' engaged share and key events per platform, as the table does (AT-005)", () => {
    const table = trafficTable('platforms', data(), label);
    expect(table.headers).toEqual([
      'Platform',
      'Visits',
      'Visits, previous period',
      'Change (%)',
      'Share (%)',
      'Engaged (%)',
      'Key events',
      'Note',
    ]);
  });

  it('has no previous period for all time', () => {
    const summary = { ...data().summary!, hasPreviousPeriod: false, totalVisitsPrev: 0 };
    const kpis = trafficTable('kpis', data({ summary }), label);
    expect(kpis.rows.map((r) => r[0])).not.toContain('Visits, previous period');
    expect(kpis.rows.find((r) => r[0] === 'Change vs previous period (%)')).toEqual([
      'Change vs previous period (%)',
      null,
      'No previous period for all time',
    ]);
    expect(trafficTable('pages', data({ summary }), label).rows[0]).toEqual([
      '/pricing',
      35,
      null,
      null,
      4,
      'No previous period for all time',
    ]);
  });

  it('gives the trend as one row per day and one column per platform', () => {
    expect(trafficTable('trend', data(), label)).toEqual({
      headers: ['Day', 'ChatGPT', 'Gemini'],
      rows: [
        ['2026-10-17', 5, 1],
        ['2026-10-18', 2, 0],
      ],
    });
  });

  it('names the hours of a 24-hour trend in UTC', () => {
    const trend = [
      { date: '2026-10-17T13:00:00.000Z', 'chatgpt.com': 1 },
      { date: '2026-10-17T14:00:00.000Z', 'chatgpt.com': 0 },
    ];
    expect(trafficTable('trend', data({ trend }), label)).toEqual({
      headers: ['Hour (UTC)', 'ChatGPT'],
      rows: [
        ['2026-10-17 13:00', 1],
        ['2026-10-17 14:00', 0],
      ],
    });
  });

  it('gives each visit with its page, full URL and pageviews', () => {
    expect(trafficTable('visits', data(), label)).toEqual({
      headers: ['Time (UTC)', 'Platform', 'Page', 'URL', 'Referrer', 'Country', 'Pageviews'],
      rows: [
        [
          '2026-10-17 09:30',
          'Gemini',
          '/menu/',
          'https://acme.example/menu/?utm_source=gemini',
          'https://gemini.google.com/',
          'TR',
          3,
        ],
      ],
    });
  });

  it('lists every page with the lists it is on, so each tab can be filtered (AT-006)', () => {
    const table = trafficTable('pageStatus', data(), label);
    expect(table.headers).toEqual([
      'Page',
      'AI visits',
      'Key events from AI',
      'Citations',
      'Top platforms',
      'Prompts targeting',
      'Sessions',
      'Rank',
      'In sitemap',
      'Status',
    ]);
    expect(table.rows).toEqual([
      ['/shop/beans', 0, 0, 25, null, 2, 440, 3, 'Yes', 'No AI traffic; Cited, not clicked'],
      ['/menu', 12, 2, 0, 'ChatGPT, Gemini', 0, 0, null, 'No', 'Traffic, no prompt'],
    ]);
  });

  it('says there are no pages, never an empty sheet', () => {
    const table = trafficTable('pageStatus', data({ pageStatus: null }), label);
    expect(table.rows).toEqual([['No pages in this range']]);
  });
});

describe('where AI visitors convert (AT-014)', () => {
  const conversions = (over: Partial<TrafficConversions> = {}): TrafficConversions => ({
    aiVisits: 64,
    hasRevenue: false,
    widened: false,
    pageCount: 2,
    answerCount: 1,
    pages: [
      {
        page: '/gifts',
        aiVisits: 50,
        keyEvents: 5,
        keyEventSessions: 4,
        transactions: 1,
        revenue: 120.5,
        bestPlatform: 'chatgpt.com',
      },
      {
        page: '/pricing',
        aiVisits: 5,
        keyEvents: 2,
        keyEventSessions: 2,
        transactions: 0,
        revenue: 0,
        bestPlatform: null,
      },
    ],
    answers: [
      {
        platform: 'perplexity.ai',
        topicId: 't1',
        topic: 'Coffee gifts',
        pages: 2,
        aiVisits: 40,
        keyEvents: 4,
        keyEventSessions: 3,
        revenue: 0,
      },
    ],
    ...over,
  });

  it('gives every converting page with its rate, or why there is none', () => {
    const table = trafficTable('convertingPages', data({ conversions: conversions() }), label);
    expect(table.headers).toEqual([
      'Page',
      'AI visits',
      'Key events',
      'Revenue',
      'Rate (%)',
      'Best platform',
      'Note',
    ]);
    expect(table.rows).toEqual([
      ['/gifts', 50, 5, null, 8, 'ChatGPT', null],
      ['/pricing', 5, 2, null, null, null, 'Low sample: fewer than 30 AI visits'],
    ]);
    // Revenue only when the property reports purchases.
    const sold = trafficTable(
      'convertingPages',
      data({ conversions: conversions({ hasRevenue: true }) }),
      label,
    );
    expect(sold.rows[0][3]).toBe(120.5);
  });

  it('gives each platform × topic, and says when the last 30 days were read', () => {
    const table = trafficTable(
      'buyerAnswers',
      data({ conversions: conversions({ widened: true }) }),
      label,
    );
    expect(table.headers).toEqual([
      'Platform',
      'Topic',
      'Cited pages',
      'AI visits',
      'Key events',
      'Revenue',
      'Rate (%)',
      'Note',
    ]);
    expect(table.rows).toEqual([
      ['Perplexity', 'Coffee gifts', 2, 40, 4, null, 7.5, null],
      [
        'Last 30 days: the selected range has fewer than 30 AI visits',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ],
    ]);
  });

  it('says there are no conversions, never an empty sheet', () => {
    const none = conversions({ pages: [], answers: [] });
    expect(trafficTable('convertingPages', data({ conversions: none }), label).rows).toEqual([
      ['No key events from AI visitors in this range'],
    ]);
    expect(trafficTable('buyerAnswers', data({ conversions: null }), label).rows).toEqual([
      ['No key events from AI visitors in this range'],
    ]);
  });
});

describe('trafficTable: Is AI taking Google clicks (AT-008)', () => {
  const googlePages = (
    over: Partial<NonNullable<TrafficExportData['googlePages']>> = {},
  ): NonNullable<TrafficExportData['googlePages']> => ({
    lastDay: '2026-10-17',
    since: '2026-10-11',
    until: '2026-10-17',
    prevSince: '2026-10-04',
    prevUntil: '2026-10-10',
    incomplete: false,
    count: 1,
    rows: [
      {
        page: '/blog/how-to',
        url: 'https://acme.example/blog/how-to',
        impressions: 1420,
        prevImpressions: 1000,
        clicks: 14,
        prevClicks: 31,
        promptId: 'p1',
      },
    ],
    ...over,
  });

  it('holds both periods, the rise, the CTRs and the days compared', () => {
    const table = trafficTable('googlePages', data({ googlePages: googlePages() }), label);
    expect(table.headers).toEqual([
      'Page',
      'URL',
      'Impressions',
      'Impressions, previous period',
      'Change (%)',
      'CTR (%)',
      'CTR, previous period (%)',
      'Clicks',
      'Clicks, previous period',
      'Days',
      'Days, previous period',
    ]);
    expect(table.rows).toEqual([
      [
        '/blog/how-to',
        'https://acme.example/blog/how-to',
        1420,
        1000,
        42,
        1,
        3.1,
        14,
        31,
        '2026-10-11 – 2026-10-17',
        '2026-10-04 – 2026-10-10',
      ],
    ]);
  });

  it('says why there are no rows, never an empty sheet', () => {
    const rows = (g: TrafficExportData['googlePages']) =>
      trafficTable('googlePages', data({ googlePages: g }), label).rows;
    expect(rows(googlePages({ rows: [], count: 0 }))).toEqual([
      ["No page's impressions rose 15% while its CTR fell 20% in this range"],
    ]);
    expect(rows(googlePages({ lastDay: null, since: null, rows: [] }))).toEqual([
      ['No page data from Google Search Console yet'],
    ]);
    expect(rows(null)).toEqual([['No page data from Google Search Console yet']]);
    expect(rows(googlePages({ since: null, rows: [] }))).toEqual([
      ['No previous period for all time'],
    ]);
    expect(rows(googlePages({ incomplete: true, rows: [] }))).toEqual([
      ["Google Search Console's page history doesn't reach back to the period before this range"],
    ]);
  });
});

describe('trafficTable: Untracked Google queries (AT-009)', () => {
  const googleQueries = (
    over: Partial<NonNullable<TrafficExportData['googleQueries']>> = {},
  ): NonNullable<TrafficExportData['googleQueries']> => ({
    lastDay: '2026-10-17',
    since: '2026-10-11',
    until: '2026-10-17',
    count: 2,
    capped: false,
    rows: [
      { query: 'cold brew ratio', clicks: 25, impressions: 610 },
      { query: 'oat milk latte', clicks: 4, impressions: 120 },
    ],
    ...over,
  });
  const table = (q: TrafficExportData['googleQueries']) =>
    trafficTable('googleQueries', data({ googleQueries: q }), label);

  it('holds every query with its clicks, impressions and the days read', () => {
    expect(table(googleQueries())).toEqual({
      headers: ['Query', 'Clicks', 'Impressions', 'Days'],
      rows: [
        ['cold brew ratio', 25, 610, '2026-10-11 – 2026-10-17'],
        ['oat milk latte', 4, 120, '2026-10-11 – 2026-10-17'],
      ],
    });
    expect(table(googleQueries({ since: null })).rows[0][3]).toBe('Start – 2026-10-17');
    expect(table(googleQueries({ capped: true })).rows.at(-1)).toEqual([
      'Only the 5,000 most clicked queries were checked',
      null,
      null,
      null,
    ]);
  });

  it('says why there are no rows, never an empty sheet', () => {
    expect(table(googleQueries({ rows: [], count: 0 })).rows).toEqual([
      ['Every Google query with clicks in this range is tracked'],
    ]);
    expect(table(null).rows).toEqual([['No query data from Google Search Console yet']]);
  });
});

describe('filtersTable', () => {
  it('records the range, the filters, the sources and when', () => {
    const table = filtersTable(
      data({ platform: 'gemini.google.com', search: 'menu', from: null }),
      label,
    );
    expect(Object.fromEntries(table.rows.map(([k, v]) => [k, v]))).toEqual({
      Brand: 'Acme Coffee',
      Range: 'last 7 days',
      From: 'Start',
      To: '2026-10-18',
      Platform: 'Gemini',
      Search: 'menu',
      'Tracking snippet': 'Active',
      'Google Analytics': 'Connected',
      'Google Search Console': 'Not connected',
      'Exported at': '2026-10-18 10:05 UTC',
    });
  });
});

describe('trafficWorkbook', () => {
  it('puts the Filters sheet first and one sheet per section after it', () => {
    const sheets = trafficWorkbook(data(), TRAFFIC_EXPORT_SECTIONS, label, { withFilters: true });
    expect(sheets.map((s) => s.sheet)).toEqual([
      'Filters',
      'KPIs',
      'Trend',
      'Platforms',
      'Top landing pages',
      'Top converting pages',
      'Answers that bring buyers',
      'Pages by status',
      'Is AI taking Google clicks',
      'Untracked Google queries',
      'Visits',
    ]);
    // A bold header row, then the rows with their numbers as numbers.
    expect(sheets[3].data[0][0]).toEqual({ value: 'Platform', fontWeight: 'bold' });
    expect(sheets[3].data[1]).toEqual(['ChatGPT', 40, 33, 21, 72.7, 75, 6, null]);
  });

  it('holds only the table for a single table', () => {
    const sheets = trafficWorkbook(data(), ['visits'], label, { withFilters: false });
    expect(sheets.map((s) => s.sheet)).toEqual(['Visits']);
  });
});

describe('tableCsv', () => {
  it('starts with a byte order mark, so Excel reads it as UTF-8', () => {
    const csv = tableCsv({ headers: ['Page', 'Visits'], rows: [['/çay, demlik', 3]] });
    expect(csv.startsWith(BYTE_ORDER_MARK)).toBe(true);
    expect(csv.slice(1)).toBe('Page,Visits\n"/çay, demlik",3');
  });
});

describe('trafficExportFileName', () => {
  it('names the whole page ansvisor-ai-traffic-{brand}-{from}_{to}', () => {
    expect(
      trafficExportFileName({
        brand: 'Acme Coffee',
        from: '2026-10-11',
        to: '2026-10-18',
        ext: 'xlsx',
      }),
    ).toBe('ansvisor-ai-traffic-acme-coffee-2026-10-11_2026-10-18.xlsx');
  });

  it('adds the table for a single table, and says all time when there is no start', () => {
    expect(
      trafficExportFileName({
        brand: 'acme-coffee',
        from: null,
        to: '2026-10-18',
        ext: 'csv',
        table: 'Top landing pages',
      }),
    ).toBe('ansvisor-ai-traffic-acme-coffee-top-landing-pages-all-time_2026-10-18.csv');
  });
});
