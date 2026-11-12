import { parseCsv } from '@/lib/prompt-import';
import {
  MAX_TOPICS,
  TOPIC_CHARS,
  checkDraft,
  cleanTopics,
  dayMs,
  readCount,
  type BusinessHubEntry,
  type EntryInput,
  type PeriodDays,
} from '@/lib/business-hub/numbers';

/**
 * Business Hub numbers from a spreadsheet: Ansvisor's own CSV template, not
 * an export of Business Hub's (it has none). A person copies Business Hub's
 * numbers into it, one row per entry, and the preview says, before anything
 * is saved, which rows are new, which replace an entry and which can't be
 * read and why.
 *
 * Columns are matched by their header, in any order, and any other column is
 * left alone: should Business Hub ever offer an export, reading it is a
 * mapping of its headers. Excel's ways are read as it saves them in Turkey
 * and elsewhere: a semicolon or a comma between cells, a UTF-8 BOM, numbers
 * with their thousands marked ("1.240", "1,240"), and dates as YYYY-MM-DD or
 * DD.MM.YYYY. A number that could be read two ways ("1,5") is refused.
 */

export const CSV_HEADER = [
  'period_end',
  'period_days',
  'mentions',
  'website_clicks',
  'profile_views',
  'topic_1',
  'topic_2',
  'topic_3',
  'topic_4',
  'topic_5',
] as const;
/** Rows one file may carry: two years of weeks, what the API takes at once. */
export const MAX_CSV_ROWS = 104;

/** The template as a file: its header, a BOM so Excel reads it as UTF-8. */
export function templateCsv(): string {
  return `﻿${CSV_HEADER.join(',')}\r\n`;
}

export type CsvReason =
  | 'date'
  | 'future'
  | 'too_old'
  | 'days'
  | 'count'
  | 'too_many_topics'
  | 'topic_too_long'
  | 'empty'
  | 'duplicate';

export interface CsvRow {
  /** 1-based, the header excluded. */
  row: number;
  status: 'new' | 'replaces' | 'error';
  reason: CsvReason | null;
  /** The column a problem is in, as the file names it. */
  column: string | null;
  /** The row a duplicate repeats. */
  sameAs: number | null;
  entry: EntryInput | null;
}

export interface CsvPreview {
  rows: CsvRow[];
  /** The entries to save, in file order. */
  importable: EntryInput[];
  counts: { new: number; replaces: number; errors: number };
  /** No period_end column: nothing can be read. */
  missingHeader: boolean;
  /** Rows beyond MAX_CSV_ROWS, not read. */
  truncated: number;
}

type Column = 'period_end' | 'period_days' | 'mentions' | 'website_clicks' | 'profile_views';
const COLUMNS: Column[] = [
  'period_end',
  'period_days',
  'mentions',
  'website_clicks',
  'profile_views',
];

/** A header as a key: lower case, spaces and dashes as underscores. */
const keyOf = (header: string) =>
  header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

/** Where each column is, by header; topic_N columns in their number's order. */
export function readHeader(header: string[]): {
  at: Partial<Record<Column, number>>;
  topics: number[];
} {
  const at: Partial<Record<Column, number>> = {};
  const topics: { n: number; i: number }[] = [];
  header.forEach((cell, i) => {
    const key = keyOf(cell);
    if ((COLUMNS as string[]).includes(key) && at[key as Column] === undefined) {
      at[key as Column] = i;
      return;
    }
    const topic = /^topic_?(\d+)$/.exec(key);
    if (topic) topics.push({ n: Number(topic[1]), i });
  });
  return { at, topics: topics.sort((a, b) => a.n - b.n).map((t) => t.i) };
}

/** A day as YYYY-MM-DD, from YYYY-MM-DD or DD.MM.YYYY (D.M.YYYY too); null otherwise. */
export function readDay(text: string): string | null {
  const value = text.trim();
  let day = value;
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
  if (dotted) day = `${dotted[3]}-${dotted[2].padStart(2, '0')}-${dotted[1].padStart(2, '0')}`;
  return dayMs(day) === null ? null : day;
}

/**
 * Every row's fate against the brand's entries. A row is an error when its
 * last day, length, a number or its topics can't be taken, when it says
 * nothing, or when an earlier row has the same length and last day.
 */
export function buildCsvPreview(
  sheet: string[][],
  existing: Pick<BusinessHubEntry, 'periodDays' | 'periodEnd'>[],
  now: Date = new Date(),
): CsvPreview {
  const { at, topics } = readHeader(sheet[0] ?? []);
  if (at.period_end === undefined) {
    return {
      rows: [],
      importable: [],
      counts: { new: 0, replaces: 0, errors: 0 },
      missingHeader: true,
      truncated: 0,
    };
  }
  const body = sheet.slice(1);
  const truncated = Math.max(0, body.length - MAX_CSV_ROWS);
  const have = new Set(existing.map((e) => `${e.periodDays}|${e.periodEnd}`));
  const seen = new Map<string, number>();
  const cell = (r: string[], i: number | undefined) => (i === undefined ? '' : (r[i] ?? '').trim());

  const rows: CsvRow[] = body.slice(0, MAX_CSV_ROWS).map((r, index) => {
    const row = index + 1;
    const fail = (reason: CsvReason, column: string | null = null, sameAs: number | null = null) =>
      ({ row, status: 'error', reason, column, sameAs, entry: null }) as CsvRow;

    const periodEnd = readDay(cell(r, at.period_end));
    if (!periodEnd) return fail('date', 'period_end');
    const daysText = cell(r, at.period_days);
    if (daysText !== '' && daysText !== '7' && daysText !== '28')
      return fail('days', 'period_days');
    const periodDays: PeriodDays = daysText === '28' ? 28 : 7;
    for (const column of ['mentions', 'website_clicks', 'profile_views'] as const) {
      if (readCount(cell(r, at[column])) === 'invalid') return fail('count', column);
    }
    const typed = topics.map((i) => cell(r, i));
    if (typed.some((t) => t.length > TOPIC_CHARS)) return fail('topic_too_long');
    if (cleanTopics(typed).length > MAX_TOPICS) return fail('too_many_topics');

    const checked = checkDraft(
      {
        periodDays,
        periodEnd,
        mentions: cell(r, at.mentions),
        websiteClicks: cell(r, at.website_clicks),
        profileViews: cell(r, at.profile_views),
        topics: typed,
      },
      now,
    );
    if (!checked.ok) {
      const problem = checked.problems.periodEnd;
      if (problem === 'future' || problem === 'too_old') return fail(problem, 'period_end');
      return fail('empty');
    }
    const key = `${periodDays}|${periodEnd}`;
    const first = seen.get(key);
    if (first !== undefined) return fail('duplicate', null, first);
    seen.set(key, row);
    return {
      row,
      status: have.has(key) ? 'replaces' : 'new',
      reason: null,
      column: null,
      sameAs: null,
      entry: checked.entry,
    };
  });

  const importable = rows.flatMap((r) => (r.entry ? [r.entry] : []));
  return {
    rows,
    importable,
    counts: {
      new: rows.filter((r) => r.status === 'new').length,
      replaces: rows.filter((r) => r.status === 'replaces').length,
      errors: rows.filter((r) => r.status === 'error').length,
    },
    missingHeader: false,
    truncated,
  };
}

/** A file's text as its preview. */
export function previewCsv(
  text: string,
  existing: Pick<BusinessHubEntry, 'periodDays' | 'periodEnd'>[],
  now: Date = new Date(),
): CsvPreview {
  return buildCsvPreview(parseCsv(text), existing, now);
}
