// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';
import { ACTION, FILE, TASK, seedActionCenter } from '@/lib/chat/testing/action-center-fixtures';

/**
 * Chat's changes to the Action Center (CHAT-09 §D–E; CHAT-20 §9 rows
 * 43–46): Send to Action Center goes through the server's route with the
 * run's place and one idempotency key per approval, and its duplicate comes
 * back for the model to offer Add to AC-{n}; a finding, a file and Ready for
 * review are each written once, with their History event from Chat; and
 * nothing here completes a task or touches an action's targets. Admins and
 * Managers only; a chat that isn't the person's is never recorded as theirs.
 */

const ME = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BRAND = '33333333-3333-4333-8333-333333333333';
const CHAT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RUN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));
const manager = vi.hoisted(() => ({ is: true }));
vi.mock('@/lib/session-role', () => ({ isManager: async () => manager.is }));
const writable = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/subscription-guard', () => ({ assertWritable: writable }));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));
vi.mock('@/lib/supabase/server', async () => {
  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  const db = supabaseAdmin as unknown as FakeSupabase;
  return {
    // The member's own client: the same rows here (RLS isn't what these tests are about).
    createClient: async () => ({
      from: (table: string) => db.from(table),
      auth: {
        getUser: async () => ({ data: { user: { id: ME } } }),
        getSession: async () => ({ data: { session: { access_token: 'token-1' } } }),
      },
    }),
  };
});

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const {
  attachFileToTask,
  attachToAction,
  checkChatActionCover,
  createChatAction,
  setTaskReadyForReview,
} = await import('./chat-action-center');

const place = {
  conversationId: CHAT,
  runId: RUN,
  approvalKey: 'step-1',
  executionMode: 'assisted' as const,
};
const proposal = {
  title: 'Win back pricing citations on /pricing',
  category: 'recover' as const,
  why: 'Google AI Overviews stopped citing /pricing.',
  entities: { prompts: [], pages: ['/pricing'], competitors: [], platforms: [] },
  tasks: [
    {
      title: 'Add a pricing FAQ block to /pricing',
      type: 'on_page' as const,
      url: '/pricing',
      done_when: 'The FAQ block is live',
    },
  ],
};
const fetchMock = vi.fn();
const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
const sent = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
const events = (event: string) => db.tables.action_events.filter((e) => e.event === event);

beforeEach(() => {
  vi.clearAllMocks();
  manager.is = true;
  vi.stubGlobal('fetch', fetchMock);
  db.tables = {};
  db.unique = {};
  db.failures = {};
  seedActionCenter(db);
  for (const row of db.tables.actions) row.brand_id = BRAND;
  for (const row of db.tables.action_tasks)
    row.actions = { action_no: 1258, brand_id: BRAND, status: 'new' };
  for (const row of db.tables.chat_files) row.brand_id = BRAND;
  db.tables.chat_conversations = [{ id: CHAT, user_id: ME }];
  db.tables.chat_runs = [{ id: RUN, conversation_id: CHAT }];
});
afterEach(() => vi.unstubAllGlobals());

describe('createChatAction (Send to Action Center)', () => {
  it("sends it through the server's route, with the chat, the run and the approval's key", async () => {
    answer(201, { actionId: ACTION, actionNo: 1271, created: true });
    await expect(createChatAction(BRAND, proposal, place)).resolves.toEqual({
      ok: true,
      action_id: ACTION,
      action_no: 1271,
      created: true,
      href: `/dashboard/action-center/actions/${ACTION}`,
    });
    expect(writable).toHaveBeenCalledWith({ brandId: BRAND });
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/api/action-center/chat-actions');
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer token-1' });
    expect(sent()).toEqual({
      brandId: BRAND,
      proposal,
      conversationId: CHAT,
      runId: RUN,
      executionMode: 'assisted',
      idempotencyKey: 'chat:step-1',
      createAnyway: false,
    });
  });

  /** As every person's send: never refused for the day's new actions, and said once they're reached. */
  it("passes on the one sentence Chat says when the day's new actions are reached", async () => {
    answer(201, {
      actionId: ACTION,
      actionNo: 1275,
      created: true,
      dailyLimit: { used: 5, limit: 5, reached: true },
    });
    await expect(createChatAction(BRAND, proposal, place)).resolves.toEqual({
      ok: true,
      action_id: ACTION,
      action_no: 1275,
      created: true,
      href: `/dashboard/action-center/actions/${ACTION}`,
      daily_limit_reached: true,
      daily_limit_note:
        "This is one of the 5 new actions the brand gets today, so Action Center's own new actions wait until tomorrow.",
    });
    // Below the limit, or without a count: nothing to say.
    answer(201, {
      actionId: ACTION,
      actionNo: 1276,
      created: true,
      dailyLimit: { used: 4, limit: 5, reached: false },
    });
    const below = await createChatAction(BRAND, proposal, place);
    expect(below).not.toHaveProperty('daily_limit_reached');
    expect(below).not.toHaveProperty('daily_limit_note');
  });

  it("records automated in Full auto, and never a chat that isn't the person's", async () => {
    answer(201, { actionId: ACTION, actionNo: 1271, created: true });
    await createChatAction(BRAND, proposal, {
      ...place,
      conversationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      executionMode: 'automated',
    });
    expect(sent()).toMatchObject({ conversationId: null, runId: null, executionMode: 'automated' });
  });

  it('answers a duplicate with the action that covers it, for Add to AC-{n}', async () => {
    answer(409, {
      code: 'duplicate',
      action: { id: ACTION, no: 1258, covers: 'some' },
      canCreateAnyway: true,
    });
    await expect(createChatAction(BRAND, proposal, place, true)).resolves.toEqual({
      ok: false,
      reason: 'duplicate',
      message: 'AC-1258 already covers this.',
      action_id: ACTION,
      action_no: 1258,
      can_create_anyway: true,
    });
    expect(sent().createAnyway).toBe(true);
  });

  it('refuses an Analyst before anything is sent, and says the server’s refusals in words', async () => {
    manager.is = false;
    await expect(createChatAction(BRAND, proposal, place)).resolves.toMatchObject({
      ok: false,
      reason: 'forbidden_role',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    manager.is = true;
    answer(400, { details: 'Task 1 only looks ("Analyze pricing"): say the change to make.' });
    await expect(createChatAction(BRAND, proposal, place)).resolves.toEqual({
      ok: false,
      reason: 'invalid',
      message: 'Task 1 only looks ("Analyze pricing"): say the change to make.',
    });
    fetchMock.mockRejectedValueOnce(new Error('down'));
    await expect(createChatAction(BRAND, proposal, place)).resolves.toMatchObject({
      ok: false,
      reason: 'failed',
    });
  });
});

describe('checkChatActionCover', () => {
  it('goes on when nothing covers it, or the check fails; else names the closest action', async () => {
    answer(200, { covering: [] });
    await expect(checkChatActionCover(BRAND, proposal.entities, 'recover')).resolves.toEqual({
      ok: true,
    });
    expect(sent()).toEqual({ brandId: BRAND, entities: proposal.entities, category: 'recover' });
    answer(200, { covering: [{ actionId: ACTION, actionNo: 1258, covers: 'all' }] });
    await expect(checkChatActionCover(BRAND, proposal.entities)).resolves.toMatchObject({
      reason: 'duplicate',
      action_no: 1258,
      can_create_anyway: false,
    });
    fetchMock.mockRejectedValueOnce(new Error('down'));
    await expect(checkChatActionCover(BRAND, proposal.entities)).resolves.toEqual({ ok: true });
  });
});

describe('attachToAction (Add to AC-{n})', () => {
  it('adds the finding to its History from Chat, and changes nothing else', async () => {
    const before = JSON.stringify(db.tables.actions);
    const added = await attachToAction(
      ACTION,
      { finding: 'Lost 6 citations on /pricing.', note: 'Same pages', sources: ['Citations'] },
      { ...place, executionMode: 'automated' },
    );
    expect(added).toMatchObject({ ok: true, action_id: ACTION, action_no: 1258 });
    expect(events('evidence_attached')).toEqual([
      expect.objectContaining({
        action_id: ACTION,
        actor_id: ME,
        data: {
          source: 'chat',
          finding: 'Lost 6 citations on /pricing.',
          note: 'Same pages',
          sources: ['Citations'],
          conversationId: CHAT,
          runId: RUN,
          execution: { mode: 'automated' },
        },
      }),
    ]);
    // Its targets never grow: the action itself isn't written.
    expect(JSON.stringify(db.tables.actions)).toBe(before);
  });

  it('refuses a closed action, and one it can’t find', async () => {
    db.tables.actions[0].status = 'completed';
    await expect(attachToAction(ACTION, { finding: 'x' }, place)).resolves.toMatchObject({
      reason: 'conflict',
    });
    await expect(
      attachToAction('ffffffff-ffff-4fff-8fff-ffffffffffff', { finding: 'x' }, place),
    ).resolves.toMatchObject({ reason: 'not_found' });
    expect(events('evidence_attached')).toEqual([]);
  });
});

describe('attachFileToTask (Attach only)', () => {
  it('links the file by the person, marks it attached, and says so in History, once', async () => {
    await expect(attachFileToTask(BRAND, TASK, FILE, place)).resolves.toEqual({
      ok: true,
      file_id: FILE,
      task_id: TASK,
      action_id: ACTION,
      already: false,
    });
    expect(db.tables.chat_file_task_links).toEqual([
      expect.objectContaining({ file_id: FILE, action_task_id: TASK, attached_by: ME }),
    ]);
    expect(db.tables.chat_files[0].status).toBe('attached');
    // The task stays as it was: marking it done is the person's click.
    expect(db.tables.action_tasks[0].status).toBe('todo');
    expect(events('file_attached')).toEqual([
      expect.objectContaining({
        action_id: ACTION,
        actor_id: ME,
        data: expect.objectContaining({
          source: 'chat',
          taskId: TASK,
          title: 'Add a pricing FAQ block to /pricing',
          fileId: FILE,
          file: 'Pricing FAQ',
          execution: { mode: 'assisted' },
        }),
      }),
    ]);

    await expect(attachFileToTask(BRAND, TASK, FILE, place)).resolves.toMatchObject({
      already: true,
    });
    expect(events('file_attached')).toHaveLength(1);
  });

  it("refuses another brand's task or file, and a closed action's task", async () => {
    await expect(
      attachFileToTask('99999999-0000-4000-8000-000000000000', TASK, FILE, place),
    ).resolves.toMatchObject({ reason: 'not_found' });
    db.tables.chat_files[0].brand_id = '99999999-0000-4000-8000-000000000000';
    await expect(attachFileToTask(BRAND, TASK, FILE, place)).resolves.toMatchObject({
      reason: 'not_found',
    });
    db.tables.chat_files[0].brand_id = BRAND;
    (db.tables.action_tasks[0].actions as { status: string }).status = 'dismissed';
    await expect(attachFileToTask(BRAND, TASK, FILE, place)).resolves.toMatchObject({
      reason: 'conflict',
    });
    expect(db.tables.chat_file_task_links).toEqual([]);
  });
});

describe('setTaskReadyForReview', () => {
  it("puts the task last in the chat's strip as Ready for review, and says so in History", async () => {
    db.tables.chat_task_state.push({
      conversation_id: CHAT,
      action_task_id: 'other-task',
      position: 2,
      chat_status: 'writing',
    });
    await expect(setTaskReadyForReview(BRAND, TASK, place)).resolves.toEqual({
      ok: true,
      task_id: TASK,
      action_id: ACTION,
      conversation_id: CHAT,
      previous: null,
    });
    expect(db.tables.chat_task_state.find((s) => s.action_task_id === TASK)).toMatchObject({
      position: 3,
      chat_status: 'ready_for_review',
      run_id: RUN,
    });
    // Its Action Center status doesn't change.
    expect(db.tables.action_tasks[0].status).toBe('todo');
    expect(events('task_ready_for_review')).toEqual([
      expect.objectContaining({
        action_id: ACTION,
        actor_id: ME,
        data: expect.objectContaining({ source: 'chat', taskId: TASK, conversationId: CHAT }),
      }),
    ]);
  });

  it('moves a task the chat was writing, and says what it was for Undo', async () => {
    db.tables.chat_task_state.push({
      conversation_id: CHAT,
      action_task_id: TASK,
      position: 1,
      chat_status: 'writing',
    });
    await expect(setTaskReadyForReview(BRAND, TASK, place)).resolves.toMatchObject({
      previous: 'writing',
    });
    expect(db.tables.chat_task_state[0].chat_status).toBe('ready_for_review');
  });

  it('refuses a task done in Action Center, and outside a chat', async () => {
    await expect(setTaskReadyForReview(BRAND, TASK, undefined)).resolves.toMatchObject({
      reason: 'invalid',
    });
    db.tables.action_tasks[0].status = 'completed';
    await expect(setTaskReadyForReview(BRAND, TASK, place)).resolves.toMatchObject({
      reason: 'conflict',
    });
    expect(db.tables.chat_task_state).toEqual([]);
  });
});
