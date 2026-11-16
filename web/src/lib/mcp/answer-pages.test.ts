import { describe, expect, it } from 'vitest';
import { ANSWER_PAGE_ROWS, answersCutNote, readAnswerPages } from './answer-pages';

/**
 * The answers a read adds up, a page at a time (the owner's plan of
 * 2026-11-16, item 7): one select stops at PostgREST's 1,000 rows, so the
 * reads page through the window newest first, up to a bound they name.
 */

/** A window's answers, newest first, and every slice read of them. */
function window(count: number) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `a${String(i).padStart(6, '0')}`,
    created_at: new Date(Date.UTC(2026, 10, 16) - i * 60_000).toISOString(),
  }));
  const slices: [number, number][] = [];
  const page = async (from: number, to: number) => {
    slices.push([from, to]);
    // PostgREST's max_rows: never more than a page, whatever the range.
    return { data: rows.slice(from, Math.min(to + 1, from + ANSWER_PAGE_ROWS)), error: null };
  };
  return { rows, slices, page };
}

describe('readAnswerPages', () => {
  it('reads a window under a page in one request', async () => {
    const w = window(640);
    const read = await readAnswerPages(w.page);
    expect(read.rows).toHaveLength(640);
    expect(read.cut).toBeNull();
    expect(w.slices).toEqual([[0, 999]]);
  });

  it('reads every answer past 1,000, the pages after the first together', async () => {
    const w = window(2_350);
    const read = await readAnswerPages(w.page);
    expect(read.rows.map((r) => r.id)).toEqual(w.rows.map((r) => r.id));
    expect(read.cut).toBeNull();
    expect(w.slices.slice(0, 3)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('counts an answer read twice once (a row written between two pages)', async () => {
    const w = window(1_500);
    const shifted = async (from: number, to: number) => {
      const read = await w.page(from, to);
      // The second page starts one row early, as a new answer at the top would shift it.
      return from === 1000 ? { ...read, data: w.rows.slice(999, 1500) } : read;
    };
    const read = await readAnswerPages(shifted);
    expect(read.rows).toHaveLength(1_500);
    expect(new Set(read.rows.map((r) => r.id)).size).toBe(1_500);
  });

  it('stops at its bound and says what the counts cover, never a count of rows', async () => {
    const w = window(5_000);
    const read = await readAnswerPages(w.page, 3_000);
    expect(read.rows).toHaveLength(3_000);
    expect(read.cut).toEqual({
      counted_from: w.rows[2_999].created_at,
      note: answersCutNote(w.rows[2_999].created_at),
    });
    expect(read.cut!.note).toContain(`from ${w.rows[2_999].created_at.slice(0, 10)} on`);
    expect(read.cut!.note).not.toMatch(/\brows?\b|\d{1,3},\d{3}|\d{4,}(?!-)/);
  });

  it('fails the read when a page fails', async () => {
    await expect(
      readAnswerPages(async () => ({ data: null, error: { message: 'statement timeout' } })),
    ).rejects.toThrow('statement timeout');
  });
});
