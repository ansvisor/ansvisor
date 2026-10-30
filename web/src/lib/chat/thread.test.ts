// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatEvent } from './events';
import { createFakeSupabase, type FakeSupabase } from './testing/fake-supabase';

/**
 * A saved chat as its page opens it (CHAT-03 items 18–19, 21–22; W1-15): an
 * answer that ended keeps what its end event told the browser — why it
 * failed, in the same words, and the header's time and steps — so a reload
 * shows the reason and Retry, and "Stopped after 41s"; and nothing of a
 * step's tool or debug record ever comes with it.
 */

const fake = vi.hoisted(() => ({ db: null as unknown as FakeSupabase }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () =>
    Object.assign(Object.create(fake.db), {
      auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  get supabaseAdmin() {
    return fake.db;
  },
}));

const { loadChatThread } = await import('./thread');

const USER = '11111111-1111-4111-8111-111111111111';
const CHAT = '33333333-3333-4333-8333-333333333333';
const UUID = '99999999-9999-4999-8999-999999999999';
const REASON = "Chat couldn't check your AI usage just now, so it didn't start this step.";

function seed(runs: { id: string; status: string; error?: string | null }[]) {
  fake.db.tables.chat_conversations = [
    { id: CHAT, title: 'Citations', brand_id: null, user_id: USER },
  ];
  fake.db.tables.chat_messages = runs.flatMap((run, i) => [
    {
      id: `q-${run.id}`,
      conversation_id: CHAT,
      role: 'user',
      content_md: `Question ${i + 1}`,
      context_json: null,
      generated_at: null,
      data_as_of: null,
      timezone: null,
      created_at: `2026-10-30T09:0${i}:00.000Z`,
    },
    {
      id: `a-${run.id}`,
      conversation_id: CHAT,
      role: 'assistant',
      content_md: 'So far: two pages.',
      generated_at: null,
      data_as_of: null,
      timezone: 'UTC',
      created_at: `2026-10-30T09:0${i}:01.000Z`,
    },
  ]);
  fake.db.tables.chat_runs = runs.map((run) => ({
    id: run.id,
    message_id: `a-${run.id}`,
    conversation_id: CHAT,
    status: run.status,
    error: run.error ?? null,
  }));
  fake.db.tables.chat_files = [];
}

const event = (runId: string, e: ReturnType<typeof chatEvent>) => ({
  run_id: runId,
  seq: e.seq,
  type: e.type,
  data: e.data,
});

beforeEach(() => {
  fake.db = createFakeSupabase();
});

describe('loadChatThread', () => {
  it('keeps why a run failed, in its own words, after a reload', async () => {
    seed([{ id: 'run-1', status: 'error', error: 'failed' }]);
    fake.db.tables.chat_run_steps = [];
    fake.db.tables.chat_run_events = [
      event('run-1', chatEvent('text.delta', 1, { text: 'So far' })),
      event(
        'run-1',
        chatEvent('run.error', 2, {
          workingMs: 3000,
          stepCount: 0,
          sources: [],
          code: 'failed',
          reason: REASON,
        }),
      ),
    ];
    const thread = await loadChatThread(CHAT);
    expect(thread!.messages[1].run).toMatchObject({
      status: 'error',
      errorReason: REASON,
      summary: { workingMs: 3000, stepCount: 0, sources: [] },
    });
  });

  it("keeps a stopped run's time and steps, its stopped step skipped with why", async () => {
    seed([{ id: 'run-1', status: 'stopped' }]);
    fake.db.tables.chat_run_steps = [
      {
        id: 's1',
        run_id: 'run-1',
        position: 1,
        kind: 'read',
        status: 'skipped',
        label: 'Read Citations',
        detail: 'Stopped',
        scope_json: null,
        row_count: null,
        data_as_of: null,
        started_at: null,
        finished_at: null,
      },
    ];
    fake.db.tables.chat_run_events = [
      event(
        'run-1',
        chatEvent('run.stopped', 4, {
          workingMs: 41_000,
          stepCount: 5,
          sources: [],
          reason: 'person',
        }),
      ),
    ];
    const run = (await loadChatThread(CHAT))!.messages[1].run!;
    expect(run.summary).toEqual({ workingMs: 41_000, stepCount: 5, sources: [] });
    expect(run.errorReason).toBeNull();
    expect(run.steps).toEqual([
      { n: 1, kind: 'read', status: 'skipped', label: 'Read Citations', detail: 'Stopped' },
    ]);
  });

  it('reads no end for a run still under way: the page rebuilds it from its events', async () => {
    seed([{ id: 'run-1', status: 'running' }]);
    fake.db.tables.chat_run_steps = [];
    fake.db.tables.chat_run_events = [];
    const run = (await loadChatThread(CHAT))!.messages[1].run!;
    expect(run).toMatchObject({ status: 'running', summary: null, errorReason: null });
    expect(fake.db.log).not.toContainEqual(['chat_run_events', 'select']);
  });

  it('still opens the chat when the ends can’t be read', async () => {
    seed([{ id: 'run-1', status: 'error', error: 'failed' }]);
    fake.db.tables.chat_run_steps = [];
    fake.db.failures.chat_run_events = { message: 'down' };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = (await loadChatThread(CHAT))!.messages[1].run!;
    expect(run).toMatchObject({ status: 'error', errorReason: null, summary: null });
    error.mockRestore();
  });

  it('says which questions Retry may send again as they were: no files, no page scope', async () => {
    seed([
      { id: 'run-1', status: 'error', error: 'failed' },
      { id: 'run-2', status: 'error', error: 'failed' },
      { id: 'run-3', status: 'error', error: 'failed' },
    ]);
    fake.db.tables.chat_messages[2].context_json = {
      context: { route: '/dashboard/mentions', chips: [{ key: 'page', label: 'Mentions' }] },
    };
    fake.db.tables.chat_uploads = [{ id: 'u1', message_id: 'q-run-3' }];
    fake.db.tables.chat_run_steps = [];
    fake.db.tables.chat_run_events = [];
    const messages = (await loadChatThread(CHAT))!.messages;
    expect(messages.map((m) => m.resendable)).toEqual([
      true,
      undefined,
      false,
      undefined,
      false,
      undefined,
    ]);
    // The scope itself stays on the server.
    expect(JSON.stringify(messages)).not.toContain('/dashboard/mentions');

    // Unread, no question is sent again short of its files.
    fake.db.failures.chat_uploads = { message: 'down' };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await loadChatThread(CHAT))!.messages[0].resendable).toBe(false);
    error.mockRestore();
  });

  it("never carries a step's tool, its debug record or its measure, even from a full row", async () => {
    seed([{ id: 'run-1', status: 'done' }]);
    fake.db.tables.chat_run_steps = [
      {
        id: 's1',
        run_id: 'run-1',
        position: 1,
        kind: 'read',
        status: 'done',
        label: 'Read Citations',
        detail: 'Perplexity · Last 30 days · 18 rows',
        scope_json: { subject: 'Pricing', brand_id: UUID },
        row_count: 18,
        data_as_of: null,
        started_at: null,
        finished_at: null,
        // The server's columns, as a service-role read would give them.
        tool: 'list_citations',
        debug_json: { input: { brand_id: UUID }, output: { rows: [] }, latencyMs: 840 },
        latency_ms: 840,
        cache_hit: true,
        truncated: false,
        result_tokens: 1200,
      },
    ];
    fake.db.tables.chat_run_events = [
      event(
        'run-1',
        chatEvent('run.finished', 2, {
          workingMs: 8000,
          stepCount: 1,
          sources: [{ label: 'Citations', count: 18 }],
          generatedAt: '2026-10-30T09:14:00.000Z',
          dataAsOf: null,
        }),
      ),
    ];
    const thread = await loadChatThread(CHAT);
    const wire = JSON.stringify(thread);
    expect(wire).not.toMatch(/list_citations|debug|latency|cache_hit|result_tokens|tool/i);
    expect(wire).not.toContain(UUID);
    expect(thread!.messages[1].run!.summary).toEqual({
      workingMs: 8000,
      stepCount: 1,
      sources: [{ label: 'Citations', count: 18 }],
    });
  });
});
