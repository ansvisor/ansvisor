// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHAT_SETTINGS, type PrecedenceContext } from '@/lib/chat/precedence';

/**
 * The Chat frame's saved choices (chatShellPrefs): none while the new Chat
 * is off, and on the person's first visit their Agent Chat conversations
 * are copied in (W1-02) — once, and never in the way of Chat opening. And
 * the composer's setup (W1-10): Full auto shows open only where the server
 * would run it, so a member whose Admin turned "Full auto for members" off
 * doesn't pick a mode that then asks anyway.
 */

const db = vi.hoisted(() => ({
  prefs: null as {
    menu_open?: boolean;
    rail_open?: boolean;
    legacy_imported_at?: string | null;
    default_mode?: string | null;
    usage_notice_period?: string | null;
  } | null,
  prefsError: null as { message: string } | null,
  confirmedAt: null as string | null,
}));

const facts = vi.hoisted(() => ({
  ctx: null as Pick<PrecedenceContext, 'role' | 'plan' | 'settings'> | null,
  fail: false,
  ownKey: false as boolean | 'throws',
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
vi.mock('@/lib/chat/precedence-context', () => ({
  readPrecedenceContext: vi.fn(async () => {
    if (facts.fail) throw new Error('no answer');
    return facts.ctx;
  }),
}));
vi.mock('@/lib/chat/key', () => ({
  chatRunsOnOwnKey: vi.fn(async () => {
    if (facts.ownKey === 'throws') throw new Error('no answer');
    return facts.ownKey;
  }),
}));
const keyHealth = vi.hoisted(() => ({
  failingKeyFor: vi.fn(async (): Promise<unknown> => null),
}));
vi.mock('@/lib/chat/key-health', () => keyHealth);

const { importLegacyChats } = await import('@/lib/chat/legacy-import');
const { chatPageOpen, chatShellPrefs, chatComposerSetup } = await import('./_chat-page-access');

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  db.prefs = null;
  db.prefsError = null;
  db.confirmedAt = null;
  facts.ctx = null;
  facts.fail = false;
  facts.ownKey = false;
  vi.mocked(importLegacyChats).mockClear();
});
afterEach(() => vi.unstubAllEnvs());

// Chat's pages and Agent Center's (/dashboard/agents) open only by this.
describe('chatPageOpen', () => {
  it('opens with the new Chat on for every workspace, or for the person’s', async () => {
    expect(await chatPageOpen()).toBe(true);
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'org-2, ORG-1');
    expect(await chatPageOpen()).toBe(true);
  });

  it('stays shut with it off, or on only for other workspaces', async () => {
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'org-2');
    expect(await chatPageOpen()).toBe(false);
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await chatPageOpen()).toBe(false);
  });
});

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

/** The / menu's skills with the new Chat on: the library's, by name and title (W2-04). */
const SKILL_MENU = expect.arrayContaining([{ name: 'faq', title: 'FAQ from fan-outs' }]);

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
    facts.ctx = ctxOf('manager', true, false);
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'auto',
      fullAutoOpen: false,
      fullAutoOffByAdmin: true,
      usageNoticeSeen: null,
      onOwnKey: false,
      keyFailure: null,
      skills: SKILL_MENU,
    });
  });

  it('opens Full auto for an Admin whatever the members switch says', async () => {
    facts.ctx = ctxOf('admin', true, false);
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'full_auto',
      fullAutoOpen: true,
      fullAutoOffByAdmin: false,
      usageNoticeSeen: null,
      onOwnKey: false,
      keyFailure: null,
      skills: SKILL_MENU,
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
      usageNoticeSeen: null,
      onOwnKey: false,
      keyFailure: null,
      skills: SKILL_MENU,
    });
  });

  it('keeps the usage period whose 80% line the person saw', async () => {
    db.prefs = { default_mode: 'auto', usage_notice_period: '2026-10' };
    facts.ctx = ctxOf('admin', true, false);
    expect((await chatComposerSetup()).usageNoticeSeen).toBe('2026-10');
  });

  it('falls back to the careful setup when the facts can’t be read', async () => {
    facts.fail = true;
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'auto',
      fullAutoOpen: false,
      fullAutoOffByAdmin: false,
      usageNoticeSeen: null,
      onOwnKey: false,
      keyFailure: null,
      skills: SKILL_MENU,
    });
  });

  it("lists the library's skills for the / menu, by name and title, and none with the new Chat off", async () => {
    facts.ctx = ctxOf('manager', true, true);
    const { skills } = await chatComposerSetup();
    expect(skills).toHaveLength(14);
    expect(skills.every((skill) => Object.keys(skill).join() === 'name,title')).toBe(true);
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect((await chatComposerSetup()).skills).toEqual([]);
  });

  it('passes on the period whose 80% line was seen, and whether Chat runs on its own key', async () => {
    facts.ctx = ctxOf('admin', true, false);
    db.prefs = { default_mode: 'full_auto', usage_notice_period: '2026-10-01' };
    facts.ownKey = true;
    const setup = await chatComposerSetup();
    expect(setup.usageNoticeSeen).toBe('2026-10-01');
    expect(setup.onOwnKey).toBe(true);

    // A key that can't be read: the careful answer, and the server's hold still decides.
    facts.ownKey = 'throws';
    expect((await chatComposerSetup()).onOwnKey).toBe(false);
  });

  it('says the own key fails, read only where Chat runs on it (AGENT-OWN-KEY §5.2)', async () => {
    facts.ctx = ctxOf('admin', true, false);
    keyHealth.failingKeyFor.mockClear();
    facts.ownKey = false;
    expect((await chatComposerSetup()).keyFailure).toBeNull();
    expect(keyHealth.failingKeyFor).not.toHaveBeenCalled();

    facts.ownKey = true;
    keyHealth.failingKeyFor.mockResolvedValueOnce({ class: 'no_credit', provider: 'openai' });
    expect((await chatComposerSetup()).keyFailure).toEqual({
      class: 'no_credit',
      provider: 'openai',
    });
  });
});
