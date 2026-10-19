import { afterEach, describe, expect, it, vi } from 'vitest';

let configs: { id: string }[] = [];
let filters: [string, unknown][] = [];
let selected = '';
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
    from: () => {
      const chain = {
        select: (columns: string) => ((selected = columns), chain),
        eq: (column: string, value: unknown) => (filters.push([column, value]), chain),
        limit: async () => ({ data: configs, error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'https://api.example' }));

const { hasActiveWebhook, sendActionTask } = await import('./action-task-send');

afterEach(() => {
  vi.unstubAllGlobals();
  configs = [];
  filters = [];
});

describe('hasActiveWebhook', () => {
  it('asks only whether an active one exists, never for its secret', async () => {
    configs = [{ id: 'w1' }];
    expect(await hasActiveWebhook('b1')).toBe(true);
    expect(selected).toBe('id');
    expect(filters).toEqual([
      ['brand_id', 'b1'],
      ['is_active', true],
    ]);
    configs = [];
    expect(await hasActiveWebhook('b1')).toBe(false);
  });
});

describe('sendActionTask', () => {
  it('posts where to send it and the text the drawer shows', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ opportunityId: 'o1', created: true })),
    );
    vi.stubGlobal('fetch', fetch);
    expect(await sendActionTask('t1', 'content', 'Add a table to /pricing')).toEqual({
      to: 'content',
      opportunityId: 'o1',
      created: true,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/api/action-center/tasks/t1/send');
    expect(JSON.parse(String(init.body))).toEqual({
      to: 'content',
      title: 'Add a table to /pricing',
    });
  });

  it("returns the server's reason as a code", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'No webhook', code: 'no_webhook' }), {
            status: 409,
          }),
      ),
    );
    expect(await sendActionTask('t1', 'webhook', 'x')).toEqual({
      error: 'server',
      code: 'no_webhook',
      message: 'No webhook',
    });
  });
});
