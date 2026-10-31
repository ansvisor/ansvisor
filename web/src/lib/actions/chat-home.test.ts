// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Chat Home's Action Center line (CHAT-01 item 12, CHAT-09 item 3): the
 * brand's open actions due by the end of this week, read as the person,
 * only with the new Chat on, and answered as a value — never thrown (#1777).
 * And "Since you left" (CHAT-22 §1): citations by engine since the person
 * last left Home, counted as the service role once the brand is theirs.
 */

const BRAND = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const db = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  filters: [] as unknown[][],
  answer: { count: 3, error: null } as { count: number | null; error: { message: string } | null },
  single: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  rpc: { data: null, error: null } as { data: unknown; error: { message: string } | null },
  rpcCalls: [] as unknown[][],
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
      chain.maybeSingle = async () => db.single[table] ?? { data: null, error: null };
      return chain;
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    rpc: async (...args: unknown[]) => {
      db.rpcCalls.push(args);
      return db.rpc;
    },
  },
}));

const { countDueActions, readSinceYouLeft } = await import('./chat-home');

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  db.user = { id: 'user-1' };
  db.filters = [];
  db.answer = { count: 3, error: null };
  db.single = {};
  db.rpc = { data: null, error: null };
  db.rpcCalls = [];
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

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

describe('readSinceYouLeft', () => {
  const SEEN = '2026-10-19T15:20:00.000Z';
  const cell = (engine: string, period: 'a' | 'b', answers: number, cited: number) => ({
    prompt_id: 'p1',
    platform: engine,
    model_used: engine,
    region: null,
    period,
    runs: 7,
    answers,
    citation_answers: cited,
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T09:00:00Z'));
    db.single = {
      chat_user_prefs: { data: { home_seen_at: SEEN }, error: null },
      brands: { data: { id: BRAND }, error: null },
    };
    db.rpc = {
      data: {
        cells: [
          cell('google-aio', 'a', 200, 60),
          cell('google-aio', 'b', 200, 40),
          cell('chatgpt-web', 'a', 200, 30),
          cell('chatgpt-web', 'b', 200, 50),
          // ChatGPT Shopping is left out, as Why leaves it.
          cell('chatgpt-shopping', 'a', 200, 0),
          cell('chatgpt-shopping', 'b', 200, 100),
        ],
      },
      error: null,
    };
  });

  it('gives the biggest drop and one win since the person last left Home', async () => {
    expect(await readSinceYouLeft(BRAND)).toEqual({
      ok: true,
      since: {
        from: '2026-10-19',
        seenAt: SEEN,
        drop: { engine: 'google-aio', before: 60, now: 40 },
        win: { engine: 'chatgpt-web', before: 30, now: 50 },
      },
    });
    expect(db.filters).toContainEqual(['brands', 'eq', 'organization_id', 'org-1']);
    expect(db.rpcCalls).toEqual([
      [
        'chat_why_cells',
        {
          p_brand_id: BRAND,
          p_a_from: '2026-10-07',
          p_a_to: '2026-10-18',
          p_b_from: '2026-10-19',
          p_b_to: '2026-10-30',
          p_series_from: '2026-10-30',
        },
      ],
    ]);
  });

  it('has nothing before the first leave, the same day, or without a move', async () => {
    db.single.chat_user_prefs = { data: { home_seen_at: null }, error: null };
    expect(await readSinceYouLeft(BRAND)).toEqual({ ok: true, since: null });
    db.single.chat_user_prefs = { data: { home_seen_at: '2026-10-31T07:00:00Z' }, error: null };
    expect(await readSinceYouLeft(BRAND)).toEqual({ ok: true, since: null });
    expect(db.rpcCalls).toEqual([]);
    db.single.chat_user_prefs = { data: { home_seen_at: SEEN }, error: null };
    db.rpc = { data: { cells: [] }, error: null };
    expect(await readSinceYouLeft(BRAND)).toEqual({ ok: true, since: null });
  });

  it('counts nothing for a brand outside the workspace, a bad id, or with the new Chat off', async () => {
    db.single.brands = { data: null, error: null };
    expect(await readSinceYouLeft(BRAND)).toEqual({ ok: false });
    expect(await readSinceYouLeft('nope')).toEqual({ ok: false });
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await readSinceYouLeft(BRAND)).toEqual({ ok: false });
    expect(db.rpcCalls).toEqual([]);
  });

  it('answers a failed read as a value', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    db.rpc = { data: null, error: { message: 'nope' } };
    expect(await readSinceYouLeft(BRAND)).toEqual({ ok: false });
    db.single.chat_user_prefs = { data: null, error: { message: 'nope' } };
    expect(await readSinceYouLeft(BRAND)).toEqual({ ok: false });
    logged.mockRestore();
  });
});
