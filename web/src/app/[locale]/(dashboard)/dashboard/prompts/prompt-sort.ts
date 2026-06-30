export type SortDir = 'asc' | 'desc';

/**
 * Compare two numeric (or null) column values for the All Prompts table.
 *
 * Missing values (`null` — e.g. an unanalysed prompt with no volume/visibility)
 * always sort to the bottom in BOTH directions, so ascending ("weakest first")
 * doesn't push empty rows to the top. Non-null values sort ascending/descending
 * per `dir`.
 */
export function compareNullsLast(av: number | null, bv: number | null, dir: SortDir): number {
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  if (av === bv) return 0;
  const factor = dir === 'asc' ? 1 : -1;
  return av < bv ? -factor : factor;
}
