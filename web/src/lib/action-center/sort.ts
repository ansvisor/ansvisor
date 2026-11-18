import type { ActionItem } from '@/lib/actions/action-center';
import { comparePriority } from '@/lib/action-center/priority';
import type { ChatPageSort } from '@/lib/chat/page-view';

/**
 * How the Actions list orders its rows.
 *
 * One date sort, by the date the list shows (its Updated column), most
 * recent first by default. There used to be a Newest sort too, by when the
 * action was created: it shows nowhere in the list, so its order read as
 * wrong beside the Updated column, and people couldn't tell it from
 * Recently updated. The Updated and Priority Score headers flip their sort
 * to the other direction (`_asc`). Priority is the server's score (AC-006),
 * which already weighs impact in, so impact is not an order of its own.
 */
export const ACTION_SORTS = [
  'updated',
  'updated_asc',
  'priority',
  'priority_asc',
  'due_date',
] as const;
export type ActionSort = (typeof ACTION_SORTS)[number];

export const DEFAULT_ACTION_SORT: ActionSort = 'updated';

/** What the Sort dropdown offers: a column's first direction each. */
export const ACTION_SORT_CHOICES: readonly ActionSort[] = ['updated', 'priority', 'due_date'];

/** Sorts that old links name: Newest is now the one date sort. */
const RENAMED: Record<string, ActionSort> = { newest: 'updated' };

/** The sort a `?sort=` value names, or the default for anything else. */
export function parseActionSort(value: string | null | undefined): ActionSort {
  if (!value) return DEFAULT_ACTION_SORT;
  if ((ACTION_SORTS as readonly string[]).includes(value)) return value as ActionSort;
  return RENAMED[value] ?? DEFAULT_ACTION_SORT;
}

/**
 * A sort as Chat's side panel sends it (chat/page-view.ts): its column, and
 * which way (Due date: soonest first).
 */
export function actionViewSort(sort: ActionSort): ChatPageSort {
  if (sort === 'due_date') return { key: 'due_date', dir: 'asc' };
  return sort.endsWith('_asc')
    ? { key: sort.slice(0, -'_asc'.length), dir: 'asc' }
    : { key: sort, dir: 'desc' };
}

/** The table's headers that sort on a click. */
export type ActionSortColumn = 'updated' | 'priority';

/** How a header's column is sorted now, as `aria-sort` says it; null when it isn't. */
export function columnSortDirection(
  sort: ActionSort,
  column: ActionSortColumn,
): 'descending' | 'ascending' | null {
  if (sort === column) return 'descending';
  if (sort === `${column}_asc`) return 'ascending';
  return null;
}

/**
 * A header click: most recent (or highest) first, and the other way round on
 * a click while the column is sorted that way.
 */
export function nextColumnSort(sort: ActionSort, column: ActionSortColumn): ActionSort {
  return sort === column ? `${column}_asc` : column;
}

const time = (iso: string) => Date.parse(iso) || 0;

/**
 * Ties keep one order, so rows with the same date don't swap between loads:
 * the later action number (a global counter) first.
 */
function byNumber(a: ActionItem, b: ActionItem): number {
  return b.actionNo - a.actionNo || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function byUpdated(a: ActionItem, b: ActionItem): number {
  return time(b.updatedAt) - time(a.updatedAt) || byNumber(a, b);
}

function byPriority(a: ActionItem, b: ActionItem): number {
  return comparePriority(a, b) || byNumber(a, b);
}

const scored = (action: ActionItem) => action.priorityScore !== null;

const COMPARE: Record<ActionSort, (a: ActionItem, b: ActionItem) => number> = {
  updated: byUpdated,
  updated_asc: (a, b) => byUpdated(b, a),
  priority: byPriority,
  // Lowest first; an action not scored yet still comes after the scored ones.
  priority_asc: (a, b) => (scored(a) !== scored(b) ? (scored(a) ? -1 : 1) : byPriority(b, a)),
  // No due date last; the same day by Updated.
  due_date: (a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || byUpdated(a, b),
};

/** The list's order for a sort. */
export function compareActions(sort: ActionSort): (a: ActionItem, b: ActionItem) => number {
  return COMPARE[sort];
}
