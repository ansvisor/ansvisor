// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Connected apps (MCP over OAuth, #2141): a person lists and disconnects
 * only their own live connections; Disconnect ends the connection and its
 * tokens and is logged; all of it 404 while MCP over OAuth is off.
 */

interface Grant {
  id: string;
  user_id: string;
  organization_id: string;
  client_id: string;
  client_name: string | null;
  redirect_host: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  grants: [] as Grant[],
  profiles: {} as Record<string, Record<string, unknown>>,
  org: { plan: 'growth', subscription_status: 'active', plan_overrides: null } as Record<
    string,
    unknown
  >,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const query = {
        select: () => query,
        order: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return query;
        },
        is: (column: string, value: unknown) => {
          filters.push([column, value]);
          return query;
        },
        maybeSingle: async () => {
          if (table === 'profiles') {
            return { data: state.profiles[filters[0][1] as string] ?? null, error: null };
          }
          if (table === 'organizations') return { data: state.org, error: null };
          const rows = state.grants.filter((g) =>
            filters.every(([c, v]) => (g as unknown as Record<string, unknown>)[c] === v),
          );
          return { data: rows[0] ?? null, error: null };
        },
        then: (resolve: (value: unknown) => void) => {
          const rows =
            table === 'oauth_grants'
              ? state.grants.filter((g) =>
                  filters.every(([c, v]) => (g as unknown as Record<string, unknown>)[c] === v),
                )
              : [];
          resolve({ data: rows, error: null });
        },
      };
      return query;
    },
  },
}));
const grants = vi.hoisted(() => ({ revokeGrant: vi.fn(async () => {}) }));
vi.mock('@/lib/mcp-oauth/grants', () => grants);
const events = vi.hoisted(() => ({ logOAuthEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/mcp-oauth/events', () => events);

const list = await import('./route');
const one = await import('./[id]/route');

const now = Date.now();
const grant = (overrides: Partial<Grant>): Grant => ({
  id: '11111111-1111-1111-1111-111111111111',
  user_id: 'user-1',
  organization_id: 'org-1',
  client_id: 'ansc_a',
  client_name: 'Totally Claude',
  redirect_host: 'claude.ai',
  scopes: ['mcp:read', 'mcp:write'],
  created_at: new Date(now - 86_400_000).toISOString(),
  last_used_at: new Date(now - 60_000).toISOString(),
  revoked_at: null,
  ...overrides,
});

const del = (id: string) =>
  one.DELETE(
    new Request(`https://app.ansvisor.com/api/oauth/connections/${id}`, { method: 'DELETE' }),
    {
      params: Promise.resolve({ id }),
    },
  );

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.ansvisor.com');
  // App sign-in is on by default (MCP_OAUTH_ENABLED unset), with an https issuer.
  vi.stubEnv('MCP_OAUTH_ENABLED', undefined);
  state.user = { id: 'user-1' };
  state.profiles = {
    'user-1': { organization_id: 'org-1', role: 'admin', brand_scope: 'all' },
  };
  state.org = { plan: 'growth', subscription_status: 'active', plan_overrides: null };
  state.grants = [
    grant({}),
    grant({
      id: '22222222-2222-2222-2222-222222222222',
      client_name: 'MyAgent',
      redirect_host: '127.0.0.1',
      scopes: ['mcp:read'],
      last_used_at: null,
      created_at: new Date(now - 3_600_000).toISOString(),
    }),
    // Someone else's, one disconnected, one idle past 30 days: never listed.
    grant({ id: '33333333-3333-3333-3333-333333333333', user_id: 'user-2' }),
    grant({ id: '44444444-4444-4444-4444-444444444444', revoked_at: new Date().toISOString() }),
    grant({
      id: '55555555-5555-5555-5555-555555555555',
      last_used_at: new Date(now - 31 * 86_400_000).toISOString(),
    }),
  ];
  grants.revokeGrant.mockClear();
  events.logOAuthEvent.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/oauth/connections', () => {
  it("lists the person's own live connections, a known app by its host", async () => {
    const res = await list.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { connections: Record<string, unknown>[] };
    expect(body).toMatchObject({ access: 'ok', isAdmin: true });
    expect(body.connections.map((c) => c.id)).toEqual([
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ]);
    expect(body.connections[0]).toMatchObject({
      name: 'Claude',
      host: 'claude.ai',
      recognised: true,
      loopback: false,
    });
    expect(body.connections[1]).toMatchObject({
      name: 'MyAgent',
      recognised: false,
      loopback: true,
      scopes: ['mcp:read'],
    });
  });

  it('says when the plan stops connections working', async () => {
    state.org = { plan: 'growth', subscription_status: 'trialing', plan_overrides: null };
    expect(await (await list.GET()).json()).toMatchObject({ access: 'trial' });
    state.org = { plan: 'growth', subscription_status: 'canceled', plan_overrides: null };
    expect(await (await list.GET()).json()).toMatchObject({ access: 'ended' });
  });

  it('answers 401 signed out, and 404 while MCP over OAuth is off', async () => {
    state.user = null;
    expect((await list.GET()).status).toBe(401);
    vi.stubEnv('MCP_OAUTH_ENABLED', 'false');
    expect((await list.GET()).status).toBe(404);
  });
});

describe('DELETE /api/oauth/connections/[id]', () => {
  it('ends one of the person’s own connections and logs it', async () => {
    const res = await del('11111111-1111-1111-1111-111111111111');
    expect(res.status).toBe(200);
    expect(grants.revokeGrant).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      'person',
    );
    expect(events.logOAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'revoked_by_person',
        userId: 'user-1',
        grantId: '11111111-1111-1111-1111-111111111111',
      }),
    );
  });

  it("answers 404 for someone else's, a disconnected one, or not an id", async () => {
    for (const id of [
      '33333333-3333-3333-3333-333333333333',
      '44444444-4444-4444-4444-444444444444',
      'nope',
    ]) {
      expect((await del(id)).status).toBe(404);
    }
    expect(grants.revokeGrant).not.toHaveBeenCalled();
  });

  it('answers 401 signed out, and 404 while MCP over OAuth is off', async () => {
    state.user = null;
    expect((await del('11111111-1111-1111-1111-111111111111')).status).toBe(401);
    vi.stubEnv('MCP_OAUTH_ENABLED', 'false');
    expect((await del('11111111-1111-1111-1111-111111111111')).status).toBe(404);
  });
});
