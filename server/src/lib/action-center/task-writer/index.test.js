import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The task writer end to end (AC-004), on an in-memory database and a
 * scripted model: which tasks a rewrite keeps, the one retry for refused
 * tasks, metering, dry runs and a spent budget.
 */

let db;
let ops;

/** A query builder over `db`, recording every write. */
function table(name) {
  const q = {
    name,
    op: 'select',
    filters: [],
    payload: null,
    single: false,
    returning: false,
    free: false,
  };
  const rows = () =>
    (db[name] ?? [])
      .filter((row) => (q.free ? !row.tasks_writing_since : true))
      .filter((row) =>
        q.filters.every(([col, value]) =>
          col === 'action_signals.action_id'
            ? true
            : Array.isArray(value)
              ? value.includes(row[col])
              : row[col] === value,
        ),
      );
  const run = () => {
    if (q.op === 'select') {
      const data = rows();
      return { data: q.single ? (data[0] ?? null) : data, error: null };
    }
    ops.push({ table: name, op: q.op, payload: q.payload, filters: q.filters });
    if (q.op === 'insert' && name === 'action_tasks') {
      const inserted = q.payload.map((row, i) => ({ id: `new-${i + 1}`, ...row }));
      db.action_tasks.push(...inserted);
      return { data: inserted, error: null };
    }
    if (q.op === 'delete') {
      const ids = q.filters.find(([col]) => col === 'id')?.[1] ?? [];
      db[name] = db[name].filter((row) => !ids.includes(row.id));
    }
    if (q.op === 'update') {
      const matched = rows();
      for (const row of matched) Object.assign(row, q.payload);
      return { data: q.returning ? matched.map((row) => ({ id: row.id })) : null, error: null };
    }
    return { data: null, error: null };
  };
  const chain = {
    select: () => ((q.returning = q.op !== 'select'), chain),
    // Only the claim uses or(): a free action, or one whose writer died.
    or: () => ((q.free = true), chain),
    eq: (col, value) => (q.filters.push([col, value]), chain),
    in: (col, value) => (q.filters.push([col, value]), chain),
    is: () => chain,
    gte: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => chain,
    insert: (payload) => ((q.op = 'insert'), (q.payload = payload), chain),
    update: (payload) => ((q.op = 'update'), (q.payload = payload), chain),
    delete: () => ((q.op = 'delete'), chain),
    maybeSingle: async () => ((q.single = true), run()),
    single: async () => ((q.single = true), run()),
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  };
  return chain;
}

vi.mock('../../../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));

const generateObject = vi.fn();
vi.mock('ai', () => ({
  generateObject: (...args) => generateObject(...args),
  NoObjectGeneratedError: { isInstance: () => false },
}));
vi.mock('../../ai-provider.js', () => ({ resolveModel: () => ({}) }));
vi.mock('../../logger.js', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const enforceImproveQuota = vi.fn();
class PlanLimitError extends Error {}
vi.mock('../../plan-guard.js', () => ({
  enforceImproveQuota: (...args) => enforceImproveQuota(...args),
  PlanLimitError,
}));
vi.mock('../definitions/index.js', () => ({
  loadDefinitions: async () => [{ id: 'recover_lost_citations', name: 'Recover Lost Citations' }],
}));
vi.mock('../from-prompt-improve.js', () => ({ IMPROVE_ACTION_KIND: 'prompt_improve' }));
vi.mock('../from-opportunity.js', () => ({ OPPORTUNITY_ACTION_KIND: 'content_opportunity' }));

const { isTouched, keepsTask, sweepActionTasks, writeTasksForAction } = await import('./index.js');

const task = (over = {}) => ({
  title: 'Add a 2026 shipping table to /blog/shipping',
  where: 'acme.example/blog/shipping · lost on ChatGPT',
  why: 'Cited #2 until Oct 12.',
  how: ['Add a table.', 'Put "2026" in the title.'],
  doneWhen: 'Cited again within 14 days.',
  type: 'content',
  effort: '~2h',
  role: 'Content writer',
  refs: ['page:1'],
  ...over,
});
const answer = (tasks) => ({ object: { tasks }, usage: { inputTokens: 1000, outputTokens: 500 } });

beforeEach(() => {
  ops = [];
  generateObject.mockReset();
  enforceImproveQuota.mockReset();
  process.env.ACTION_TASKS_AI = 'true';
  db = {
    actions: [
      {
        id: 'a1',
        brand_id: 'b1',
        kind: 'recover_lost_citations',
        category: 'recover',
        status: 'new',
        payload: {},
      },
    ],
    brands: [{ id: 'b1', name: 'Acme Coffee', description: null, organization_id: 'o1' }],
    brand_domains: [{ brand_id: 'b1', domain: 'acme.example' }],
    signals: [
      {
        id: 's1',
        brand_id: 'b1',
        kind: 'lost_citations',
        status: 'new',
        action_id: 'a1',
        payload: {
          promptId: 'p1',
          promptText: 'Which coffee subscriptions ship internationally?',
          lostUrls: [{ url: 'https://acme.example/blog/shipping', position: 2 }],
          citedNow: [{ url: 'https://seriouseats.com/best', domain: 'seriouseats.com' }],
        },
      },
    ],
    action_tasks: [
      {
        id: 't1',
        action_id: 'a1',
        position: 1,
        task_key: 'analyze_citations',
        status: 'completed',
        details: null,
      },
      {
        id: 't2',
        action_id: 'a1',
        position: 2,
        task_key: 'refresh_content',
        status: 'in_progress',
        details: null,
      },
      {
        id: 't3',
        action_id: 'a1',
        position: 3,
        task_key: 'prepare_outreach',
        status: 'todo',
        details: null,
      },
      { id: 't4', action_id: 'a1', position: 4, task_key: null, status: 'todo', details: null },
    ],
  };
});

describe('keepsTask', () => {
  it('keeps work done or under way and what a person added; never the analysis', () => {
    expect(keepsTask({ task_key: 'refresh_content', status: 'completed' })).toBe(true);
    expect(keepsTask({ task_key: 'refresh_content', status: 'in_progress' })).toBe(true);
    expect(keepsTask({ task_key: 'refresh_content', status: 'todo' })).toBe(false);
    expect(keepsTask({ task_key: null, status: 'todo', details: null })).toBe(true);
    expect(keepsTask({ task_key: null, status: 'todo', details: { source: 'ai' } })).toBe(false);
    expect(keepsTask({ task_key: 'analyze_citations', status: 'completed' })).toBe(false);
    expect(keepsTask({ task_key: 'validate_citations', status: 'in_progress' })).toBe(false);
    // Sent to Content or a webhook: kept, whatever its status.
    expect(
      keepsTask({
        task_key: null,
        status: 'todo',
        details: { source: 'ai', sent: { webhook: {} } },
      }),
    ).toBe(true);
  });
});

describe('isTouched', () => {
  it('reads a plan as untouched until someone works on it', () => {
    const template = { task_key: 'refresh_content', title: null, status: 'todo', details: null };
    expect(isTouched([template])).toBe(false);
    expect(isTouched([{ ...template, status: 'in_progress' }])).toBe(true);
    expect(isTouched([{ ...template, title: 'Refresh /pricing' }])).toBe(true);
    expect(isTouched([{ task_key: null, title: 'Call G2', status: 'todo', details: null }])).toBe(
      true,
    );
    expect(
      isTouched([{ task_key: null, title: 'x', status: 'todo', details: { source: 'ai' } }]),
    ).toBe(false);
  });
});

describe('writeTasksForAction', () => {
  it('asks once more for the refused tasks, then writes the kept and the written in order', async () => {
    generateObject
      .mockResolvedValueOnce(
        answer([
          task(),
          task({ title: 'Refresh content for 7 prompts', refs: ['page:1'] }),
          task({
            title: 'Pitch acme to seriouseats.com',
            where: 'seriouseats.com/best',
            refs: ['domain:1'],
            type: 'outreach',
          }),
        ]),
      )
      .mockResolvedValueOnce(
        answer([task({ title: 'Link /blog/shipping from the pricing page', type: 'on_page' })]),
      );

    const result = await writeTasksForAction('a1', { trigger: 'regenerate', userId: 'u1' });

    expect(result).toMatchObject({ status: 'written', kept: 2 });
    expect(result.tasks.map((t) => t.title)).toEqual([
      'Add a 2026 shipping table to /blog/shipping',
      'Pitch acme to seriouseats.com',
      'Link /blog/shipping from the pricing page',
    ]);
    // The retry named what was refused and why.
    expect(generateObject.mock.calls[1][0].prompt).toContain(
      '"Refresh content for 7 prompts": the title counts prompts or pages instead of naming one',
    );

    const tasks = [...db.action_tasks].sort((a, b) => a.position - b.position);
    expect(tasks.map((t) => [t.position, t.task_key ?? t.title ?? t.id])).toEqual([
      [1, 'refresh_content'],
      [2, 't4'],
      [3, 'Add a 2026 shipping table to /blog/shipping'],
      [4, 'Pitch acme to seriouseats.com'],
      [5, 'Link /blog/shipping from the pricing page'],
    ]);
    expect(tasks[2].details).toMatchObject({ source: 'ai', type: 'content', refs: ['page:1'] });

    const usage = ops.filter((op) => op.table === 'prompt_improve_usage');
    expect(usage).toHaveLength(2);
    expect(usage[0].payload).toMatchObject({
      organization_id: 'o1',
      action_id: 'a1',
      feature: 'action_center',
    });
    expect(ops.find((op) => op.table === 'action_events').payload).toMatchObject({
      event: 'tasks_generated',
      data: { count: 3, kept: 2, trigger: 'regenerate' },
      actor_id: 'u1',
    });
    expect(db.actions[0].tasks_generated_at).toEqual(expect.any(String));
  });

  it('writes and charges nothing on a dry run', async () => {
    generateObject.mockResolvedValueOnce(answer([task()]));
    const result = await writeTasksForAction('a1', { dryRun: true });
    expect(result.status).toBe('preview');
    expect(result.costUsd).toBeGreaterThan(0);
    expect(ops).toEqual([]);
    expect(enforceImproveQuota).not.toHaveBeenCalled();
  });

  it('calls no model when the signals name nothing to work on', async () => {
    db.signals[0].payload = {};
    const result = await writeTasksForAction('a1', { trigger: 'regenerate' });
    expect(result).toMatchObject({ status: 'skipped', reason: 'no_targets' });
    expect(generateObject).not.toHaveBeenCalled();
    expect(db.actions[0].tasks_generated_at).toEqual(expect.any(String));
  });

  it('leaves the tasks as they are once the budget is spent', async () => {
    enforceImproveQuota.mockRejectedValueOnce(new PlanLimitError('Budget used up'));
    await expect(writeTasksForAction('a1', { trigger: 'regenerate' })).rejects.toThrow(
      'Budget used up',
    );
    expect(generateObject).not.toHaveBeenCalled();
    expect(ops.filter((op) => op.table !== 'actions')).toEqual([]);
    expect(db.actions[0].tasks_writing_since).toBeNull();
  });

  it('leaves a plan someone is working through to the night, and releases its claim', async () => {
    const result = await writeTasksForAction('a1', { trigger: 'auto' });
    expect(result).toMatchObject({ status: 'skipped', reason: 'in_use' });
    expect(generateObject).not.toHaveBeenCalled();
    expect(db.actions[0].tasks_writing_since).toBeNull();
  });

  it('refuses while another writer has the action', async () => {
    db.actions[0].tasks_writing_since = new Date().toISOString();
    await expect(writeTasksForAction('a1', { trigger: 'regenerate' })).rejects.toMatchObject({
      code: 'busy',
      status: 409,
    });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('refuses an action a person sent, which carries its own tasks', async () => {
    db.actions[0].kind = 'prompt_improve';
    await expect(writeTasksForAction('a1')).rejects.toThrow('carries the tasks it was sent with');
  });
});

describe('sweepActionTasks', () => {
  it('does nothing unless the deployment writes tasks', async () => {
    process.env.ACTION_TASKS_AI = '';
    expect(await sweepActionTasks()).toEqual({ skipped: 'disabled' });
  });

  it('skips the rest of a brand once its budget is spent', async () => {
    db.actions.push({ ...db.actions[0], id: 'a2' });
    db.action_tasks = [];
    enforceImproveQuota.mockRejectedValue(new PlanLimitError('Budget used up'));
    const outcome = await sweepActionTasks();
    expect(outcome).toEqual({ written: 0, skipped: 0, failed: 1 });
    expect(enforceImproveQuota).toHaveBeenCalledTimes(1);
  });
});
