import { describe, expect, it } from 'vitest';
import type { ActionItem } from '@/lib/actions/action-center';
import {
  ACTION_SORT_CHOICES,
  DEFAULT_ACTION_SORT,
  columnSortDirection,
  compareActions,
  nextColumnSort,
  parseActionSort,
  type ActionSort,
} from './sort';

/**
 * The Actions list's order (owner's feedback, 14 Nov): one date sort, by the
 * Updated date the list shows, most recent first by default; Priority a pick
 * away; and the Updated and Priority Score headers flip their direction.
 */

const base: ActionItem = {
  id: 'a0',
  actionNo: 1,
  category: 'recover',
  kind: 'recover_lost_citations',
  impact: 'high',
  status: 'new',
  payload: {},
  kpiKeys: [],
  assignee: null,
  dueDate: null,
  createdAt: '2026-10-01T00:00:00+00:00',
  updatedAt: '2026-10-01T00:00:00+00:00',
  taskTotal: 0,
  taskCompleted: 0,
  signalCount: 1,
  priorityScore: 50,
  priorityLevel: 'medium',
  priorityReason: null,
};

const make = (id: string, actionNo: number, patch: Partial<ActionItem> = {}): ActionItem => ({
  ...base,
  id,
  actionNo,
  ...patch,
});

const order = (actions: ActionItem[], sort: ActionSort) =>
  [...actions].sort(compareActions(sort)).map((action) => action.id);

describe('parseActionSort', () => {
  it('opens on the most recently updated first when the URL names no sort', () => {
    expect(DEFAULT_ACTION_SORT).toBe('updated');
    expect(parseActionSort(null)).toBe('updated');
    expect(parseActionSort('')).toBe('updated');
  });

  it('takes an old link’s Newest to the one date sort, and anything unknown to the default', () => {
    expect(parseActionSort('newest')).toBe('updated');
    expect(parseActionSort('created')).toBe('updated');
  });

  it('keeps every sort the list has', () => {
    for (const sort of ['updated', 'updated_asc', 'priority', 'priority_asc', 'due_date']) {
      expect(parseActionSort(sort)).toBe(sort);
    }
  });
});

describe('the Sort dropdown', () => {
  it('offers one date sort, first, and Priority and Due date', () => {
    expect(ACTION_SORT_CHOICES).toEqual(['updated', 'priority', 'due_date']);
  });
});

describe('a header click', () => {
  it('sorts its column most recent (or highest) first, then the other way round', () => {
    expect(nextColumnSort('priority', 'updated')).toBe('updated');
    expect(nextColumnSort('updated', 'updated')).toBe('updated_asc');
    expect(nextColumnSort('updated_asc', 'updated')).toBe('updated');

    expect(nextColumnSort('updated', 'priority')).toBe('priority');
    expect(nextColumnSort('priority', 'priority')).toBe('priority_asc');
    expect(nextColumnSort('priority_asc', 'priority')).toBe('priority');
    expect(nextColumnSort('due_date', 'priority')).toBe('priority');
  });

  it('marks how its column is sorted now, and nothing on the others', () => {
    expect(columnSortDirection('updated', 'updated')).toBe('descending');
    expect(columnSortDirection('updated_asc', 'updated')).toBe('ascending');
    expect(columnSortDirection('updated', 'priority')).toBeNull();
    expect(columnSortDirection('priority_asc', 'priority')).toBe('ascending');
    expect(columnSortDirection('due_date', 'updated')).toBeNull();
  });
});

describe('compareActions', () => {
  // The owner's screenshot: Updated read 5d, 5d, 6d, 16d, 8d … under Newest.
  const fiveDays = make('five', 10, {
    createdAt: '2026-09-01T00:00:00+00:00',
    updatedAt: '2026-11-09T08:00:00.123456+00:00',
  });
  const sixteenDays = make('sixteen', 30, {
    createdAt: '2026-10-29T00:00:00+00:00',
    updatedAt: '2026-10-29T00:00:00+00:00',
  });
  // Changed in the drawer just now: stamped by the browser, in UTC's Z form.
  const justNow = make('now', 5, { updatedAt: '2026-11-14T09:30:00.000Z' });
  const eightDays = make('eight', 20, { updatedAt: '2026-11-06T12:00:00+00:00' });

  it('lists the most recently updated first, whenever the action was created', () => {
    expect(order([sixteenDays, fiveDays, eightDays, justNow], 'updated')).toEqual([
      'now',
      'five',
      'eight',
      'sixteen',
    ]);
  });

  it('lists the least recently updated first the other way round', () => {
    expect(order([fiveDays, justNow, sixteenDays, eightDays], 'updated_asc')).toEqual([
      'sixteen',
      'eight',
      'five',
      'now',
    ]);
  });

  it('keeps one order for the same date, whatever order the rows came in', () => {
    const at = '2026-11-10T10:00:00+00:00';
    const tied = [make('x', 41, { updatedAt: at }), make('y', 43, { updatedAt: at })];
    const twin = make('z', 42, { updatedAt: '2026-11-10T10:00:00.000Z' });
    const rows = [...tied, twin];
    const reversed = [...rows].reverse();

    expect(order(rows, 'updated')).toEqual(['y', 'z', 'x']);
    expect(order(reversed, 'updated')).toEqual(['y', 'z', 'x']);
    // The other way round is exactly the reverse.
    expect(order(rows, 'updated_asc')).toEqual(['x', 'z', 'y']);
    expect(order(reversed, 'updated_asc')).toEqual(['x', 'z', 'y']);
    // Same number too (never in the database): by id.
    const same = [make('b', 7, { updatedAt: at }), make('a', 7, { updatedAt: at })];
    expect(order(same, 'updated')).toEqual(['a', 'b']);
    expect(order([...same].reverse(), 'updated')).toEqual(['a', 'b']);
  });

  it('lists the highest priority first, and the lowest first the other way round', () => {
    const high = make('high', 1, { priorityScore: 90, priorityLevel: 'critical' });
    const low = make('low', 2, { priorityScore: 20, priorityLevel: 'low' });
    const mid = make('mid', 3, { priorityScore: 60, priorityLevel: 'medium' });
    const unscored = make('unscored', 4, { priorityScore: null, priorityLevel: null });
    const rows = [unscored, low, high, mid];

    expect(order(rows, 'priority')).toEqual(['high', 'mid', 'low', 'unscored']);
    // An action not scored yet stays after the scored ones either way.
    expect(order(rows, 'priority_asc')).toEqual(['low', 'mid', 'high', 'unscored']);
  });

  it('breaks a priority tie the same way on every read', () => {
    const one = make('one', 8, { priorityScore: 70 });
    const two = make('two', 9, { priorityScore: 70 });
    expect(order([one, two], 'priority')).toEqual(['two', 'one']);
    expect(order([two, one], 'priority')).toEqual(['two', 'one']);
    expect(order([one, two], 'priority_asc')).toEqual(['one', 'two']);
  });

  it('lists the soonest due date first, none last, and the same day by Updated', () => {
    const soon = make('soon', 1, { dueDate: '2026-11-20', updatedAt: '2026-10-01T00:00:00Z' });
    const soonFresh = make('soon-fresh', 2, {
      dueDate: '2026-11-20',
      updatedAt: '2026-11-12T00:00:00Z',
    });
    const later = make('later', 3, { dueDate: '2026-12-01' });
    const none = make('none', 4);
    expect(order([none, later, soon, soonFresh], 'due_date')).toEqual([
      'soon-fresh',
      'soon',
      'later',
      'none',
    ]);
  });
});
