import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHAT_SETTINGS, type PrecedenceContext } from '@/lib/chat/precedence';

/**
 * The composer's setup (W1-10): Full auto shows open only where the server
 * would run it, so a member whose Admin turned "Full auto for members" off
 * doesn't pick a mode that then asks anyway.
 */

const facts = vi.hoisted(() => ({
  savedMode: null as string | null,
  ctx: null as Pick<PrecedenceContext, 'role' | 'plan' | 'settings'> | null,
  fail: false,
  notice: null as string | null,
  ownKey: false as boolean | 'throws',
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === 'profiles'
              ? { data: { organization_id: 'org-1' } }
              : {
                  data:
                    facts.savedMode || facts.notice
                      ? { default_mode: facts.savedMode, usage_notice_period: facts.notice }
                      : null,
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

vi.mock('@/lib/chat/key', () => ({
  chatRunsOnOwnKey: vi.fn(async () => {
    if (facts.ownKey === 'throws') throw new Error('no answer');
    return facts.ownKey;
  }),
}));

const { chatComposerSetup } = await import('./_chat-page-access');

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
  facts.savedMode = 'full_auto';
  facts.ctx = null;
  facts.fail = false;
  facts.notice = null;
  facts.ownKey = false;
});

describe('chatComposerSetup', () => {
  it('keeps Full auto closed for a member when the Admin turned it off, and says why', async () => {
    facts.ctx = ctxOf('manager', true, false);
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'auto',
      fullAutoOpen: false,
      fullAutoOffByAdmin: true,
      usageNoticeSeen: null,
      onOwnKey: false,
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
    });
  });

  it('falls back to the careful setup when the facts can’t be read', async () => {
    facts.fail = true;
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'auto',
      fullAutoOpen: false,
      fullAutoOffByAdmin: false,
      usageNoticeSeen: null,
      onOwnKey: false,
    });
  });

  it('passes on the period whose 80% line was seen, and whether Chat runs on its own key', async () => {
    facts.ctx = ctxOf('admin', true, false);
    facts.notice = '2026-10-01';
    facts.ownKey = true;
    const setup = await chatComposerSetup();
    expect(setup.usageNoticeSeen).toBe('2026-10-01');
    expect(setup.onOwnKey).toBe(true);

    // A key that can't be read: the careful answer, and the server's hold still decides.
    facts.ownKey = 'throws';
    expect((await chatComposerSetup()).onOwnKey).toBe(false);
  });
});
