// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Chat Home's Action Center line (CHAT-01 item 12, CHAT-09 item 3): the
 * brand's open actions due by the end of this week, read as the person,
 * only with the new Chat on, and answered as a value — never thrown (#1777).
 */

const BRAND = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const db = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  filters: [] as unknown[][],
  answer: { count: 3, error: null } as { count: number | null; error: { message: string } | null },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { organization_id: 'org-1' }, error: null }),
            }),
          }),
        };
      }
      const chain: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'in', 'lte']) {
        chain[name] = (...args: unknown[]) => {
          db.filters.push([table, name, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(db.answer).then(resolve);
      return chain;
    },
  }),
}));

const { countDueActions } = await import('./chat-home');

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  db.user = { id: 'user-1' };
  db.filters = [];
  db.answer = { count: 3, error: null };
});
afterEach(() => vi.unstubAllEnvs());

describe('countDueActions', () => {
  it("counts the brand's open actions due by the week's end", async () => {
    expect(await countDueActions(BRAND, '2026-11-01')).toEqual({ ok: true, count: 3 });
    expect(db.filters).toEqual([
      ['actions', 'select', 'id', { count: 'exact', head: true }],
      ['actions', 'eq', 'brand_id', BRAND],
      ['actions', 'in', 'status', ['new', 'in_progress', 'on_hold']],
      ['actions', 'lte', 'due_date', '2026-11-01'],
    ]);
  });

  it('takes the demo brand’s id, made by hand and not an RFC 4122 one', async () => {
    const demo = '33333333-3333-3333-3333-333333333333';
    expect(await countDueActions(demo, '2026-11-01')).toEqual({ ok: true, count: 3 });
    expect(db.filters).toContainEqual(['actions', 'eq', 'brand_id', demo]);
  });

  it('reads nothing for a bad brand or date, signed out or with the new Chat off', async () => {
    expect(await countDueActions('nope', '2026-11-01')).toEqual({ ok: false });
    expect(await countDueActions(BRAND, 'Sunday')).toEqual({ ok: false });
    db.user = null;
    expect(await countDueActions(BRAND, '2026-11-01')).toEqual({ ok: false });
    db.user = { id: 'user-1' };
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await countDueActions(BRAND, '2026-11-01')).toEqual({ ok: false });
    expect(db.filters).toEqual([]);
  });

  it('answers a failed read as a value', async () => {
    db.answer = { count: null, error: { message: 'nope' } };
    expect(await countDueActions(BRAND, '2026-11-01')).toEqual({ ok: false });
  });
});
