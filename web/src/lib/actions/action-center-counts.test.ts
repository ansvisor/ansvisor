import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The open-action count (AC-01): Today's Actions step and the Actions list's
 * All pill on Open read one predicate, new + in progress + on hold, anyone's.
 */

let user: { id: string } | null;
let result: {
  data: { status: string; assignee_id: string | null }[] | null;
  error: { message: string } | null;
};
let countResult: { count: number | null; error: { message: string } | null } | null;
let calls: [string, ...unknown[]][];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'is', 'limit', 'gte']) {
        chain[method] = (...args: unknown[]) => (calls.push([method, ...args]), chain);
      }
      chain.then = (resolve: (value: unknown) => unknown) => resolve(countResult ?? result);
      return chain;
    },
  })),
}));

const { getClosedThisWeekCount, getOpenActionCounts } = await import('./action-center-counts');

beforeEach(() => {
  countResult = null;
  user = { id: 'u1' };
  result = {
    data: [
      { status: 'new', assignee_id: null },
      { status: 'in_progress', assignee_id: 'u1' },
      { status: 'on_hold', assignee_id: 'u2' },
      { status: 'on_hold', assignee_id: 'u1' },
      { status: 'new', assignee_id: 'u2' },
    ],
    error: null,
  };
  calls = [];
});

describe('getOpenActionCounts', () => {
  it('counts the brand’s new, in-progress and on-hold actions, anyone’s, not deleted', async () => {
    expect(await getOpenActionCounts('b1')).toEqual({ open: 5, onHold: 2, mine: 2 });
    expect(calls).toEqual([
      ['from', 'actions'],
      ['select', 'status, assignee_id'],
      ['eq', 'brand_id', 'b1'],
      ['in', 'status', ['new', 'in_progress', 'on_hold']],
      ['is', 'deleted_at', null],
      ['limit', 1000],
    ]);
  });

  it('is all zeros with no open actions', async () => {
    result = { data: null, error: null };
    expect(await getOpenActionCounts('b1')).toEqual({ open: 0, onHold: 0, mine: 0 });
  });

  it('throws when the read fails, so the cell shows nothing', async () => {
    result = { data: null, error: { message: 'boom' } };
    await expect(getOpenActionCounts('b1')).rejects.toThrow('boom');
  });

  it('reads nothing without a signed-in person', async () => {
    user = null;
    await expect(getOpenActionCounts('b1')).rejects.toThrow('Not authenticated');
    expect(calls).toEqual([]);
  });
});

describe('getClosedThisWeekCount', () => {
  it('counts the brand’s completed and dismissed actions changed in the last 7 days, not deleted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-21T12:00:00.000Z'));
    countResult = { count: 12, error: null };
    try {
      expect(await getClosedThisWeekCount('b1')).toBe(12);
    } finally {
      vi.useRealTimers();
    }
    expect(calls).toEqual([
      ['from', 'actions'],
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'brand_id', 'b1'],
      ['in', 'status', ['completed', 'dismissed']],
      ['is', 'deleted_at', null],
      ['gte', 'updated_at', '2026-11-14T12:00:00.000Z'],
    ]);
  });

  it('is 0 with none', async () => {
    countResult = { count: null, error: null };
    expect(await getClosedThisWeekCount('b1')).toBe(0);
  });

  it('throws when the count fails, so the summary leaves it out', async () => {
    countResult = { count: null, error: { message: 'boom' } };
    await expect(getClosedThisWeekCount('b1')).rejects.toThrow('boom');
  });
});
