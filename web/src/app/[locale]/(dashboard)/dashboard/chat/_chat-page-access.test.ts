// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHAT_SETTINGS, type PrecedenceContext } from '@/lib/chat/precedence';

/**
 * The Chat frame's saved choices (chatShellPrefs): none while the new Chat
 * is off, and on the person's first visit their Agent Chat conversations
 * are copied in (W1-02) — once, and never in the way of Chat opening.
 *
 * The composer's setup (W1-10): Full auto shows open only where the server
 * would run it, so a member whose Admin turned "Full auto for members" off
 * doesn't pick a mode that then asks anyway.
 */

const db = vi.hoisted(() => ({
  prefs: null as {
    menu_open?: boolean;
    rail_open?: boolean;
    legacy_imported_at?: string | null;
    default_mode?: string;
    usage_notice_period?: string | null;
  } | null,
  prefsError: null as { message: string } | null,
  ctx: null as Pick<PrecedenceContext, 'role' | 'plan' | 'settings'> | null,
  fail: false,
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
              : { data: db.prefs, error: db.prefsError },
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/chat/legacy-import', () => ({
  importLegacyChats: vi.fn(async () => ({ ok: false })),
}));
vi.mock('@/lib/chat/precedence-context', () => ({
  readPrecedenceContext: vi.fn(async () => {
    if (db.fail) throw new Error('no answer');
    return db.ctx;
  }),
}));

const { importLegacyChats } = await import('@/lib/chat/legacy-import');
const { chatShellPrefs, chatComposerSetup } = await import('./_chat-page-access');

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  db.prefs = null;
  db.prefsError = null;
  db.ctx = null;
  db.fail = false;
  vi.mocked(importLegacyChats).mockClear();
});
afterEach(() => vi.unstubAllEnvs());

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

describe('chatComposerSetup', () => {
  beforeEach(() => {
    db.prefs = { default_mode: 'full_auto', usage_notice_period: null };
  });

  it('keeps Full auto closed for a member when the Admin turned it off, and says why', async () => {
    db.ctx = ctxOf('manager', true, false);
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'auto',
      fullAutoOpen: false,
      fullAutoOffByAdmin: true,
      usageNoticeSeen: null,
    });
  });

  it('opens Full auto for an Admin whatever the members switch says', async () => {
    db.ctx = ctxOf('admin', true, false);
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'full_auto',
      fullAutoOpen: true,
      fullAutoOffByAdmin: false,
      usageNoticeSeen: null,
    });
  });

  it('opens Full auto for a member with the switch on', async () => {
    db.ctx = ctxOf('manager', true, true);
    expect((await chatComposerSetup()).fullAutoOpen).toBe(true);
  });

  it('names the plan, not the Admin, when the plan has no Full auto', async () => {
    db.ctx = ctxOf('manager', false, false);
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'auto',
      fullAutoOpen: false,
      fullAutoOffByAdmin: false,
      usageNoticeSeen: null,
    });
  });

  it('keeps the usage period whose 80% line the person saw', async () => {
    db.prefs = { default_mode: 'auto', usage_notice_period: '2026-10' };
    db.ctx = ctxOf('admin', true, false);
    expect((await chatComposerSetup()).usageNoticeSeen).toBe('2026-10');
  });

  it('falls back to the careful setup when the facts can’t be read', async () => {
    db.fail = true;
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'auto',
      fullAutoOpen: false,
      fullAutoOffByAdmin: false,
      usageNoticeSeen: null,
    });
  });
});
