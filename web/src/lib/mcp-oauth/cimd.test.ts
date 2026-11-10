// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Client ID Metadata Documents (MCP over OAuth, #2141): an app named by an
 * https URL is fetched safely, checked (client_id equal to the URL, its
 * redirect URIs, a public client), cached by its Cache-Control, and named
 * on the consent page by its URL's host. Then it connects like any app.
 */

type FakeDb = ReturnType<typeof import('./__fixtures__/fake-db').createFakeDb>;
const db = vi.hoisted(() => ({ current: null as FakeDb | null }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => db.current!.client.from(table),
    rpc: (fn: string, args: Record<string, unknown>) => db.current!.client.rpc(fn, args),
  },
}));
const fetched = vi.hoisted(() => ({
  body: null as unknown,
  maxAge: null as number | null,
  error: null as Error | null,
  calls: 0,
}));
vi.mock('./safe-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./safe-fetch')>();
  return {
    ...actual,
    fetchPublicJson: async () => {
      fetched.calls++;
      if (fetched.error) throw fetched.error;
      return { body: fetched.body, maxAge: fetched.maxAge };
    },
  };
});

const { createFakeDb } = await import('./__fixtures__/fake-db');
const { isClientIdUrl, readClientDocument, resolveCimdClient } = await import('./cimd');
const safeFetch = await vi.importActual<typeof import('./safe-fetch')>('./safe-fetch');
const authorize = await import('@/app/api/oauth/authorize/route');
const metadata = await import('@/app/api/oauth/metadata/route');
const { appOf } = await import('./consent');
const { s256Challenge } = await import('./pkce');

const ISSUER = 'https://app.ansvisor.com';
const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata';
/** Claude Code's document, as Claude's connector docs describe it. */
const claudeCode = {
  client_id: CLAUDE_CODE,
  client_name: 'Claude Code',
  redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
};

beforeEach(() => {
  db.current = createFakeDb();
  fetched.body = claudeCode;
  fetched.maxAge = null;
  fetched.error = null;
  fetched.calls = 0;
  vi.stubEnv('NEXT_PUBLIC_APP_URL', ISSUER);
  vi.stubEnv('MCP_OAUTH_ENABLED', 'true');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('a client id that is a document URL', () => {
  it.each([
    [CLAUDE_CODE, true],
    ['https://chatgpt.com/oauth/client.json', true],
    ['ansc_abc', false],
    ['http://claude.ai/oauth/x', false],
    ['https://claude.ai/', false],
    ['https://claude.ai', false],
    ['https://claude.ai/x?y=1', false],
    ['https://claude.ai/x#y', false],
    ['https://user:pw@claude.ai/x', false],
    ['https://claude.ai:8443/x', false],
    ['https://claude.ai/a/../b', false],
    ['https://claude.ai/a/./b', false],
    // An IP host connects without the DNS lookup that checks addresses.
    ['https://10.0.0.1/x', false],
    ['https://169.254.169.254/x', false],
    ['https://[fd00::1]/x', false],
    ['https://2130706433/x', false],
    ['https://8.8.8.8/x', false],
  ])('%s is one: %s', (value, ok) => {
    expect(isClientIdUrl(value)).toBe(ok);
  });
});

describe('the document', () => {
  it('takes a public client whose client_id is its URL', () => {
    expect(readClientDocument(CLAUDE_CODE, claudeCode)).toEqual({
      ok: true,
      document: {
        clientName: 'Claude Code',
        redirectUris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
        metadata: {},
      },
    });
  });

  it.each([
    [{ ...claudeCode, client_id: `${CLAUDE_CODE}/` }, 'client_id_mismatch'],
    [{ ...claudeCode, client_id: undefined }, 'client_id_mismatch'],
    [{ ...claudeCode, redirect_uris: ['http://evil.example/cb'] }, 'redirect_uris'],
    [{ ...claudeCode, redirect_uris: ['myapp://cb'] }, 'redirect_uris'],
    [{ ...claudeCode, redirect_uris: [] }, 'redirect_uris'],
    [{ ...claudeCode, token_endpoint_auth_method: 'private_key_jwt' }, 'auth_method'],
    [{ ...claudeCode, grant_types: ['client_credentials'] }, 'grant_types'],
    [{ ...claudeCode, response_types: ['token'] }, 'response_types'],
    [[claudeCode], 'not_an_object'],
  ])('refuses %o (%s)', (body, problem) => {
    expect(readClientDocument(CLAUDE_CODE, body)).toEqual({ ok: false, problem });
  });
});

describe('resolveCimdClient', () => {
  it('fetches, keeps it as a public cimd client, and uses the cache while it is fresh', async () => {
    fetched.maxAge = 600;
    const client = await resolveCimdClient(CLAUDE_CODE);
    expect(client).toMatchObject({
      client_id: CLAUDE_CODE,
      kind: 'cimd',
      client_name: 'Claude Code',
      token_endpoint_auth_method: 'none',
    });
    const [row] = db.current!.table('oauth_clients');
    expect(row).toMatchObject({ client_id: CLAUDE_CODE, kind: 'cimd', client_secret_hash: null });
    const minutes = (Date.parse(row.metadata_expires_at as string) - Date.now()) / 60_000;
    expect(Math.round(minutes)).toBe(10);
    await resolveCimdClient(CLAUDE_CODE);
    expect(fetched.calls).toBe(1);
  });

  it('keeps a document five minutes at least and a day at most', async () => {
    fetched.maxAge = 0;
    await resolveCimdClient(CLAUDE_CODE);
    const short = db.current!.table('oauth_clients')[0];
    expect(
      Math.round((Date.parse(short.metadata_expires_at as string) - Date.now()) / 60_000),
    ).toBe(5);
    db.current = createFakeDb();
    fetched.maxAge = 7 * 86_400;
    await resolveCimdClient(CLAUDE_CODE);
    const long = db.current!.table('oauth_clients')[0];
    expect(
      Math.round((Date.parse(long.metadata_expires_at as string) - Date.now()) / 3_600_000),
    ).toBe(24);
  });

  it('fetches again once the cache has expired, updating the client', async () => {
    await resolveCimdClient(CLAUDE_CODE);
    db.current!.table('oauth_clients')[0].metadata_expires_at = new Date(
      Date.now() - 1000,
    ).toISOString();
    fetched.body = { ...claudeCode, client_name: 'Claude Code 2' };
    expect(await resolveCimdClient(CLAUDE_CODE)).toMatchObject({ client_name: 'Claude Code 2' });
    expect(db.current!.table('oauth_clients')).toHaveLength(1);
    expect(fetched.calls).toBe(2);
  });

  it('knows no client when the document cannot be fetched or checked', async () => {
    fetched.error = new safeFetch.SafeFetchError('blocked', 'private');
    expect(await resolveCimdClient(CLAUDE_CODE)).toBeNull();
    fetched.error = null;
    fetched.body = { ...claudeCode, client_id: 'https://claude.ai/other' };
    expect(await resolveCimdClient(CLAUDE_CODE)).toBeNull();
    expect(db.current!.table('oauth_clients')).toHaveLength(0);
    expect(await resolveCimdClient('ansc_x')).toBeNull();
  });
});

describe('fetching a document safely', () => {
  const get =
    (status: number, body: string, headers: Record<string, string> = {}) =>
    async () => ({
      status,
      headers: { 'content-type': 'application/json', ...headers },
      body: Buffer.from(body),
    });

  it('reads JSON and its max-age', async () => {
    expect(
      await safeFetch.fetchPublicJson(
        CLAUDE_CODE,
        get(200, '{"a":1}', { 'cache-control': 'public, max-age=3600' }),
      ),
    ).toEqual({ body: { a: 1 }, maxAge: 3600 });
  });

  it.each([
    ['http://claude.ai/x', get(200, '{}'), 'invalid_url'],
    ['https://claude.ai:444/x', get(200, '{}'), 'invalid_url'],
    [CLAUDE_CODE, get(302, ''), 'redirect'],
    [CLAUDE_CODE, get(404, ''), 'http_error'],
    [CLAUDE_CODE, get(200, '<html>', { 'content-type': 'text/html' }), 'not_json'],
    [CLAUDE_CODE, get(200, '{nope'), 'not_json'],
    [CLAUDE_CODE, get(200, `{"a":"${'x'.repeat(11_000)}"}`), 'too_large'],
  ])('refuses %s (%s)', async (url, response, code) => {
    await expect(safeFetch.fetchPublicJson(url, response)).rejects.toMatchObject({ code });
  });

  it.each([
    ['93.184.216.34', true],
    ['2606:2800:220:1:248:1893:25c8:1946', true],
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.16.0.1', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['::1', false],
    ['::ffff:127.0.0.1', false],
    ['fd00::1', false],
    ['fe80::1', false],
    ['not an ip', false],
  ])('%s is a public address: %s', (address, ok) => {
    expect(safeFetch.isPublicAddress(address)).toBe(ok);
  });

  it('refuses a name that resolves to any private address, in the lookup the connection uses', async () => {
    const lookup = (addresses: string[]) =>
      safeFetch.publicOnlyLookup((_host, _options, done) =>
        done(
          null,
          addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
        ),
      );
    const run = (addresses: string[]) =>
      new Promise<unknown>((resolve) =>
        lookup(addresses)('claude.ai', {}, (err, address) => resolve(err ?? address)),
      );
    expect(await run(['93.184.216.34'])).toBe('93.184.216.34');
    expect(await run(['93.184.216.34', '10.0.0.5'])).toMatchObject({ code: 'blocked' });
    expect(await run([])).toMatchObject({ code: 'blocked' });
  });
});

describe('an app named by its document', () => {
  it('is advertised in the authorization server metadata', async () => {
    const body = (await (metadata.GET() as Response).json()) as Record<string, unknown>;
    expect(body.client_id_metadata_document_supported).toBe(true);
    expect(body.token_endpoint_auth_methods_supported).toContain('none');
  });

  it('asks to connect without registering, with a loopback redirect on any port', async () => {
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: CLAUDE_CODE,
      redirect_uri: 'http://localhost:3118/callback',
      code_challenge: s256Challenge('v'.repeat(64)),
      code_challenge_method: 'S256',
      state: 's',
    });
    const res = await authorize.GET(new Request(`${ISSUER}/api/oauth/authorize?${query}`));
    expect(new URL(res.headers.get('location')!).searchParams.get('request')).toBeTruthy();
    expect(db.current!.table('oauth_authorization_requests')[0]).toMatchObject({
      client_id: CLAUDE_CODE,
      redirect_uri: 'http://localhost:3118/callback',
    });
  });

  it('ends on Ansvisor’s page when its document refuses the redirect URI or cannot be read', async () => {
    const query = (redirect: string) =>
      new URLSearchParams({
        response_type: 'code',
        client_id: CLAUDE_CODE,
        redirect_uri: redirect,
        code_challenge: s256Challenge('v'.repeat(64)),
        code_challenge_method: 'S256',
      });
    const evil = await authorize.GET(
      new Request(`${ISSUER}/api/oauth/authorize?${query('https://evil.example/cb')}`),
    );
    expect(new URL(evil.headers.get('location')!).searchParams.get('error')).toBe(
      'invalid_redirect_uri',
    );
    db.current = createFakeDb();
    fetched.error = new safeFetch.SafeFetchError('timeout', 'slow');
    const down = await authorize.GET(
      new Request(`${ISSUER}/api/oauth/authorize?${query('http://localhost:1/callback')}`),
    );
    expect(new URL(down.headers.get('location')!).searchParams.get('error')).toBe('unknown_client');
  });

  it('is named on the consent page by its URL’s host, not the name it gives itself', () => {
    expect(
      appOf('Totally Not Evil', 'http://127.0.0.1:5000/cb', {
        kind: 'cimd',
        clientId: 'https://tools.example.com/oauth/client.json',
      }),
    ).toEqual({ name: 'tools.example.com', host: '127.0.0.1', recognised: false, loopback: true });
    expect(
      appOf('Claude Code', 'http://localhost:3118/callback', {
        kind: 'cimd',
        clientId: CLAUDE_CODE,
      }),
    ).toEqual({ name: 'Claude', host: 'localhost', recognised: true, loopback: true });
  });
});
