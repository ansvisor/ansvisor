import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardNav } from '@/config/dashboard';
import { menuSectionOf } from '@/lib/menu-access';

/**
 * Where a person lands each time they come (owner decisions 2026-11-06 and
 * 2026-11-09): Chat Home on Ansvisor Cloud while the new Chat is on and on
 * their menu, whatever the plan; else the Action Center. A read that fails
 * keeps the Action Center.
 */

const roleHidden = vi.hoisted(() => vi.fn());
vi.mock('@/lib/menu-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/menu-access')>()),
  readRoleHidden: roleHidden,
}));

const CHAT = '/dashboard/chat';
const ACTION_CENTER = '/dashboard/action-center/actions';

type Profile = {
  organization_id: string | null;
  role: string | null;
  work_areas: string[] | null;
  work_areas_asked_at: string | null;
  menu_shown: string[] | null;
  menu_hidden: string[] | null;
  can_manage_menus: boolean | null;
};

const member = (patch: Partial<Profile> = {}): Profile => ({
  organization_id: 'org1',
  role: 'manager',
  work_areas: null,
  work_areas_asked_at: null,
  menu_shown: null,
  menu_hidden: null,
  can_manage_menus: false,
  ...patch,
});

const session = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  profile: null as unknown,
  select: '' as string,
}));
const client = {
  auth: { getUser: async () => ({ data: { user: session.user } }) },
  from: () => {
    const query = {
      select: (columns: string) => {
        session.select = columns;
        return query;
      },
      eq: () => query,
      maybeSingle: async () => ({ data: session.profile }),
    };
    return query;
  },
};
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client }));

const { CHAT_MENU_SECTION, dashboardHome, dashboardHomeFor } = await import('./dashboard-home');

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  roleHidden.mockReset().mockResolvedValue([]);
  session.user = { id: 'u1' };
  session.profile = member();
  session.select = '';
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the Chat menu section', () => {
  it("is the left menu's Chat item's", () => {
    const chat = dashboardNav.flatMap((group) => group.items).find((item) => item.title === 'Chat');
    expect(chat && menuSectionOf(chat.href)).toBe(CHAT_MENU_SECTION);
  });
});

describe('dashboardHomeFor', () => {
  it('opens Chat Home with the new Chat on, whatever the plan', async () => {
    await expect(dashboardHomeFor(client as never, member())).resolves.toBe(CHAT);
    await expect(dashboardHomeFor(client as never, member({ role: 'admin' }))).resolves.toBe(CHAT);
    expect(roleHidden).toHaveBeenCalledWith(client, 'org1', 'manager');
  });

  it("opens the Action Center when an Admin took Chat off the person's role menu", async () => {
    roleHidden.mockResolvedValue([CHAT_MENU_SECTION]);
    await expect(dashboardHomeFor(client as never, member())).resolves.toBe(ACTION_CENTER);
  });

  it("opens the Action Center when Chat is off the person's own menu", async () => {
    await expect(
      dashboardHomeFor(client as never, member({ menu_hidden: [CHAT_MENU_SECTION] })),
    ).resolves.toBe(ACTION_CENTER);
  });

  it("opens Chat Home when an Admin put Chat back on the person's menu", async () => {
    roleHidden.mockResolvedValue([CHAT_MENU_SECTION]);
    await expect(
      dashboardHomeFor(client as never, member({ menu_shown: [CHAT_MENU_SECTION] })),
    ).resolves.toBe(CHAT);
  });

  it('follows the work areas: Chat Home where they include Chat, else the Action Center', async () => {
    await expect(
      dashboardHomeFor(client as never, member({ work_areas: ['content'] })),
    ).resolves.toBe(CHAT);
    await expect(dashboardHomeFor(client as never, member({ work_areas: ['aeo'] }))).resolves.toBe(
      ACTION_CENTER,
    );
  });

  it('reads nothing while the new Chat is off, self-hosted, or without an organization', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    await expect(dashboardHomeFor(client as never, member())).resolves.toBe(ACTION_CENTER);
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    await expect(dashboardHomeFor(client as never, member())).resolves.toBe(ACTION_CENTER);
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    await expect(
      dashboardHomeFor(client as never, member({ organization_id: null })),
    ).resolves.toBe(ACTION_CENTER);
    await expect(dashboardHomeFor(client as never, null)).resolves.toBe(ACTION_CENTER);
    expect(roleHidden).not.toHaveBeenCalled();
  });

  it('keeps the Action Center when the read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    roleHidden.mockRejectedValue(new Error('down'));
    await expect(dashboardHomeFor(client as never, member())).resolves.toBe(ACTION_CENTER);
  });
});

describe('dashboardHome', () => {
  it("reads the signed-in person's organization and menu", async () => {
    await expect(dashboardHome()).resolves.toBe(CHAT);
    for (const column of ['organization_id', 'role', 'work_areas', 'menu_shown', 'menu_hidden']) {
      expect(session.select).toContain(column);
    }
  });

  it('opens the Action Center without a session', async () => {
    session.user = null;
    await expect(dashboardHome()).resolves.toBe(ACTION_CENTER);
    expect(roleHidden).not.toHaveBeenCalled();
  });
});
