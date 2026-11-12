// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The authorization endpoint (MCP over OAuth, #2141): a request whose client
 * or redirect URI doesn't check out ends on Ansvisor's own page, never at
 * the address it names; after that, errors go back to the app with state
 * and iss; a good request is kept and the person goes on to the consent
 * page with its id alone.
 */

type FakeDb = ReturnType<typeof import('@/lib/mcp-oauth/__fixtures__/fake-db').createFakeDb>;
const db = vi.hoisted(() => ({ current: null as FakeDb | null }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => db.current!.client.from(table),
    rpc: (fn: string, args: Record<string, unknown>) => db.current!.client.rpc(fn, args),
  },
}));

const { createFakeDb } = await import('@/lib/mcp-oauth/__fixtures__/fake-db');
const { GET } = await import('./route');
const { s256Challenge } = await import('@/lib/mcp-oauth/pkce');

const ISSUER = 'https://app.ansvisor.com';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const CHALLENGE = s256Challenge('v'.repeat(64));

function addClient(redirectUris = [REDIRECT]) {
  db.current!.table('oauth_clients').push({
    client_id: 'ansc_claude',
    client_name: 'Claude',
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    client_secret_hash: null,
  });
}

function authorize(params: Record<string, string | undefined>) {
  const query = new URLSearchParams(
    Object.entries({
      response_type: 'code',
      client_id: 'ansc_claude',
      redirect_uri: REDIRECT,
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      scope: 'mcp:read mcp:write',
      state: 'xyz',
      resource: `${ISSUER}/api/mcp`,
      ...params,
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return GET(
    new Request(`${ISSUER}/api/oauth/authorize?${query}`, {
      headers: { 'x-forwarded-for': '198.51.100.9' },
    }),
  );
}

const location = (res: Response) => new URL(res.headers.get('location')!);

beforeEach(() => {
  db.current = createFakeDb();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', ISSUER);
  // App sign-in is on by default (MCP_OAUTH_ENABLED unset), with an https issuer.
  vi.stubEnv('MCP_OAUTH_ENABLED', undefined);
  addClient();
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/oauth/authorize', () => {
  it('keeps a good request and sends the person on with its id alone', async () => {
    const res = await authorize({});
    expect(res.status).toBe(303);
    const to = location(res);
    expect(`${to.origin}${to.pathname}`).toBe(`${ISSUER}/oauth/consent`);
    expect([...to.searchParams.keys()]).toEqual(['request']);
    const [row] = db.current!.table('oauth_authorization_requests');
    expect(row).toMatchObject({
      id: to.searchParams.get('request'),
      client_id: 'ansc_claude',
      redirect_uri: REDIRECT,
      code_challenge: CHALLENGE,
      scopes: ['mcp:read', 'mcp:write'],
      state: 'xyz',
      resource: `${ISSUER}/api/mcp`,
    });
    const minutes = (Date.parse(row.expires_at as string) - Date.now()) / 60_000;
    expect(Math.round(minutes)).toBe(10);
  });

  it("takes the client's only redirect URI when none is named, and a loopback one on any port", async () => {
    expect(location(await authorize({ redirect_uri: undefined })).pathname).toBe('/oauth/consent');
    db.current = createFakeDb();
    addClient(['http://127.0.0.1/callback', 'http://localhost/callback']);
    const res = await authorize({ redirect_uri: 'http://localhost:61123/callback' });
    expect(location(res).searchParams.get('request')).toBeTruthy();
    // Several registered: one must be named.
    const none = await authorize({ redirect_uri: undefined });
    expect(location(none).searchParams.get('error')).toBe('invalid_redirect_uri');
  });

  it.each([
    [{ client_id: 'ansc_nobody' }, 'unknown_client'],
    [{ client_id: undefined }, 'unknown_client'],
    [{ redirect_uri: 'https://evil.example/cb' }, 'invalid_redirect_uri'],
    [{ redirect_uri: 'https://claude.ai/api/mcp/auth_callback/x' }, 'invalid_redirect_uri'],
  ])('ends %o on its own page with %s, never redirecting', async (params, code) => {
    const res = await authorize(params);
    const to = location(res);
    expect(to.origin).toBe(ISSUER);
    expect(to.pathname).toBe('/oauth/consent');
    expect(to.searchParams.get('error')).toBe(code);
    expect(db.current!.table('oauth_authorization_requests')).toHaveLength(0);
  });

  it.each([
    [{ response_type: 'token' }, 'unsupported_response_type'],
    [{ code_challenge: undefined }, 'invalid_request'],
    [{ code_challenge_method: 'plain' }, 'invalid_request'],
    [{ code_challenge: 'short' }, 'invalid_request'],
    [{ resource: 'https://evil.example/api/mcp' }, 'invalid_target'],
  ])('sends %o back to the app as %s, with state and iss', async (params, error) => {
    const to = location(await authorize(params));
    expect(`${to.origin}${to.pathname}`).toBe(REDIRECT);
    expect(to.searchParams.get('error')).toBe(error);
    expect(to.searchParams.get('state')).toBe('xyz');
    expect(to.searchParams.get('iss')).toBe(ISSUER);
    expect(db.current!.table('oauth_authorization_requests')).toHaveLength(0);
  });

  it('asks for both scopes when the app names none, and reading alone when it asks for that', async () => {
    await authorize({ scope: undefined });
    await authorize({ scope: 'mcp:read' });
    expect(db.current!.table('oauth_authorization_requests').map((row) => row.scopes)).toEqual([
      ['mcp:read', 'mcp:write'],
      ['mcp:read'],
    ]);
  });

  it('limits an address to 60 requests in ten minutes', async () => {
    for (let i = 0; i < 60; i++) await authorize({});
    expect(location(await authorize({})).searchParams.get('error')).toBe('rate_limited');
  });

  it('answers 404 while MCP over OAuth is off', async () => {
    vi.stubEnv('MCP_OAUTH_ENABLED', 'false');
    expect((await authorize({})).status).toBe(404);
  });
});
