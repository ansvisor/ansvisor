/**
 * Chat's list reads, a page at a time (CHAT-04 Rule 1; the owner's rule of
 * 2026-11-16: Chat reads all that a page shows). Each page says how many
 * match in all (`total`), where it starts (`offset`), where the next one
 * starts (`next_offset`, null on the last) and a `note` in words the model
 * can repeat. listActionsPageFor (action-center-reads.ts) was the first;
 * these helpers give every other list read the same shape. Pure, but for
 * pageRows' count.
 */

/** A page's length when none is asked, and the most it holds (CHAT-04's ~50). */
export const PAGE_ROWS = 50;

/** What a page tells the model about itself. */
export interface PageMeta {
  /** Every item that matches, not only this page's. */
  total: number;
  /** Items before this page. */
  offset: number;
  /** Where the next page starts; null on the last. */
  next_offset: number | null;
  note: string;
}

/** What a page's note calls its items, and their order: "signals", "newest first". */
export interface PageWords {
  what: string;
  order?: string;
}

/** What one page holds against all that match, and how to read on. */
export function pageNote(words: PageWords, total: number, offset: number, shown: number): string {
  const order = words.order ? `, ${words.order}` : '';
  if (total === 0) return `No ${words.what}.`;
  if (shown === 0) return `None past offset ${offset}: ${total} ${words.what} in all.`;
  const end = offset + shown;
  if (offset === 0 && end >= total) return `All ${total} ${words.what}${order}.`;
  const range = `Showing ${offset + 1}–${end} of ${total} ${words.what}${order}.`;
  return end < total
    ? `${range} Read the next page with offset ${end}, or say how many you judged.`
    : `${range} This is the last page.`;
}

export function pageMeta(words: PageWords, total: number, offset: number, shown: number): PageMeta {
  const end = offset + shown;
  return {
    total,
    offset,
    next_offset: shown > 0 && end < total ? end : null,
    note: pageNote(words, total, offset, shown),
  };
}

/** A page's input: its length (1 to PAGE_ROWS, PAGE_ROWS when none) and its start. */
export function pageWindow(input: { limit?: number; offset?: number }) {
  return {
    limit: Math.min(Math.max(Math.trunc(input.limit ?? PAGE_ROWS), 1), PAGE_ROWS),
    offset: Math.max(Math.trunc(input.offset ?? 0), 0),
  };
}

/** One page of a list the read has whole, with its meta. */
export function pageOfList<T>(
  list: readonly T[],
  input: { limit?: number; offset?: number },
  words: PageWords,
): PageMeta & { rows: T[] } {
  const { limit, offset } = pageWindow(input);
  const rows = list.slice(offset, offset + limit);
  return { ...pageMeta(words, list.length, offset, rows.length), rows };
}

/** PostgREST's answer to an offset past the rows it counted (416). */
const PAST_THE_END = 'PGRST103';

interface Counted<T> {
  data: T[] | null;
  count: number | null;
  error: { code?: string; message: string } | null;
}

/**
 * A page of a query read with `count: 'exact'` and a range: its rows and how
 * many match in all. Past the last one PostgREST refuses the range, so the
 * page is empty and the total is counted on its own (`head`).
 */
export async function pageRows<T>(
  read: Counted<T>,
  countAll: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<{ rows: T[]; total: number }> {
  if (read.error?.code === PAST_THE_END) {
    const { count, error } = await countAll();
    if (error) throw new Error(error.message);
    return { rows: [], total: count ?? 0 };
  }
  if (read.error) throw new Error(read.error.message);
  const rows = read.data ?? [];
  return { rows, total: read.count ?? rows.length };
}
