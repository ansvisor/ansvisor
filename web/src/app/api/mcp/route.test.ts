// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * The MCP endpoint and an app's sign-in (MCP over OAuth, #2141): it asks for
 * the token at the MCP endpoint, and a connection that may only read gets 403
 * insufficient_scope for a change, before the SDK, so the app can ask the
 * person for more. Reads and API keys go through as before.
 */

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
const auth = vi.hoisted(() => ({ value: null as unknown, options: [] as unknown[] }));
vi.mock('@/lib/mcp-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp-auth')>()),
  authenticateMcpRequest: async (_req: Request, options: unknown) => {
    auth.options.push(options);
    return auth.value;
  },
}));

const { POST } = await import('./route');

const base: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  role: 'admin',
  apiKeyId: 'oauth:grant-1',
  brandAccess: 'all',
  via: 'oauth',
  oauthGrantId: 'grant-1',
  oauthScopes: ['mcp:read'],
  oauthAccess: 'ok',
};

const rpc = (body: unknown) =>
  POST(
    new Request('https://app.ansvisor.com/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify(body),
    }),
  );
const call = (name: string) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name, arguments: {} },
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.ansvisor.com');
  // App sign-in is on by default (MCP_OAUTH_ENABLED unset), with an https issuer.
  vi.stubEnv('MCP_OAUTH_ENABLED', undefined);
  auth.value = { ...base };
  auth.options = [];
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/mcp', () => {
  it('takes app tokens here, and gates the tools one by one', async () => {
    await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(auth.options).toEqual([{ gateWrites: false, allowOAuth: true }]);
  });

  it('answers a change on a read-only connection 403 insufficient_scope', async () => {
    const res = await rpc(call('create_content_draft'));
    expect(res.status).toBe(403);
    expect(res.headers.get('www-authenticate')).toContain('error="insufficient_scope"');
    expect(res.headers.get('www-authenticate')).toContain('scope="mcp:read mcp:write"');
    expect(await res.json()).toMatchObject({ error: 'insufficient_scope' });
  });

  it('lets a read-only connection list the tools', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: unknown[] } };
    expect(body.result.tools.length).toBeGreaterThan(50);
  });

  it('lets a connection that may change things through, and an API key', async () => {
    auth.value = { ...base, oauthScopes: ['mcp:read', 'mcp:write'] };
    expect((await rpc(call('create_content_draft'))).status).toBe(200);
    auth.value = { ...base, via: 'api_key', apiKeyId: 'key-1', oauthScopes: undefined };
    expect((await rpc(call('create_content_draft'))).status).toBe(200);
  });

  it('passes on the 401 the authentication answered', async () => {
    auth.value = new (await import('next/server')).NextResponse(null, { status: 401 });
    expect((await rpc(call('list_brands'))).status).toBe(401);
  });

  it('leaves a body that is not JSON to the transport', async () => {
    const res = await POST(
      new Request('https://app.ansvisor.com/api/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: '{not json',
      }),
    );
    expect(res.status).toBe(400);
  });
});
