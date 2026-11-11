import { describe, expect, it } from 'vitest';
import { firstOpenTask, todayStep, weekStart, whoDoesIt, type TodayTaskRow } from './today';

/** Today's helpers: first step, who does it, the week. */

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
