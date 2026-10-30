// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The chat menu's state and the side panel's size on the person (CHAT-01
 * items 9d, 16; DECISIONS N3): written to their own chat_user_prefs row,
 * only with the new Chat on, and answered as a value — never thrown (#1777).
 */

const db = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  upserts: [] as { row: unknown; options: unknown }[],
  error: null as { message: string } | null,
  throws: false,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (db.throws) throw new Error('down');
    return {
      auth: { getUser: async () => ({ data: { user: db.user } }) },
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { organization_id: 'org-1' }, error: null }),
          }),
        }),
        upsert: async (row: unknown, options: unknown) => {
          expect(table).toBe('chat_user_prefs');
          db.upserts.push({ row, options });
          return { error: db.error };
        },
      }),
    };
  },
}));

const { saveChatMenuOpen, saveChatPanelSize } = await import('./chat-prefs');

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  db.user = { id: 'user-1' };
  db.upserts = [];
  db.error = null;
  db.throws = false;
});
afterEach(() => vi.unstubAllEnvs());

describe('saveChatMenuOpen', () => {
  it("keeps the choice on the person's own row", async () => {
    expect(await saveChatMenuOpen(false)).toEqual({ ok: true });
    expect(db.upserts).toEqual([
      { row: { user_id: 'user-1', menu_open: false }, options: { onConflict: 'user_id' } },
    ]);
  });

  it('does nothing while the new Chat is off, signed out or for a bad value', async () => {
    db.user = null;
    expect(await saveChatMenuOpen(true)).toEqual({ ok: false });
    db.user = { id: 'user-1' };
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await saveChatMenuOpen(true)).toEqual({ ok: false });
    vi.stubEnv('CHAT_AGENTIC', 'true');
    expect(await saveChatMenuOpen('yes' as unknown as boolean)).toEqual({ ok: false });
    expect(db.upserts).toEqual([]);
  });

  it('answers a failed write or a thrown error as a value', async () => {
    db.error = { message: 'nope' };
    expect(await saveChatMenuOpen(true)).toEqual({ ok: false });
    db.throws = true;
    expect(await saveChatMenuOpen(true)).toEqual({ ok: false });
  });
});

describe('saveChatPanelSize', () => {
  it("keeps the panel's size on the person's own row", async () => {
    expect(await saveChatPanelSize('wide')).toEqual({ ok: true });
    expect(db.upserts).toEqual([
      { row: { user_id: 'user-1', panel_size: 'wide' }, options: { onConflict: 'user_id' } },
    ]);
  });

  it('keeps no size it does not know', async () => {
    expect(await saveChatPanelSize('huge' as 'wide')).toEqual({ ok: false });
    expect(db.upserts).toEqual([]);
  });
});
