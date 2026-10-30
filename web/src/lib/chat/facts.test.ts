import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  FIGURE_CONTEXT,
  PLACEHOLDER,
  checkFigures,
  figureHold,
  knownFigures,
  parseFigure,
} from './facts';

/**
 * Chat's fact check (W1-21; CHAT-05 item 11, CHAT-20 §19): a figure the
 * run's data doesn't hold, or can't be worked out of, is replaced; what was
 * read, rounded or worked out inside a row or a column, stays; counts,
 * numbering, dates and names' versions aren't claims.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z');
const check = (text: string, sources: unknown[]) =>
  checkFigures(text, knownFigures(sources), { now: NOW });

describe('knownFigures', () => {
  it('reads numbers, numbers in texts, list lengths and each column’s total and average', () => {
    const known = knownFigures([
      'Up 1,234 since Oct 1',
      { rows: [{ citations: 10 }, { citations: 30 }], note: 'score 42.5' },
    ]);
    for (const n of [1234, 1, 10, 30, 40, 20, 2, 42.5]) expect(known.values.has(n)).toBe(true);
    expect(known.groups).toContainEqual([10, 30, 40]);
  });

  it('parses thousands and decimal commas', () => {
    expect(parseFigure('1,234')).toBe(1234);
    expect(parseFigure('1.234.567')).toBe(1234567);
    expect(parseFigure('12,5')).toBe(12.5);
    expect(parseFigure('12.5')).toBe(12.5);
  });
});

describe('checkFigures', () => {
  it('keeps a figure that was read, as the answer rounds it', () => {
    const read = { visibility: 42.857, share: 0.4286, mentions: 1180 };
    expect(check('Visibility is 42.9, about 43%, with 1.2k mentions.', [read])).toEqual({
      text: 'Visibility is 42.9, about 43%, with 1.2k mentions.',
      checked: 3,
      replaced: [],
    });
  });

  it('replaces a figure the data does not hold, with the placeholder for its kind', () => {
    const result = check('Perplexity cites you 37% of the time; it costs $99 and grew in 2019.', [
      { citations: 12 },
    ]);
    expect(result.text).toBe(
      `Perplexity cites you ${PLACEHOLDER.metric} of the time; it costs ${PLACEHOLDER.price} and grew in ${PLACEHOLDER.date}.`,
    );
    expect(result.replaced).toEqual(['37%', '$99', '2019']);
  });

  it('keeps what is worked out inside a row or a column, not across unrelated reads', () => {
    const row = { current: 50, previous: 40 };
    expect(check('Up 10 points, 25% more than before.', [row]).replaced).toEqual([]);
    const column = { rows: [{ citations: 30 }, { citations: 70 }] };
    expect(check('100 citations in all; the top page has 70%.', [column]).replaced).toEqual([]);
    // 100 − 55 = 45, but they are two reads' numbers.
    expect(check('A gap of 45.', [{ a: 100, b: 7 }, { c: 55 }]).replaced).toEqual(['45']);
  });

  it('leaves counts, numbering, dates, times, this year and names’ versions alone', () => {
    const text = [
      '1. Step 12 of the plan: 3 prompts on Oct 14, 2026-10-01 at 09:14.',
      'Top 20 pages in 2026, read with Claude 3.5.',
    ].join('\n');
    expect(check(text, [])).toEqual({ text, checked: 0, replaced: [] });
  });

  it('leaves links, domains and placeholders alone', () => {
    const text =
      'See https://acme.com/2024/report and site-2024.com; we have [customer count] users.';
    expect(check(text, []).text).toBe(text);
  });

  it('reads what comes before and after for context, without changing it', () => {
    const known = knownFigures([]);
    expect(checkFigures('12 of the plan', known, { before: 'Step ' }).replaced).toEqual([]);
    expect(checkFigures('Up 15', known, { after: '% this week' }).text).toBe(
      `Up ${PLACEHOLDER.metric}`,
    );
  });

  it('reads a link, "#12" or a date cut across two chunks as one', () => {
    const known = knownFigures([]);
    const after = (before: string, text: string) =>
      checkFigures(text, known, { before, now: NOW }).text;
    expect(after('Read https://example.com/blog/', '98765 for more.')).toBe('98765 for more.');
    expect(after('Ranked #', '12 overall.')).toBe('12 overall.');
    expect(after('Since Oct ', '17 traffic rose.')).toBe('17 traffic rose.');
    // What was sent is context only: its figures are neither changed nor counted.
    expect(checkFigures(' and up.', known, { before: 'Visits were 7,777' })).toEqual({
      text: ' and up.',
      checked: 0,
      replaced: [],
    });
  });

  it('stays linear on a long text', () => {
    const known = knownFigures([]);
    const text = `${'A-'.repeat(100_000)}${' 12'.repeat(30_000)}`;
    const started = performance.now();
    const result = checkFigures(text, known);
    expect(result.replaced).toHaveLength(30_000);
    expect(performance.now() - started).toBeLessThan(3_000);
  });
});

describe('figureHold', () => {
  it('holds a figure near the end until the text after it comes', () => {
    expect(figureHold('Visibility is up 12')).toBe('Visibility is up '.length);
    expect(figureHold('between 10 – 1')).toBe('between '.length);
    expect(figureHold('No figures here.')).toBeNull();
    expect(figureHold(`Up 12%${' '.repeat(FIGURE_CONTEXT)}`)).toBeNull();
  });
});

describe('the Site Audit guard it mirrors', () => {
  it('uses the same placeholders and figure patterns', () => {
    const server = readFileSync(
      join(__dirname, '../../../../server/src/lib/audit/recommendation-guard.js'),
      'utf8',
    );
    expect(server).toContain(`metric: '${PLACEHOLDER.metric}'`);
    expect(server).toContain(`price: '${PLACEHOLDER.price}'`);
    expect(server).toContain(`date: '${PLACEHOLDER.date}'`);
    expect(server).toContain(
      String.raw`const NUM = String.raw` + '`' + String.raw`\d+(?:[.,]\d+)*` + '`',
    );
    expect(server).toContain(
      String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`,
    );
  });
});
