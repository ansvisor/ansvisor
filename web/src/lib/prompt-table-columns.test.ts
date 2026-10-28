import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLUMNS_VIEW,
  PROMPT_COLUMNS,
  effectiveView,
  moveColumn,
  readColumnsView,
  sameView,
  toggleColumn,
  visibleColumns,
} from './prompt-table-columns';

/** The Tracked Prompts table's columns (PROMPT-015a). */

describe('readColumnsView', () => {
  it("drops ids it doesn't know and puts a new column back at its default place", () => {
    const view = readColumnsView({
      order: ['visibility', 'gone', 'topic', 'status', 'mentions', 'visibility'],
      hidden: ['runs', 'nope'],
    });
    expect(view?.order.slice(0, 5)).toEqual(['visibility', 'topic', 'status', 'work', 'mentions']);
    expect(view?.order).toHaveLength(PROMPT_COLUMNS.length);
    expect(new Set(view?.order)).toEqual(new Set(PROMPT_COLUMNS));
    expect(view?.hidden).toEqual(['runs']);
  });

  it("reads anything that isn't a view as none", () => {
    expect(readColumnsView(null)).toBeNull();
    expect(readColumnsView([])).toBeNull();
    expect(readColumnsView({ hidden: [] })).toBeNull();
  });
});

describe('a view', () => {
  it('shows every column, in order, by default', () => {
    expect(visibleColumns(DEFAULT_COLUMNS_VIEW)).toEqual([...PROMPT_COLUMNS]);
  });

  it('hides and shows a column', () => {
    const hidden = toggleColumn(DEFAULT_COLUMNS_VIEW, 'competition', false);
    expect(visibleColumns(hidden)).not.toContain('competition');
    expect(sameView(toggleColumn(hidden, 'competition', true), DEFAULT_COLUMNS_VIEW)).toBe(true);
  });

  it('moves a column a step, or to where it was dropped', () => {
    expect(moveColumn(DEFAULT_COLUMNS_VIEW, 'status', -1).order.slice(0, 2)).toEqual([
      'status',
      'topic',
    ]);
    expect(moveColumn(DEFAULT_COLUMNS_VIEW, 'topic', -1).order[0]).toBe('topic');
    expect(moveColumn(DEFAULT_COLUMNS_VIEW, 'lastRun', 1).order.at(-1)).toBe('lastRun');
    // Dropped on a later column: after it. On an earlier one: before it.
    expect(moveColumn(DEFAULT_COLUMNS_VIEW, 'topic', 'work').order.slice(0, 3)).toEqual([
      'status',
      'work',
      'topic',
    ]);
    expect(moveColumn(DEFAULT_COLUMNS_VIEW, 'volume', 'visibility').order.slice(3, 5)).toEqual([
      'volume',
      'visibility',
    ]);
  });

  it("is the person's own, else the brand's shared one, else the default", () => {
    const mine = toggleColumn(DEFAULT_COLUMNS_VIEW, 'runs', false);
    const brand = toggleColumn(DEFAULT_COLUMNS_VIEW, 'work', false);
    expect(effectiveView(mine, brand)).toBe(mine);
    expect(effectiveView(null, brand)).toBe(brand);
    expect(effectiveView(null, null)).toBe(DEFAULT_COLUMNS_VIEW);
  });
});
