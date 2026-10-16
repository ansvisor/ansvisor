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

const { regenerateTasks } = await import('./action-center.js');

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
