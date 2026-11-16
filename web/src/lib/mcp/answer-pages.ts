import { RPC_PAGE_SIZE } from '@/lib/supabase/rpc-pages';

/**
 * The answers a read adds up, a page at a time (the owner's plan of
 * 2026-11-16, item 7: Chat counts as the pages count). One select stops at
 * PostgREST's 1,000 rows without an error, so a busy brand's window was
 * counted on its first 1,000 answers only, below the page's cards. Pages are
 * read newest first, in a fixed order, until one comes back short, up to
 * ANSWERS_READ_MAX; past that the result says which part of the period it
 * counted (answersCutNote). Pure, but for the reads it is given.
 */

/** Answers one page holds: PostgREST's max_rows. */
export const ANSWER_PAGE_ROWS = RPC_PAGE_SIZE;

/** The most answers a read adds up: far past a normal window, a bound on a runaway read. */
export const ANSWERS_READ_MAX = 50_000;

/** Pages read together once the first is full: a busy window in a fraction of the time. */
const PAGES_AT_ONCE = 4;

/** A read cut at ANSWERS_READ_MAX: its counts cover the period from its oldest answer read. */
export interface AnswersCut {
  /** The oldest answer counted (created_at): the counts cover the period from it on. */
  counted_from: string | null;
  /** In words the model can say, never a count of rows. */
  note: string;
}

export interface AnswerPages<T> {
  rows: T[];
  /** Null when every answer of the window was read. */
  cut: AnswersCut | null;
}

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** What a cut read says: what its counts cover, and how to count all of them. */
export function answersCutNote(countedFrom: string | null): string {
  const day = countedFrom ? countedFrom.slice(0, 10) : null;
  return `These counts cover the newest AI answers of the period${day ? `, from ${day} on` : ''}, not all of it: the period has more than one read adds up. Say what they cover, or read a shorter period to count all of it.`;
}

/**
 * Every row of a read, page by page: `page(from, to)` reads one slice in a
 * fixed order, newest first (each caller orders by created_at, then id).
 * The first page alone; when it is full, the next PAGES_AT_ONCE together,
 * until one is short or `max` rows are read. A row read twice (an answer
 * written between two pages shifts the later ones) counts once, by its id.
 */
export async function readAnswerPages<T extends { id: string; created_at?: string | null }>(
  page: (from: number, to: number) => Page<T>,
  max: number = ANSWERS_READ_MAX,
): Promise<AnswerPages<T>> {
  const rows: T[] = [];
  const seen = new Set<string>();
  const add = (data: T[] | null) => {
    for (const row of data ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  };
  const slice = async (index: number) => {
    const from = index * ANSWER_PAGE_ROWS;
    const { data, error } = await page(from, from + ANSWER_PAGE_ROWS - 1);
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  const pages = Math.ceil(max / ANSWER_PAGE_ROWS);
  const first = await slice(0);
  add(first);
  if (first.length < ANSWER_PAGE_ROWS) return { rows, cut: null };
  for (let next = 1; next < pages; next += PAGES_AT_ONCE) {
    const wave = Array.from({ length: Math.min(PAGES_AT_ONCE, pages - next) }, (_, i) => next + i);
    const read = await Promise.all(wave.map(slice));
    for (const data of read) {
      add(data);
      if (data.length < ANSWER_PAGE_ROWS) return { rows, cut: null };
    }
  }
  // Every page full up to the bound: the window holds more than one read adds up.
  const oldest = rows.reduce<string | null>((min, row) => {
    const at = row.created_at ?? null;
    return at && (!min || at < min) ? at : min;
  }, null);
  return { rows, cut: { counted_from: oldest, note: answersCutNote(oldest) } };
}
