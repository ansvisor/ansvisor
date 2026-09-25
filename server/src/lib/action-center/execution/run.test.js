import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();
const rpc = vi.fn();
vi.mock('../../../config/supabase.js', () => ({
  default: { from: (...a) => from(...a), rpc: (...a) => rpc(...a) },
}));
vi.mock('../../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../composio.js', () => ({ runGaReport: vi.fn() }));

import { blockedReason, runTask } from './run.js';
import { TOOLS } from './tools.js';

const TASK = 'task-1';
const ACTION = 'action-1';
const BRAND = 'brand-1';
const NOW = new Date('2026-09-25T06:00:00Z');
const ALL = new Set(['tracking', 'competitors', 'site_audits', 'analytics']);

/**
 * Enough PostgREST to drive one run. Tables answer from fixtures; every write
 * is recorded so a test can assert what the attempt actually left behind.
 */
function mockDb({ task, action, siblings = [] }) {
  const writes = { inserted: [], updated: [] };
  from.mockImplementation((table) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      // `.single()` fetches one row — the task, or its action. Awaiting the
      // builder without it is the sibling list.
      single: () => Promise.resolve({ data: table === 'actions' ? action : task, error: null }),
      insert: (row) => {
        writes.inserted.push({ table, row });
        return Promise.resolve({ error: null });
      },
      update: (patch) => {
        writes.updated.push({ table, patch });
        return builder;
      },
      then: (resolve, reject) =>
        Promise.resolve({
          data: table === 'action_tasks' ? siblings : [],
          error: null,
        }).then(resolve, reject),
    };
    return builder;
  });
  return writes;
}

const task = (over = {}) => ({
  id: TASK,
  action_id: ACTION,
  task_key: 'validate',
  status: 'todo',
  depends_on: [],
  approved_by: null,
  ...over,
});

const action = { id: ACTION, brand_id: BRAND, payload: { promptCount: 4 } };

beforeEach(() => {
  from.mockReset();
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: { answers: 100, mention_answers: 20, citation_answers: 8 },
    error: null,
  });
});

describe('runTask', () => {
  it('carries out a task through its tool and stores the result', async () => {
    const writes = mockDb({ task: task(), action });

    const result = await runTask(TASK, { now: NOW, sources: ALL });

    expect(result.status).toBe('succeeded');
    const run = writes.inserted.find((w) => w.table === 'action_task_runs');
    expect(run.row).toMatchObject({
      task_id: TASK,
      action_id: ACTION,
      brand_id: BRAND,
      tool_id: 'visibility_window',
      status: 'succeeded',
    });
    expect(run.row.finished_at).toBeTruthy();

    const completed = writes.updated.find((w) => w.table === 'action_tasks');
    expect(completed.patch.status).toBe('completed');
    expect(completed.patch.output.answers).toBe(100);
  });

  /**
   * The rule the whole layer exists for. No tool that writes to a
   * third-party system ships yet, so this stands one in — the gate has to be
   * provable before there is something for it to hold back, not afterwards.
   */
  describe('changing something outside Ansvisor', () => {
    const outreach = { id: 'outreach', version: 1, writesExternally: true, source: 'tracking' };
    const primitive = { mode: 'agent', tool: 'outreach' };

    it('refuses to run without an approval', () => {
      expect(
        blockedReason({
          task: task({ approved_by: null }),
          primitive,
          tool: outreach,
          sources: ALL,
          siblings: [],
        }),
      ).toMatch(/not been approved/);
    });

    it('runs once a person has approved it', () => {
      expect(
        blockedReason({
          task: task({ approved_by: 'user-1' }),
          primitive,
          tool: outreach,
          sources: ALL,
          siblings: [],
        }),
      ).toBeNull();
    });

    /** Reading a system the brand connected is not a change. Requiring
     *  approval for it would teach people to approve without reading. */
    it('does not ask for approval to read', () => {
      expect(
        blockedReason({
          task: task({ approved_by: null }),
          primitive: { mode: 'agent', tool: 'visibility_window' },
          tool: TOOLS.visibility_window,
          sources: ALL,
          siblings: [],
        }),
      ).toBeNull();
    });
  });

  /** One step failing is one step to do by hand, not a plan cancelled. */
  it('fails the task and leaves the action alone', async () => {
    rpc.mockRejectedValue(new Error('statement timeout'));
    const writes = mockDb({ task: task(), action });

    const result = await runTask(TASK, { now: NOW, sources: ALL });

    expect(result.status).toBe('failed');
    expect(writes.updated.find((w) => w.table === 'action_tasks').patch.status).toBe('failed');
    expect(writes.updated.some((w) => w.table === 'actions')).toBe(false);
    const run = writes.inserted.find((w) => w.table === 'action_task_runs');
    expect(run.row).toMatchObject({ status: 'failed' });
    expect(run.row.error).toContain('timeout');
  });

  it('records a blocked attempt rather than passing over it in silence', async () => {
    const writes = mockDb({ task: task({ task_key: 'update_content' }), action });

    const result = await runTask(TASK, { now: NOW, sources: ALL });

    expect(result.status).toBe('blocked');
    expect(writes.inserted.find((w) => w.table === 'action_task_runs').row).toMatchObject({
      status: 'blocked',
    });
  });

  it('never stores the model’s reasoning, because nothing may put it there', async () => {
    const writes = mockDb({ task: task(), action });

    await runTask(TASK, { now: NOW, sources: ALL });

    const run = writes.inserted.find((w) => w.table === 'action_task_runs').row;
    expect(Object.keys(run)).toEqual(
      expect.not.arrayContaining(['reasoning', 'thoughts', 'chain_of_thought']),
    );
  });
});

describe('blockedReason', () => {
  const primitive = { mode: 'agent', tool: 'visibility_window' };
  const tool = TOOLS.visibility_window;

  it('lets a runnable task through', () => {
    expect(blockedReason({ task: task(), primitive, tool, sources: ALL, siblings: [] })).toBeNull();
  });

  it('stops a task a person owns', () => {
    expect(
      blockedReason({
        task: task(),
        primitive: { mode: 'manual', tool: null },
        tool: null,
        sources: ALL,
        siblings: [],
      }),
    ).toMatch(/by a person/);
  });

  /** Fourteen agent-mode tasks have no tool yet. Saying so is the difference
   *  between an honest gap and a silent one. */
  it('names the gap when a task is meant to be automated and is not yet', () => {
    expect(
      blockedReason({
        task: task({ task_key: 'coverage_gaps' }),
        primitive: { mode: 'agent', tool: null },
        tool: null,
        sources: ALL,
        siblings: [],
      }),
    ).toMatch(/no tool implements coverage_gaps/);
  });

  it('stops a tool whose source the brand does not have', () => {
    expect(
      blockedReason({
        task: task(),
        primitive,
        tool: { ...tool, source: 'analytics' },
        sources: new Set(['tracking']),
        siblings: [],
      }),
    ).toMatch(/no analytics source/);
  });

  it('waits for the tasks this one depends on', () => {
    expect(
      blockedReason({
        task: task({ depends_on: ['analyze_losses'] }),
        primitive,
        tool,
        sources: ALL,
        siblings: [{ task_key: 'analyze_losses', status: 'todo' }],
      }),
    ).toMatch(/waits on analyze_losses/);
  });

  it('treats a skipped dependency as finished, because nobody is going to do it', () => {
    expect(
      blockedReason({
        task: task({ depends_on: ['analyze_losses'] }),
        primitive,
        tool,
        sources: ALL,
        siblings: [{ task_key: 'analyze_losses', status: 'skipped' }],
      }),
    ).toBeNull();
  });

  it('ignores a dependency that was never planned', () => {
    expect(
      blockedReason({
        task: task({ depends_on: ['a_task_this_plan_does_not_have'] }),
        primitive,
        tool,
        sources: ALL,
        siblings: [],
      }),
    ).toBeNull();
  });

  it('does not re-run a task that is already done', () => {
    expect(
      blockedReason({
        task: task({ status: 'completed' }),
        primitive,
        tool,
        sources: ALL,
        siblings: [],
      }),
    ).toMatch(/is completed/);
  });
});
