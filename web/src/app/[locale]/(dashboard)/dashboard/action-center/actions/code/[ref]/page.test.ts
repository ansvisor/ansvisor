import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirect(url);
    throw new Error('NEXT_REDIRECT');
  },
}));
type Row = { id: string; brand_id: string; brand_no: number | null; action_no: number };
const db = vi.hoisted(() => ({
  // The actions the person's own client reads: RLS keeps them to their workspace.
  rows: [] as Row[],
  or: [] as string[],
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        or: (filter: string) => {
          db.or.push(filter);
          const no = Number(/brand_no\.eq\.(\d+)/.exec(filter)![1]);
          return {
            limit: async (n: number) => ({
              data: db.rows.filter((r) => r.brand_no === no || r.action_no === no).slice(0, n),
              error: null,
            }),
          };
        },
      }),
    }),
  }),
}));

import ActionCodeRedirect from './page';

const go = (ref: string) =>
  ActionCodeRedirect({ params: Promise.resolve({ ref }) }).catch((err: Error) => {
    if (err.message !== 'NEXT_REDIRECT') throw err;
  });
const opened = () => redirect.mock.calls[0][0] as string;

// The owner's ask (14 Nov): each brand numbers its actions from AC-01 (00534);
// a code in text may be a brand's or an old global number, so it never guesses.
describe('a code in text', () => {
  beforeEach(() => {
    redirect.mockClear();
    db.or = [];
    db.rows = [
      { id: 'brand-3', brand_id: 'b1', brand_no: 3, action_no: 648 },
      { id: 'brand-59', brand_id: 'b1', brand_no: 59, action_no: 700 },
      { id: 'old-59', brand_id: 'b2', brand_no: 12, action_no: 59 },
    ];
  });

  it('opens the one action with that code, padded or not, on its brand', async () => {
    for (const ref of ['AC-03', 'AC-3', 'AC-648']) {
      redirect.mockClear();
      await go(ref);
      expect(opened(), ref).toBe('/dashboard/action-center/actions?action=brand-3&brand=b1');
    }
    expect(db.or).toContain('brand_no.eq.3,action_no.eq.3');
  });

  it("lists both when a brand's code and an old number name different actions", async () => {
    await go('AC-59');
    expect(opened()).toBe('/dashboard/action-center/actions?q=AC-59');
  });

  it('opens the list for a code with no action, or no code at all', async () => {
    for (const ref of ['AC-404', 'AC-0', 'AC-012', 'x']) {
      redirect.mockClear();
      await go(ref);
      expect(opened(), ref).toBe('/dashboard/action-center/actions');
    }
  });
});
