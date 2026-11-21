/**
 * The Competitors grid in Visibility score order, the brand among them
 * (UX audit CP-06): highest score first, "You" in its place, each with its
 * rank. A brand named in fewer than MIN_RANK_PROMPTS prompts isn't ranked:
 * it comes after the ranked ones, marked low sample (metric dictionary D5,
 * D8). A tie puts the brand first, then names in order; without a score the
 * list keeps its own order.
 */

/** Named in fewer prompts than this and a brand isn't ranked (D8). */
export const MIN_RANK_PROMPTS = 10;

export interface GridScore {
  score: number | null;
  /** Prompts whose answers name it. */
  visiblePrompts: number;
}

export interface GridEntry<T> {
  /** The competitor; null for the brand ("You"). */
  item: T | null;
  /** 1 for the highest score; null when not ranked. */
  rank: number | null;
  /** Scored, but named in too few prompts to rank. */
  lowSample: boolean;
}

export function rankWithYou<T>(
  items: readonly T[],
  statsOf: (item: T) => GridScore | null,
  nameOf: (item: T) => string,
  you: GridScore | null,
): GridEntry<T>[] {
  type Row = { item: T | null; stats: GridScore | null; name: string; at: number };
  const rows: Row[] = [
    { item: null, stats: you, name: '', at: -1 },
    ...items.map((item, at) => ({ item, stats: statsOf(item), name: nameOf(item), at })),
  ];
  const scored = (row: Row) => row.stats !== null && row.stats.score !== null;
  const ranked = (row: Row) =>
    row.stats !== null && row.stats.score !== null && row.stats.visiblePrompts >= MIN_RANK_PROMPTS;
  // Unscored, the list keeps its order, You after them.
  const order = (a: Row, b: Row) =>
    !scored(a) && !scored(b)
      ? (a.item === null ? 1 : 0) - (b.item === null ? 1 : 0) || a.at - b.at
      : (b.stats?.score ?? -1) - (a.stats?.score ?? -1) ||
        (a.item === null ? -1 : b.item === null ? 1 : a.name.localeCompare(b.name));
  const top = rows.filter(ranked).sort(order);
  const rest = rows.filter((row) => !ranked(row)).sort(order);
  return [
    ...top.map((row, i) => ({ item: row.item, rank: i + 1, lowSample: false })),
    ...rest.map((row) => ({
      item: row.item,
      rank: null,
      lowSample: row.stats !== null && row.stats.score !== null,
    })),
  ];
}
