import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionRow } from '@/lib/action-center/rows';

/**
 * Today's read (AC-011): the server's order, and each item's action read by
 * id as the person, so the card never depends on the page's list, which
 * holds at most 1000 actions in no order.
 */

const row = (id: string, overrides: Partial<ActionRow> = {}): ActionRow => ({
  id,
  action_no: 2048,
  category: 'compete',
  kind: 'recover_lost_citations',
  impact: 'high',
  status: 'new',
  payload: {},
  kpi_keys: [],
  assignee_id: null,
  due_date: null,
  created_at: '2026-10-16T09:05:31Z',
  updated_at: '2026-10-16T09:05:31Z',
  priority_score: 97,
  priority_level: 'critical',
  priority_reason: null,
  priority_updated_at: null,
  stale_at: null,
  ...overrides,
});

const db = vi.hoisted(() => ({
  /** The rows each table answers with. */
  tables: {} as Record<string, unknown[]>,
  /** Each read's table and filters, in order. */
  reads: [] as { table: string; filters: unknown[][] }[],
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'me' } } }),
      getSession: async () => ({ data: { session: { access_token: 'token' } } }),
    },
    from: (table: string) => {
      const read = { table, filters: [] as unknown[][] };
      db.reads.push(read);
      let head = false;
      const chain: Record<string, unknown> = {};
      const filter =
        (name: string) =>
        (...args: unknown[]) => {
          read.filters.push([name, ...args]);
          return chain;
        };
      Object.assign(chain, {
        select: (_columns: string, options?: { head?: boolean }) => {
          head = options?.head === true;
          return chain;
        },
        eq: filter('eq'),
        in: filter('in'),
        is: filter('is'),
        gte: filter('gte'),
        maybeSingle: async () => ({ data: { time_zone: 'UTC' }, error: null }),
        then: (resolve: (value: unknown) => void) =>
          resolve(head ? { count: 4, error: null } : { data: db.tables[table] ?? [], error: null }),
      });
      return chain;
    },
    rpc: async () => ({ data: [], error: null }),
  }),
}));
vi.mock('@/lib/action-center/assignees', () => ({
  readAssignees: async (_client: unknown, _brandId: string, ids: string[]) =>
    new Map(ids.map((id) => [id, { id, fullName: 'Ada', avatarUrl: null }])),
}));

const { getToday } = await import('./action-center-today');

beforeEach(() => {
  db.reads.length = 0;
  db.tables = {
    actions: [
      row('far', { assignee_id: 'me' }),
      row('a2', { status: 'in_progress', priority_score: 85 }),
      row('n1', { category: 'protect', priority_score: 71 }),
    ],
    action_tasks: [
      { action_id: 'far', position: 1, task_key: null, title: 'Done', status: 'completed' },
      {
        action_id: 'far',
        position: 2,
        task_key: null,
        title: 'Add a direct answer',
        status: 'todo',
        mode: 'human',
        details: { url: '/blog/post' },
      },
      { action_id: 'n1', position: 1, task_key: null, title: 'Check', status: 'todo' },
    ],
    signals: [{ action_id: 'far' }, { action_id: 'far' }, { action_id: 'n1' }],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        today: [
          { id: 'far', suggested: true },
          { id: 'a2', suggested: false },
          { id: 'hidden', suggested: false },
        ],
        next: [{ id: 'n1' }, { id: 'far' }],
      }),
    })),
  );
});

describe('getToday', () => {
  it('reads each item’s action by id, as the Actions list reads it', async () => {
    const read = await getToday('brand-id', 'UTC');
    const actions = db.reads.find(
      (r) => r.table === 'actions' && r.filters.some(([name]) => name === 'in'),
    )!;
    // Today's and the Next ones', each once, on this brand: never the page's list.
    expect(actions.filters).toEqual([
      ['eq', 'brand_id', 'brand-id'],
      ['in', 'id', ['far', 'a2', 'hidden', 'n1']],
    ]);

    // `hidden` is in the order but not in what the person can read: left out.
    expect(read.today.map((item) => item.id)).toEqual(['far', 'a2']);
    const [far] = read.today;
    expect(far).toMatchObject({
      suggested: true,
      who: 'me',
      firstStep: { title: 'Add a direct answer', url: '/blog/post' },
    });
    expect(far.action).toMatchObject({
      id: 'far',
      actionNo: 2048,
      category: 'compete',
      status: 'new',
      priorityScore: 97,
      priorityLevel: 'critical',
      assignee: { id: 'me', fullName: 'Ada' },
      taskTotal: 2,
      taskCompleted: 1,
      signalCount: 2,
    });
    expect(read.next).toEqual([{ id: 'n1', action: expect.objectContaining({ id: 'n1' }) }]);
    expect(read.next[0].action).toMatchObject({ category: 'protect', priorityScore: 71 });
    expect(read.doneThisWeek).toBe(4);
  });

  it('reads no action when nothing waits on the person', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ today: [], next: [] }),
    } as Response);
    const read = await getToday('brand-id', 'UTC');
    expect(read).toEqual({ today: [], next: [], doneThisWeek: 4 });
    expect(db.reads.map((r) => r.table)).toEqual(['profiles', 'actions']);
  });
});
