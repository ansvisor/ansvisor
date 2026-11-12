import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/lib/prompt-import';
import { CSV_HEADER, buildCsvPreview, previewCsv, readDay, readHeader, templateCsv } from './csv';

/**
 * Business Hub numbers from Ansvisor's CSV template: matched by header,
 * Turkish and English Excel's ways read, and every row's fate said before
 * anything is saved.
 */

const NOW = new Date('2026-11-11T10:00:00Z');
const HEADER = CSV_HEADER.join(',');

describe('templateCsv', () => {
  it('is the header alone, with a BOM so Excel reads it as UTF-8', () => {
    expect(templateCsv()).toBe(
      '﻿period_end,period_days,mentions,website_clicks,profile_views,topic_1,topic_2,topic_3,topic_4,topic_5\r\n',
    );
    // It reads back as its own header.
    expect(parseCsv(templateCsv())).toEqual([[...CSV_HEADER]]);
  });
});

describe('readHeader and readDay', () => {
  it('finds the columns by header in any order, and leaves the rest alone', () => {
    expect(
      readHeader(['Notes', 'Website Clicks', 'period-end', 'Topic 2', 'topic_1', 'Mentions']),
    ).toEqual({
      at: { website_clicks: 1, period_end: 2, mentions: 5 },
      topics: [4, 3],
    });
  });

  it('reads YYYY-MM-DD and DD.MM.YYYY, and nothing else', () => {
    expect(readDay('2026-11-10')).toBe('2026-11-10');
    expect(readDay('10.11.2026')).toBe('2026-11-10');
    expect(readDay('3.2.2026')).toBe('2026-02-03');
    expect(readDay('31.02.2026')).toBeNull();
    expect(readDay('11/10/2026')).toBeNull();
    expect(readDay('')).toBeNull();
  });
});

describe('previewCsv', () => {
  it('reads the template filled in, a number left empty as not shown', () => {
    const preview = previewCsv(
      `${HEADER}\n2026-11-10,7,53,19,,Coffee subscriptions,Decaf coffee,,,\n`,
      [],
      NOW,
    );
    expect(preview.counts).toEqual({ new: 1, replaces: 0, errors: 0 });
    expect(preview.importable).toEqual([
      {
        periodDays: 7,
        periodEnd: '2026-11-10',
        mentions: 53,
        websiteClicks: 19,
        profileViews: null,
        topics: ['Coffee subscriptions', 'Decaf coffee'],
      },
    ]);
  });

  it('reads a Turkish Excel file: a BOM, semicolons, 1.240 and DD.MM.YYYY', () => {
    const file = `﻿${CSV_HEADER.join(';')}\r\n10.11.2026;7;1.240;1,240;98;Kahve aboneliği;;;;\r\n`;
    const preview = previewCsv(file, [], NOW);
    expect(preview.rows[0]).toMatchObject({ status: 'new', reason: null });
    expect(preview.importable[0]).toMatchObject({
      periodEnd: '2026-11-10',
      mentions: 1240,
      websiteClicks: 1240,
      profileViews: 98,
      topics: ['Kahve aboneliği'],
    });
  });

  it('says which rows replace an entry the brand has', () => {
    const preview = previewCsv(
      `${HEADER}\n2026-11-10,7,53,,,,,,,\n2026-11-03,7,44,,,,,,,\n2026-11-03,28,160,,,,,,,\n`,
      [{ periodDays: 7, periodEnd: '2026-11-03' }],
      NOW,
    );
    expect(preview.rows.map((r) => r.status)).toEqual(['new', 'replaces', 'new']);
    expect(preview.counts).toEqual({ new: 2, replaces: 1, errors: 0 });
  });

  it('refuses a row it can’t read, and says why and where', () => {
    const preview = previewCsv(
      [
        HEADER,
        '2026-13-01,7,5,,,,,,,',
        '2026-11-10,14,5,,,,,,,',
        '2026-11-10,7,"1,5",,,,,,,',
        '2026-11-03,7,-2,,,,,,,',
        '2027-01-01,7,5,,,,,,,',
        '2026-10-27,7,,,,,,,,',
        '2026-10-20,7,5,,,,,,,',
        '20.10.2026,7,6,,,,,,,',
      ].join('\n'),
      [],
      NOW,
    );
    expect(preview.rows.map((r) => [r.status, r.reason, r.column])).toEqual([
      ['error', 'date', 'period_end'],
      ['error', 'days', 'period_days'],
      ['error', 'count', 'mentions'],
      ['error', 'count', 'mentions'],
      ['error', 'future', 'period_end'],
      ['error', 'empty', null],
      ['new', null, null],
      ['error', 'duplicate', null],
    ]);
    expect(preview.rows[7].sameAs).toBe(7);
    expect(preview.importable).toHaveLength(1);
  });

  it('refuses a sixth topic and one over 120 characters', () => {
    const six = `period_end,mentions,topic_1,topic_2,topic_3,topic_4,topic_5,topic_6\n2026-11-10,5,a,b,c,d,e,f\n`;
    expect(previewCsv(six, [], NOW).rows[0]).toMatchObject({ reason: 'too_many_topics' });
    // A sixth that repeats one of the five is the same topic.
    const again = `period_end,mentions,topic_1,topic_2,topic_3,topic_4,topic_5,topic_6\n2026-11-10,5,a,b,c,d,e,A\n`;
    expect(previewCsv(again, [], NOW).rows[0]).toMatchObject({ status: 'new' });
    const long = `period_end,topic_1\n2026-11-10,${'x'.repeat(121)}\n`;
    expect(previewCsv(long, [], NOW).rows[0]).toMatchObject({ reason: 'topic_too_long' });
  });

  it('needs a period_end column, and reads 104 rows at most', () => {
    expect(previewCsv('Date,Mentions\n2026-11-10,5\n', [], NOW)).toMatchObject({
      missingHeader: true,
      rows: [],
    });
    const many = Array.from(
      { length: 106 },
      (_, i) =>
        `${new Date(NOW.getTime() - (i + 1) * 7 * 86_400_000).toISOString().slice(0, 10)},7,${i}`,
    );
    const preview = buildCsvPreview(
      parseCsv(['period_end,period_days,mentions', ...many].join('\n')),
      [],
      NOW,
    );
    expect(preview.rows).toHaveLength(104);
    expect(preview.truncated).toBe(2);
    expect(preview.counts.new).toBe(104);
  });
});
