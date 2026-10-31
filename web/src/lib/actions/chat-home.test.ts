// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Chat Home's Action Center line (CHAT-01 item 12, CHAT-09 item 3): the
 * brand's open actions due by the end of this week, read as the person,
 * only with the new Chat on, and answered as a value — never thrown (#1777).
 * And "For you now"'s counts (CHAT-08 v2): the pages the open lost-citation
 * signals name, and the drafts ready to publish.
 */

const BRAND = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const db = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  filters: [] as unknown[][],
  answer: { count: 3, error: null } as { count: number | null; error: { message: string } | null },
  /** A table's own answer, over `answer`. */
  answers: {} as Record<string, { data?: unknown; count?: number | null; error: unknown }>,
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
      for (const name of ['select', 'eq', 'in', 'lte', 'is']) {
        chain[name] = (...args: unknown[]) => {
          db.filters.push([table, name, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(db.answers[table] ?? db.answer).then(resolve);
      return chain;
    },
  }),
}));

const { countDueActions, countHomeShortcuts } = await import('./chat-home');

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  db.user = { id: 'user-1' };
  db.filters = [];
  db.answer = { count: 3, error: null };
  db.answers = {};
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

describe('countHomeShortcuts', () => {
  const lost = (status: string, urls?: string[]) => ({
    status,
    payload: urls
      ? { promptText: 'p', lostUrls: urls.map((url) => ({ url })) }
      : { promptText: 'p' },
  });

  it('counts the pages the open lost-citation signals name, and the drafts ready to publish', async () => {
    db.answers = {
      signals: {
        data: [
          lost('new', ['https://www.acme.example/pricing/', 'https://acme.example/blog']),
          // The same page again, written another way.
          lost('acknowledged', ['http://acme.example/Pricing']),
          // A signal from before its evidence names no page.
          lost('new'),
        ],
        error: null,
      },
      content_drafts: { count: 2, error: null },
    };
    expect(await countHomeShortcuts(BRAND)).toEqual({ ok: true, lostPages: 2, readyDrafts: 2 });
    expect(db.filters).toEqual([
      ['signals', 'select', 'payload'],
      ['signals', 'eq', 'brand_id', BRAND],
      ['signals', 'eq', 'kind', 'lost_citations'],
      ['signals', 'in', 'status', ['new', 'acknowledged']],
      ['content_drafts', 'select', 'id', { count: 'exact', head: true }],
      ['content_drafts', 'eq', 'brand_id', BRAND],
      ['content_drafts', 'eq', 'status', 'ready'],
      ['content_drafts', 'is', 'archived_at', null],
    ]);
  });

  it('reads nothing for a bad brand, signed out or with the new Chat off', async () => {
    expect(await countHomeShortcuts('nope')).toEqual({ ok: false });
    db.user = null;
    expect(await countHomeShortcuts(BRAND)).toEqual({ ok: false });
    db.user = { id: 'user-1' };
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await countHomeShortcuts(BRAND)).toEqual({ ok: false });
    expect(db.filters).toEqual([]);
  });

  it('answers a failed read as a value', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    db.answers = { signals: { data: null, error: { message: 'nope' } } };
    expect(await countHomeShortcuts(BRAND)).toEqual({ ok: false });
    logged.mockRestore();
  });
});
