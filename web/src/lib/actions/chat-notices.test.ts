// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * The Inbox's notices about scheduled work (00461; W3-04a, W3-03, W3-05):
 * read with the person's session, each with where Open goes — a job's page
 * in Scheduled, or, for a follow-up check's result, the chat it was posted in.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const JOB = '0b0b0b0b-0000-4000-8000-000000000001';
const CHAT = '0b0b0b0b-0000-4000-8000-0000000000c2';

const db = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/lib/supabase/server', async () => {
  const { createFakeSupabase } = await import('@/lib/chat/testing/fake-supabase');
  const fake = createFakeSupabase();
  db.value = fake;
  return {
    createClient: async () =>
      Object.assign(fake, { auth: { getUser: async () => ({ data: { user: { id: ME } } }) } }),
  };
});

const { readChatNotices } = await import('./chat-notices');
const fake = () => db.value as FakeSupabase;

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  fake().tables = {
    profiles: [{ id: ME, organization_id: ORG }],
    chat_notices: [],
  };
});

const notice = (kind: string, payload: Record<string, unknown>, at: string) =>
  fake().tables.chat_notices.push({
    id: `${kind}-id`,
    organization_id: ORG,
    user_id: ME,
    kind,
    payload,
    created_at: at,
    read_at: null,
    resolved_at: null,
  });

describe('readChatNotices', () => {
  it('opens a job’s notice on its page, and a follow-up result in its chat', async () => {
    notice(
      'schedule_failed',
      {
        scheduleId: JOB,
        title: 'Weekly report',
        reason: 'Something went wrong.',
        conversationId: CHAT,
      },
      '2026-11-02T08:00:00Z',
    );
    notice(
      'followup_result',
      {
        scheduleId: JOB,
        title: 'Citations for /pricing',
        reason: 'Improved',
        conversationId: CHAT,
      },
      '2026-11-02T09:00:00Z',
    );
    const read = await readChatNotices();
    expect(read.ok && read.notices.map((n) => [n.kind, 'href' in n ? n.href : null])).toEqual([
      ['followup_result', `/dashboard/chat/${CHAT}`],
      ['schedule_failed', `/dashboard/chat/scheduled/${JOB}`],
    ]);
  });
});
