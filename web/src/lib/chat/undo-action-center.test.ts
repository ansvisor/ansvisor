// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fake-supabase';
import { BRAND, ORG, PEOPLE, seedWorkspace } from './testing/chat-fixtures';
import {
  ACTION,
  CONVERSATION,
  FILE,
  TASK,
  fakeCreateChatAction,
  seedActionCenter,
} from './testing/action-center-fixtures';

/**
 * Undo for Chat's Action Center changes (CHAT-20 §9 rows 43–46, §10b):
 * a sent action is cancelled only while no task has started, a finding is
 * withdrawn once, a file comes off its task (and back to a draft when no
 * other task has it), and Ready for review goes back to what the chat had.
 * Every Undo is a new event in the action's History, by who clicked it;
 * anything changed since is left for the person to sort out (`changed`).
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));
vi.mock('@/lib/actions/chat-action-center', () => ({
  createChatAction: vi.fn(),
  attachToAction: vi.fn(),
  attachFileToTask: vi.fn(),
  setTaskReadyForReview: vi.fn(),
  checkChatActionCover: vi.fn(),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { ACTION_CENTER_UNDO_RULES: RULES } = await import('./undo-action-center');
const { createChatAction } = await import('@/lib/actions/chat-action-center');
const { runLoggedWrite } = await import('./write');
const { undoChange } = await import('./undo');
const { chatTool } = await import('./registry/tools');

const ME = PEOPLE.admin;
const events = (event: string) => db.tables.action_events.filter((e) => e.event === event);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  seedWorkspace(db);
  seedActionCenter(db);
});
afterEach(() => vi.unstubAllEnvs());

describe('create_action', () => {
  const rule = RULES.create_action;
  const sent = { ok: true, action_id: ACTION, action_no: 1258, created: true };

  it('keeps Undo for an action it made, not for the same approval again', async () => {
    const input = { title: 'Win back pricing citations' };
    await expect(rule.record(input, sent, null)).resolves.toEqual({
      target: { type: 'action', id: ACTION },
      summaryParams: { title: 'Win back pricing citations', no: 'AC-1258' },
      undo: { after: { status: 'new' } },
    });
    expect((await rule.record(input, { ...sent, created: false }, null)).undo).toBeNull();
    expect((await rule.record(input, { ok: false, reason: 'duplicate' }, null)).undo).toBeNull();
    expect(rule.windowMs).toBe(24 * 60 * 60 * 1000);
  });

  it('cancels it while no task has started, in History by who clicked Undo', async () => {
    const target = { id: ACTION, brandId: BRAND, data: {}, userId: ME };
    await expect(rule.inverse(target)).resolves.toBe('ok');
    expect(db.tables.actions[0]).toMatchObject({
      status: 'dismissed',
      deleted_at: expect.any(String),
    });
    expect(events('cancelled')).toEqual([
      expect.objectContaining({
        action_id: ACTION,
        actor_id: ME,
        data: { source: 'chat', via: 'undo', from: 'new' },
      }),
    ]);
    // Gone now: a second Undo finds nothing to cancel.
    await expect(rule.inverse(target)).resolves.toBe('gone');
  });

  it('leaves it to the team once a task started, or the action moved on', async () => {
    const target = { id: ACTION, brandId: BRAND, data: {}, userId: ME };
    db.tables.action_tasks[0].status = 'in_progress';
    await expect(rule.inverse(target)).resolves.toBe('changed');
    db.tables.action_tasks[0].status = 'todo';
    db.tables.actions[0].status = 'on_hold';
    await expect(rule.inverse(target)).resolves.toBe('changed');
    expect(db.tables.actions[0].deleted_at).toBeNull();
    expect(events('cancelled')).toEqual([]);
  });
});

describe('attach_to_action', () => {
  const rule = RULES.attach_to_action;

  it('withdraws the finding once, as a new History event', async () => {
    db.tables.action_events.push({ id: 'ev-1', action_id: ACTION, event: 'evidence_attached' });
    const recorded = await rule.record(
      { finding: 'Lost 6 citations.' },
      { ok: true, action_id: ACTION, action_no: 1258, event_id: 'ev-1' },
      null,
    );
    expect(recorded).toEqual({
      target: { type: 'action', id: ACTION },
      summaryParams: { no: 'AC-1258', finding: 'Lost 6 citations.' },
      undo: { after: { eventId: 'ev-1' } },
    });
    const target = { id: ACTION, brandId: BRAND, data: recorded.undo!, userId: ME };
    await expect(rule.inverse(target)).resolves.toBe('ok');
    // The finding stays in History, with its withdrawal after it.
    expect(events('evidence_attached')).toHaveLength(1);
    expect(events('evidence_withdrawn')).toEqual([
      expect.objectContaining({
        actor_id: ME,
        data: { source: 'chat', via: 'undo', eventId: 'ev-1' },
      }),
    ]);
    await expect(rule.inverse(target)).resolves.toBe('changed');
    await expect(
      rule.inverse({ ...target, data: { after: { eventId: 'not-there' } } }),
    ).resolves.toBe('gone');
  });
});

describe('attach_file_to_task', () => {
  const rule = RULES.attach_file_to_task;
  const attached = { ok: true, file_id: FILE, task_id: TASK, action_id: ACTION, already: false };

  beforeEach(() => {
    db.tables.chat_file_task_links.push({ file_id: FILE, action_task_id: TASK });
    db.tables.chat_files[0].status = 'attached';
  });

  it('names the file and the task, and keeps no Undo when it was attached already', async () => {
    const recorded = await rule.record({ task_id: TASK }, attached, null);
    expect(recorded).toMatchObject({
      target: { type: 'action_task', id: TASK },
      summaryParams: { file: 'Pricing FAQ', task: 'AC-1258 “Add a pricing FAQ block to /pricing”' },
      undo: { after: { fileId: FILE, actionId: ACTION } },
    });
    expect((await rule.record({}, { ...attached, already: true }, null)).undo).toBeNull();
  });

  it('takes it off the task, back to a draft, in History', async () => {
    const { undo } = await rule.record({ task_id: TASK }, attached, null);
    await expect(rule.inverse({ id: TASK, brandId: BRAND, data: undo!, userId: ME })).resolves.toBe(
      'ok',
    );
    expect(db.tables.chat_file_task_links).toEqual([]);
    expect(db.tables.chat_files[0].status).toBe('draft');
    expect(events('file_detached')).toEqual([
      expect.objectContaining({
        action_id: ACTION,
        actor_id: ME,
        data: expect.objectContaining({ source: 'chat', via: 'undo', fileId: FILE, taskId: TASK }),
      }),
    ]);
  });

  it('keeps it attached where another task has it, and leaves a task done with it', async () => {
    const { undo } = await rule.record({ task_id: TASK }, attached, null);
    db.tables.chat_file_task_links.push({ file_id: FILE, action_task_id: 'other-task' });
    await expect(rule.inverse({ id: TASK, brandId: BRAND, data: undo!, userId: ME })).resolves.toBe(
      'ok',
    );
    expect(db.tables.chat_files[0].status).toBe('attached');

    db.tables.chat_file_task_links.push({ file_id: FILE, action_task_id: TASK });
    db.tables.chat_files[0].status = 'done';
    await expect(rule.inverse({ id: TASK, brandId: BRAND, data: undo!, userId: ME })).resolves.toBe(
      'changed',
    );
  });
});

describe('set_task_ready_for_review', () => {
  const rule = RULES.set_task_ready_for_review;
  const set = (previous: string | null) => ({
    ok: true,
    task_id: TASK,
    action_id: ACTION,
    conversation_id: CONVERSATION,
    previous,
  });
  const state = (chatStatus: string) =>
    db.tables.chat_task_state.push({
      conversation_id: CONVERSATION,
      action_task_id: TASK,
      position: 1,
      chat_status: chatStatus,
    });

  it("takes a task the strip didn't have off it again", async () => {
    state('ready_for_review');
    const { undo } = await rule.record({ task_id: TASK }, set(null), null);
    await expect(rule.inverse({ id: TASK, brandId: BRAND, data: undo!, userId: ME })).resolves.toBe(
      'ok',
    );
    expect(db.tables.chat_task_state).toEqual([]);
    expect(events('task_review_withdrawn')).toHaveLength(1);
  });

  it('puts back what the chat had, and leaves a task that moved on since', async () => {
    state('ready_for_review');
    const { undo } = await rule.record({ task_id: TASK }, set('writing'), null);
    await expect(rule.inverse({ id: TASK, brandId: BRAND, data: undo!, userId: ME })).resolves.toBe(
      'ok',
    );
    expect(db.tables.chat_task_state[0].chat_status).toBe('writing');

    db.tables.chat_task_state[0].chat_status = 'done';
    await expect(rule.inverse({ id: TASK, brandId: BRAND, data: undo!, userId: ME })).resolves.toBe(
      'changed',
    );
  });

  it('keeps no Undo when the task was ready for review already', async () => {
    expect((await rule.record({ task_id: TASK }, set('ready_for_review'), null)).undo).toBeNull();
  });
});

describe('from the Activity log', () => {
  it('logs a sent action with its Undo, and Undo cancels it', async () => {
    vi.mocked(createChatAction).mockImplementation(fakeCreateChatAction(db) as never);
    const tool = chatTool('create_action')!;
    const input = tool.inputSchema.parse({ ...tool.fixture.input, brand_id: BRAND });
    const outcome = await runLoggedWrite({
      tool,
      input,
      ctx: {} as never,
      organizationId: ORG,
      userId: ME,
      brandId: BRAND,
      surface: 'chat',
      mode: 'full_auto',
      approval: { kind: 'auto', via: 'full_auto' },
      place: { conversationId: null, runId: null, stepId: null },
      approvalKey: 'step-1',
    });
    expect(outcome).toMatchObject({ code: 'ok' });
    const made = db.tables.actions.find((a) => a.kind === 'chat_finding')!;
    const row = db.tables.chat_activity_log[0];
    expect(row).toMatchObject({ tool_key: 'sendToActions', target_id: made.id });

    const undone = await undoChange({
      activityId: row.id as string,
      userId: ME,
      organizationId: ORG,
      surface: 'chat',
    });
    expect(undone).toMatchObject({ code: 'ok', message: 'Undone.' });
    expect(db.tables.actions.find((a) => a.id === made.id)).toMatchObject({ status: 'dismissed' });
    expect(events('cancelled')[0]).toMatchObject({ action_id: made.id, actor_id: ME });
  });
});
