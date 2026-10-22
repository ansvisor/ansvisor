import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /api/settings/ai-providers: an organization's own keys for Chat, one per
 * provider, and the one Chat uses. Members read; admins save, switch and remove.
 */

let user: { id: string } | null;
let profile: { id: string; role: string; organization_id: string } | null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: profile }) }) }),
    }),
  }),
}));

/** Each query on the admin client: its table and the calls made on it. */
const queries: { table: string; calls: [string, ...unknown[]][] }[] = [];
/** What each query resolves to, in order. */
let results: { data?: unknown; error?: { message: string } | null }[];
const rpc = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const query = { table, calls: [] as [string, ...unknown[]][] };
      queries.push(query);
      const settle = () => Promise.resolve(results.shift() ?? { data: null, error: null });
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'upsert', 'update', 'delete', 'order', 'limit']) {
        chain[op] = (...args: unknown[]) => {
          query.calls.push([op, ...args]);
          return chain;
        };
      }
      chain.maybeSingle = settle;
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        settle().then(resolve, reject);
      return chain;
    },
    rpc: (...args: unknown[]) => rpc(...args),
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: { email: `${id}@acme.test` } } }),
      },
    },
  },
}));

vi.mock('@/lib/agent/key-encryption', () => ({
  encryptApiKey: (key: string) => `enc(${key})`,
  last4: (key: string) => key.slice(-4),
}));

const { GET, PUT, PATCH, DELETE } = await import('./route');

const KEY = 'sk-test-0123456789abcdef';
const send = (method: string, body?: unknown) =>
  new Request('http://localhost/api/settings/ai-providers', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  user = { id: 'u1' };
  profile = { id: 'u1', role: 'admin', organization_id: 'org1' };
  queries.length = 0;
  results = [];
  rpc.mockReset().mockResolvedValue({ data: true, error: null });
});

describe('GET', () => {
  it('lists the saved providers with who saved them, and whether Chat has one', async () => {
    profile!.role = 'member';
    results = [
      {
        data: [
          {
            provider: 'openai',
            key_last4: 'abcd',
            settings: {},
            active: true,
            set_at: '2026-10-19T08:00:00Z',
            set_by: 'u2',
          },
          {
            provider: 'azure',
            key_last4: 'wxyz',
            settings: { endpoint: 'https://acme.openai.azure.com', deployment: 'd1' },
            active: false,
            set_at: '2026-10-18T08:00:00Z',
            set_by: null,
          },
        ],
        error: null,
      },
    ];
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      configured: true,
      providers: [
        {
          provider: 'openai',
          last4: 'abcd',
          settings: {},
          active: true,
          setAt: '2026-10-19T08:00:00Z',
          setByEmail: 'u2@acme.test',
        },
        {
          provider: 'azure',
          last4: 'wxyz',
          settings: { endpoint: 'https://acme.openai.azure.com', deployment: 'd1' },
          active: false,
          setAt: '2026-10-18T08:00:00Z',
          setByEmail: null,
        },
      ],
    });
    expect(queries[0].calls).toContainEqual(['eq', 'organization_id', 'org1']);
  });

  it('needs a signed-in user', async () => {
    user = null;
    expect((await GET()).status).toBe(401);
  });
});

describe('PUT', () => {
  it('lets admins only change the keys', async () => {
    profile!.role = 'manager';
    const res = await PUT(send('PUT', { provider: 'openai', apiKey: KEY }));
    expect(res.status).toBe(403);
    expect(queries).toHaveLength(0);
  });

  it("refuses an unknown provider, a short key, and names the setting that's wrong", async () => {
    expect((await PUT(send('PUT', { provider: 'copilot', apiKey: KEY }))).status).toBe(400);
    expect((await PUT(send('PUT', { provider: 'openai', apiKey: 'short' }))).status).toBe(400);
    const res = await PUT(
      send('PUT', {
        provider: 'azure',
        apiKey: KEY,
        settings: { endpoint: 'https://evil.example', deployment: 'd1' },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'endpoint' });
    expect(queries).toHaveLength(0);
  });

  it('saves the key encrypted, and makes the first one the one Chat uses', async () => {
    results = [{ error: null }];
    const res = await PUT(
      send('PUT', {
        provider: 'azure',
        apiKey: ` ${KEY} `,
        settings: { endpoint: 'https://acme.openai.azure.com/', deployment: 'd1' },
      }),
    );
    expect(res.status).toBe(200);
    const [upsert] = queries[0].calls;
    expect(upsert[0]).toBe('upsert');
    expect(upsert[1]).toMatchObject({
      organization_id: 'org1',
      provider: 'azure',
      key_encrypted: `enc(${KEY})`,
      key_last4: 'cdef',
      settings: { endpoint: 'https://acme.openai.azure.com', deployment: 'd1' },
      set_by: 'u1',
    });
    // A replaced key keeps whether Chat uses it.
    expect(upsert[1]).not.toHaveProperty('active');
    // Only while no key is Chat's, decided under the lock (00188).
    expect(rpc).toHaveBeenCalledWith('set_active_ai_provider', {
      p_organization_id: 'org1',
      p_provider: 'azure',
      p_only_if_none: true,
    });
    // Only an Anthropic key has an old copy to clear.
    expect(queries.map((q) => q.table)).toEqual(['organization_ai_keys']);
  });

  it("clears the Anthropic key's old copy on organizations when it is replaced", async () => {
    results = [{ error: null }, { error: null }];
    expect((await PUT(send('PUT', { provider: 'anthropic', apiKey: KEY }))).status).toBe(200);
    expect(queries[1].table).toBe('organizations');
    expect(queries[1].calls).toEqual([
      [
        'update',
        {
          anthropic_api_key_encrypted: null,
          anthropic_api_key_last4: null,
          anthropic_api_key_set_at: null,
          anthropic_api_key_set_by: null,
        },
      ],
      ['eq', 'id', 'org1'],
    ]);
  });
});

describe('PATCH', () => {
  it('switches Chat to a saved provider', async () => {
    const res = await PATCH(send('PATCH', { provider: 'google' }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('set_active_ai_provider', {
      p_organization_id: 'org1',
      p_provider: 'google',
      p_only_if_none: false,
    });
  });

  it('answers 404 for a provider without a key', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect((await PATCH(send('PATCH', { provider: 'google' }))).status).toBe(404);
  });
});

describe('DELETE', () => {
  const remove = (provider: string) =>
    DELETE(
      new Request(`http://localhost/api/settings/ai-providers?provider=${provider}`, {
        method: 'DELETE',
      }),
    );

  it('removes the key in one locked step that also hands Chat to another key', async () => {
    rpc.mockResolvedValue({ data: 'google', error: null });
    expect((await remove('openai')).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('remove_ai_provider_key', {
      p_organization_id: 'org1',
      p_provider: 'openai',
    });
    expect(queries).toHaveLength(0);
  });

  it("clears the Anthropic key's old copy too", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    results = [{ error: null }];
    expect((await remove('anthropic')).status).toBe(200);
    expect(queries[0].table).toBe('organizations');
    expect(queries[0].calls[0][0]).toBe('update');
  });

  it('answers 500 when the removal fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect((await remove('openai')).status).toBe(500);
  });

  it('refuses an unknown provider', async () => {
    expect((await remove('copilot')).status).toBe(400);
  });
});
