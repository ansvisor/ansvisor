import { describe, expect, it } from 'vitest';
import type { ActionItem } from '@/lib/actions/action-center';
import { finishOne, waitingRows, type WaitingAction, type WaitingInput } from './waiting';

const action = (id: string, overrides: Partial<ActionItem> = {}) =>
  ({
    id,
    kind: 'recover_lost_citations',
    status: 'new',
    taskTotal: 4,
    taskCompleted: 0,
    ...overrides,
  }) as ActionItem;

const item = (id: string, dueDate: string | null, kind?: string): WaitingAction => ({
  id,
  action: action(id, kind ? { kind } : {}),
  firstStep: null,
  dueDate,
});

const input = (overrides: Partial<WaitingInput> = {}): WaitingInput => ({
  canManage: true,
  chatOn: true,
  hidden: new Set(),
  agents: [{ id: 'c1', title: 'Weekly comparison page' }],
  drafts: [{ id: 'd1', title: 'Low-acid guide' }],
  actions: [
    item('later', '2026-11-12'),
    item('today', '2026-11-11'),
    item('late', '2026-11-09'),
    item('remind', null, 'business_hub_numbers'),
  ],
  isReminder: (kind) => kind === 'business_hub_numbers',
  today: '2026-11-11',
  reviews: 2,
  ideas: { count: 2, sources: ['gsc'] },
  ...overrides,
});

const types = (rows: ReturnType<typeof waitingRows>) =>
  rows.map((row) => (row.type === 'due' ? `due:${row.item.id}` : row.type));

describe('Waiting for you', () => {
  it('lists agent runs, drafts, due tasks (overdue first), reminders, reviews and ideas', () => {
    const rows = waitingRows(input());
    expect(types(rows)).toEqual([
      'agent',
      'drafts',
      'due:late',
      'due:today',
      'reminder',
      'review',
      'ideas',
    ]);
    expect(rows.find((row) => row.type === 'due' && row.item.id === 'late')).toMatchObject({
      overdue: true,
    });
  });

  it('keeps reviews and prompt ideas for admins and managers', () => {
    expect(types(waitingRows(input({ canManage: false })))).toEqual([
      'agent',
      'drafts',
      'due:late',
      'due:today',
      'reminder',
    ]);
  });

  it("leaves out rows whose section is off the person's menu, and agents without Chat", () => {
    const rows = waitingRows(input({ hidden: new Set(['agent', 'content', 'prompts']) }));
    expect(types(rows)).toEqual(['due:late', 'due:today', 'reminder', 'review']);
    expect(types(waitingRows(input({ chatOn: false }))).includes('agent')).toBe(false);
  });

  it('shows 3 due tasks at most, and nothing for reads that failed or found none', () => {
    const many = ['01', '02', '03', '04', '05'].map((d) => item(d, `2026-11-${d}`));
    expect(types(waitingRows(input({ actions: many })))).toContain('due:03');
    expect(types(waitingRows(input({ actions: many }))).filter((t) => t.startsWith('due'))).toEqual(
      ['due:01', 'due:02', 'due:03'],
    );
    expect(
      waitingRows(
        input({
          agents: null,
          drafts: [],
          actions: null,
          reviews: 0,
          ideas: { count: 0, sources: [] },
        }),
      ),
    ).toEqual([]);
  });

  it('offers the focus action furthest along when nothing waits', () => {
    const cards = [
      { action: action('a', { status: 'in_progress', taskCompleted: 1 }) },
      { action: action('b', { status: 'in_progress', taskCompleted: 3 }) },
      { action: action('c', { status: 'new', taskCompleted: 0 }) },
      { action: action('d', { status: 'in_progress', taskCompleted: 4 }) },
    ];
    expect(finishOne(cards)?.action.id).toBe('b');
    expect(finishOne([cards[2]])).toBeNull();
  });
});
