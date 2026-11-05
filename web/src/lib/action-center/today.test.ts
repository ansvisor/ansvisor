import { describe, expect, it } from 'vitest';
import type { ActionItem } from '@/lib/actions/action-center';
import type { GettingStartedStep } from '@/lib/getting-started/steps';
import {
  TODAY_STEPS,
  firstOpenTask,
  nextSteps,
  patchToday,
  todayAction,
  todayRows,
  todayStep,
  weekStart,
  whoDoesIt,
  type TodayRead,
  type TodayTaskRow,
} from './today';

/** The Today card's helpers (AC-011): first step, who does it, the week, the rows. */

function task(position: number, overrides: Partial<TodayTaskRow> = {}): TodayTaskRow {
  return {
    action_id: 'a1',
    position,
    task_key: null,
    title: `Task ${position}`,
    title_params: null,
    status: 'todo',
    mode: 'human',
    url: null,
    ...overrides,
  };
}

function action(id: string, overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id,
    actionNo: 1,
    category: 'growth',
    kind: 'recover_lost_citations',
    impact: 'high',
    status: 'new',
    payload: {},
    kpiKeys: [],
    assignee: null,
    dueDate: null,
    createdAt: '2026-10-16T09:05:31Z',
    updatedAt: '2026-10-16T09:05:31Z',
    taskTotal: 1,
    taskCompleted: 0,
    signalCount: 1,
    priorityScore: 80,
    priorityLevel: 'high',
    priorityReason: null,
    ...overrides,
  };
}

describe('firstOpenTask', () => {
  it('is the first task still to do, by position, that a person or an agent does', () => {
    const tasks = [
      task(3, { title: 'Third' }),
      task(1, { status: 'completed' }),
      task(2, { mode: 'system', title: 'A check' }),
      task(0, { status: 'skipped' }),
      task(4, { status: 'failed' }),
    ];
    expect(firstOpenTask(tasks)?.title).toBe('Third');
  });

  it('counts tasks in progress or waiting for approval as still to do', () => {
    expect(firstOpenTask([task(2), task(1, { status: 'waiting_approval' })])?.position).toBe(1);
    expect(firstOpenTask([task(1, { status: 'in_progress' })])?.position).toBe(1);
  });

  it('is null when every task is done or the system’s', () => {
    expect(firstOpenTask([])).toBeNull();
    expect(
      firstOpenTask([task(1, { status: 'completed' }), task(2, { mode: 'system' })]),
    ).toBeNull();
  });
});

describe('whoDoesIt', () => {
  it('is the agent when the first step is an agent’s, whoever the action is assigned to', () => {
    expect(whoDoesIt({ mode: 'agent' }, 'u1', 'u1')).toBe('agent');
    expect(whoDoesIt({ mode: 'agent' }, null, 'u1')).toBe('agent');
  });

  it('is me when it is assigned to me, and the team when it is no one’s yet', () => {
    expect(whoDoesIt({ mode: 'human' }, 'u1', 'u1')).toBe('me');
    expect(whoDoesIt({ mode: 'human_or_agent' }, null, 'u1')).toBe('team');
    expect(whoDoesIt(null, 'u1', 'u1')).toBe('me');
    expect(whoDoesIt(null, null, 'u1')).toBe('team');
  });
});

describe('todayStep', () => {
  it('keeps the task’s text parts and its page', () => {
    expect(todayStep(task(1, { task_key: 'add_faq', title: null, url: '/blog/post' }))).toEqual({
      taskKey: 'add_faq',
      title: null,
      titleParams: {},
      url: '/blog/post',
    });
    expect(todayStep(null)).toBeNull();
  });
});

describe('weekStart', () => {
  it('is Monday at midnight on the person’s clock', () => {
    // Thursday, Nov 5 2026.
    const thursday = new Date('2026-11-05T12:00:00Z');
    expect(weekStart(thursday, 'UTC')).toBe('2026-11-02T00:00:00.000Z');
    expect(weekStart(thursday, 'Europe/Istanbul')).toBe('2026-11-01T21:00:00.000Z');
    // New York is back on standard time (UTC−5) since Nov 1.
    expect(weekStart(thursday, 'America/New_York')).toBe('2026-11-02T05:00:00.000Z');
  });

  it('counts Sunday in the week that began the Monday before, and Monday in its own', () => {
    expect(weekStart(new Date('2026-11-08T23:00:00Z'), 'UTC')).toBe('2026-11-02T00:00:00.000Z');
    expect(weekStart(new Date('2026-11-09T00:00:00Z'), 'UTC')).toBe('2026-11-09T00:00:00.000Z');
    // Already Monday in Tokyo while it is still Sunday in UTC.
    expect(weekStart(new Date('2026-11-08T16:00:00Z'), 'Asia/Tokyo')).toBe(
      '2026-11-08T15:00:00.000Z',
    );
  });
});

describe('todayRows', () => {
  const item = (id: string, overrides: Partial<ActionItem> = {}) => ({
    id,
    action: action(id, overrides),
  });

  it('keeps the server’s order and leaves out what closed or went on hold since', () => {
    const actions = [
      action('a'),
      action('b', { status: 'completed' }),
      action('c', { status: 'in_progress' }),
      action('d', { status: 'on_hold' }),
      action('e', { status: 'dismissed' }),
    ];
    const rows = todayRows([item('c'), item('b'), item('a'), item('d'), item('e')], actions);
    expect(rows.map((row) => row.action.id)).toEqual(['c', 'a']);
  });

  it('shows an item the page’s list doesn’t hold from its own action', () => {
    // The list holds at most 1000 actions, in no order: Today's may not be among them.
    const rows = todayRows(
      [item('far', { priorityScore: 97 }), item('a'), item('gone', { status: 'completed' })],
      [action('a', { priorityScore: 60 })],
    );
    expect(rows.map((row) => [row.action.id, row.action.priorityScore])).toEqual([
      ['far', 97],
      ['a', 60],
    ]);
  });

  it('takes the list’s copy when it holds one, as a change made on the page shows there first', () => {
    const rows = todayRows([item('a'), item('b')], [action('a', { status: 'on_hold' })]);
    expect(rows.map((row) => row.action.id)).toEqual(['b']);
  });
});

describe('todayAction and patchToday', () => {
  const read: TodayRead = {
    today: [{ id: 'a', action: action('a'), suggested: false, firstStep: null, who: 'team' }],
    next: [{ id: 'b', action: action('b') }],
    doneThisWeek: 0,
  };

  it('finds an item’s own action, today’s or the Next ones’', () => {
    expect(todayAction(read, 'a')?.id).toBe('a');
    expect(todayAction(read, 'b')?.id).toBe('b');
    expect(todayAction(read, 'other')).toBeNull();
    expect(todayAction(read, null)).toBeNull();
    expect(todayAction(null, 'a')).toBeNull();
  });

  it('shows a change made on the page on that item’s own action only', () => {
    const patched = patchToday(read, 'b', { status: 'completed' });
    expect(patched.next[0].action.status).toBe('completed');
    expect(patched.today[0]).toBe(read.today[0]);
    expect(read.next[0].action.status).toBe('new');
    expect(patchToday(read, 'other', { status: 'completed' })).toBe(read);
  });
});

describe('nextSteps', () => {
  const step = (key: string, state: GettingStartedStep['state']) =>
    ({ key, state }) as unknown as GettingStartedStep;

  it('is the first three steps ready now, in order', () => {
    const steps = [
      step('kpis', 'done'),
      step('competitors', 'new'),
      step('topics', 'waiting'),
      step('prompts', 'new'),
      step('gsc', 'skipped'),
      step('ga', 'new'),
      step('snippet', 'new'),
    ];
    expect(TODAY_STEPS).toBe(3);
    expect(nextSteps(steps).map((s) => s.key)).toEqual(['competitors', 'prompts', 'ga']);
  });
});
