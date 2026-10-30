// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Chat frame's saved choices (chatShellPrefs): none while the new Chat
 * is off, and on the person's first visit their Agent Chat conversations
 * are copied in (W1-02) — once, and never in the way of Chat opening.
 */

const db = vi.hoisted(() => ({
  prefs: null as {
    menu_open: boolean;
    rail_open?: boolean;
    legacy_imported_at: string | null;
  } | null,
  prefsError: null as { message: string } | null,
  confirmedAt: null as string | null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: { id: 'user-1', email: 'jo@example.com', email_confirmed_at: db.confirmedAt },
        },
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === 'profiles'
              ? { data: { organization_id: 'org-1' }, error: null }
              : { data: db.prefs, error: db.prefsError },
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/chat/legacy-import', () => ({
  importLegacyChats: vi.fn(async () => ({ ok: false })),
}));

const { importLegacyChats } = await import('@/lib/chat/legacy-import');
const { chatShellPrefs } = await import('./_chat-page-access');

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  db.prefs = null;
  db.prefsError = null;
  db.confirmedAt = null;
  vi.mocked(importLegacyChats).mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('chatShellPrefs', () => {
  it("copies the person's Agent Chat conversations on their first visit, and opens even when that fails", async () => {
    expect(await chatShellPrefs()).toEqual({ menuOpen: true, railOpen: false, staff: false });
    expect(importLegacyChats).toHaveBeenCalledWith({
      userId: 'user-1',
      email: 'jo@example.com',
      organizationId: 'org-1',
    });
  });

  it('copies nothing once they were copied, or when the settings could not be read', async () => {
    db.prefs = {
      menu_open: false,
      rail_open: true,
      legacy_imported_at: '2026-10-30T09:00:00.000Z',
    };
    expect(await chatShellPrefs()).toEqual({ menuOpen: false, railOpen: true, staff: false });
    db.prefs = null;
    db.prefsError = { message: 'down' };
    expect(await chatShellPrefs()).toEqual({ menuOpen: true, railOpen: false, staff: false });
    expect(importLegacyChats).not.toHaveBeenCalled();
  });

  it('says whether the person is Ansvisor staff: a confirmed e-mail in STAFF_EMAILS (W1-15)', async () => {
    vi.stubEnv('STAFF_EMAILS', 'ops@ansvisor.com, Jo@Example.com');
    expect((await chatShellPrefs())?.staff).toBe(false);
    db.confirmedAt = '2026-10-01T09:00:00.000Z';
    expect((await chatShellPrefs())?.staff).toBe(true);
    vi.stubEnv('STAFF_EMAILS', 'ops@ansvisor.com');
    expect((await chatShellPrefs())?.staff).toBe(false);
  });

  it('does nothing while the new Chat is off', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await chatShellPrefs()).toBeNull();
    expect(importLegacyChats).not.toHaveBeenCalled();
  });
});
