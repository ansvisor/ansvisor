// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fake-supabase';

/**
 * A saved chat as its page opens it: each answer's run with its steps, and a
 * finished run's next moves in rank order (CHAT-07 §C: they come back after
 * a reload), with the ghost mark and never their class.
 */

const fake = vi.hoisted(() => ({ db: null as unknown as FakeSupabase, user: 'u1' }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () =>
    Object.assign(fake.db, {
      auth: { getUser: async () => ({ data: { user: { id: fake.user } } }) },
    }),
}));

const { createFakeSupabase } = await import('./testing/fake-supabase');
const { loadChatThread } = await import('./thread');

const CHAT = 'c1';

beforeEach(() => {
  fake.db = createFakeSupabase();
  fake.user = 'u1';
  Object.assign(fake.db.tables, {
    chat_conversations: [{ id: CHAT, title: 'Citations', brand_id: 'b1', user_id: 'u1' }],
    chat_messages: [
      {
        id: 'm1',
        conversation_id: CHAT,
        role: 'user',
        content_md: 'Why did citations fall?',
        generated_at: null,
        data_as_of: null,
        timezone: null,
        created_at: '2026-10-30T09:00:00.000Z',
      },
      {
        id: 'm2',
        conversation_id: CHAT,
        role: 'assistant',
        content_md: 'Two pages lost most of it.',
        generated_at: '2026-10-30T09:01:00.000Z',
        data_as_of: null,
        timezone: 'UTC',
        created_at: '2026-10-30T09:00:01.000Z',
      },
    ],
    chat_runs: [{ id: 'r1', message_id: 'm2', conversation_id: CHAT, status: 'done' }],
    chat_run_steps: [],
    chat_files: [],
    chat_next_moves: [
      {
        run_id: 'r1',
        rank: 2,
        label: 'Compare with Perplexity',
        prompt: 'Compare these citations with Perplexity',
        class: 'read',
        ghost_ok: false,
      },
      {
        run_id: 'r1',
        rank: 1,
        label: 'Do the same for /features',
        prompt: 'Do the same for /features',
        class: 'write',
        ghost_ok: true,
      },
    ],
  });
});

describe('loadChatThread', () => {
  it('brings a finished run’s next moves back in rank order, with the ghost mark only', async () => {
    const thread = await loadChatThread(CHAT);
    expect(thread?.mine).toBe(true);
    const run = thread!.messages[1].run!;
    expect(run.nextMoves).toEqual([
      { label: 'Do the same for /features', prompt: 'Do the same for /features', ghost: true },
      { label: 'Compare with Perplexity', prompt: 'Compare these citations with Perplexity' },
    ]);
    expect(JSON.stringify(thread)).not.toContain('"class"');
  });

  it('opens the chat without moves when they can’t be read', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.db.failures.chat_next_moves = { message: 'relation does not exist' };
    const thread = await loadChatThread(CHAT);
    expect(thread!.messages[1].run!.nextMoves).toEqual([]);
    expect(thread!.messages[1].text).toBe('Two pages lost most of it.');
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('shows a teammate’s shared chat without its author’s moves, and doesn’t read them', async () => {
    fake.user = 'u2';
    const thread = await loadChatThread(CHAT);
    expect(thread!.mine).toBe(false);
    expect(thread!.messages[1].run!.nextMoves).toEqual([]);
    expect(fake.db.log.some(([table]) => table === 'chat_next_moves')).toBe(false);
  });

  it('gives a run without moves none', async () => {
    fake.db.tables.chat_next_moves = [];
    const thread = await loadChatThread(CHAT);
    expect(thread!.messages[1].run!.nextMoves).toEqual([]);
  });
});
