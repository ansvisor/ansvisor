import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The open-action count beside Action Center › Actions (SIMPLE_NAV): the
 * actions Today ranks for the person, read as them, one number back.
 */

let user: { id: string } | null;
let result: { count: number | null; error: { message: string } | null };
let calls: [string, ...unknown[]][];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'is', 'or']) {
        chain[method] = (...args: unknown[]) => (calls.push([method, ...args]), chain);
      }
      chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: null, ...result });
      return chain;
    },
  })),
}));

const { getMyOpenActionCount } = await import('./action-center-counts');

beforeEach(() => {
  user = { id: 'u1' };
  result = { count: 4, error: null };
  calls = [];
});

describe('getMyOpenActionCount', () => {
  it('counts the brand’s new and in-progress actions, unassigned or the person’s, not deleted', async () => {
    expect(await getMyOpenActionCount('b1')).toBe(4);
    expect(calls).toEqual([
      ['from', 'actions'],
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'brand_id', 'b1'],
      ['in', 'status', ['new', 'in_progress']],
      ['is', 'deleted_at', null],
      ['or', 'assignee_id.is.null,assignee_id.eq.u1'],
    ]);
  });

  it('is 0 when the count fails or comes back empty', async () => {
    result = { count: null, error: { message: 'boom' } };
    expect(await getMyOpenActionCount('b1')).toBe(0);
    result = { count: null, error: null };
    expect(await getMyOpenActionCount('b1')).toBe(0);
  });

  it('reads nothing without a signed-in person', async () => {
    user = null;
    expect(await getMyOpenActionCount('b1')).toBe(0);
    expect(calls).toEqual([]);
  });
});
