import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardNav } from '@/config/dashboard';
import { menuSectionOf } from '@/lib/menu-access';

/**
 * Where a person lands each time they come, on Ansvisor Cloud: Insights for
 * a paid workspace while Insights is on their menu (owner decision
 * 2026-11-10); else Chat Home while the new Chat is on and on their menu
 * (2026-11-06 and 2026-11-09); else the Action Center. A plan that can't be
 * read counts as unpaid; a menu that can't be read keeps the Action Center.
 */

const roleHidden = vi.hoisted(() => vi.fn());
vi.mock('@/lib/menu-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/menu-access')>()),
  readRoleHidden: roleHidden,
}));

const CHAT = '/dashboard/chat';
const ACTION_CENTER = '/dashboard/action-center/actions';
const INSIGHTS = '/dashboard/insights';

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
  /** The organization's row; `error` is what its read returns, `throws` makes it throw. */
  org: { subscription_status: 'trialing' } as { subscription_status: string | null } | null,
  orgError: null as { message: string } | null,
  orgThrows: false,
  orgReads: [] as string[],
}));
const client = {
  auth: { getUser: async () => ({ data: { user: session.user } }) },
  from: (table: string) => {
    let id = '';
    const query = {
      select: (columns: string) => {
        if (table === 'profiles') session.select = columns;
        return query;
      },
      eq: (_column: string, value: string) => {
        id = value;
        return query;
      },
      maybeSingle: async () => {
        if (table !== 'organizations') return { data: session.profile };
        session.orgReads.push(id);
        if (session.orgThrows) throw new Error('network down');
        return { data: session.orgError ? null : session.org, error: session.orgError };
      },
    };
    return query;
  },
};
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client }));

const { CHAT_MENU_SECTION, INSIGHTS_MENU_SECTION, dashboardHome, dashboardHomeFor } =
  await import('./dashboard-home');

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  roleHidden.mockReset().mockResolvedValue([]);
  session.user = { id: 'u1' };
  session.profile = member();
  session.select = '';
  session.org = { subscription_status: 'trialing' };
  session.orgError = null;
  session.orgThrows = false;
  session.orgReads = [];
});

const paid = () => {
  session.org = { subscription_status: 'active' };
};

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

describe('the Insights menu section', () => {
  it("is the left menu's Visibility item's, the page a paid workspace opens on", () => {
    const visibility = dashboardNav
      .flatMap((group) => group.items)
      .find((item) => item.href === INSIGHTS);
    expect(visibility?.title).toBe('Visibility');
    expect(visibility && menuSectionOf(visibility.href)).toBe(INSIGHTS_MENU_SECTION);
    expect(INSIGHTS_MENU_SECTION).toBe('insights');
  });
});

describe('dashboardHomeFor', () => {
  it('opens Chat Home with the new Chat on in the free trial', async () => {
    await expect(dashboardHomeFor(client as never, member())).resolves.toBe(CHAT);
    await expect(dashboardHomeFor(client as never, member({ role: 'admin' }))).resolves.toBe(CHAT);
    expect(roleHidden).toHaveBeenCalledWith(client, 'org1', 'manager');
    expect(session.orgReads).toEqual(['org1', 'org1']);
  });

  it('opens Insights for a paid workspace, with the new Chat on or off', async () => {
    // Active: paid, a plan set to cancel at the period's end included.
    paid();
    await expect(dashboardHomeFor(client as never, member())).resolves.toBe(INSIGHTS);
    await expect(dashboardHomeFor(client as never, member({ role: 'admin' }))).resolves.toBe(
      INSIGHTS,
    );
    vi.stubEnv('CHAT_AGENTIC', 'false');
    await expect(dashboardHomeFor(client as never, member())).resolves.toBe(INSIGHTS);
  });

  it("keeps today's page for a paid workspace where Insights is off the person's menu", async () => {
    paid();
    roleHidden.mockResolvedValue([INSIGHTS_MENU_SECTION]);
    await expect(dashboardHomeFor(client as never, member())).resolves.toBe(CHAT);
    await expect(
      dashboardHomeFor(client as never, member({ menu_hidden: [CHAT_MENU_SECTION] })),
    ).resolves.toBe(ACTION_CENTER);
    roleHidden.mockResolvedValue([]);
    await expect(
      dashboardHomeFor(client as never, member({ menu_hidden: [INSIGHTS_MENU_SECTION] })),
    ).resolves.toBe(CHAT);
    vi.stubEnv('CHAT_AGENTIC', 'false');
    await expect(
      dashboardHomeFor(client as never, member({ menu_hidden: [INSIGHTS_MENU_SECTION] })),
    ).resolves.toBe(ACTION_CENTER);
  });

  it('follows the work areas for a paid workspace: Insights where they include it', async () => {
    paid();
    await expect(
      dashboardHomeFor(client as never, member({ work_areas: ['leaders'] })),
    ).resolves.toBe(INSIGHTS);
    await expect(
      dashboardHomeFor(client as never, member({ work_areas: ['content'] })),
    ).resolves.toBe(CHAT);
    await expect(dashboardHomeFor(client as never, member({ work_areas: ['aeo'] }))).resolves.toBe(
      ACTION_CENTER,
    );
  });

  it("opens Insights when an Admin put it back on the person's menu", async () => {
    paid();
    roleHidden.mockResolvedValue([INSIGHTS_MENU_SECTION]);
    await expect(
      dashboardHomeFor(client as never, member({ menu_shown: [INSIGHTS_MENU_SECTION] })),
    ).resolves.toBe(INSIGHTS);
  });

  it.each(['trialing', 'past_due', 'unpaid', 'canceled', 'inactive', null])(
    "keeps today's page for a plan that is %s",
    async (status) => {
      session.org = { subscription_status: status };
      await expect(dashboardHomeFor(client as never, member())).resolves.toBe(CHAT);
      await expect(
        dashboardHomeFor(client as never, member({ menu_hidden: [CHAT_MENU_SECTION] })),
      ).resolves.toBe(ACTION_CENTER);
      vi.stubEnv('CHAT_AGENTIC', 'false');
      await expect(dashboardHomeFor(client as never, member())).resolves.toBe(ACTION_CENTER);
    },
  );

  it("keeps today's page when the organization's plan can't be read", async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    session.orgError = { message: 'denied' };
    await expect(dashboardHomeFor(client as never, member())).resolves.toBe(CHAT);
    session.orgError = null;
    session.orgThrows = true;
    await expect(dashboardHomeFor(client as never, member())).resolves.toBe(CHAT);
    session.org = null;
    session.orgThrows = false;
    await expect(dashboardHomeFor(client as never, member())).resolves.toBe(CHAT);
    expect(logged).toHaveBeenCalledTimes(2);
    expect(String(logged.mock.calls[0][0])).toContain('[dashboard-home]');
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

  it('opens the Action Center while the new Chat is off for an unpaid workspace', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    await expect(dashboardHomeFor(client as never, member())).resolves.toBe(ACTION_CENTER);
  });

  it('reads nothing self-hosted, paid or not, or without an organization', async () => {
    paid();
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    await expect(dashboardHomeFor(client as never, member())).resolves.toBe(ACTION_CENTER);
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    await expect(
      dashboardHomeFor(client as never, member({ organization_id: null })),
    ).resolves.toBe(ACTION_CENTER);
    await expect(dashboardHomeFor(client as never, null)).resolves.toBe(ACTION_CENTER);
    expect(roleHidden).not.toHaveBeenCalled();
    expect(session.orgReads).toEqual([]);
  });

  it("keeps the Action Center when the person's menu can't be read", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    roleHidden.mockRejectedValue(new Error('down'));
    await expect(dashboardHomeFor(client as never, member())).resolves.toBe(ACTION_CENTER);
  });
});

describe('dashboardHome', () => {
  it("reads the signed-in person's organization, its plan and their menu", async () => {
    await expect(dashboardHome()).resolves.toBe(CHAT);
    for (const column of ['organization_id', 'role', 'work_areas', 'menu_shown', 'menu_hidden']) {
      expect(session.select).toContain(column);
    }
    expect(session.orgReads).toEqual(['org1']);
    paid();
    await expect(dashboardHome()).resolves.toBe(INSIGHTS);
  });

  it('opens the Action Center without a session', async () => {
    session.user = null;
    await expect(dashboardHome()).resolves.toBe(ACTION_CENTER);
    expect(roleHidden).not.toHaveBeenCalled();
  });
});
