// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * authenticateMcpRequest on a read-only workspace (Ansvisor Cloud, plan not
 * active): the REST routes' reads go through, their writes answer 402
 * subscription_inactive; the MCP endpoint gates its tools instead.
 */

let status: string | null;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const row =
        table === 'api_keys'
          ? { id: 'key-1', user_id: 'user-1', revoked_at: null }
          : table === 'profiles'
            ? { organization_id: 'org-1' }
            : { subscription_status: status };
      const query = {
        select: () => query,
        eq: () => query,
        update: () => query,
        then: (resolve: (value: unknown) => void) => resolve({ data: null }),
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return query;
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'a@example.com' } } }) } },
  },
}));

const { authenticateMcpRequest } = await import('./mcp-auth');

const request = (method: string) =>
  new Request('http://localhost/api/mcp/content-drafts', {
    method,
    headers: { authorization: 'Bearer ans_test' },
  });

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  status = 'canceled';
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('authenticateMcpRequest on a read-only workspace', () => {
  it('lets a read through', async () => {
    const auth = await authenticateMcpRequest(request('GET'));
    expect(auth).toMatchObject({ userId: 'user-1', organizationId: 'org-1' });
  });

  it('answers a write with 402 subscription_inactive', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = (await authenticateMcpRequest(request(method))) as Response;
      expect(res.status).toBe(402);
      expect(await res.json()).toMatchObject({
        error: 'plan_limit',
        code: 'subscription_inactive',
      });
    }
  });

  it('leaves the MCP endpoint to gate its tools', async () => {
    const auth = await authenticateMcpRequest(request('POST'), { gateWrites: false });
    expect(auth).toMatchObject({ organizationId: 'org-1' });
  });

  it('lets a write through once the plan is active', async () => {
    status = 'active';
    expect(await authenticateMcpRequest(request('POST'))).toMatchObject({ apiKeyId: 'key-1' });
  });

  it('never gates self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(await authenticateMcpRequest(request('POST'))).toMatchObject({ apiKeyId: 'key-1' });
  });
});
