// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHAT_SETTINGS, type PrecedenceContext } from '@/lib/chat/precedence';

/**
 * The composer's setup (W1-10): Full auto shows open only where the server
 * would run it, so a member whose Admin turned "Full auto for members" off
 * doesn't pick a mode that then asks anyway.
 *
 * The Chat frame's saved choices (chatShellPrefs): none while the new Chat
 * is off, and on the person's first visit their Agent Chat conversations
 * are copied in (W1-02) — once, and never in the way of Chat opening.
 */

const facts = vi.hoisted(() => ({
  savedMode: null as string | null,
  ctx: null as Pick<PrecedenceContext, 'role' | 'plan' | 'settings'> | null,
  fail: false,
}));

const db = vi.hoisted(() => ({
  prefs: null as {
    menu_open: boolean;
    rail_open?: boolean;
    legacy_imported_at: string | null;
  } | null,
  prefsError: null as { message: string } | null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1', email: 'jo@example.com' } } }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === 'profiles'
              ? { data: { organization_id: 'org-1' }, error: null }
              : {
                  data: db.prefs ?? (facts.savedMode ? { default_mode: facts.savedMode } : null),
                  error: db.prefsError,
                },
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/chat/precedence-context', () => ({
  readPrecedenceContext: vi.fn(async () => {
    if (facts.fail) throw new Error('no answer');
    return facts.ctx;
  }),
}));
vi.mock('@/lib/chat/legacy-import', () => ({
  importLegacyChats: vi.fn(async () => ({ ok: false })),
}));

const { importLegacyChats } = await import('@/lib/chat/legacy-import');
const { chatComposerSetup, chatShellPrefs } = await import('./_chat-page-access');

function ctxOf(
  role: PrecedenceContext['role'],
  fullAuto: boolean,
  fullAutoForMembers: boolean,
): Pick<PrecedenceContext, 'role' | 'plan' | 'settings'> {
  return {
    role,
    plan: { fullAuto } as PrecedenceContext['plan'],
    settings: { ...DEFAULT_CHAT_SETTINGS, fullAutoForMembers },
  };
}

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  facts.savedMode = 'full_auto';
  facts.ctx = null;
  facts.fail = false;
  db.prefs = null;
  db.prefsError = null;
  vi.mocked(importLegacyChats).mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('chatComposerSetup', () => {
  it('keeps Full auto closed for a member when the Admin turned it off, and says why', async () => {
    facts.ctx = ctxOf('manager', true, false);
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'auto',
      fullAutoOpen: false,
      fullAutoOffByAdmin: true,
    });
  });

  it('opens Full auto for an Admin whatever the members switch says', async () => {
    facts.ctx = ctxOf('admin', true, false);
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'full_auto',
      fullAutoOpen: true,
      fullAutoOffByAdmin: false,
    });
  });

  it('opens Full auto for a member with the switch on', async () => {
    facts.ctx = ctxOf('manager', true, true);
    expect((await chatComposerSetup()).fullAutoOpen).toBe(true);
  });

  it('names the plan, not the Admin, when the plan has no Full auto', async () => {
    facts.ctx = ctxOf('manager', false, false);
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'auto',
      fullAutoOpen: false,
      fullAutoOffByAdmin: false,
    });
  });

  it('falls back to the careful setup when the facts can’t be read', async () => {
    facts.fail = true;
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'auto',
      fullAutoOpen: false,
      fullAutoOffByAdmin: false,
    });
  });
});

describe('chatShellPrefs', () => {
  it("copies the person's Agent Chat conversations on their first visit, and opens even when that fails", async () => {
    expect(await chatShellPrefs()).toEqual({ menuOpen: true, railOpen: false });
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
    expect(await chatShellPrefs()).toEqual({ menuOpen: false, railOpen: true });
    db.prefs = null;
    db.prefsError = { message: 'down' };
    expect(await chatShellPrefs()).toEqual({ menuOpen: true, railOpen: false });
    expect(importLegacyChats).not.toHaveBeenCalled();
  });

  it('does nothing while the new Chat is off', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await chatShellPrefs()).toBeNull();
    expect(importLegacyChats).not.toHaveBeenCalled();
  });
});
