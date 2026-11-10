// @vitest-environment node
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
} from '@modelcontextprotocol/sdk/client/auth.js';
import {
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The OAuth endpoints of MCP over OAuth (#2141), on an in-memory database:
 * discovery (RFC 9728, RFC 8414), registration (RFC 7591), the token
 * endpoint's code and refresh grants (OAuth 2.1, PKCE S256, RFC 8707) and
 * revocation (RFC 7009), then the MCP SDK's own client against them. Codes
 * are written as the consent page will write them (PR 4).
 */

const db = vi.hoisted(() => ({
  current: null as ReturnType<
    typeof import('@/lib/mcp-oauth/__fixtures__/fake-db').createFakeDb
  > | null,
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => db.current!.client.from(table),
    rpc: (fn: string, args: Record<string, unknown>) => db.current!.client.rpc(fn, args),
  },
}));

const { createFakeDb } = await import('@/lib/mcp-oauth/__fixtures__/fake-db');
const prm = await import('./protected-resource/route');
const asm = await import('./metadata/route');
const register = await import('./register/route');
const token = await import('./token/route');
const revoke = await import('./revoke/route');
const { checkAccessToken } = await import('@/lib/mcp-oauth/grants');
const { hashSecret } = await import('@/lib/mcp-oauth/tokens');
const { s256Challenge } = await import('@/lib/mcp-oauth/pkce');

const ISSUER = 'https://app.ansvisor.com';
const RESOURCE = `${ISSUER}/api/mcp`;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'v'.repeat(43) + 'erifier-for-the-tests';

/** Routes a request as next.config.ts's rewrites and the app router would. */
async function route(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  const path = new URL(req.url).pathname;
  const method = req.method;
  const pick = (mod: Record<string, unknown>) => {
    const handler = mod[method] as ((req: Request) => Promise<Response> | Response) | undefined;
    return handler ? handler(req) : new Response(null, { status: 405 });
  };
  if (
    path === '/.well-known/oauth-protected-resource/api/mcp' ||
    path === '/.well-known/oauth-protected-resource'
  ) {
    return pick(prm);
  }
  if (path === '/.well-known/oauth-authorization-server') return pick(asm);
  if (path === '/api/oauth/register') return pick(register);
  if (path === '/api/oauth/token') return pick(token);
  if (path === '/api/oauth/revoke') return pick(revoke);
  return new Response(null, { status: 404 });
}

const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  route(`${ISSUER}${path}`, {
    method: 'POST',
    headers: { 'x-forwarded-for': '198.51.100.7', ...headers },
    body,
  });
const form = (path: string, params: Record<string, string>, headers: Record<string, string> = {}) =>
  post(path, new URLSearchParams(params).toString(), {
    'content-type': 'application/x-www-form-urlencoded',
    ...headers,
  });

async function registerPublic(extra: Record<string, unknown> = {}) {
  const res = await post(
    '/api/oauth/register',
    JSON.stringify({
      client_name: 'Claude',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
      ...extra,
    }),
    { 'content-type': 'application/json' },
  );
  return { res, body: (await res.json()) as Record<string, unknown> };
}

/** A code, as an approved consent writes it. */
function approve(clientId: string, overrides: Record<string, unknown> = {}) {
  const code = `ans_oac_${Math.random().toString(36).slice(2)}${'x'.repeat(30)}`;
  db.current!.table('oauth_codes').push({
    code_hash: hashSecret(code),
    client_id: clientId,
    user_id: 'user-1',
    organization_id: 'org-1',
    redirect_uri: REDIRECT,
    code_challenge: s256Challenge(VERIFIER),
    scopes: ['mcp:read', 'mcp:write'],
    resource: RESOURCE,
    client_name: 'Claude',
    redirect_host: 'claude.ai',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 300_000).toISOString(),
    used_at: null,
    grant_id: null,
    ...overrides,
  });
  return code;
}

const redeem = (clientId: string, code: string, extra: Record<string, string> = {}) =>
  form('/api/oauth/token', {
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: REDIRECT,
    code_verifier: VERIFIER,
    resource: RESOURCE,
    ...extra,
  });

beforeEach(() => {
  db.current = createFakeDb();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', ISSUER);
  vi.stubEnv('MCP_OAUTH_ENABLED', 'true');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('while MCP over OAuth is off', () => {
  it('answers 404 everywhere', async () => {
    vi.stubEnv('MCP_OAUTH_ENABLED', 'false');
    for (const path of [
      '/.well-known/oauth-protected-resource/api/mcp',
      '/.well-known/oauth-authorization-server',
    ]) {
      expect((await route(`${ISSUER}${path}`)).status).toBe(404);
    }
    for (const path of ['/api/oauth/register', '/api/oauth/token', '/api/oauth/revoke']) {
      expect((await post(path, '{}')).status).toBe(404);
    }
    expect(db.current!.tables.oauth_clients).toBeUndefined();
  });
});

describe('discovery', () => {
  it('names the MCP endpoint and Ansvisor as its only authorization server', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource/api/mcp',
      '/.well-known/oauth-protected-resource',
    ]) {
      const res = await route(`${ISSUER}${path}`);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      const body = OAuthProtectedResourceMetadataSchema.parse(await res.json());
      expect(body).toMatchObject({
        resource: RESOURCE,
        authorization_servers: [ISSUER],
        scopes_supported: ['mcp:read', 'mcp:write'],
        bearer_methods_supported: ['header'],
      });
    }
  });

  it('says what the authorization server supports: S256, public clients, iss', async () => {
    const res = await route(`${ISSUER}/.well-known/oauth-authorization-server`);
    const body = OAuthMetadataSchema.parse(await res.json());
    expect(body).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/api/oauth/authorize`,
      token_endpoint: `${ISSUER}/api/oauth/token`,
      registration_endpoint: `${ISSUER}/api/oauth/register`,
      revocation_endpoint: `${ISSUER}/api/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
    });
    expect(body.token_endpoint_auth_methods_supported).toContain('none');
    expect((body as Record<string, unknown>).authorization_response_iss_parameter_supported).toBe(
      true,
    );
  });

  it('answers a CORS preflight', async () => {
    const res = await route(`${ISSUER}/api/oauth/token`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
  });
});

describe('registration', () => {
  it('registers a public client, keeps what it said, and logs it', async () => {
    const { res, body } = await registerPublic({ logo_uri: 'https://claude.ai/logo.png' });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body).toMatchObject({
      client_name: 'Claude',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
    expect(body.client_id).toMatch(/^ansc_/);
    expect(body).not.toHaveProperty('client_secret');
    const [row] = db.current!.table('oauth_clients');
    expect(row).toMatchObject({
      client_id: body.client_id,
      client_secret_hash: null,
      metadata: expect.objectContaining({ logo_uri: 'https://claude.ai/logo.png' }),
    });
    expect(db.current!.table('oauth_events')).toEqual([
      expect.objectContaining({ event: 'client_registered', client_id: body.client_id }),
    ]);
  });

  it('gives a confidential client a secret this once, and keeps its hash', async () => {
    const { body } = await registerPublic({ token_endpoint_auth_method: 'client_secret_post' });
    expect(body.client_secret).toMatch(/^ans_ocs_/);
    expect(body.client_secret_expires_at).toBe(0);
    expect(db.current!.table('oauth_clients')[0].client_secret_hash).toBe(
      hashSecret(body.client_secret as string),
    );
  });

  it('keeps a name to one clean line of 100 characters', async () => {
    const { body } = await registerPublic({ client_name: `  Evil‮\nApp ${'x'.repeat(200)}` });
    expect(body.client_name).toMatch(/^Evil App x+$/);
    expect((body.client_name as string).length).toBe(100);
  });

  it.each([
    [{ redirect_uris: ['http://example.com/cb'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['cursor://anysphere.cursor-mcp/oauth/callback'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['https://example.com/cb#x'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: [] }, 'invalid_client_metadata'],
    [{ redirect_uris: Array(6).fill(REDIRECT) }, 'invalid_client_metadata'],
    [{ grant_types: ['implicit'] }, 'invalid_client_metadata'],
    [{ grant_types: ['client_credentials'] }, 'invalid_client_metadata'],
    [{ response_types: ['token'] }, 'invalid_client_metadata'],
    [{ token_endpoint_auth_method: 'private_key_jwt' }, 'invalid_client_metadata'],
  ])('refuses %o with %s', async (extra, error) => {
    const { res, body } = await registerPublic(extra);
    expect(res.status).toBe(400);
    expect(body.error).toBe(error);
    expect(db.current!.table('oauth_clients')).toHaveLength(0);
  });

  it('refuses a body that is not JSON, or too large', async () => {
    expect((await post('/api/oauth/register', 'nope')).status).toBe(400);
    const big = JSON.stringify({ redirect_uris: [REDIRECT], software_id: 'x'.repeat(20_000) });
    expect((await post('/api/oauth/register', big)).status).toBe(400);
  });

  it('limits an address to 30 registrations an hour', async () => {
    for (let i = 0; i < 30; i++) expect((await registerPublic()).res.status).toBe(201);
    const { res, body } = await registerPublic();
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('3600');
    expect(body.error).toBe('temporarily_unavailable');
  });
});

describe('the token endpoint, with a code', () => {
  it('makes the connection and its first tokens, kept only as hashes', async () => {
    const { body: client } = await registerPublic();
    const res = await redeem(client.client_id as string, approve(client.client_id as string));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const tokens = (await res.json()) as Record<string, string | number>;
    expect(tokens).toMatchObject({
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'mcp:read mcp:write',
    });
    expect(tokens.access_token).toMatch(/^ans_oat_/);
    expect(tokens.refresh_token).toMatch(/^ans_ort_/);
    expect(db.current!.table('oauth_grants')).toEqual([
      expect.objectContaining({
        user_id: 'user-1',
        organization_id: 'org-1',
        client_id: client.client_id,
        redirect_host: 'claude.ai',
        resource: RESOURCE,
      }),
    ]);
    expect(JSON.stringify(db.current!.tables)).not.toContain(tokens.access_token as string);
    // The MCP endpoint takes it.
    expect(await checkAccessToken(tokens.access_token as string, RESOURCE)).toMatchObject({
      ok: true,
      scopes: ['mcp:read', 'mcp:write'],
    });
    expect(db.current!.table('oauth_clients')[0].last_used_at).not.toBeNull();
  });

  it('works for a code with no resource named (an older client)', async () => {
    const { body: client } = await registerPublic();
    const res = await redeem(client.client_id as string, approve(client.client_id as string), {
      resource: '',
    });
    expect(res.status).toBe(200);
  });

  it.each([
    ['another verifier', { code_verifier: 'w'.repeat(43) }, 'invalid_grant'],
    ['another redirect_uri', { redirect_uri: 'https://claude.ai/other' }, 'invalid_grant'],
    ['another resource', { resource: 'https://evil.example/api/mcp' }, 'invalid_target'],
    ['no verifier', { code_verifier: '' }, 'invalid_request'],
  ])('refuses %s', async (_label, extra, error) => {
    const { body: client } = await registerPublic();
    const res = await redeem(
      client.client_id as string,
      approve(client.client_id as string),
      extra,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(error);
    expect(db.current!.table('oauth_grants')).toHaveLength(0);
  });

  it("refuses an expired code, and another client's", async () => {
    const { body: a } = await registerPublic();
    const { body: b } = await registerPublic();
    const expired = approve(a.client_id as string, {
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect((await redeem(a.client_id as string, expired)).status).toBe(400);
    expect((await redeem(b.client_id as string, approve(a.client_id as string))).status).toBe(400);
    expect(db.current!.table('oauth_grants')).toHaveLength(0);
  });

  it('ends the connection when its code is used again', async () => {
    const { body: client } = await registerPublic();
    const code = approve(client.client_id as string);
    expect((await redeem(client.client_id as string, code)).status).toBe(200);
    const again = await redeem(client.client_id as string, code);
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toBe('invalid_grant');
    expect(db.current!.table('oauth_grants')[0]).toMatchObject({ revoked_reason: 'code_reuse' });
    expect(db.current!.table('oauth_tokens').every((row) => row.revoked_at)).toBe(true);
    expect(db.current!.table('oauth_events').map((row) => row.event)).toContain('code_reuse');
  });

  it('refuses a JSON body, an unknown client and an unknown grant type', async () => {
    const { body: client } = await registerPublic();
    const json = await post(
      '/api/oauth/token',
      JSON.stringify({ grant_type: 'authorization_code' }),
      {
        'content-type': 'application/json',
      },
    );
    expect(((await json.json()) as { error: string }).error).toBe('invalid_request');
    const unknown = await redeem('ansc_nobody', approve(client.client_id as string));
    expect(unknown.status).toBe(401);
    expect(((await unknown.json()) as { error: string }).error).toBe('invalid_client');
    const implicit = await form('/api/oauth/token', {
      grant_type: 'client_credentials',
      client_id: client.client_id as string,
    });
    expect(((await implicit.json()) as { error: string }).error).toBe('unsupported_grant_type');
  });

  it('checks a confidential client’s secret, in the body or by Basic', async () => {
    const { body: client } = await registerPublic({
      token_endpoint_auth_method: 'client_secret_basic',
    });
    const id = client.client_id as string;
    const secret = client.client_secret as string;
    const wrong = await redeem(id, approve(id), { client_secret: 'ans_ocs_wrong' });
    expect(wrong.status).toBe(401);
    const missing = await redeem(id, approve(id));
    expect(missing.status).toBe(401);
    const basic = Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString(
      'base64',
    );
    const ok = await form(
      '/api/oauth/token',
      {
        grant_type: 'authorization_code',
        code: approve(id),
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
      },
      { authorization: `Basic ${basic}` },
    );
    expect(ok.status).toBe(200);
  });
});

describe('the token endpoint, with a refresh token', () => {
  async function connected(scopes = ['mcp:read', 'mcp:write']) {
    const { body: client } = await registerPublic();
    const id = client.client_id as string;
    const res = await redeem(id, approve(id, { scopes }));
    return { id, tokens: (await res.json()) as Record<string, string> };
  }
  const refresh = (id: string, refreshToken: string, extra: Record<string, string> = {}) =>
    form('/api/oauth/token', {
      grant_type: 'refresh_token',
      client_id: id,
      refresh_token: refreshToken,
      ...extra,
    });

  it('swaps it for a new pair once', async () => {
    const { id, tokens } = await connected();
    const res = await refresh(id, tokens.refresh_token);
    expect(res.status).toBe(200);
    const next = (await res.json()) as Record<string, string>;
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(await checkAccessToken(next.access_token, RESOURCE)).toMatchObject({ ok: true });
    const old = db
      .current!.table('oauth_tokens')
      .find((row) => row.token_hash === hashSecret(tokens.refresh_token));
    expect(old?.rotated_at).not.toBeNull();
  });

  it('refuses a token swapped moments ago, keeping the connection (two refreshes racing)', async () => {
    const { id, tokens } = await connected();
    await refresh(id, tokens.refresh_token);
    const again = await refresh(id, tokens.refresh_token);
    expect(((await again.json()) as { error: string }).error).toBe('invalid_grant');
    expect(db.current!.table('oauth_grants')[0].revoked_at).toBeNull();
  });

  it('ends the connection when a token swapped a while ago comes back (a replay)', async () => {
    const { id, tokens } = await connected();
    await refresh(id, tokens.refresh_token);
    const old = db
      .current!.table('oauth_tokens')
      .find((row) => row.token_hash === hashSecret(tokens.refresh_token))!;
    old.rotated_at = new Date(Date.now() - 60_000).toISOString();
    const again = await refresh(id, tokens.refresh_token);
    expect(again.status).toBe(400);
    expect(db.current!.table('oauth_grants')[0]).toMatchObject({ revoked_reason: 'refresh_reuse' });
    expect(db.current!.table('oauth_events').map((row) => row.event)).toContain('refresh_reuse');
  });

  it('keeps or narrows the scopes, never widens them', async () => {
    const { id, tokens } = await connected();
    const narrowed = (await (
      await refresh(id, tokens.refresh_token, { scope: 'mcp:read' })
    ).json()) as Record<string, string>;
    expect(narrowed.scope).toBe('mcp:read');
    const wider = await refresh(id, narrowed.refresh_token, { scope: 'mcp:read mcp:write' });
    expect(((await wider.json()) as { error: string }).error).toBe('invalid_scope');
  });

  it("refuses another client's token, an expired one and one whose connection ended", async () => {
    const { id, tokens } = await connected();
    const { body: other } = await registerPublic();
    expect((await refresh(other.client_id as string, tokens.refresh_token)).status).toBe(400);

    const row = db
      .current!.table('oauth_tokens')
      .find((r) => r.token_hash === hashSecret(tokens.refresh_token))!;
    row.expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await refresh(id, tokens.refresh_token)).status).toBe(400);

    row.expires_at = new Date(Date.now() + 60_000).toISOString();
    db.current!.table('oauth_grants')[0].revoked_at = new Date().toISOString();
    expect((await refresh(id, tokens.refresh_token)).status).toBe(400);
  });
});

describe('revocation', () => {
  it('ends the connection, its access token included, and logs it', async () => {
    const { body: client } = await registerPublic();
    const id = client.client_id as string;
    const tokens = (await (await redeem(id, approve(id))).json()) as Record<string, string>;
    const res = await form('/api/oauth/revoke', { client_id: id, token: tokens.refresh_token });
    expect(res.status).toBe(200);
    expect(db.current!.table('oauth_grants')[0]).toMatchObject({ revoked_reason: 'client' });
    expect(await checkAccessToken(tokens.access_token, RESOURCE)).toEqual({
      ok: false,
      reason: 'revoked',
    });
    expect(db.current!.table('oauth_events').map((row) => row.event)).toContain(
      'revoked_by_client',
    );
  });

  it("answers 200 for an unknown token, and refuses another client's", async () => {
    const { body: a } = await registerPublic();
    const { body: b } = await registerPublic();
    const tokens = (await (
      await redeem(a.client_id as string, approve(a.client_id as string))
    ).json()) as Record<string, string>;
    expect(
      (await form('/api/oauth/revoke', { client_id: a.client_id as string, token: 'ans_oat_nope' }))
        .status,
    ).toBe(200);
    const other = await form('/api/oauth/revoke', {
      client_id: b.client_id as string,
      token: tokens.access_token,
    });
    expect(other.status).toBe(400);
    expect(db.current!.table('oauth_grants')[0].revoked_at).toBeNull();
  });
});

describe("the MCP SDK's own client", () => {
  it('discovers, registers, redeems a code and refreshes', async () => {
    const fetchFn = route as typeof fetch;
    const resource = await discoverOAuthProtectedResourceMetadata(RESOURCE, {}, fetchFn);
    expect(resource.resource).toBe(RESOURCE);
    const metadata = await discoverAuthorizationServerMetadata(resource.authorization_servers![0], {
      fetchFn,
    });
    expect(metadata?.issuer).toBe(ISSUER);
    const client = await registerClient(ISSUER, {
      metadata,
      clientMetadata: {
        client_name: 'Claude',
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
      fetchFn,
    });
    const tokens = await exchangeAuthorization(ISSUER, {
      metadata,
      clientInformation: client,
      authorizationCode: approve(client.client_id),
      codeVerifier: VERIFIER,
      redirectUri: REDIRECT,
      resource: new URL(RESOURCE),
      fetchFn,
    });
    expect(tokens.access_token).toMatch(/^ans_oat_/);
    const refreshed = await refreshAuthorization(ISSUER, {
      metadata,
      clientInformation: client,
      refreshToken: tokens.refresh_token!,
      resource: new URL(RESOURCE),
      fetchFn,
    });
    expect(refreshed.access_token).not.toBe(tokens.access_token);
    expect(await checkAccessToken(refreshed.access_token, RESOURCE)).toMatchObject({ ok: true });
  });
});
