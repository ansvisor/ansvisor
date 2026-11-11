import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirect(url);
    // next/navigation's redirect never returns.
    throw new Error('NEXT_REDIRECT');
  },
}));
const row = vi.hoisted(() => ({
  value: null as { id?: string; brand_id: string } | null,
  // What the page looked the action up by: the person's own client, so RLS
  // keeps it to their workspace.
  eq: [] as [string, unknown][],
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: (column: string, value: unknown) => {
          row.eq.push([column, value]);
          return { maybeSingle: async () => ({ data: row.value, error: null }) };
        },
      }),
    }),
  }),
}));

import ActionRedirect from './page';

const go = (id: string) =>
  ActionRedirect({ params: Promise.resolve({ id }) }).catch((err: Error) => {
    if (err.message !== 'NEXT_REDIRECT') throw err;
  });

describe("an action's own path", () => {
  beforeEach(() => {
    redirect.mockClear();
    row.value = { brand_id: 'brand-1' };
    row.eq = [];
  });

  it("opens the Actions page on its drawer, on the action's brand, with no filter", async () => {
    await go('action-1');
    expect(redirect).toHaveBeenCalledWith(
      '/dashboard/action-center/actions?action=action-1&brand=brand-1',
    );
  });

  it('keeps an odd id inside the query value', async () => {
    await go('a&b=c');
    expect(redirect).toHaveBeenCalledWith(
      '/dashboard/action-center/actions?action=a%26b%3Dc&brand=brand-1',
    );
  });

  it("opens the list for an action the person can't read", async () => {
    row.value = null;
    await go('action-2');
    expect(redirect).toHaveBeenCalledWith('/dashboard/action-center/actions');
  });

  it('opens an action by its number, as a Chat answer links "AC-1497"', async () => {
    row.value = { id: 'action-1497', brand_id: 'brand-1' };
    await go('AC-1497');
    expect(row.eq).toEqual([['action_no', 1497]]);
    expect(redirect).toHaveBeenCalledWith(
      '/dashboard/action-center/actions?action=action-1497&brand=brand-1',
    );
  });

  it('opens the list for a number with no action in the workspace, and no drawer', async () => {
    row.value = null;
    await go('AC-99999');
    expect(row.eq).toEqual([['action_no', 99999]]);
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith('/dashboard/action-center/actions');
  });

  it('reads anything but a whole number as an id', async () => {
    for (const id of ['AC-0', 'AC-12a', 'ac-12', 'AC-1234567890123']) {
      row.eq = [];
      await go(id);
      expect(row.eq, id).toEqual([['id', id]]);
    }
  });
});
