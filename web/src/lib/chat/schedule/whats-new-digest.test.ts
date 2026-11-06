// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '../testing/fake-supabase';
import type { WhatsNewItem, WhatsNewPick } from '../whats-new/reads';

/**
 * What's new for my plan, on a schedule (W4-23, 00489): the digest's answer
 * in Markdown, and one run's chat. Nothing new delivers nothing; new entries
 * go to the job's chat as a message and its answer, a run that ended as it
 * began, and are marked read. No model is called.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('../testing/fake-supabase')).createFakeSupabase(),
}));
const fakes = vi.hoisted(() => ({
  pick: vi.fn(),
  read: vi.fn(async () => new Set<string>()),
  mark: vi.fn(async () => true),
  flags: new Set(['auto_go_live']),
}));
vi.mock('../whats-new/reads', () => ({
  UNREAD_DAYS: 90,
  pickWhatsNew: fakes.pick,
  readWhatsNewReads: fakes.read,
  markWhatsNewRead: fakes.mark,
  whatsNewFlags: () => fakes.flags,
}));
vi.mock('../touched-brands', () => ({ startTouchedBrands: vi.fn(async () => undefined) }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { DIGEST_MAX, digestAnswer, isWhatsNewDigest, sendWhatsNewDigest } =
  await import('./whats-new-digest');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const JOB = '33333333-3333-4333-8333-333333333333';
const RUN_ROW = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-12-01T06:00:30.000Z');

const item = (over: Partial<WhatsNewItem> = {}): WhatsNewItem => ({
  slug: 'agent-center',
  feature: 'Agent Center',
  homeLine: 'Agents that work for you',
  lines: ['Ready-made agents for your work.'],
  route: '/dashboard/agents',
  onPlans: null,
  published: '2026-11-20',
  read: false,
  ...over,
});
const pick = (items: WhatsNewItem[], more = false): WhatsNewPick => ({
  items,
  hasUnread: items.length > 0,
  more,
});

const input = (chatId: string | null = null) => ({
  job: { id: JOB, organization_id: ORG, title: 'What’s new for my plan', prompt: null },
  runRowId: RUN_ROW,
  userId: USER,
  plan: { planId: 'growth' as const, selfHosted: false },
  chatId,
  slot: 'Tue 1 Dec, 09:00',
  timezone: 'Europe/Istanbul',
  now: NOW,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.tables.chat_conversations = [];
  db.tables.chat_messages = [];
  db.tables.chat_runs = [];
  db.tables.chat_schedules = [{ id: JOB, organization_id: ORG, conversation_id: null }];
  db.tables.chat_schedule_runs = [{ id: RUN_ROW, schedule_id: JOB, run_id: null }];
});

describe('the digest’s answer', () => {
  it('counts the updates, names each one with its lines and Try it, and points to older ones', () => {
    const answer = digestAnswer(
      [item(), item({ slug: 'skills', feature: 'Skills', onPlans: 'Growth and Enterprise' })],
      true,
    );
    expect(answer).toContain('Here are 2 updates for your plan that you haven’t seen yet.');
    expect(answer).toContain(
      '**Agent Center**\nReady-made agents for your work.\n[Try it](/dashboard/agents)',
    );
    expect(answer).toContain('**Skills** · On Growth and Enterprise.');
    expect(answer.endsWith('Ask me “What’s new” for older updates.')).toBe(true);
    expect(digestAnswer([item()], false)).not.toContain('older updates');
    expect(digestAnswer([item()], false)).toContain('Here’s 1 update');
  });

  it('keeps an entry’s own characters, never Markdown formatting', () => {
    const answer = digestAnswer(
      [item({ feature: 'Run *now*', lines: ['Use `/report` [here]'] })],
      false,
    );
    expect(answer).toContain('**Run \\*now\\***');
    expect(answer).toContain('Use \\`/report\\` \\[here\\]');
  });

  it('tells a digest job from any other', () => {
    expect(isWhatsNewDigest({ digest: 'whats_new' })).toBe(true);
    expect(isWhatsNewDigest({ digest: null })).toBe(false);
    expect(isWhatsNewDigest({})).toBe(false);
  });
});

describe('a digest’s run', () => {
  it('delivers nothing when nothing is new: no chat, nothing marked read', async () => {
    fakes.pick.mockReturnValue(pick([]));
    expect(await sendWhatsNewDigest(input())).toEqual({ kind: 'nothing' });
    expect(db.tables.chat_conversations).toEqual([]);
    expect(db.tables.chat_messages).toEqual([]);
    expect(fakes.mark).not.toHaveBeenCalled();
  });

  it('picks as get_whats_new does: unread only, the workspace’s switches, at most 10', async () => {
    fakes.pick.mockReturnValue(pick([]));
    await sendWhatsNewDigest(input());
    expect(fakes.read).toHaveBeenCalledWith(USER);
    expect(fakes.pick).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: fakes.flags,
        unreadOnly: true,
        days: 90,
        limit: DIGEST_MAX,
        now: NOW,
      }),
    );
  });

  it('writes the job’s chat, its message and answer and a finished run, then marks them read', async () => {
    fakes.pick.mockReturnValue(pick([item(), item({ slug: 'skills', feature: 'Skills' })]));
    const sent = await sendWhatsNewDigest(input());
    expect(sent).toMatchObject({ kind: 'sent', count: 2 });
    if (sent?.kind !== 'sent') throw new Error('not sent');

    expect(db.tables.chat_conversations).toEqual([
      expect.objectContaining({
        id: sent.conversationId,
        organization_id: ORG,
        user_id: USER,
        brand_id: null,
        origin: 'schedule',
        schedule_id: JOB,
      }),
    ]);
    const [message, answer] = db.tables.chat_messages;
    expect(message).toMatchObject({ role: 'user', content_md: 'What’s new for my plan' });
    expect(answer).toMatchObject({ id: sent.answerId, role: 'assistant' });
    expect(answer.content_md).toContain('Here are 2 updates');
    expect(db.tables.chat_runs).toEqual([
      expect.objectContaining({ id: sent.chatRunId, message_id: sent.answerId, status: 'done' }),
    ]);
    expect(db.tables.chat_schedule_runs[0]).toMatchObject({
      run_id: sent.chatRunId,
      message_id: sent.answerId,
    });
    expect(db.tables.chat_schedules[0].conversation_id).toBe(sent.conversationId);
    expect(fakes.mark).toHaveBeenCalledWith(USER, ['agent-center', 'skills']);
  });

  it('goes on in the job’s live chat', async () => {
    const CHAT = '55555555-5555-4555-8555-555555555555';
    fakes.pick.mockReturnValue(pick([item()]));
    const sent = await sendWhatsNewDigest(input(CHAT));
    expect(sent).toMatchObject({ kind: 'sent', conversationId: CHAT });
    expect(db.tables.chat_conversations).toEqual([]);
    expect(db.tables.chat_messages.every((m) => m.conversation_id === CHAT)).toBe(true);
  });
});
