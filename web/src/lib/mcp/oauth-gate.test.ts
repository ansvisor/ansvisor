// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * The MCP tools over an app's sign-in connection (MCP over OAuth, #2141;
 * owner, 2026-11-09): on a paid plan they answer as for an API key; in the
 * free trial or once the plan has ended every tool, reads too, answers
 * oauth_plan_required, with words the app can pass on, and runs nothing.
 */

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
const data = vi.hoisted(() => ({
  listBrandsFor: vi.fn(async () => [{ id: 'brand-1', name: 'Acme' }]),
}));
vi.mock('@/lib/mcp/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/data')>()),
  ...data,
}));

const { createMcpServer } = await import('./server');
const { oauthAccessFromFacts, OAUTH_PLAN_REQUIRED } = await import('./subscription-gate');
const { planFactsFromOrgRow } = await import('@/lib/chat/plan-facts');

async function connect(extra: Partial<McpAuthContext>) {
  const server = createMcpServer({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'oauth:grant-1',
    brandAccess: 'all',
    role: 'admin',
    via: 'oauth',
    oauthGrantId: 'grant-1',
    oauthScopes: ['mcp:read', 'mcp:write'],
    ...extra,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

const text = (result: unknown) =>
  (result as { content: { type: string; text: string }[] }).content[0].text;

describe('a sign-in connection off a paid plan', () => {
  it.each(['trial', 'ended'] as const)(
    'answers every tool, reads too, with oauth_plan_required (%s)',
    async (access) => {
      data.listBrandsFor.mockClear();
      const client = await connect({ oauthAccess: access });
      const read = await client.callTool({ name: 'list_brands', arguments: {} });
      expect(read.isError).toBe(true);
      expect(JSON.parse(text(read))).toEqual(OAUTH_PLAN_REQUIRED[access]);
      expect(data.listBrandsFor).not.toHaveBeenCalled();

      const write = await client.callTool({
        name: 'run_site_audit',
        arguments: { brand_id: '11111111-2222-3333-4444-555555555555', url: 'https://a.example/' },
      });
      expect(JSON.parse(text(write))).toMatchObject({ code: 'oauth_plan_required' });
      // Still listed, so the app can say why instead of not finding them.
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(50);
    },
  );

  it('says where to choose a plan, and that an API key reads meanwhile', () => {
    for (const body of Object.values(OAUTH_PLAN_REQUIRED)) {
      expect(body.message).toContain('Settings › Billing');
      expect(body.message).toContain('API key');
    }
  });
});

describe('a sign-in connection on a paid plan', () => {
  it('answers a read as for an API key', async () => {
    const client = await connect({ oauthAccess: 'ok' });
    const read = await client.callTool({ name: 'list_brands', arguments: {} });
    expect(read.isError).toBeFalsy();
    expect(JSON.parse(text(read))).toEqual([{ id: 'brand-1', name: 'Acme' }]);
  });

  it('is unaffected by the OAuth gate when the call came with an API key', async () => {
    const client = await connect({ via: 'api_key', oauthAccess: 'ended' });
    const read = await client.callTool({ name: 'list_brands', arguments: {} });
    expect(read.isError).toBeFalsy();
  });
});

describe('oauthAccessFromFacts', () => {
  it.each([
    [{ plan: 'starter', subscription_status: 'active' }, 'ok'],
    [{ plan: 'growth', subscription_status: 'active' }, 'ok'],
    [{ plan: 'enterprise', subscription_status: 'active' }, 'ok'],
    // An Enterprise trial is a deal's: paid, as everywhere else (plan-facts).
    [{ plan: 'enterprise', subscription_status: 'trialing' }, 'ok'],
    [{ plan: 'starter', subscription_status: 'trialing' }, 'trial'],
    [{ plan: 'growth', subscription_status: 'trialing' }, 'trial'],
    [{ plan: 'growth', subscription_status: 'canceled' }, 'ended'],
    [{ plan: 'growth', subscription_status: 'past_due' }, 'ended'],
    [{ plan: 'free', subscription_status: 'incomplete' }, 'ended'],
  ])('%o is %s on Cloud', (row, access) => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    expect(oauthAccessFromFacts(planFactsFromOrgRow(row))).toBe(access);
    vi.unstubAllEnvs();
  });

  it('is always ok self-hosted', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(
      oauthAccessFromFacts(
        planFactsFromOrgRow({ plan: 'growth', subscription_status: 'canceled' }),
      ),
    ).toBe('ok');
    vi.unstubAllEnvs();
  });
});
