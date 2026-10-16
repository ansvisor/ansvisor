import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Regenerate tasks" (AC-004): off unless the deployment writes tasks,
 * checked against the caller's organization first, and a rewrite that wrote
 * nothing says why.
 */

let action;
vi.mock('../config/supabase.js', () => ({
  default: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: action, error: null }),
      };
      return chain;
    },
  },
}));

const assertBrandAccess = vi.fn();
vi.mock('../lib/access.js', () => ({ assertBrandAccess: (...args) => assertBrandAccess(...args) }));
vi.mock('../lib/action-center/priority-data.js', () => ({ rescoreActionsForSignal: vi.fn() }));

let enabled;
const writeTasksForAction = vi.fn();
class TaskWriterError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
class PlanLimitError extends Error {}
vi.mock('../lib/plan-guard.js', () => ({ PlanLimitError }));
vi.mock('../lib/action-center/task-writer/index.js', () => ({
  TaskWriterError,
  isTaskWriterEnabled: () => enabled,
  writeTasksForAction: (...args) => writeTasksForAction(...args),
}));

const loadTask = vi.fn();
const sendTaskToContent = vi.fn();
const sendTaskToWebhook = vi.fn();
vi.mock('../lib/action-center/task-send.js', () => ({
  TaskSendError: class extends Error {},
  loadTask: (...args) => loadTask(...args),
  sendTaskToContent: (...args) => sendTaskToContent(...args),
  sendTaskToWebhook: (...args) => sendTaskToWebhook(...args),
}));

const { regenerateTasks, sendTask } = await import('./action-center.js');

beforeEach(() => {
  enabled = true;
  action = { id: 'a1', brand_id: 'b1' };
  assertBrandAccess.mockReset();
  writeTasksForAction.mockReset();
});

describe('regenerateTasks', () => {
  it('is not found while the deployment does not write tasks', async () => {
    enabled = false;
    await expect(regenerateTasks('a1', 'u1')).rejects.toMatchObject({
      status: 404,
      code: 'disabled',
    });
    expect(writeTasksForAction).not.toHaveBeenCalled();
  });

  it("checks the caller's access before writing anything", async () => {
    assertBrandAccess.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    await expect(regenerateTasks('a1', 'u1')).rejects.toThrow('Forbidden');
    expect(assertBrandAccess).toHaveBeenCalledWith('b1', 'u1');
    expect(writeTasksForAction).not.toHaveBeenCalled();
  });

  it('writes as the caller and says how many were written and kept', async () => {
    writeTasksForAction.mockResolvedValueOnce({ status: 'written', tasks: [{}, {}, {}], kept: 2 });
    expect(await regenerateTasks('a1', 'u1')).toEqual({ written: 3, kept: 2 });
    expect(writeTasksForAction).toHaveBeenCalledWith('a1', { trigger: 'regenerate', userId: 'u1' });
  });

  it('says why nothing was written', async () => {
    writeTasksForAction.mockResolvedValueOnce({ status: 'skipped', reason: 'no_targets' });
    await expect(regenerateTasks('a1', 'u1')).rejects.toMatchObject({
      status: 422,
      code: 'no_targets',
    });
  });

  it('says the budget is spent, as a code the drawer words', async () => {
    writeTasksForAction.mockRejectedValueOnce(new PlanLimitError('Budget used up'));
    await expect(regenerateTasks('a1', 'u1')).rejects.toMatchObject({
      status: 429,
      code: 'budget',
    });
  });
});

describe('sendTask', () => {
  beforeEach(() => {
    loadTask.mockReset().mockResolvedValue({ task: { id: 't1' }, action: { brand_id: 'b1' } });
    sendTaskToContent.mockReset().mockResolvedValue({ opportunityId: 'o1', created: true });
    sendTaskToWebhook.mockReset().mockResolvedValue({ delivered: 1, failed: 0 });
  });

  it("checks the caller's access to the task's brand before sending", async () => {
    assertBrandAccess.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    await expect(sendTask('t1', { to: 'content' }, 'u1')).rejects.toThrow('Forbidden');
    expect(assertBrandAccess).toHaveBeenCalledWith('b1', 'u1');
    expect(sendTaskToContent).not.toHaveBeenCalled();
  });

  it('sends where it was asked, with the text the drawer shows', async () => {
    expect(await sendTask('t1', { to: 'content', title: 'Refresh /a' }, 'u1')).toEqual({
      opportunityId: 'o1',
      created: true,
    });
    expect(sendTaskToContent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't1', title: 'Refresh /a', userId: 'u1' }),
    );
    await sendTask('t1', { to: 'webhook' }, 'u1');
    expect(sendTaskToWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't1', userId: 'u1' }),
    );
  });
});
