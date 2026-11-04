// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fake-supabase';

/** "Notify me when an agent needs me" (00474): the call to the server, and closing the notice. */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fake-supabase')).createFakeSupabase(),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { needsYouKey, resolveAgentNeedsYou, tellAgentNeedsYou } = await import('./agent-needs-you');

const ORG = '11111111-1111-4111-8111-111111111111';
const RUN = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  db.failures = {};
  db.tables = { chat_notices: [] };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('tellAgentNeedsYou', () => {
  it('asks the server, with the secret, for the run', async () => {
    vi.stubEnv('CRON_SECRET', 'shh');
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await tellAgentNeedsYou(ORG, RUN)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/internal\/chat\/notices\/needs-you$/);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer shh' });
    expect(JSON.parse(init.body as string)).toEqual({ orgId: ORG, agentRunId: RUN });
  });

  it('never throws: no secret, or no answer, is false', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect(await tellAgentNeedsYou(ORG, RUN)).toBe(false);
    vi.stubEnv('CRON_SECRET', 'shh');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    expect(await tellAgentNeedsYou(ORG, RUN)).toBe(false);
  });
});

describe('resolveAgentNeedsYou', () => {
  it("closes the run's open notice, and only it", async () => {
    db.tables.chat_notices = [
      { id: 'a', dedupe_key: needsYouKey(RUN), resolved_at: null },
      { id: 'b', dedupe_key: needsYouKey('other-run'), resolved_at: null },
    ];
    await resolveAgentNeedsYou(RUN);
    expect(db.tables.chat_notices.find((n) => n.id === 'a')?.resolved_at).toEqual(
      expect.any(String),
    );
    expect(db.tables.chat_notices.find((n) => n.id === 'b')?.resolved_at).toBeNull();
  });
});
