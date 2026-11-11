import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { getDateRange } from '@/lib/date-range';
import {
  RANGE_PRESETS,
  pageRangeOf,
  parseRange,
  rangeCommand,
  rangeDays,
  rangeDaysBack,
  rangeInText,
  rangeOptions,
  rangePhrase,
  rangeWindow,
  rangeWords,
  type RangeT,
} from './range';

/**
 * Chat's date range (owner request 2026-11-11): the app's presets with the
 * same days as its pages, a custom range, the range a message names or
 * sets as the default, the page's own range, and the card's buttons.
 */

const NOW = new Date('2026-11-11T15:30:00.000Z');
const tr = createTranslator({ locale: 'en', messages, namespace: 'chatRange' });
const say: RangeT = (key, values) => tr(key as never, values as never);

describe('presets', () => {
  it("cover the same days as the app's date presets (lib/date-range.ts)", () => {
    for (const preset of ['7d', '30d', '90d'] as const) {
      const page = getDateRange(preset, { from: '', to: '' }, NOW).days!;
      expect(rangeWindow(preset, NOW)).toEqual({ dateFrom: page.dayFrom, dateTo: page.dayTo });
    }
    // "Last 30 days" is today and the 29 days before: 30 days, not 31.
    expect(rangeWindow('30d', NOW)).toEqual({ dateFrom: '2026-10-13', dateTo: '2026-11-11' });
    expect(rangeWindow('7d', NOW)).toEqual({ dateFrom: '2026-11-05', dateTo: '2026-11-11' });
    // The last 24 hours roll from this hour yesterday, as on the pages.
    expect(rangeWindow('24h', NOW)).toEqual({
      dateFrom: getDateRange('24h', { from: '', to: '' }, NOW).dateFrom,
      dateTo: '2026-11-11',
    });
    expect(rangeWindow('2026-10-01/2026-10-15', NOW)).toEqual({
      dateFrom: '2026-10-01',
      dateTo: '2026-10-15',
    });
  });

  it('count their days, and days back for a read that takes them', () => {
    expect(RANGE_PRESETS.map(rangeDays)).toEqual([1, 7, 30, 90]);
    expect(rangeDays('2026-10-01/2026-10-15')).toBe(15);
    expect(rangeDaysBack('2026-11-01/2026-11-05', NOW, 90)).toBe(11);
    expect(rangeDaysBack('2025-01-01/2025-02-01', NOW, 90)).toBe(90);
    expect(rangeDaysBack('7d', NOW, 90)).toBe(7);
  });

  it('take a preset or two days, the first first and neither after today', () => {
    expect(parseRange('7d')).toBe('7d');
    expect(parseRange(' 24h ')).toBe('24h');
    expect(parseRange('2026-10-01/2026-10-15', NOW)).toBe('2026-10-01/2026-10-15');
    for (const bad of [
      '14d',
      'all',
      '2026-10-15/2026-10-01',
      '2026-10-01/2026-11-20',
      '2026-02-30/2026-03-01',
      '2026-10-01',
      '2026-10-01/2026-10-15/x',
      null,
      7,
    ]) {
      expect(parseRange(bad, NOW)).toBeNull();
    }
  });

  it('say their words, on the card, its page button and the line under the box', () => {
    expect(rangeWords('24h', say)).toBe('Last 24 hours');
    expect(rangeWords('30d', say)).toBe('Last 30 days');
    expect(rangeWords('7d', say, { as: 'page' })).toBe("This page's range: last 7 days");
    expect(rangeWords('30d', say, { as: 'line' })).toBe('Range: last 30 days');
    expect(rangeWords('2026-10-01/2026-10-15', say, { now: NOW })).toBe('Oct 1 – Oct 15');
    expect(rangeWords('2025-12-20/2026-01-05', say, { now: NOW })).toBe(
      'Dec 20, 2025 – Jan 5, 2026',
    );
    // As the models are told it, in English.
    expect(rangePhrase('7d', NOW)).toBe('the last 7 days');
    expect(rangePhrase('24h', NOW)).toBe('the last 24 hours');
    expect(rangePhrase('2026-10-01/2026-10-15', NOW)).toBe('Oct 1 to Oct 15');
  });
});

describe('a period in a message', () => {
  it('reads the periods people name, in English and Turkish', () => {
    const cases: [string, string][] = [
      ['How did visibility change in the last 7 days?', '7d'],
      ['how was last week?', '7d'],
      ['Mentions over the past two weeks', '2026-10-29/2026-11-11'],
      ['citations last month', '30d'],
      ['what changed in the last quarter', '90d'],
      ['last 24 hours on ChatGPT', '24h'],
      ['show 90d trend', '90d'],
      ['son 7 günde görünürlüğümüz nasıl?', '7d'],
      ['Geçen hafta nasıldı?', '7d'],
      ['son 3 ayda neler değişti', '90d'],
      ['son 24 saatte kaç atıf aldık', '24h'],
      ['dün kaç kez anıldık?', '2026-11-10/2026-11-10'],
      ['last 14 days', '2026-10-29/2026-11-11'],
    ];
    for (const [text, range] of cases) expect(rangeInText(text, NOW), text).toBe(range);
  });

  it('reads no period where none is asked', () => {
    for (const text of [
      'Give me a 30-day plan to raise visibility',
      'How visible are we on Perplexity?',
      'What should I work on today?',
      'Write 3 FAQ entries',
      'son 3 prompt hangileri?',
      'iki ayrı kampanya için öneri',
    ]) {
      expect(rangeInText(text, NOW), text).toBeNull();
    }
  });
});

describe('a short range', () => {
  it("changes the default when it is the whole message, as the owner's examples write it", () => {
    for (const [text, range] of [
      ['son 7d', '7d'],
      ['last 7d', '7d'],
      ['last 30d', '30d'],
      ['last 24h', '24h'],
      ['varsayılanı 90d yap', '90d'],
      ['use 90 days by default', '90d'],
      ['Son 30 gün olsun', '30d'],
      ['7d please', '7d'],
    ] as const) {
      expect(rangeCommand(text, NOW), text).toEqual({ range, alone: true });
    }
  });

  it('changes the default with more asked when the message names the default', () => {
    expect(rangeCommand('make 7d the default and show my visibility', NOW)).toEqual({
      range: '7d',
      alone: false,
    });
    expect(rangeCommand('Bundan sonra son 30 gün, rakiplerimiz nasıl?', NOW)).toEqual({
      range: '30d',
      alone: false,
    });
  });

  it('leaves a question with a period in it alone: that period is its answer’s', () => {
    for (const text of [
      'how was last week?',
      'son 7 günde görünürlüğümüz nasıl?',
      'Why is the default visibility low in the last 30 days?',
      'Give me a 30-day plan',
      'What should I do next?',
    ]) {
      expect(rangeCommand(text, NOW), text).toBeNull();
    }
  });
});

describe("the page's range and the card's buttons", () => {
  it("reads the side panel's date chip", () => {
    const chip = (value: string) => [{ key: 'page' }, { key: 'dates', value }];
    expect(pageRangeOf(chip('7d/'), NOW)).toBe('7d');
    expect(pageRangeOf(chip('2026-10-01/2026-10-15'), NOW)).toBe('2026-10-01/2026-10-15');
    expect(pageRangeOf(chip('all/'), NOW)).toBeNull();
    expect(pageRangeOf(chip('/'), NOW)).toBeNull();
    expect(pageRangeOf([{ key: 'page' }], NOW)).toBeNull();
    expect(pageRangeOf(undefined, NOW)).toBeNull();
  });

  it("puts the page's range first, without its preset twice", () => {
    expect(rangeOptions(null).map((o) => o.range)).toEqual(['24h', '7d', '30d', '90d']);
    expect(rangeOptions('7d')).toEqual([
      { range: '7d', page: true },
      { range: '24h', page: false },
      { range: '30d', page: false },
      { range: '90d', page: false },
    ]);
    expect(rangeOptions('2026-10-01/2026-10-15')).toHaveLength(5);
  });
});
