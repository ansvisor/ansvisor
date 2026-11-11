// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A person's Today and menu state on a brand (00529), read and written as
 * the person: their own row (user_id is always theirs; RLS refuses a brand
 * they can't access), one column per write merged with what the row holds,
 * only what the state accepts, and answered as a value, never thrown (#1777).
 * No plan check: it is UI state, so it works while read-only and on the demo
 * brand.
 */

const USER = '99999999-9999-4999-8999-999999999999';
const BRAND = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';
const A3 = '33333333-3333-4333-8333-333333333333';
const A4 = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-11T10:00:00.000Z');
const later = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

const db = vi.hoisted(() => ({
  user: { id: '99999999-9999-4999-8999-999999999999' } as { id: string } | null,
  row: null as Record<string, unknown> | null,
  reads: [] as { columns: string; filters: [string, unknown][] }[],
  upserts: [] as { row: Record<string, unknown>; options: unknown }[],
  readError: null as { message: string } | null,
  writeError: null as { message: string } | null,
  throws: false,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (db.throws) throw new Error('down');
    return {
      auth: { getUser: async () => ({ data: { user: db.user } }) },
      from: (table: string) => {
        expect(table).toBe('user_brand_state');
        const read = { columns: '', filters: [] as [string, unknown][] };
        const query = {
          select: (columns: string) => {
            read.columns = columns;
            db.reads.push(read);
            return query;
          },
          eq: (column: string, value: unknown) => {
            read.filters.push([column, value]);
            return query;
          },
          maybeSingle: async () => ({ data: db.readError ? null : db.row, error: db.readError }),
          upsert: async (row: Record<string, unknown>, options: unknown) => {
            db.upserts.push({ row, options });
            return { error: db.writeError };
          },
        };
        return query;
      },
    };
  },
}));

const { hideCard, markSeen, readUserBrandState, setFocus } = await import('./user-brand-state');

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  db.user = { id: USER };
  db.row = null;
  db.reads = [];
  db.upserts = [];
  db.readError = null;
  db.writeError = null;
  db.throws = false;
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  errorLog.mockRestore();
});

const OWN_ROW = { onConflict: 'user_id,brand_id' };

describe('readUserBrandState', () => {
  it("reads the person's own row on the brand", async () => {
    db.row = {
      nav_seen: { today: '2026-11-10T08:00:00Z', agents: 'x' },
      focus: [{ id: A1, added_at: '2026-11-09T08:00:00Z' }],
      hidden: { setup: null, [`skip:${A2}`]: later(-1), [`skip:${A3}`]: later(3) },
    };
    expect(await readUserBrandState(BRAND)).toEqual({
      navSeen: { today: '2026-11-10T08:00:00.000Z' },
      focus: [{ id: A1, addedAt: '2026-11-09T08:00:00.000Z' }],
      hidden: { setup: null, [`skip:${A3}`]: later(3) },
    });
    expect(db.reads).toEqual([
      {
        columns: 'nav_seen, focus, hidden',
        filters: [
          ['user_id', USER],
          ['brand_id', BRAND],
        ],
      },
    ]);
  });

  it('is the empty state before the person has a row', async () => {
    expect(await readUserBrandState(BRAND)).toEqual({ navSeen: {}, focus: [], hidden: {} });
  });

  it('is null when it cannot be read: a bad brand, signed out, a failed read or a throw', async () => {
    expect(await readUserBrandState('nope')).toBeNull();
    db.user = null;
    expect(await readUserBrandState(BRAND)).toBeNull();
    db.user = { id: USER };
    db.readError = { message: 'nope' };
    expect(await readUserBrandState(BRAND)).toBeNull();
    db.readError = null;
    db.throws = true;
    expect(await readUserBrandState(BRAND)).toBeNull();
  });
});

describe('markSeen', () => {
  it('writes the area at the server’s time, keeping the areas already seen', async () => {
    db.row = { nav_seen: { today: '2026-11-10T08:00:00.000Z' } };
    expect(await markSeen(BRAND, 'prompts/tracked')).toEqual({ ok: true });
    expect(db.reads[0]).toEqual({
      columns: 'nav_seen',
      filters: [
        ['user_id', USER],
        ['brand_id', BRAND],
      ],
    });
    expect(db.upserts).toEqual([
      {
        row: {
          user_id: USER,
          brand_id: BRAND,
          nav_seen: { today: '2026-11-10T08:00:00.000Z', 'prompts/tracked': NOW.toISOString() },
        },
        options: OWN_ROW,
      },
    ]);
  });

  it('starts the row on the first visit, writing only nav_seen', async () => {
    expect(await markSeen(BRAND, 'today')).toEqual({ ok: true });
    expect(db.upserts[0].row).toEqual({
      user_id: USER,
      brand_id: BRAND,
      nav_seen: { today: NOW.toISOString() },
    });
  });

  it('refuses an area or a brand it does not know', async () => {
    expect(await markSeen(BRAND, 'agents' as never)).toEqual({ ok: false, error: 'invalid' });
    expect(await markSeen('nope', 'today')).toEqual({ ok: false, error: 'invalid' });
    expect(db.upserts).toEqual([]);
  });
});

describe('setFocus', () => {
  it('keeps up to 3 actions in order, stamping the new ones now, without reading first', async () => {
    expect(
      await setFocus(BRAND, [
        { id: A1, addedAt: '2026-11-09T08:00:00Z' },
        { id: A2.toUpperCase() },
        { id: A3 },
      ]),
    ).toEqual({ ok: true });
    expect(db.reads).toEqual([]);
    expect(db.upserts).toEqual([
      {
        row: {
          user_id: USER,
          brand_id: BRAND,
          focus: [
            { id: A1, added_at: '2026-11-09T08:00:00.000Z' },
            { id: A2, added_at: NOW.toISOString() },
            { id: A3, added_at: NOW.toISOString() },
          ],
        },
        options: OWN_ROW,
      },
    ]);
  });

  it('clears it with an empty list', async () => {
    expect(await setFocus(BRAND, [])).toEqual({ ok: true });
    expect(db.upserts[0].row.focus).toEqual([]);
  });

  it('refuses more than 3, an action twice, an id or a time that is not one', async () => {
    for (const pins of [
      [{ id: A1 }, { id: A2 }, { id: A3 }, { id: A4 }],
      [{ id: A1 }, { id: A1.toUpperCase() }],
      [{ id: 'nope' }],
      [{ id: A1, addedAt: 'soon' }],
      'x' as never,
    ]) {
      expect(await setFocus(BRAND, pins)).toEqual({ ok: false, error: 'invalid' });
    }
    expect(await setFocus('nope', [{ id: A1 }])).toEqual({ ok: false, error: 'invalid' });
    expect(db.upserts).toEqual([]);
  });
});

describe('hideCard', () => {
  it('hides a card until a time ahead, dropping the ones that have expired', async () => {
    db.row = { hidden: { setup: null, [`skip:${A1}`]: later(-1) } };
    expect(await hideCard(BRAND, `skip:${A2}`, new Date(later(7)))).toEqual({ ok: true });
    expect(db.reads[0].columns).toBe('hidden');
    expect(db.upserts).toEqual([
      {
        row: { user_id: USER, brand_id: BRAND, hidden: { setup: null, [`skip:${A2}`]: later(7) } },
        options: OWN_ROW,
      },
    ]);
  });

  it('hides a card for good with null', async () => {
    expect(await hideCard(BRAND, 'setup', null)).toEqual({ ok: true });
    expect(db.upserts[0].row.hidden).toEqual({ setup: null });
  });

  it('snoozes a topic by its key, and the first day’s prompt check', async () => {
    expect(await hideCard(BRAND, 'topic:Hiking backpacks', later(30))).toEqual({ ok: true });
    db.row = { hidden: db.upserts[0].row.hidden };
    expect(await hideCard(BRAND, 'prompts_check', null)).toEqual({ ok: true });
    expect(db.upserts[1].row.hidden).toEqual({
      'topic:Hiking backpacks': later(30),
      prompts_check: null,
    });
  });

  it('refuses a key it does not know, a time that has passed or is not one', async () => {
    expect(await hideCard(BRAND, 'nope', null)).toEqual({ ok: false, error: 'invalid' });
    expect(await hideCard(BRAND, 'skip:42', later(7))).toEqual({ ok: false, error: 'invalid' });
    expect(await hideCard(BRAND, 'setup', NOW)).toEqual({ ok: false, error: 'invalid' });
    expect(await hideCard(BRAND, 'setup', later(-1))).toEqual({ ok: false, error: 'invalid' });
    expect(await hideCard(BRAND, 'setup', 'soon')).toEqual({ ok: false, error: 'invalid' });
    expect(await hideCard('nope', 'setup', null)).toEqual({ ok: false, error: 'invalid' });
    expect(db.upserts).toEqual([]);
  });
});

describe('every write', () => {
  const writes = [
    () => markSeen(BRAND, 'today'),
    () => setFocus(BRAND, [{ id: A1 }]),
    () => hideCard(BRAND, 'setup', null),
  ];

  it('does nothing signed out', async () => {
    db.user = null;
    for (const write of writes) expect(await write()).toEqual({ ok: false, error: 'failed' });
    expect(db.upserts).toEqual([]);
  });

  it('answers a refused or failed write, a failed read and a throw as a value', async () => {
    // RLS refuses a brand the person can't access: the write comes back as an error.
    db.writeError = { message: 'new row violates row-level security policy' };
    for (const write of writes) expect(await write()).toEqual({ ok: false, error: 'failed' });
    db.writeError = null;
    db.readError = { message: 'nope' };
    expect(await markSeen(BRAND, 'today')).toEqual({ ok: false, error: 'failed' });
    expect(await hideCard(BRAND, 'setup', null)).toEqual({ ok: false, error: 'failed' });
    db.readError = null;
    db.throws = true;
    for (const write of writes) expect(await write()).toEqual({ ok: false, error: 'failed' });
  });

  it('writes only the person’s own row, whatever it is given', async () => {
    for (const write of writes) await write();
    expect(db.upserts.map((u) => [u.row.user_id, u.row.brand_id, u.options])).toEqual([
      [USER, BRAND, OWN_ROW],
      [USER, BRAND, OWN_ROW],
      [USER, BRAND, OWN_ROW],
    ]);
  });
});
