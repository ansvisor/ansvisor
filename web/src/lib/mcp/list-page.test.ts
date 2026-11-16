import { describe, expect, it, vi } from 'vitest';
import { PAGE_ROWS, pageMeta, pageNote, pageOfList, pageRows, pageWindow } from './list-page';

/**
 * Chat's list reads, a page at a time (the owner's rule, 2026-11-16): each
 * page says how many match, where it starts, where the next starts, and a
 * note the model repeats instead of "I couldn't read the rest".
 */

const signals = { what: 'signals', order: 'newest first' };

describe('pageNote', () => {
  it('says what the page holds of all that match, and how to read on', () => {
    expect(pageNote(signals, 451, 0, 50)).toBe(
      'Showing 1–50 of 451 signals, newest first. Read the next page with offset 50, or say how many you judged.',
    );
    expect(pageNote(signals, 451, 450, 1)).toBe(
      'Showing 451–451 of 451 signals, newest first. This is the last page.',
    );
    expect(pageNote(signals, 12, 0, 12)).toBe('All 12 signals, newest first.');
    expect(pageNote({ what: 'topics' }, 0, 0, 0)).toBe('No topics.');
    expect(pageNote(signals, 451, 900, 0)).toBe('None past offset 900: 451 signals in all.');
  });

  it('never words a page as data that could not be read', () => {
    for (const [total, offset, shown] of [
      [451, 0, 50],
      [451, 450, 1],
      [12, 0, 12],
      [0, 0, 0],
      [451, 900, 0],
    ]) {
      expect(pageNote(signals, total, offset, shown)).not.toMatch(/couldn|missing|limit|rows/i);
    }
  });
});

describe('pageMeta and pageWindow', () => {
  it('gives the next offset only while more are left', () => {
    expect(pageMeta(signals, 451, 0, 50)).toMatchObject({ total: 451, offset: 0, next_offset: 50 });
    expect(pageMeta(signals, 451, 400, 51)).toMatchObject({ next_offset: null });
    expect(pageMeta(signals, 451, 900, 0)).toMatchObject({ next_offset: null });
  });

  it('holds a page to 1–50 and its start to 0 or more', () => {
    expect(pageWindow({})).toEqual({ limit: PAGE_ROWS, offset: 0 });
    expect(pageWindow({ limit: 500, offset: -3 })).toEqual({ limit: PAGE_ROWS, offset: 0 });
    expect(pageWindow({ limit: 0, offset: 50.7 })).toEqual({ limit: 1, offset: 50 });
  });
});

describe('pageOfList', () => {
  it('cuts a whole list to one page, with every item counted', () => {
    const list = Array.from({ length: 120 }, (_, i) => i);
    expect(pageOfList(list, {}, signals)).toMatchObject({
      total: 120,
      offset: 0,
      next_offset: 50,
      rows: list.slice(0, 50),
    });
    expect(pageOfList(list, { offset: 100 }, signals)).toMatchObject({
      next_offset: null,
      rows: list.slice(100),
    });
  });
});

describe('pageRows', () => {
  it('gives the rows and the count the query read', async () => {
    const countAll = vi.fn();
    expect(await pageRows({ data: [1, 2], count: 451, error: null }, countAll)).toEqual({
      rows: [1, 2],
      total: 451,
    });
    expect(countAll).not.toHaveBeenCalled();
  });

  it('reads an offset past the last row as an empty page, with the total counted on its own', async () => {
    const past = { data: null, count: null, error: { code: 'PGRST103', message: 'range' } };
    const countAll = vi.fn(async () => ({ count: 451, error: null }));
    expect(await pageRows(past, countAll)).toEqual({ rows: [], total: 451 });
  });

  it('throws any other error, so the read fails rather than reads empty', async () => {
    const failed = { data: null, count: null, error: { message: 'statement timeout' } };
    await expect(pageRows(failed, vi.fn())).rejects.toThrow('statement timeout');
  });
});
