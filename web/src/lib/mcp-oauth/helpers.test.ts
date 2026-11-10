// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The pure parts of MCP over OAuth (#2141): the issuer and flag, PKCE S256,
 * redirect URIs, the resource a token is for, scopes, token prefixes, the
 * WWW-Authenticate challenge and the shortened address the log keeps.
 */

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));

const { mcpOAuthEnabled, mcpResourceUrl, oauthIssuer, protectedResourceMetadataUrl } =
  await import('./config');
const { isCodeVerifier, isS256Challenge, s256Challenge, verifyS256 } = await import('./pkce');
const { checkRedirectUri, redirectHost, redirectUriMatches } = await import('./redirect-uris');
const { isOurResource, normalizeResource, resolveResource } = await import('./resource');
const { callsWriteTool, hasWriteScope, parseScopeParam, scopeString } = await import('./scopes');
const {
  ACCESS_TOKEN_PREFIX,
  REFRESH_TOKEN_PREFIX,
  hashSecret,
  isAccessToken,
  isOAuthSecret,
  newClientId,
  newSecret,
  safeEqual,
} = await import('./tokens');
const { bearerChallenge, insufficientScope, unauthorizedWithChallenge } =
  await import('./challenge');
const { requestIp, shortIp } = await import('./events');

afterEach(() => vi.unstubAllEnvs());

describe('the issuer and the flag', () => {
  it.each([
    ['https://app.ansvisor.com', 'https://app.ansvisor.com'],
    ['https://app.ansvisor.com/', 'https://app.ansvisor.com'],
    ['https://APP.ansvisor.com:443', 'https://app.ansvisor.com'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['http://127.0.0.1:3000/', 'http://127.0.0.1:3000'],
  ])('takes %s as %s', (value, issuer) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', value);
    expect(oauthIssuer()).toBe(issuer);
  });

  it.each([
    ['', 'unset'],
    ['http://app.example.com', 'plain http off this computer'],
    ['https://example.com/ansvisor', 'a path: the well-known addresses need the root'],
    ['https://user:pw@example.com', 'credentials'],
    ['not a url', 'not a URL'],
  ])('refuses %s (%s)', (value) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', value);
    expect(oauthIssuer()).toBeNull();
  });

  it('is on only with MCP_OAUTH_ENABLED=true and an issuer', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.ansvisor.com');
    expect(mcpOAuthEnabled()).toBe(false);
    vi.stubEnv('MCP_OAUTH_ENABLED', 'true');
    expect(mcpOAuthEnabled()).toBe(true);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://app.example.com');
    expect(mcpOAuthEnabled()).toBe(false);
  });

  it('names the MCP endpoint and its metadata from the issuer', () => {
    expect(mcpResourceUrl('https://app.ansvisor.com')).toBe('https://app.ansvisor.com/api/mcp');
    expect(protectedResourceMetadataUrl('https://app.ansvisor.com')).toBe(
      'https://app.ansvisor.com/.well-known/oauth-protected-resource/api/mcp',
    );
  });
});

describe('PKCE', () => {
  // RFC 7636 appendix B.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  it('makes and checks the S256 challenge of RFC 7636', () => {
    expect(s256Challenge(verifier)).toBe(challenge);
    expect(verifyS256(verifier, challenge)).toBe(true);
  });

  it('refuses another verifier, a short one, and a plain challenge', () => {
    expect(verifyS256(`${verifier.slice(0, -1)}A`, challenge)).toBe(false);
    expect(verifyS256('short', s256Challenge('short'))).toBe(false);
    expect(verifyS256(verifier, verifier)).toBe(false);
    expect(verifyS256(undefined, challenge)).toBe(false);
  });

  it('knows a challenge and a verifier by their form', () => {
    expect(isS256Challenge(challenge)).toBe(true);
    expect(isS256Challenge(`${challenge}=`)).toBe(false);
    expect(isCodeVerifier('a'.repeat(43))).toBe(true);
    expect(isCodeVerifier('a'.repeat(129))).toBe(false);
    expect(isCodeVerifier('a b'.repeat(20))).toBe(false);
  });
});

describe('redirect URIs', () => {
  it.each([
    'https://claude.ai/api/mcp/auth_callback',
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'http://localhost/callback',
    'http://127.0.0.1:33418/callback',
    'http://[::1]:5000/cb',
  ])('lets an app register %s', (uri) => {
    expect(checkRedirectUri(uri)).toBeNull();
  });

  it.each([
    ['http://example.com/cb', 'scheme'],
    ['cursor://anysphere.cursor-mcp/oauth/callback', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['https://example.com/cb#frag', 'fragment'],
    ['https://user:pw@example.com/cb', 'credentials'],
    ['https://*.example.com/cb', 'wildcard'],
    ['not a url', 'not_a_url'],
    [`https://example.com/${'a'.repeat(2000)}`, 'too_long'],
  ])('refuses %s (%s)', (uri, problem) => {
    expect(checkRedirectUri(uri)).toBe(problem);
  });

  it('matches exactly, and a loopback address on any port', () => {
    const registered = [
      'https://claude.ai/api/mcp/auth_callback',
      'http://localhost/callback',
      'http://127.0.0.1/callback',
    ];
    expect(redirectUriMatches(registered, 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(redirectUriMatches(registered, 'http://localhost:3118/callback')).toBe(true);
    expect(redirectUriMatches(registered, 'http://127.0.0.1:61000/callback')).toBe(true);
    // Not a prefix, not another path, not another host, not https on a port.
    expect(redirectUriMatches(registered, 'https://claude.ai/api/mcp/auth_callback/x')).toBe(false);
    expect(redirectUriMatches(registered, 'https://claude.ai/api/mcp/auth_callback?x=1')).toBe(
      false,
    );
    expect(redirectUriMatches(registered, 'http://localhost:3118/other')).toBe(false);
    expect(redirectUriMatches(registered, 'http://[::1]:3118/callback')).toBe(false);
    expect(redirectUriMatches(registered, 'https://claude.ai:8443/api/mcp/auth_callback')).toBe(
      false,
    );
  });

  it('names the host a person goes back to', () => {
    expect(redirectHost('https://claude.ai/api/mcp/auth_callback')).toBe('claude.ai');
    expect(redirectHost('http://127.0.0.1:3118/callback')).toBe('127.0.0.1');
  });
});

describe('the resource a token is for', () => {
  const ours = 'https://app.ansvisor.com/api/mcp';

  it('treats case in scheme and host, a default port and a trailing slash as the same', () => {
    expect(normalizeResource('HTTPS://App.Ansvisor.com:443/api/mcp/')).toBe(ours);
    expect(isOurResource('https://app.ansvisor.com/api/mcp/', ours)).toBe(true);
    expect(isOurResource('https://app.ansvisor.com/api/other', ours)).toBe(false);
    expect(normalizeResource('https://app.ansvisor.com/api/mcp#x')).toBeNull();
  });

  it('takes ours when a request names none or ours, and nothing else', () => {
    expect(resolveResource(undefined, ours)).toBe(ours);
    expect(resolveResource('', ours)).toBe(ours);
    expect(resolveResource('https://app.ansvisor.com/api/mcp/', ours)).toBe(ours);
    expect(resolveResource('https://evil.example/api/mcp', ours)).toBeNull();
  });
});

describe('scopes', () => {
  it('gives both when an app asks for none it knows, or for write alone', () => {
    expect(parseScopeParam(undefined)).toEqual(['mcp:read', 'mcp:write']);
    expect(parseScopeParam('offline_access openid')).toEqual(['mcp:read', 'mcp:write']);
    expect(parseScopeParam('mcp:write')).toEqual(['mcp:read', 'mcp:write']);
    expect(parseScopeParam('mcp:read offline_access')).toEqual(['mcp:read']);
    expect(scopeString(['mcp:write', 'mcp:read'])).toBe('mcp:read mcp:write');
    expect(hasWriteScope(['mcp:read'])).toBe(false);
    expect(hasWriteScope(undefined)).toBe(false);
  });

  it('finds a call to a tool that changes something, in a batch too', () => {
    const call = (name: string) => ({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name },
    });
    expect(callsWriteTool(call('list_brands'))).toBe(false);
    expect(callsWriteTool(call('get_me'))).toBe(false);
    expect(callsWriteTool(call('create_content_draft'))).toBe(true);
    expect(callsWriteTool([call('list_brands'), call('run_site_audit')])).toBe(true);
    expect(callsWriteTool({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toBe(false);
    expect(callsWriteTool(undefined)).toBe(false);
  });
});

describe('tokens', () => {
  it('gives each kind its prefix and keeps only a sha256', () => {
    const access = newSecret(ACCESS_TOKEN_PREFIX);
    expect(access).toMatch(/^ans_oat_[A-Za-z0-9_-]{43}$/);
    expect(isAccessToken(access)).toBe(true);
    expect(isOAuthSecret(newSecret(REFRESH_TOKEN_PREFIX))).toBe(true);
    expect(isOAuthSecret('ans_abc')).toBe(false);
    expect(hashSecret('x')).toBe(
      '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881',
    );
    expect(newClientId()).toMatch(/^ansc_[A-Za-z0-9_-]{22}$/);
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('the challenge', () => {
  const issuer = 'https://app.ansvisor.com';

  it('points to the metadata and names both scopes', () => {
    expect(bearerChallenge(issuer)).toBe(
      'Bearer resource_metadata="https://app.ansvisor.com/.well-known/oauth-protected-resource/api/mcp", scope="mcp:read mcp:write"',
    );
  });

  it('answers 401 with the challenge, keeping the body API-key clients read', async () => {
    const res = unauthorizedWithChallenge(issuer, 'Invalid API key', 'invalid_token');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer error="invalid_token", error_description="Invalid API key", resource_metadata="https://app.ansvisor.com/.well-known/oauth-protected-resource/api/mcp", scope="mcp:read mcp:write"',
    );
    expect(await res.json()).toEqual({ error: 'Invalid API key', error_code: 'invalid_token' });
  });

  it('answers a change on a read-only connection with 403 insufficient_scope', () => {
    const res = insufficientScope(issuer);
    expect(res.status).toBe(403);
    expect(res.headers.get('www-authenticate')).toMatch(
      /^Bearer error="insufficient_scope", error_description="[^"]+", resource_metadata="[^"]+", scope="mcp:read mcp:write"$/,
    );
  });
});

describe('the address the log keeps', () => {
  it('shortens IPv4 to its /24 and IPv6 to its /48', () => {
    expect(shortIp('203.0.113.77')).toBe('203.0.113.0/24');
    expect(shortIp('::ffff:203.0.113.77')).toBe('203.0.113.0/24');
    expect(shortIp('2001:0db8:0001:abcd::1')).toBe('2001:db8:1::/48');
    expect(shortIp('2001:db8::1')).toBe('2001:db8:0::/48');
    expect(shortIp('nonsense')).toBeNull();
    expect(shortIp(null)).toBeNull();
  });

  it("reads the caller's address from the proxy's header", () => {
    const req = new Request('https://x/', {
      headers: { 'x-forwarded-for': '198.51.100.4, 10.0.0.1' },
    });
    expect(requestIp(req)).toBe('198.51.100.4');
    expect(requestIp(new Request('https://x/', { headers: { 'x-real-ip': 'bad' } }))).toBeNull();
  });
});
