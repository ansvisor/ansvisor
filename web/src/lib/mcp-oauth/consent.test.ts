// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The consent page's state and its answers (MCP over OAuth, #2141): the
 * request is the first signed-in person's; a known app is named by where
 * its code goes; the plan decides whether Allow shows (every paid plan, not
 * the trial, not an ended plan, always self-hosted); Allow writes a
 * one-time code the token endpoint redeems; Cancel tells the app no.
 */

type FakeDb = ReturnType<typeof import('./__fixtures__/fake-db').createFakeDb>;
const db = vi.hoisted(() => ({ current: null as FakeDb | null }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => db.current!.client.from(table),
    rpc: (fn: string, args: Record<string, unknown>) => db.current!.client.rpc(fn, args),
  },
}));
const session = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  signOut: vi.fn(async () => ({ error: null })),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: session.user } }),
      signOut: session.signOut,
    },
  }),
}));
class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));

const { createFakeDb } = await import('./__fixtures__/fake-db');
const { appForSignIn, appOf, loadConsent } = await import('./consent');
const { approveConnection, denyConnection, switchAccount } = await import('./consent-actions');
const token = await import('@/app/api/oauth/token/route');
const { checkAccessToken, hashSecret } = await Promise.all([
  import('./grants'),
  import('./tokens'),
]).then(([grants, tokens]) => ({ ...grants, ...tokens }));
const { s256Challenge } = await import('./pkce');

const ISSUER = 'https://app.ansvisor.com';
const RESOURCE = `${ISSUER}/api/mcp`;
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const LOOPBACK = 'http://127.0.0.1:61123/callback';
const VERIFIER = 'v'.repeat(64);
const CIHAN = { id: 'user-1', email: 'cihan@acme.com' };
const AYSE = { id: 'user-2', email: 'ayse@acme.com' };

function seed({ plan = 'growth', status = 'active' } = {}) {
  db.current!.table('oauth_clients').push(
    {
      client_id: 'ansc_claude',
      client_name: 'Totally Claude',
      redirect_uris: [CLAUDE],
      token_endpoint_auth_method: 'none',
      client_secret_hash: null,
    },
    {
      client_id: 'ansc_agent',
      client_name: 'MyAgent',
      redirect_uris: ['http://127.0.0.1/callback'],
      token_endpoint_auth_method: 'none',
      client_secret_hash: null,
    },
  );
  db.current!.table('organizations').push({
    id: 'org-1',
    name: 'Acme Inc.',
    plan,
    subscription_status: status,
    plan_overrides: null,
  });
  db.current!.table('profiles').push(
    { id: CIHAN.id, organization_id: 'org-1', role: 'admin', brand_scope: 'all' },
    { id: AYSE.id, organization_id: 'org-1', role: 'analyst', brand_scope: 'selected' },
  );
  db.current!.table('brands').push(
    { id: 'b1', name: 'Acme Shoes', organization_id: 'org-1', is_demo: false },
    { id: 'b2', name: 'Acme Kids', organization_id: 'org-1', is_demo: false },
    { id: 'b3', name: 'Acme Pro', organization_id: 'org-1', is_demo: false },
    { id: 'b4', name: 'Demo brand', organization_id: 'org-1', is_demo: true },
  );
  db.current!.table('member_brands').push(
    { user_id: AYSE.id, organization_id: 'org-1', brand_id: 'b1' },
    { user_id: AYSE.id, organization_id: 'org-1', brand_id: 'b2' },
  );
}

function request(client = 'ansc_claude', overrides: Record<string, unknown> = {}) {
  const row = {
    id: crypto.randomUUID(),
    client_id: client,
    redirect_uri: client === 'ansc_claude' ? CLAUDE : LOOPBACK,
    code_challenge: s256Challenge(VERIFIER),
    scopes: ['mcp:read', 'mcp:write'],
    state: 'st-1',
    resource: RESOURCE,
    user_id: null,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    ...overrides,
  };
  db.current!.table('oauth_authorization_requests').push(row);
  return row.id as string;
}

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

async function redirected(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    if (err instanceof Redirect) return err.to;
    throw err;
  }
  throw new Error('expected a redirect');
}

beforeEach(() => {
  db.current = createFakeDb();
  session.user = null;
  session.signOut.mockClear();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', ISSUER);
  // App sign-in is on by default (MCP_OAUTH_ENABLED unset), with an https issuer.
  vi.stubEnv('MCP_OAUTH_ENABLED', undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe('loadConsent', () => {
  it('shows a known app by where its code goes, and the person’s workspace and brands', async () => {
    seed();
    const id = request();
    const state = await loadConsent(id, CIHAN);
    expect(state).toEqual({
      kind: 'ready',
      view: {
        requestId: id,
        // The name it registered is not what the page shows.
        app: { name: 'Claude', host: 'claude.ai', recognised: true, loopback: false },
        email: 'cihan@acme.com',
        role: 'admin',
        isAdmin: true,
        workspace: { name: 'Acme Inc.', planName: 'Growth' },
        brands: { all: true, count: 4 },
        access: 'ok',
        scopes: ['mcp:read', 'mcp:write'],
        writesNeedGrowth: false,
      },
    });
  });

  it('shows an unchecked app by its own name, and the brands shared with a Selected-brands person', async () => {
    seed({ plan: 'starter', status: 'active' });
    const state = await loadConsent(request('ansc_agent'), AYSE);
    expect(state).toMatchObject({
      kind: 'ready',
      view: {
        app: { name: 'MyAgent', host: '127.0.0.1', recognised: false, loopback: true },
        role: 'analyst',
        isAdmin: false,
        workspace: { name: 'Acme Inc.', planName: 'Starter' },
        brands: { all: false, names: ['Acme Shoes', 'Acme Kids', 'Demo brand'] },
        access: 'ok',
        writesNeedGrowth: true,
      },
    });
  });

  it.each([
    ['growth', 'trialing', 'trial'],
    ['growth', 'canceled', 'ended'],
    ['enterprise', 'trialing', 'ok'],
  ])('on %s (%s) the plan says %s', async (plan, status, access) => {
    seed({ plan, status });
    expect(await loadConsent(request(), CIHAN)).toMatchObject({ view: { access } });
  });

  it('lets a self-hosted install connect whatever its row says', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    seed({ plan: 'growth', status: 'canceled' });
    expect(await loadConsent(request(), CIHAN)).toMatchObject({ view: { access: 'ok' } });
  });

  it('says when the person has no workspace yet', async () => {
    seed();
    db.current!.table('profiles').push({ id: 'user-3', organization_id: null, role: null });
    expect(await loadConsent(request(), { id: 'user-3', email: 'n@x.com' })).toMatchObject({
      view: { access: 'no_workspace', workspace: null, brands: null },
    });
  });

  it('sends a signed-out person to sign in, and refuses a bad, unknown or expired request', async () => {
    seed();
    const id = request();
    expect(await loadConsent(id, null)).toEqual({ kind: 'sign_in', requestId: id });
    expect(await loadConsent('not-a-uuid', CIHAN)).toEqual({
      kind: 'error',
      code: 'invalid_request',
    });
    expect(await loadConsent(crypto.randomUUID(), CIHAN)).toEqual({
      kind: 'error',
      code: 'expired',
    });
    const old = request('ansc_claude', { expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(await loadConsent(old, CIHAN)).toEqual({ kind: 'error', code: 'expired' });
  });

  it('keeps a request for the first person who opened it', async () => {
    seed();
    const id = request();
    expect((await loadConsent(id, CIHAN)).kind).toBe('ready');
    expect(await loadConsent(id, AYSE)).toEqual({ kind: 'error', code: 'other_person' });
    expect((await loadConsent(id, CIHAN)).kind).toBe('ready');
  });
});

describe('appForSignIn', () => {
  it('names the app when the sign-in leads to its consent page, and nothing otherwise', async () => {
    seed();
    const id = request('ansc_agent');
    expect(await appForSignIn(`/oauth/consent?request=${id}`)).toMatchObject({
      name: 'MyAgent',
      recognised: false,
    });
    expect(await appForSignIn('/dashboard')).toBeNull();
    expect(await appForSignIn(`https://evil.example/oauth/consent?request=${id}`)).toBeNull();
    expect(await appForSignIn(undefined)).toBeNull();
    expect(appOf(null, 'https://chatgpt.com/connector_platform_oauth_redirect').name).toBe(
      'ChatGPT',
    );
  });
});

describe('Allow', () => {
  it('sends the app a one-time code the token endpoint redeems', async () => {
    seed();
    session.user = CIHAN;
    const id = request();
    const to = new URL(
      await redirected(() => approveConnection(form({ request: id, allow_changes: 'on' }))),
    );
    expect(`${to.origin}${to.pathname}`).toBe(CLAUDE);
    expect(to.searchParams.get('state')).toBe('st-1');
    expect(to.searchParams.get('iss')).toBe(ISSUER);
    const code = to.searchParams.get('code')!;
    expect(code).toMatch(/^ans_oac_/);

    const [row] = db.current!.table('oauth_codes');
    expect(row).toMatchObject({
      code_hash: hashSecret(code),
      client_id: 'ansc_claude',
      user_id: CIHAN.id,
      organization_id: 'org-1',
      redirect_uri: CLAUDE,
      scopes: ['mcp:read', 'mcp:write'],
      client_name: 'Claude',
      redirect_host: 'claude.ai',
    });
    expect(db.current!.table('oauth_authorization_requests')).toHaveLength(0);
    expect(db.current!.table('oauth_events').map((e) => e.event)).toEqual(['consent_granted']);

    const res = await token.POST(
      new Request(`${ISSUER}/api/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: 'ansc_claude',
          code,
          redirect_uri: CLAUDE,
          code_verifier: VERIFIER,
          resource: RESOURCE,
        }).toString(),
      }),
    );
    expect(res.status).toBe(200);
    const tokens = (await res.json()) as { access_token: string };
    expect(await checkAccessToken(tokens.access_token, RESOURCE)).toMatchObject({
      ok: true,
      grant: { user_id: CIHAN.id, organization_id: 'org-1' },
    });
  });

  it('gives a read-only connection when changes are unticked', async () => {
    seed();
    session.user = CIHAN;
    await redirected(() => approveConnection(form({ request: request() })));
    expect(db.current!.table('oauth_codes')[0].scopes).toEqual(['mcp:read']);
  });

  it('writes no code when the plan stopped allowing it, and shows the page again', async () => {
    seed({ plan: 'growth', status: 'trialing' });
    session.user = CIHAN;
    const id = request();
    expect(
      await redirected(() => approveConnection(form({ request: id, allow_changes: 'on' }))),
    ).toBe(`/oauth/consent?request=${id}`);
    expect(db.current!.table('oauth_codes')).toHaveLength(0);
  });

  it("refuses another person's request, a signed-out one and a spent one", async () => {
    seed();
    const id = request('ansc_claude', { user_id: AYSE.id });
    session.user = CIHAN;
    expect(await redirected(() => approveConnection(form({ request: id })))).toBe(
      '/oauth/consent?error=other_person',
    );
    session.user = null;
    expect(await redirected(() => approveConnection(form({ request: id })))).toBe(
      `/sign-in?next=${encodeURIComponent(`/oauth/consent?request=${id}`)}`,
    );
    session.user = CIHAN;
    expect(await redirected(() => approveConnection(form({ request: crypto.randomUUID() })))).toBe(
      '/oauth/consent?error=expired',
    );
    expect(db.current!.table('oauth_codes')).toHaveLength(0);
  });

  it('does nothing while MCP over OAuth is off', async () => {
    vi.stubEnv('MCP_OAUTH_ENABLED', 'false');
    seed();
    session.user = CIHAN;
    expect(await redirected(() => approveConnection(form({ request: request() })))).toBe(
      '/oauth/consent?error=invalid_request',
    );
    expect(db.current!.table('oauth_codes')).toHaveLength(0);
  });
});

describe('Cancel and Back to the app', () => {
  it('tells the app no, with state and iss, and uses the request up', async () => {
    seed();
    session.user = CIHAN;
    const to = new URL(await redirected(() => denyConnection(form({ request: request() }))));
    expect(`${to.origin}${to.pathname}`).toBe(CLAUDE);
    expect(to.searchParams.get('error')).toBe('access_denied');
    expect(to.searchParams.get('state')).toBe('st-1');
    expect(to.searchParams.get('iss')).toBe(ISSUER);
    expect(db.current!.table('oauth_authorization_requests')).toHaveLength(0);
    expect(db.current!.table('oauth_events').map((e) => e.event)).toEqual(['consent_denied']);
  });

  it('logs why when the plan stopped it', async () => {
    seed({ plan: 'starter', status: 'trialing' });
    session.user = AYSE;
    await redirected(() => denyConnection(form({ request: request('ansc_agent') })));
    expect(db.current!.table('oauth_events').map((e) => e.event)).toEqual(['blocked_trial']);
  });
});

describe('Switch account', () => {
  it('signs out and comes back to the request after signing in', async () => {
    const id = crypto.randomUUID();
    expect(await redirected(() => switchAccount(form({ request: id })))).toBe(
      `/sign-in?next=${encodeURIComponent(`/oauth/consent?request=${id}`)}`,
    );
    expect(session.signOut).toHaveBeenCalled();
  });
});
