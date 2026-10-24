import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  actionPages,
  completeDraftTasks,
  draftMethodForTask,
  findActionDraft,
  reopenDraftTasks,
  type ActionDraft,
} from './action-drafts';

/**
 * An action's writing tasks and their drafts (CE-022): which draft a task is
 * written in, Ready completing the task once the work's drafts are done, and
 * Ready taken back opening it again.
 */

interface Op {
  table: string;
  op: 'select' | 'update' | 'insert';
  value?: unknown;
  filters: [string, string, unknown][];
}
let ops: Op[];
let rows: Record<string, unknown[]>;

const db = {
  from: (table: string) => {
    const op: Op = { table, op: 'select', filters: [] };
    ops.push(op);
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, v: unknown) => (op.filters.push(['eq', col, v]), chain),
      in: (col: string, v: unknown) => (op.filters.push(['in', col, v]), chain),
      is: (col: string, v: unknown) => (op.filters.push(['is', col, v]), chain),
      limit: () => chain,
      order: () => chain,
      update: (value: unknown) => ((op.op = 'update'), (op.value = value), chain),
      insert: (value: unknown) => ((op.op = 'insert'), (op.value = value), chain),
      maybeSingle: async () => ({ data: rows[table]?.[0] ?? null, error: null }),
      then: (resolve: (r: unknown) => void) =>
        resolve({ data: op.op === 'select' ? (rows[table] ?? []) : null, error: null }),
    };
    return chain;
  },
} as unknown as SupabaseClient;

const draft = { id: 'd1', brandId: 'b1', actionId: 'act-1', method: 'optimize' as const };

beforeEach(() => {
  ops = [];
  rows = {};
});

describe('draftMethodForTask', () => {
  it('writes a new page for the draft task and an existing one for optimize or refresh', () => {
    expect(draftMethodForTask('create_content_draft')).toBe('create');
    expect(draftMethodForTask('optimize_content')).toBe('optimize');
    expect(draftMethodForTask('refresh_content')).toBe('optimize');
    expect(draftMethodForTask('create_content_brief')).toBeNull();
    expect(draftMethodForTask(null)).toBeNull();
  });
});

describe('actionPages and findActionDraft', () => {
  const drafts: ActionDraft[] = [
    { id: 'new', method: 'create', sourceUrl: null, status: 'draft' },
    { id: 'pricing', method: 'optimize', sourceUrl: 'https://a.example/pricing', status: 'ready' },
  ];

  it('reads the pages an action names, once each', () => {
    expect(
      actionPages({
        pages: ['https://a.example/pricing', 'https://a.example/pricing', '/relative', 3],
      }),
    ).toEqual(['https://a.example/pricing']);
    expect(actionPages(null)).toEqual([]);
  });

  it('finds the draft for a page, or the work’s draft without one', () => {
    expect(findActionDraft(drafts, 'optimize', 'https://a.example/pricing')?.id).toBe('pricing');
    expect(findActionDraft(drafts, 'optimize', 'https://a.example/other')).toBeNull();
    expect(findActionDraft(drafts, 'optimize', null)?.id).toBe('pricing');
    expect(findActionDraft(drafts, 'create', null)?.id).toBe('new');
  });
});

describe('completeDraftTasks', () => {
  it('completes the work’s open tasks, each in the action’s History', async () => {
    rows.action_tasks = [
      { id: 't-optimize', status: 'in_progress' },
      { id: 't-refresh', status: 'skipped' },
    ];
    rows.actions = [{ payload: { pages: ['https://a.example/pricing'] } }];
    await expect(completeDraftTasks(db, draft, 'u1')).resolves.toBe(1);

    expect(ops[0]).toMatchObject({
      table: 'actions',
      filters: [
        ['eq', 'id', 'act-1'],
        ['is', 'deleted_at', null],
      ],
    });
    expect(ops[1].filters).toContainEqual([
      'in',
      'task_key',
      ['optimize_content', 'refresh_content'],
    ]);
    expect(ops.slice(2)).toEqual([
      {
        table: 'action_tasks',
        op: 'update',
        value: expect.objectContaining({ status: 'completed', skip_reason: null }),
        filters: [
          ['eq', 'action_id', 'act-1'],
          ['eq', 'id', 't-optimize'],
        ],
      },
      {
        table: 'action_events',
        op: 'insert',
        value: {
          action_id: 'act-1',
          event: 'task_status',
          data: { taskId: 't-optimize', to: 'completed', draftId: 'd1' },
          actor_id: 'u1',
        },
        filters: [],
      },
      {
        table: 'actions',
        op: 'update',
        value: { updated_at: expect.any(String) },
        filters: [
          ['eq', 'brand_id', 'b1'],
          ['eq', 'id', 'act-1'],
        ],
      },
    ]);
  });

  it('waits until each page the action names has a ready draft', async () => {
    rows.actions = [{ payload: { pages: ['https://a.example/pricing', 'https://a.example/faq'] } }];
    rows.content_drafts = [{ source_url: 'https://a.example/pricing' }];
    rows.action_tasks = [{ id: 't-optimize', status: 'todo' }];
    await expect(completeDraftTasks(db, draft, 'u1')).resolves.toBe(0);
    expect(ops[1]).toMatchObject({
      table: 'content_drafts',
      filters: [
        ['eq', 'action_id', 'act-1'],
        ['eq', 'method', 'optimize'],
        ['in', 'status', ['ready', 'published']],
      ],
    });
    expect(ops.some((op) => op.op === 'update')).toBe(false);

    ops = [];
    rows.content_drafts.push({ source_url: 'https://a.example/faq' });
    await expect(completeDraftTasks(db, draft, 'u1')).resolves.toBe(1);
  });

  it('completes a new page’s task without reading pages', async () => {
    rows.actions = [{ payload: { pages: ['https://a.example/pricing'] } }];
    rows.action_tasks = [{ id: 't-draft', status: 'todo' }];
    await expect(completeDraftTasks(db, { ...draft, method: 'create' }, null)).resolves.toBe(1);
    expect(ops.some((op) => op.table === 'content_drafts')).toBe(false);
    expect(ops[1]).toMatchObject({
      table: 'action_tasks',
      filters: [
        ['eq', 'action_id', 'act-1'],
        ['in', 'task_key', ['create_content_draft']],
      ],
    });
  });

  it('leaves a deleted action’s tasks as they were', async () => {
    rows.action_tasks = [{ id: 't-draft', status: 'todo' }];
    await expect(completeDraftTasks(db, { ...draft, method: 'create' }, 'u1')).resolves.toBe(0);
    expect(ops.map((op) => op.table)).toEqual(['actions']);
  });
});

describe('reopenDraftTasks', () => {
  it('opens again the work’s tasks a draft’s Ready completed, each in the action’s History', async () => {
    rows.actions = [{ status: 'in_progress' }];
    rows.action_tasks = [
      { id: 't-optimize', status: 'completed' },
      { id: 't-refresh', status: 'completed' },
      { id: 't-other', status: 'skipped' },
    ];
    // Newest first: t-refresh was completed by a person after Ready.
    rows.action_events = [
      { data: { taskId: 't-refresh', to: 'completed' } },
      { data: { taskId: 't-optimize', to: 'completed', draftId: 'd2' } },
      { data: { taskId: 't-refresh', to: 'completed', draftId: 'd2' } },
    ];
    await expect(reopenDraftTasks(db, draft, 'u1')).resolves.toBe(1);
    expect(ops[1].filters).toContainEqual([
      'in',
      'task_key',
      ['optimize_content', 'refresh_content'],
    ]);
    expect(ops[2]).toMatchObject({
      table: 'action_events',
      filters: [
        ['eq', 'action_id', 'act-1'],
        ['eq', 'event', 'task_status'],
      ],
    });
    expect(ops.slice(3, 5)).toEqual([
      {
        table: 'action_tasks',
        op: 'update',
        value: expect.objectContaining({ status: 'in_progress', skip_reason: null }),
        filters: [
          ['eq', 'action_id', 'act-1'],
          ['eq', 'id', 't-optimize'],
        ],
      },
      {
        table: 'action_events',
        op: 'insert',
        value: {
          action_id: 'act-1',
          event: 'task_status',
          data: { taskId: 't-optimize', to: 'in_progress', draftId: 'd1' },
          actor_id: 'u1',
        },
        filters: [],
      },
    ]);
  });

  it('leaves a closed action’s tasks as they are', async () => {
    rows.actions = [{ status: 'completed' }];
    rows.action_tasks = [{ id: 't-optimize', status: 'completed' }];
    await expect(reopenDraftTasks(db, draft, 'u1')).resolves.toBe(0);
    expect(ops).toHaveLength(1);
  });

  it('leaves a deleted action’s tasks, and reads no History when none is done', async () => {
    await expect(reopenDraftTasks(db, draft, 'u1')).resolves.toBe(0);
    expect(ops).toHaveLength(1);

    ops = [];
    rows.actions = [{ status: 'in_progress' }];
    rows.action_tasks = [{ id: 't-optimize', status: 'in_progress' }];
    await expect(reopenDraftTasks(db, draft, 'u1')).resolves.toBe(0);
    expect(ops.some((op) => op.table === 'action_events')).toBe(false);
  });
});
