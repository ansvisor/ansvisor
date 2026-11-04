// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '../testing/fake-supabase';

/**
 * What a run leaves, by e-mail too (W3-04b): a done run's result goes, a
 * "No change" doesn't; a failed retry and a pause go once, with their Inbox
 * notice, never twice for the same event.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('../testing/fake-supabase')).createFakeSupabase(),
}));
const mails = vi.hoisted(() => ({ result: vi.fn(), problem: vi.fn() }));
vi.mock('./email', () => ({ emailRunResult: mails.result, emailJobProblem: mails.problem }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const deliver = await import('./deliver');

const run = { id: 'run-1', schedule_id: 'job-1', attempt: 2 };
const chat = {
  id: 'chat-run-1',
  conversationId: 'chat-1',
  messageId: 'msg-1',
  progress: { timezone: 'UTC' } as never,
};

beforeEach(() => {
  mails.result.mockClear();
  mails.problem.mockClear();
  db.unique = { chat_notices: [['user_id', 'dedupe_key']] };
  db.tables = {
    chat_schedules: [
      {
        id: 'job-1',
        organization_id: 'org-1',
        created_by: 'creator',
        title: 'Weekly report',
        conversation_id: 'chat-1',
        skill_name: null,
      },
    ],
    chat_schedule_runs: [{ id: 'run-1', schedule_id: 'job-1' }],
    chat_files: [],
    chat_notices: [],
  };
});

describe('keepRunResult and the notices, by e-mail', () => {
  it('e-mails a done run’s result, never a "No change" one', async () => {
    await deliver.keepRunResult(run, 'done', chat);
    expect(mails.result).toHaveBeenCalledExactlyOnceWith(run, chat);
    mails.result.mockClear();
    await deliver.keepRunResult(run, 'unchanged', chat);
    await deliver.keepRunResult(run, 'running', chat);
    expect(mails.result).not.toHaveBeenCalled();
  });

  it('e-mails a failed retry and a pause once, with their notice', async () => {
    await deliver.keepRunResult(run, 'failed', chat, { reason: 'Something went wrong.' });
    await deliver.noticeRunFailed('job-1', 'run-1', 'Something went wrong.');
    expect(mails.problem).toHaveBeenCalledExactlyOnceWith(
      'job-1',
      'failed',
      'Something went wrong.',
      'run-1',
    );
    const now = new Date('2026-11-02T06:00:00.000Z');
    await deliver.noticeJobPaused('job-1', 'cap', now);
    await deliver.noticeJobPaused('job-1', 'cap', now);
    expect(mails.problem).toHaveBeenCalledTimes(2);
    expect(mails.problem).toHaveBeenLastCalledWith(
      'job-1',
      'paused',
      'The monthly AI limit was reached. It goes on at its next run after the limit resets.',
    );
  });
});
