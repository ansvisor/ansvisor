import { describe, expect, it } from 'vitest';
import { countOpenActions, isOpenAction } from './registry';

describe('isOpenAction', () => {
  it('is new, in progress or on hold', () => {
    expect(['new', 'in_progress', 'on_hold'].every((s) => isOpenAction(s as never))).toBe(true);
    expect(isOpenAction('completed')).toBe(false);
    expect(isOpenAction('dismissed')).toBe(false);
  });
});

describe('countOpenActions', () => {
  it('counts every open action, anyone’s, with the on-hold and the person’s own', () => {
    expect(
      countOpenActions(
        [
          { status: 'new', assigneeId: null },
          { status: 'in_progress', assigneeId: 'me' },
          { status: 'on_hold', assigneeId: 'them' },
          { status: 'on_hold', assigneeId: 'me' },
          { status: 'completed', assigneeId: 'me' },
          { status: 'dismissed', assigneeId: null },
        ],
        'me',
      ),
    ).toEqual({ open: 4, onHold: 2, mine: 2 });
  });

  it('counts nothing as the person’s without a person', () => {
    expect(countOpenActions([{ status: 'new', assigneeId: null }], null)).toEqual({
      open: 1,
      onHold: 0,
      mine: 0,
    });
  });
});
