import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAgentRun, stopAgentRun } from './agent-runs-client';

/**
 * The Content Agent's run, read and stopped from the browser (CE-027/035):
 * the draft's latest run through RLS, and Stop through the API's proxy.
 */

let row: { data: Record<string, unknown> | null; error: Error | null };
let session: { access_token: string } | null;
const query = { draft: '', order: '', limit: 0 };
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session } }) },
    from: (table: string) => {
      expect(table).toBe('content_agent_runs');
      const chain = {
        select: () => chain,
        eq: (_col: string, value: string) => ((query.draft = value), chain),
        order: (col: string) => ((query.order = col), chain),
        limit: (n: number) => ((query.limit = n), chain),
        maybeSingle: async () => row,
      };
      return chain;
    },
  }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  row = { data: null, error: null };
  session = { access_token: 'token-1' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('readAgentRun', () => {
  it('reads the draft’s latest run', async () => {
    row.data = {
      id: 'r1',
      kind: 'fix',
      steps: [{ key: 'read_rules', count: 4 }],
      step: 0,
      started_at: '2026-10-23T10:00:00Z',
      finished_at: null,
      stopped_at: null,
      outcome: null,
    };
    expect(await readAgentRun('d1')).toMatchObject({
      id: 'r1',
      kind: 'fix',
      steps: [{ key: 'read_rules', count: 4 }],
      startedAt: '2026-10-23T10:00:00Z',
    });
    expect(query).toEqual({ draft: 'd1', order: 'started_at', limit: 1 });
  });

  it('is null when it can’t be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    row = { data: null, error: new Error('down') };
    expect(await readAgentRun('d1')).toBeNull();
  });
});

describe('stopAgentRun', () => {
  it('asks the API to stop the draft’s run, signed in', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ stopped: true })));
    expect(await stopAgentRun('d1', 'b1')).toEqual({ stopped: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/aeo/api/content-drafts/d1/stop');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer token-1');
    expect(JSON.parse(init.body)).toEqual({ brandId: 'b1' });
    // The run the editor shows, when it names it: another tab's goes on.
    await stopAgentRun('d1', 'b1', 'r9');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ brandId: 'b1', runId: 'r9' });
  });

  it('says when no run was under way', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ stopped: false })));
    expect(await stopAgentRun('d1', 'b1')).toEqual({ stopped: false });
  });

  it('fails without a session, on an error answer, or when the request fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    session = null;
    expect(await stopAgentRun('d1', 'b1')).toEqual({ error: 'failed' });
    expect(fetchMock).not.toHaveBeenCalled();

    session = { access_token: 'token-1' };
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 403 }));
    expect(await stopAgentRun('d1', 'b1')).toEqual({ error: 'failed' });
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await stopAgentRun('d1', 'b1')).toEqual({ error: 'failed' });
  });
});
