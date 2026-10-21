import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Library's read (CE-002): the latest 500 drafts, and each tab counted
 * in all once a brand has more.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';

let rows: Record<string, unknown>[];
let counted: Record<string, number>;
let countReads: string[];

vi.mock('@/lib/action-center/assignees', () => ({ readAssignees: vi.fn(async () => new Map()) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => {
      let head = false;
      let status = 'all';
      const chain: Record<string, unknown> = {
        select: (_cols: string, opts?: { head?: boolean }) => ((head = !!opts?.head), chain),
        eq: (col: string, v: string) => (col === 'status' && (status = v), chain),
        order: () => chain,
        limit: async () => ({ data: rows, error: null }),
        then: (resolve: (r: unknown) => void) => {
          countReads.push(status);
          resolve({ count: head ? counted[status] : null, error: null });
        },
      };
      return chain;
    },
  })),
}));

const { getContentDrafts } = await import('./content-drafts');

const row = (i: number, status = 'draft') => ({
  id: `d${i}`,
  title: `Draft ${i}`,
  page_type: null,
  method: 'create',
  status,
  author: 'user',
  created_by: 'u1',
  score_before: null,
  score_after: null,
  agent_state: null,
  agent_state_at: null,
  updated_at: '2026-10-21T10:00:00Z',
});

beforeEach(() => {
  countReads = [];
  counted = { all: 812, draft: 300, in_review: 12, ready: 0, published: 500 };
});

describe('getContentDrafts', () => {
  it('counts the tabs from the rows under the cap', async () => {
    rows = [row(1), row(2, 'published')];
    const { drafts, counts } = await getContentDrafts(BRAND);
    expect(drafts).toHaveLength(2);
    expect(counts).toEqual({ all: 2, draft: 1, in_review: 0, ready: 0, published: 1 });
    expect(countReads).toEqual([]);
  });

  it('counts each tab on its own at the cap', async () => {
    rows = Array.from({ length: 500 }, (_, i) => row(i));
    const { drafts, counts } = await getContentDrafts(BRAND);
    expect(drafts).toHaveLength(500);
    expect(counts).toEqual(counted);
    expect(countReads.sort()).toEqual(['all', 'draft', 'in_review', 'published', 'ready']);
  });
});
