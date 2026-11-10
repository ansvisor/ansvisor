// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * authenticateMcpRequest with an app's sign-in (MCP over OAuth, #2141): only
 * at the MCP endpoint and with MCP_OAUTH_ENABLED; the token's connection,
 * then its person read fresh; a member who left loses the connection; the
 * plan says whether the connection may work; 401s carry the challenge that
 * starts sign-in. API keys work as before.
 */

const TOKEN = 'ans_oat_valid';
const grants = vi.hoisted(() => ({
  check: vi.fn(),
  revokeGrant: vi.fn(async () => {}),
  touchGrant: vi.fn(),
}));
vi.mock('@/lib/mcp-oauth/grants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp-oauth/grants')>()),
  checkAccessToken: grants.check,
  revokeGrant: grants.revokeGrant,
  touchGrant: grants.touchGrant,
}));
const events = vi.hoisted(() => ({ logOAuthEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/mcp-oauth/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp-oauth/events')>()),
  logOAuthEvent: events.logOAuthEvent,
}));

let profile: Record<string, unknown> | null;
let org: Record<string, unknown>;
let apiKey: Record<string, unknown> | null;
let profileError: { code: string; message: string } | null;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const row = table === 'api_keys' ? apiKey : table === 'profiles' ? profile : org;
      const query = {
        select: () => query,
        eq: () => query,
        update: () => query,
        then: (resolve: (value: unknown) => void) => resolve({ data: null, error: null }),
        maybeSingle: async () =>
          table === 'profiles' && profileError
            ? { data: null, error: profileError }
            : { data: row, error: null },
      };
      return query;
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'a@example.com' } } }) } },
  },
}));

const { authenticateMcpRequest } = await import('./mcp-auth');

const grant = {
  id: 'grant-1',
  user_id: 'user-1',
  organization_id: 'org-1',
  client_id: 'ansc_x',
  client_name: 'Claude',
  redirect_host: 'claude.ai',
  scopes: ['mcp:read', 'mcp:write'],
  resource: 'https://app.ansvisor.com/api/mcp',
  created_at: '2026-11-01T00:00:00Z',
  last_used_at: null,
  revoked_at: null,
};

const request = (token?: string) =>
  new Request('https://app.ansvisor.com/api/mcp', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
const mcp = (token?: string) =>
  authenticateMcpRequest(request(token), { gateWrites: false, allowOAuth: true });
const CHALLENGE =
  'resource_metadata="https://app.ansvisor.com/.well-known/oauth-protected-resource/api/mcp"';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.ansvisor.com');
  vi.stubEnv('MCP_OAUTH_ENABLED', 'true');
  profile = { organization_id: 'org-1', role: 'manager', brand_scope: 'all' };
  org = { plan: 'growth', subscription_status: 'active' };
  apiKey = { id: 'key-1', user_id: 'user-1', revoked_at: null };
  profileError = null;
  grants.check.mockReset();
  grants.check.mockResolvedValue({ ok: true, grant, scopes: ['mcp:read'] });
  grants.revokeGrant.mockClear();
  grants.touchGrant.mockClear();
  events.logOAuthEvent.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('an app signed in at the MCP endpoint', () => {
  it('acts as the connection’s person, with their role, brands and scopes', async () => {
    expect(await mcp(TOKEN)).toEqual({
      userId: 'user-1',
      email: 'a@example.com',
      organizationId: 'org-1',
      role: 'manager',
      apiKeyId: 'oauth:grant-1',
      brandAccess: 'all',
      via: 'oauth',
      oauthGrantId: 'grant-1',
      oauthScopes: ['mcp:read'],
      oauthAccess: 'ok',
    });
    expect(grants.check).toHaveBeenCalledWith(TOKEN, 'https://app.ansvisor.com/api/mcp');
    expect(grants.touchGrant).toHaveBeenCalledWith(grant);
  });

  it.each([
    ['unknown', 'Invalid access token'],
    ['revoked', 'This connection was disconnected. Connect the app to Ansvisor again.'],
    ['expired', 'The access token expired'],
    ['wrong_resource', 'This access token is for another server'],
  ])('answers a %s token 401 invalid_token with the challenge', async (reason, message) => {
    grants.check.mockResolvedValue({ ok: false, reason });
    const res = (await mcp(TOKEN)) as Response;
    expect(res.status).toBe(401);
    const header = res.headers.get('www-authenticate')!;
    expect(header).toContain('error="invalid_token"');
    expect(header).toContain(CHALLENGE);
    expect(await res.json()).toMatchObject({ error: message });
  });

  it('ends the connection of someone no longer in its organization', async () => {
    profile = { organization_id: 'org-2', role: 'admin', brand_scope: 'all' };
    const res = (await mcp(TOKEN)) as Response;
    expect(res.status).toBe(401);
    expect(grants.revokeGrant).toHaveBeenCalledWith('grant-1', 'member_left');
    expect(events.logOAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'revoked_member_left', grantId: 'grant-1' }),
    );
  });

  it.each([
    ['growth', 'trialing', 'trial'],
    ['starter', 'trialing', 'trial'],
    ['growth', 'canceled', 'ended'],
    ['starter', 'active', 'ok'],
    ['enterprise', 'trialing', 'ok'],
  ])('on %s (%s) says the connection is %s', async (plan, status, access) => {
    org = { plan, subscription_status: status };
    expect(await mcp(TOKEN)).toMatchObject({ oauthAccess: access });
  });

  it('is never held back self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    org = { plan: 'growth', subscription_status: 'canceled' };
    expect(await mcp(TOKEN)).toMatchObject({ oauthAccess: 'ok' });
  });

  it('answers 503 when the token or the access cannot be read', async () => {
    grants.check.mockRejectedValue(new Error('down'));
    expect(((await mcp(TOKEN)) as Response).status).toBe(503);
    grants.check.mockResolvedValue({ ok: true, grant, scopes: ['mcp:read'] });
    profileError = { code: 'XX000', message: 'down' };
    expect(((await mcp(TOKEN)) as Response).status).toBe(503);
  });
});

describe('where an app token is refused', () => {
  it('everywhere while MCP_OAUTH_ENABLED is off, without a challenge', async () => {
    vi.stubEnv('MCP_OAUTH_ENABLED', 'false');
    const res = (await mcp(TOKEN)) as Response;
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect(grants.check).not.toHaveBeenCalled();
  });

  it('on the REST routes, which take API keys only', async () => {
    const res = (await authenticateMcpRequest(request(TOKEN))) as Response;
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'This address takes an API key' });
    expect(grants.check).not.toHaveBeenCalled();
  });

  it('for a refresh token or a code, which only the token endpoint takes', async () => {
    for (const token of ['ans_ort_x', 'ans_oac_x', 'ans_ocs_x']) {
      const res = (await mcp(token)) as Response;
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
    }
    expect(grants.check).not.toHaveBeenCalled();
  });
});

describe('API keys at the MCP endpoint', () => {
  it('work as before, said to be a key', async () => {
    expect(await mcp('ans_key')).toMatchObject({
      apiKeyId: 'key-1',
      via: 'api_key',
      organizationId: 'org-1',
    });
    expect(grants.check).not.toHaveBeenCalled();
  });

  it('answer a missing or bad key 401 with the challenge that starts sign-in', async () => {
    let res = (await mcp()) as Response;
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      `Bearer error_description="Missing or malformed API key", ${CHALLENGE}, scope="mcp:read mcp:write"`,
    );
    expect(await res.json()).toEqual({ error: 'Missing or malformed API key' });

    apiKey = null;
    res = (await mcp('ans_key')) as Response;
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('answer without a challenge while MCP_OAUTH_ENABLED is off, as before', async () => {
    vi.stubEnv('MCP_OAUTH_ENABLED', 'false');
    const res = (await mcp()) as Response;
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect(await res.json()).toEqual({ error: 'Missing or malformed API key' });
  });
});
