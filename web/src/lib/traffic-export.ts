/**
 * The AI Traffic page as files (AT-015, spec §3.9): the whole page as an
 * Excel workbook, one sheet per section plus a Filters sheet, or as a zip of
 * one CSV per section; and each table on its own.
 *
 * Pure: the route reads the data and calls these. Numbers stay numbers, so a
 * spreadsheet can sum them; a % change the page wouldn't show (below 30
 * visits, or no previous period) is left empty with the reason beside it.
 */

import type { Sheet } from 'write-excel-file/node';
import type {
  PageOpportunities,
  TrafficLog,
  TrafficSources,
  TrafficSummary,
  TrafficTrendPoint,
} from '@/lib/actions/traffic';
import { csvLine } from '@/lib/csv';
import { getPlatformName } from '@/lib/traffic-platforms';
import { visitChange } from '@/lib/traffic-change';
import {
  googleSourceStatus,
  snippetDetected,
  type GoogleSourceStatus,
} from '@/lib/traffic-sources';

/** Every section, in the page's order. */
export const TRAFFIC_EXPORT_SECTIONS = [
  'kpis',
  'trend',
  'platforms',
  'pages',
  'opportunities',
  'visits',
] as const;

export type TrafficExportSection = (typeof TRAFFIC_EXPORT_SECTIONS)[number];

/** The tables that carry their own Excel / CSV buttons, as in the mockup. */
export const TRAFFIC_TABLE_SECTIONS = ['platforms', 'pages', 'opportunities', 'visits'] as const;

/** Beyond this many visits an export would take too long to build on request. */
export const TRAFFIC_EXPORT_MAX_ROWS = 100_000;

/** A label from en.json's traffic.export namespace. */
export type ExportLabel = (key: string, values?: Record<string, string | number>) => string;

export interface TrafficExportData {
  brandName: string;
  /** The page's words for the range, e.g. "last 7 days". */
  rangeLabel: string;
  /** First and last day (YYYY-MM-DD); no first day for all time. */
  from: string | null;
  to: string;
  platform: string | null;
  search: string | null;
  exportedAt: Date;
  summary?: TrafficSummary;
  trend?: TrafficTrendPoint[];
  visits?: TrafficLog[];
  /** Null when Google Analytics has nothing to rank: see `opportunitiesStatus`. */
  opportunities?: PageOpportunities | null;
  /** The source's state, or 'failed' when its findings couldn't be read. */
  opportunitiesStatus?: GoogleSourceStatus | 'failed';
  sources?: TrafficSources | null;
}

type Cell = string | number | null;

export interface ExportTable {
  headers: string[];
  rows: Cell[][];
}

/** A change the page would show, as a number, or why there is none. */
function change(current: number, previous: number, comparable: boolean, label: ExportLabel) {
  const c = visitChange(current, previous, { comparable });
  if (c.kind === 'pct') return { pct: c.pct, note: '' };
  if (c.kind === 'low') return { pct: null, note: label('notes.lowSample') };
  if (c.kind === 'new') return { pct: null, note: label('notes.new') };
  return { pct: null, note: comparable ? '' : label('notes.noPreviousPeriod') };
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** "2026-10-17 09:30" in UTC: sorts and reads the same everywhere. */
function utcMinute(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

function kpis(data: TrafficExportData, label: ExportLabel): ExportTable {
  const s = data.summary;
  if (!s) return { headers: [], rows: [] };
  const top = s.platformBreakdown[0];
  const delta = change(s.totalVisits, s.totalVisitsPrev, s.hasPreviousPeriod, label);
  return {
    headers: [label('columns.metric'), label('columns.value'), label('columns.note')],
    rows: [
      [label('metrics.visits'), s.totalVisits, null],
      [label('metrics.pageviews'), s.totalPageviews, null],
      ...(s.hasPreviousPeriod
        ? ([[label('metrics.previousVisits'), s.totalVisitsPrev, null]] as Cell[][])
        : []),
      [label('metrics.change'), delta.pct, delta.note || null],
      [label('metrics.topPlatform'), top ? getPlatformName(top.platform) : null, null],
      [label('metrics.topPlatformVisits'), top ? top.visits : null, null],
      [label('metrics.platforms'), s.platformBreakdown.length, null],
    ],
  };
}

function trend(data: TrafficExportData, label: ExportLabel): ExportTable {
  const points = data.trend ?? [];
  const platforms = [...new Set(points.flatMap((p) => Object.keys(p).filter((k) => k !== 'date')))];
  // The 24-hour range trends by hour (AT-017): "2026-10-17 13:00", UTC.
  const hourly = points.some((p) => p.date.includes('T'));
  return {
    headers: [
      hourly ? label('columns.hour') : label('columns.day'),
      ...platforms.map(getPlatformName),
    ],
    rows: points.map((p) => [
      hourly ? utcMinute(p.date) : p.date,
      ...platforms.map((k) => Number(p[k]) || 0),
    ]),
  };
}

function platforms(data: TrafficExportData, label: ExportLabel): ExportTable {
  const s = data.summary;
  const total = s?.totalVisits ?? 0;
  return {
    headers: [
      label('columns.platform'),
      label('columns.visits'),
      label('columns.previousVisits'),
      label('columns.change'),
      label('columns.share'),
      label('columns.note'),
    ],
    rows: (s?.platformBreakdown ?? []).map((row) => {
      const delta = change(row.visits, row.visitsPrev, s!.hasPreviousPeriod, label);
      return [
        getPlatformName(row.platform),
        row.visits,
        s!.hasPreviousPeriod ? row.visitsPrev : null,
        delta.pct,
        total > 0 ? Math.round((row.visits / total) * 1000) / 10 : null,
        delta.note || null,
      ];
    }),
  };
}

function pages(data: TrafficExportData, label: ExportLabel): ExportTable {
  const s = data.summary;
  return {
    headers: [
      label('columns.page'),
      label('columns.visits'),
      label('columns.previousVisits'),
      label('columns.change'),
      label('columns.note'),
    ],
    rows: (s?.topPages ?? []).map((row) => {
      const delta = change(row.visits, row.visitsPrev, s!.hasPreviousPeriod, label);
      return [
        row.url,
        row.visits,
        s!.hasPreviousPeriod ? row.visitsPrev : null,
        delta.pct,
        delta.note || null,
      ];
    }),
  };
}

function opportunities(data: TrafficExportData, label: ExportLabel): ExportTable {
  const status = data.opportunitiesStatus ?? 'connected';
  const result = data.opportunities;
  // Never an empty sheet: say why there are no rows (spec §3.8b).
  const note = (text: string): ExportTable => ({
    headers: [label('columns.note')],
    rows: [[text]],
  });
  if (status !== 'connected') return note(label(`notes.analytics.${status}`));
  if (!result || result.pages === 0) return note(label('notes.analytics.noData'));
  if (result.rows.length === 0) return note(label('notes.analytics.noFinding'));
  return {
    headers: [
      label('columns.page'),
      label('columns.aiVisibility'),
      label('columns.citations'),
      label('columns.targetingPrompts'),
      label('columns.sessions'),
      label('columns.rankedBy'),
      label('columns.value'),
      label('columns.rank'),
      label('columns.percentile'),
    ],
    rows: result.rows.map((row) => [
      row.landingPage,
      label(`citationStates.${row.citationState}`),
      row.citations,
      row.targetingPrompts,
      row.sessions,
      label(`signals.${row.valueSignal}`),
      row.valueSignal === 'revenue'
        ? row.revenue
        : row.valueSignal === 'transactions'
          ? row.transactions
          : row.valueSignal === 'key_events'
            ? row.keyEvents
            : Math.round(row.engagementSeconds / 60),
      row.valueRank,
      row.valuePercentile,
    ]),
  };
}

function visits(data: TrafficExportData, label: ExportLabel): ExportTable {
  return {
    headers: [
      label('columns.time'),
      label('columns.platform'),
      label('columns.page'),
      label('columns.url'),
      label('columns.referrer'),
      label('columns.country'),
      label('columns.pageviews'),
    ],
    rows: (data.visits ?? []).map((v) => [
      utcMinute(v.createdAt),
      getPlatformName(v.sourcePlatform ?? 'unknown'),
      pathOf(v.url),
      v.url,
      v.referrer,
      v.country,
      v.pageviews,
    ]),
  };
}

/** One section as a table: its headers and its rows. */
export function trafficTable(
  section: TrafficExportSection,
  data: TrafficExportData,
  label: ExportLabel,
): ExportTable {
  switch (section) {
    case 'kpis':
      return kpis(data, label);
    case 'trend':
      return trend(data, label);
    case 'platforms':
      return platforms(data, label);
    case 'pages':
      return pages(data, label);
    case 'opportunities':
      return opportunities(data, label);
    case 'visits':
      return visits(data, label);
  }
}

/** What the export was made from: the range, the filters, the sources and when. */
export function filtersTable(data: TrafficExportData, label: ExportLabel): ExportTable {
  const sourceState = (status: GoogleSourceStatus) => label(`sourceStates.${status}`);
  const sources = data.sources;
  return {
    headers: [label('columns.setting'), label('columns.value')],
    rows: [
      [label('filters.brand'), data.brandName],
      [label('filters.range'), data.rangeLabel],
      [label('filters.from'), data.from ?? label('filters.start')],
      [label('filters.to'), data.to],
      [
        label('filters.platform'),
        data.platform ? getPlatformName(data.platform) : label('filters.allPlatforms'),
      ],
      [label('filters.search'), data.search || label('filters.none')],
      [
        label('filters.snippet'),
        sources
          ? snippetDetected(sources.snippetLastVisitAt)
            ? label('sourceStates.active')
            : label('sourceStates.notDetected')
          : null,
      ],
      [label('filters.ga'), sources ? sourceState(googleSourceStatus(sources.ga)) : null],
      [label('filters.gsc'), sources ? sourceState(googleSourceStatus(sources.gsc)) : null],
      [label('filters.exportedAt'), `${utcMinute(data.exportedAt.toISOString())} UTC`],
    ],
  };
}

const bold = (value: string) => ({ value, fontWeight: 'bold' as const });

function sheetOf(name: string, table: ExportTable): Sheet<Buffer> {
  return {
    sheet: name,
    stickyRowsCount: 1,
    columns: table.headers.map((_, i) => ({ width: i === 0 ? 44 : 18 })),
    data: [table.headers.map(bold), ...table.rows],
  };
}

/**
 * The workbook: the sections asked for, one sheet each, and — for the whole
 * page — the Filters sheet first, so whoever opens the file sees what it is.
 */
export function trafficWorkbook(
  data: TrafficExportData,
  sections: readonly TrafficExportSection[],
  label: ExportLabel,
  { withFilters }: { withFilters: boolean },
): Sheet<Buffer>[] {
  return [
    ...(withFilters ? [sheetOf(label('sheets.filters'), filtersTable(data, label))] : []),
    ...sections.map((section) =>
      sheetOf(label(`sheets.${section}`), trafficTable(section, data, label)),
    ),
  ];
}

/** Excel opens a UTF-8 CSV as UTF-8 only when it starts with a byte order mark. */
export const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

export function tableCsv(table: ExportTable): string {
  return BYTE_ORDER_MARK + [csvLine(table.headers), ...table.rows.map(csvLine)].join('\n');
}

/** "acme-coffee" from a brand name or a sheet name: safe in a file name. */
export function fileSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'brand'
  );
}

/**
 * ansvisor-ai-traffic-{brand}-{from}_{to}.{ext} (spec §3.9); a single table
 * adds its name. All time has no first day.
 */
export function trafficExportFileName({
  brand,
  from,
  to,
  ext,
  table,
}: {
  brand: string;
  from: string | null;
  to: string;
  ext: 'xlsx' | 'zip' | 'csv';
  /** The table's sheet name, for a single table. */
  table?: string;
}): string {
  const range = from ? `${from}_${to}` : `all-time_${to}`;
  const parts = ['ansvisor-ai-traffic', fileSlug(brand), table && fileSlug(table), range];
  return `${parts.filter(Boolean).join('-')}.${ext}`;
}
