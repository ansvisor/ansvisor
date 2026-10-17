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

/** The All Prompts table's sortable columns, as the URL's ?sort= names them. */
export type AllPromptsSortKey =
  | 'visibility'
  | 'mentions'
  | 'citations'
  | 'position'
  | 'volume'
  | 'runs'
  | 'added'
  | 'lastRun';

export const ALL_PROMPTS_SORT_KEYS: AllPromptsSortKey[] = [
  'visibility',
  'mentions',
  'citations',
  'position',
  'volume',
  'runs',
  'added',
  'lastRun',
];

export function isAllPromptsSortKey(value: string | null): value is AllPromptsSortKey {
  return value !== null && (ALL_PROMPTS_SORT_KEYS as string[]).includes(value);
}

/** What a row's sort reads: when the prompt was added, and the figures loaded beside it. */
export interface PromptSortRow {
  createdAt: string;
  visibility?: {
    score: number | null;
    totalMentions: number;
    totalCitations: number;
    runs: number;
    lastRunAt: string;
  };
  position?: { avg: number | null };
  volume?: { estAiVolume: number };
}

/** A row's value in a column; null when it has none, so it sorts last. */
export function promptSortValue(key: AllPromptsSortKey, row: PromptSortRow): number | null {
  const vis = row.visibility;
  switch (key) {
    case 'visibility':
      return vis ? (vis.score ?? 0) : null;
    case 'mentions':
      return vis ? vis.totalMentions : null;
    case 'citations':
      return vis ? vis.totalCitations : null;
    case 'position':
      return row.position?.avg ?? null;
    case 'volume':
      return row.volume ? row.volume.estAiVolume : null;
    case 'runs':
      return vis ? vis.runs : null;
    case 'added':
      return Date.parse(row.createdAt);
    case 'lastRun':
      return vis?.lastRunAt ? new Date(vis.lastRunAt).getTime() : null;
  }
}
