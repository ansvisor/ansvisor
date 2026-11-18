import { RPC_PAGE_SIZE } from '@/lib/supabase/rpc-pages';

/**
 * The one bounded read a few of Chat's and MCP's reads keep where no page
 * aggregate answers them with the service role (the maintainer's review of
 * 2026-11-16): one request of a brand's newest rows, never paged by offset.
 * The pages' own aggregates (the daily rollups and the Overview's and
 * Prompts' functions) answer everything else. When the window holds more
 * rows than the read takes, the result says which part it covers
 * (AnswersCut), in words, never a count of rows. Pure.
 */

/** Rows the bounded read takes: one request, PostgREST's max_rows. */
export const ANSWERS_READ_ROWS = RPC_PAGE_SIZE;

/** A read that took the newest rows of a longer window: what its figures cover. */
export interface AnswersCut {
  /** The oldest row read (created_at): the figures it names cover the period from it on. */
  counted_from: string | null;
  /** In words the model can say, never a count of rows. */
  note: string;
}

/** The oldest created_at of some rows; null with none. */
export function oldestOf(rows: readonly { created_at?: string | null }[]): string | null {
  return rows.reduce<string | null>((min, row) => {
    const at = row.created_at ?? null;
    return at && (!min || at < min) ? at : min;
  }, null);
}

/** `from 2026-11-03 on`, or nothing without a day. */
const fromDay = (countedFrom: string | null) =>
  countedFrom ? `, from ${countedFrom.slice(0, 10)} on` : '';

/** What a read whose every figure comes from the newest answers says. */
export function answersCutNote(countedFrom: string | null): string {
  return `These counts cover the newest AI answers of the period${fromDay(countedFrom)}, not all of it: the period has more answers than this read takes. Say what they cover, or read a shorter period to count all of it.`;
}

/**
 * Whether a bounded read covered its window: null when it read every row
 * (`total` rows in all, or fewer rows than it may take), else what it
 * covers, in `note`'s words.
 */
export function cutOf(
  rows: readonly { created_at?: string | null }[],
  total: number | null,
  note: (countedFrom: string | null) => string = answersCutNote,
): AnswersCut | null {
  const whole = total === null ? rows.length < ANSWERS_READ_ROWS : rows.length >= total;
  if (whole) return null;
  const countedFrom = oldestOf(rows);
  return { counted_from: countedFrom, note: note(countedFrom) };
}

/** The citations reads' cut: the domains and totals are the rollups', the pages and prompts the answers read. */
export function citedPagesCutNote(countedFrom: string | null): string {
  return `The domains and citation totals cover the whole period; the pages, results_with_citations and the prompts citing them come from the newest AI answers of the period${fromDay(countedFrom)}, not all of it. Say so with those figures, or read a shorter period to have every page.`;
}

/** A product's cut: every appearance counted, the breakdowns of the newest read. */
export function productCutNote(countedFrom: string | null): string {
  return `total_appearances counts every appearance; the platforms, regions, days, ratings and merchants cover its newest appearances${fromDay(countedFrom)}. Say so with them.`;
}
