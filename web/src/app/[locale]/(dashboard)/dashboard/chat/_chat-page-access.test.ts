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
              : { data: facts.savedMode ? { default_mode: facts.savedMode } : null },
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
});

describe('chatComposerSetup', () => {
  it('keeps Full auto closed for a member when the Admin turned it off, and says why', async () => {
    facts.ctx = ctxOf('manager', true, false);
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'auto',
      fullAutoOpen: false,
      fullAutoOffByAdmin: true,
      usageNoticeSeen: null,
    });
  });

  it('opens Full auto for an Admin whatever the members switch says', async () => {
    facts.ctx = ctxOf('admin', true, false);
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'full_auto',
      fullAutoOpen: true,
      fullAutoOffByAdmin: false,
      usageNoticeSeen: null,
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
    });
  });

  it('falls back to the careful setup when the facts can’t be read', async () => {
    facts.fail = true;
    expect(await chatComposerSetup()).toEqual({
      defaultMode: 'auto',
      fullAutoOpen: false,
      fullAutoOffByAdmin: false,
      usageNoticeSeen: null,
    });
  });
});
