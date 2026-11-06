import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /dashboard's choice (owner decision 2026-11-06): Chat Home for the free
 * trial and the demo while the new Chat is on, else the Action Center; a
 * read that fails keeps the Action Center.
 */

const audience = vi.hoisted(() => vi.fn());
vi.mock('@/lib/chat/start-audience', () => ({ readChatStartAudience: audience }));

const session = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  profile: { organization_id: 'org1' } as { organization_id: string | null } | null,
}));
const client = {
  auth: { getUser: async () => ({ data: { user: session.user } }) },
  from: () => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: session.profile }),
    };
    return query;
  },
};
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client }));

const { dashboardHome, dashboardHomeFor } = await import('./dashboard-home');

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  audience.mockReset();
  session.user = { id: 'u1' };
  session.profile = { organization_id: 'org1' };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('dashboardHomeFor', () => {
  it('opens Chat Home for the trial and the demo', async () => {
    audience.mockResolvedValueOnce('trial').mockResolvedValueOnce('demo');
    await expect(dashboardHomeFor(client as never, 'org1')).resolves.toBe('/dashboard/chat');
    await expect(dashboardHomeFor(client as never, 'org1')).resolves.toBe('/dashboard/chat');
    expect(audience).toHaveBeenCalledWith(client, 'org1');
  });

  it('opens the Action Center for everyone else', async () => {
    audience.mockResolvedValue(null);
    await expect(dashboardHomeFor(client as never, 'org1')).resolves.toBe(
      '/dashboard/action-center/actions',
    );
  });

  it('reads nothing while the new Chat is off, or without an organization', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    await expect(dashboardHomeFor(client as never, 'org1')).resolves.toBe(
      '/dashboard/action-center/actions',
    );
    vi.stubEnv('CHAT_AGENTIC', 'true');
    await expect(dashboardHomeFor(client as never, null)).resolves.toBe(
      '/dashboard/action-center/actions',
    );
    expect(audience).not.toHaveBeenCalled();
  });

  it('keeps the Action Center when the read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    audience.mockRejectedValue(new Error('down'));
    await expect(dashboardHomeFor(client as never, 'org1')).resolves.toBe(
      '/dashboard/action-center/actions',
    );
  });
});

describe('dashboardHome', () => {
  it("reads the signed-in person's organization", async () => {
    audience.mockResolvedValue('trial');
    await expect(dashboardHome()).resolves.toBe('/dashboard/chat');
  });

  it('opens the Action Center without a session', async () => {
    session.user = null;
    await expect(dashboardHome()).resolves.toBe('/dashboard/action-center/actions');
    expect(audience).not.toHaveBeenCalled();
  });
});
