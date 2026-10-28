/**
 * The Tracked Prompts table's columns a person can show, hide and order
 * (PROMPT-015a). Prompt and the row's menu always show. A saved view is
 * `{ order, hidden }`, per person and brand, or shared by an admin or
 * manager with everyone on the brand (prompt_table_views, 00363).
 */

/** Today's columns, in today's order: the default view. */
export const PROMPT_COLUMNS = [
  'topic',
  'status',
  'work',
  'visibility',
  'mentions',
  'citations',
  'positions',
  'volume',
  'competition',
  'runs',
  'added',
  'lastRun',
] as const;

export type PromptColumnId = (typeof PROMPT_COLUMNS)[number];

export interface PromptColumnsView {
  order: PromptColumnId[];
  hidden: PromptColumnId[];
}

export const DEFAULT_COLUMNS_VIEW: PromptColumnsView = { order: [...PROMPT_COLUMNS], hidden: [] };

const KNOWN = new Set<string>(PROMPT_COLUMNS);
const isColumn = (id: unknown): id is PromptColumnId => typeof id === 'string' && KNOWN.has(id);

/**
 * A saved view, as the table reads it: ids it doesn't know are dropped, and
 * a column added to the table since goes back where the default has it,
 * after the column before it there. Null for anything that isn't a view.
 */
export function readColumnsView(raw: unknown): PromptColumnsView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { order, hidden } = raw as { order?: unknown; hidden?: unknown };
  if (!Array.isArray(order)) return null;
  const kept = [...new Set(order.filter(isColumn))];
  for (const [i, id] of PROMPT_COLUMNS.entries()) {
    if (kept.includes(id)) continue;
    const before = PROMPT_COLUMNS.slice(0, i).findLast((prev) => kept.includes(prev));
    kept.splice(before ? kept.indexOf(before) + 1 : 0, 0, id);
  }
  return {
    order: kept,
    hidden: Array.isArray(hidden) ? [...new Set(hidden.filter(isColumn))] : [],
  };
}

/** The columns shown, in order. */
export function visibleColumns(view: PromptColumnsView): PromptColumnId[] {
  const hidden = new Set(view.hidden);
  return view.order.filter((id) => !hidden.has(id));
}

export function toggleColumn(
  view: PromptColumnsView,
  id: PromptColumnId,
  shown: boolean,
): PromptColumnsView {
  const hidden = view.hidden.filter((h) => h !== id);
  return { ...view, hidden: shown ? hidden : [...hidden, id] };
}

/** Moves a column to `to`'s place (a drop), or one step up or down. */
export function moveColumn(
  view: PromptColumnsView,
  id: PromptColumnId,
  to: PromptColumnId | -1 | 1,
): PromptColumnsView {
  const order = view.order.filter((c) => c !== id);
  const from = view.order.indexOf(id);
  const at =
    to === -1 || to === 1
      ? Math.min(order.length, Math.max(0, from + to))
      : view.order.indexOf(to) > from
        ? order.indexOf(to) + 1
        : order.indexOf(to);
  if (from < 0 || at < 0) return view;
  order.splice(at, 0, id);
  return { ...view, order };
}

export function sameView(a: PromptColumnsView, b: PromptColumnsView): boolean {
  return (
    a.order.join() === b.order.join() && [...a.hidden].sort().join() === [...b.hidden].sort().join()
  );
}

/** The view a person sees: theirs, else the brand's, else the default. */
export function effectiveView(
  mine: PromptColumnsView | null,
  brand: PromptColumnsView | null,
): PromptColumnsView {
  return mine ?? brand ?? DEFAULT_COLUMNS_VIEW;
}
