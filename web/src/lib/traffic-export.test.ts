import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../messages/en.json';
import type { SourceState } from '@/lib/actions/integrations';
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
    hasPreviousPeriod: true,
    platformBreakdown: [
      { platform: 'chatgpt.com', visits: 40, visitsPrev: 33 },
      { platform: 'gemini.google.com', visits: 12, visitsPrev: 5 },
      { platform: 'claude.ai', visits: 3, visitsPrev: 0 },
    ],
    topPages: [{ url: '/pricing', visits: 35, visitsPrev: 30 }],
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
  opportunitiesStatus: 'connected',
  opportunities: {
    pages: 30,
    rows: [
      {
        landingPage: '/shop/beans',
        valueSignal: 'key_events',
        valuePercentile: 90.9,
        valueRank: 3,
        sessions: 440,
        engagedSessions: 220,
        keyEvents: 70,
        transactions: 0,
        revenue: 0,
        engagementSeconds: 0,
        citationState: 'targeted_not_cited',
        citations: 0,
        citingPrompts: 0,
        targetingPrompts: 2,
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
      ['ChatGPT', 40, 33, 21, 72.7, null],
      ['Gemini', 12, 5, null, 21.8, expect.stringContaining('Low sample')],
      ['Claude', 3, 0, null, 5.5, expect.stringContaining('New')],
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

  it('gives the pages without AI traffic with the value that ranked them', () => {
    const table = trafficTable('opportunities', data(), label);
    expect(table.rows).toEqual([
      ['/shop/beans', 'Not cited', 0, 2, 440, 'Conversions', 70, 3, 90.9],
    ]);
  });

  it('says why there are no pages without AI traffic, never an empty sheet', () => {
    const note = (over: Partial<TrafficExportData>) =>
      trafficTable('opportunities', data(over), label);
    expect(note({ opportunitiesStatus: 'not_connected' }).rows).toEqual([
      ['Needs Google Analytics: not connected'],
    ]);
    expect(note({ opportunities: { pages: 0, rows: [] } }).rows).toEqual([
      ['No data for this range in Google Analytics'],
    ]);
    expect(note({ opportunities: { pages: 30, rows: [] } }).rows).toEqual([
      ['No high-value pages without AI traffic in this range'],
    ]);
    expect(note({ opportunitiesStatus: 'failed', opportunities: null }).rows[0][0]).toContain(
      "couldn't be read",
    );
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
      'Pages without AI traffic',
      'Visits',
    ]);
    // A bold header row, then the rows with their numbers as numbers.
    expect(sheets[3].data[0][0]).toEqual({ value: 'Platform', fontWeight: 'bold' });
    expect(sheets[3].data[1]).toEqual(['ChatGPT', 40, 33, 21, 72.7, null]);
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
