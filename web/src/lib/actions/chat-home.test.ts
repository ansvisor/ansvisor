// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "For you now"'s counts on Chat Home (CHAT-08 v2, CHAT-09 item 3): the
 * brand's open actions due by the week's end, the pages its open
 * lost-citation signals name, and its drafts ready to publish — read as the
 * person, once, together; none for a section an Admin took off their menu;
 * only with the new Chat on, and answered as a value, never thrown (#1777).
 */

const BRAND = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const db = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  profile: {} as Record<string, unknown>,
  roleHidden: [] as string[],
  /** Each statement: [table, method, ...args]. */
  calls: [] as unknown[][],
  /** A table's answer; signals by page. */
  answers: {} as Record<string, { data?: unknown; count?: number | null; error: unknown }>,
  signalPages: [] as unknown[][],
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      let page = 0;
      for (const name of ['select', 'eq', 'in', 'lte', 'is', 'order', 'range']) {
        chain[name] = (...args: unknown[]) => {
          db.calls.push([table, name, ...args]);
          if (name === 'range') page = (args[0] as number) / 1000;
          return chain;
        };
      }
      chain.maybeSingle = async () =>
        table === 'profiles'
          ? { data: db.profile, error: null }
          : { data: { hidden_sections: db.roleHidden }, error: null };
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(
          table === 'signals'
            ? (db.answers.signals ?? { data: db.signalPages[page] ?? [], error: null })
            : (db.answers[table] ?? { count: 0, error: null }),
        ).then(resolve);
      return chain;
    },
  }),
}));

const { readHomeShortcuts } = await import('./chat-home');

const lost = (...urls: string[]) => ({ lostUrls: urls.map((url) => ({ url })) });
const tables = () => [...new Set(db.calls.map(([table]) => table))];

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  db.user = { id: 'user-1' };
  db.profile = {
    organization_id: 'org-1',
    role: 'manager',
    work_areas: [],
    work_areas_asked_at: null,
    menu_shown: [],
    menu_hidden: [],
    can_manage_menus: false,
  };
  db.roleHidden = [];
  db.calls = [];
  db.answers = { actions: { count: 3, error: null }, content_drafts: { count: 2, error: null } };
  db.signalPages = [
    [
      lost('https://www.acme.example/pricing/', 'https://acme.example/blog?utm=x#top'),
      // The same pages again, written other ways.
      lost('http://acme.example/Pricing', 'acme.example/blog'),
      // A signal from before its evidence names no page.
      { lostUrls: null },
    ],
  ];
});
afterEach(() => vi.unstubAllEnvs());

describe('readHomeShortcuts', () => {
  it('counts the due tasks, the lost-citation pages and the ready drafts together', async () => {
    expect(await readHomeShortcuts(BRAND, '2026-11-01')).toEqual({
      ok: true,
      dueTasks: 3,
      lostPages: 2,
      readyDrafts: 2,
    });
    const of = (table: string) => db.calls.filter(([t]) => t === table).map(([, ...c]) => c);
    expect(of('actions')).toEqual([
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'brand_id', BRAND],
      ['in', 'status', ['new', 'in_progress', 'on_hold']],
      ['lte', 'due_date', '2026-11-01'],
    ]);
    // The pages only, a page of signals at a time.
    expect(of('signals')).toEqual([
      ['select', 'lostUrls:payload->lostUrls'],
      ['eq', 'brand_id', BRAND],
      ['eq', 'kind', 'lost_citations'],
      ['in', 'status', ['new', 'acknowledged']],
      ['order', 'id'],
      ['range', 0, 999],
    ]);
    expect(of('content_drafts')).toEqual([
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'brand_id', BRAND],
      ['eq', 'status', 'ready'],
      ['is', 'archived_at', null],
    ]);
  });

  it('reads the next page of signals while a page is full', async () => {
    db.signalPages = [
      Array.from({ length: 1000 }, (_, i) => lost(`https://acme.example/p${i % 10}`)),
      [lost('https://acme.example/last')],
    ];
    const result = await readHomeShortcuts(BRAND, '2026-11-01');
    expect(result).toMatchObject({ ok: true, lostPages: 11 });
    expect(db.calls.filter(([t, m]) => t === 'signals' && m === 'range')).toEqual([
      ['signals', 'range', 0, 999],
      ['signals', 'range', 1000, 1999],
    ]);
  });

  it('counts nothing for a section an Admin took off the person’s menu', async () => {
    db.profile.menu_hidden = ['content'];
    db.roleHidden = ['citations'];
    expect(await readHomeShortcuts(BRAND, '2026-11-01')).toEqual({
      ok: true,
      dueTasks: 3,
      lostPages: 0,
      readyDrafts: 0,
    });
    expect(tables()).not.toContain('content_drafts');
    expect(tables()).not.toContain('signals');
  });

  it('takes the demo brand’s id, made by hand and not an RFC 4122 one', async () => {
    const demo = '33333333-3333-3333-3333-333333333333';
    expect(await readHomeShortcuts(demo, '2026-11-01')).toMatchObject({ ok: true });
  });

  it('reads nothing for a bad brand or date, signed out or with the new Chat off', async () => {
    expect(await readHomeShortcuts('nope', '2026-11-01')).toEqual({ ok: false });
    expect(await readHomeShortcuts(BRAND, 'Sunday')).toEqual({ ok: false });
    db.user = null;
    expect(await readHomeShortcuts(BRAND, '2026-11-01')).toEqual({ ok: false });
    db.user = { id: 'user-1' };
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await readHomeShortcuts(BRAND, '2026-11-01')).toEqual({ ok: false });
    expect(tables()).toEqual(['profiles']);
  });

  it('answers a failed read as a value', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    db.answers.content_drafts = { count: null, error: { message: 'nope' } };
    expect(await readHomeShortcuts(BRAND, '2026-11-01')).toEqual({ ok: false });
    db.answers.content_drafts = { count: 2, error: null };
    db.answers.signals = { data: null, error: { message: 'nope' } };
    expect(await readHomeShortcuts(BRAND, '2026-11-01')).toEqual({ ok: false });
    logged.mockRestore();
  });
});
