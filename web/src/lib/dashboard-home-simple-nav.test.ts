import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Where a person lands with the simplified layout on (SIMPLE_NAV, owner
 * decisions 2026-11-11): Action Center › Today for everyone (paid, trial,
 * ended, payment due, demo, invited members, self-hosted), read from
 * nothing: the Action Center is on every menu and no plan changes it. Off,
 * the rules in dashboard-home.test.ts hold.
 */

const roleHidden = vi.hoisted(() => vi.fn());
vi.mock('@/lib/menu-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/menu-access')>()),
  readRoleHidden: roleHidden,
}));

const TODAY = '/dashboard/action-center/today';

const session = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  org: { subscription_status: 'trialing' } as Record<string, unknown> | null,
  reads: [] as string[],
}));
const profile = (patch: Record<string, unknown> = {}) => ({
  organization_id: 'org1',
  role: 'analyst',
  work_areas: null,
  work_areas_asked_at: null,
  menu_shown: null,
  menu_hidden: null,
  can_manage_menus: false,
  ...patch,
});
const client = {
  auth: { getUser: async () => ({ data: { user: session.user } }) },
  from: (table: string) => {
    session.reads.push(table);
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () =>
        table === 'organizations' ? { data: session.org, error: null } : { data: profile() },
    };
    return query;
  },
};
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client }));

const { dashboardHome, dashboardHomeFor } = await import('./dashboard-home');

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('SIMPLE_NAV', 'true');
  roleHidden.mockReset().mockResolvedValue([]);
  session.user = { id: 'u1' };
  session.org = { subscription_status: 'trialing' };
  session.reads = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('dashboardHomeFor with SIMPLE_NAV', () => {
  it('lands every plan’s people on Today, reading neither the plan nor the role’s menu', async () => {
    for (const status of ['trialing', 'active', 'past_due', 'canceled', null]) {
      session.org = { subscription_status: status, subscription_ends_at: '2026-11-20T00:00:00Z' };
      expect(await dashboardHomeFor(client as never, profile())).toBe(TODAY);
    }
    expect(session.reads).toEqual([]);
    expect(roleHidden).not.toHaveBeenCalled();
  });

  it('lands an invited member on Today whatever their menu hides, Chat and Visibility too', async () => {
    roleHidden.mockResolvedValue(['agent', 'insights']);
    expect(
      await dashboardHomeFor(
        client as never,
        profile({ role: 'agency_partner', menu_hidden: ['agent', 'insights'] }),
      ),
    ).toBe(TODAY);
  });

  it('lands on Today with the new Chat off, self-hosted, or without an organization', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await dashboardHomeFor(client as never, profile())).toBe(TODAY);
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(await dashboardHomeFor(client as never, profile())).toBe(TODAY);
    expect(await dashboardHomeFor(client as never, profile({ organization_id: null }))).toBe(TODAY);
    expect(await dashboardHomeFor(client as never, null)).toBe(TODAY);
  });

  it('keeps the old rules with it off: Chat Home on a trial’s first day, Insights for a paid plan', async () => {
    vi.stubEnv('SIMPLE_NAV', 'false');
    expect(await dashboardHomeFor(client as never, profile())).toBe('/dashboard/chat');
    session.org = { subscription_status: 'active' };
    expect(await dashboardHomeFor(client as never, profile())).toBe('/dashboard/insights');
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(await dashboardHomeFor(client as never, profile())).toBe(
      '/dashboard/action-center/actions',
    );
  });
});

describe('dashboardHome with SIMPLE_NAV', () => {
  it('opens Today for the signed-in person without reading their profile', async () => {
    expect(await dashboardHome()).toBe(TODAY);
    expect(session.reads).toEqual([]);
  });

  it('opens Today without a session too, and the Action Center’s Actions with it off', async () => {
    session.user = null;
    expect(await dashboardHome()).toBe(TODAY);
    vi.stubEnv('SIMPLE_NAV', undefined);
    expect(await dashboardHome()).toBe('/dashboard/action-center/actions');
  });
});
