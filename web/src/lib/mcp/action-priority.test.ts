import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * list_actions carries each action's priority (AC-006) and can list them in
 * the order to work on them.
 */

let orders: [string, Record<string, unknown> | undefined][] = [];
let entityCounts: unknown[] = [];

const ACTIONS = [
  {
    id: 'a1',
    action_no: 52,
    category: 'recover',
    kind: 'recover_lost_citations',
    impact: 'high',
    status: 'new',
    outcome: null,
    assignee_id: null,
    due_date: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-14T00:00:00Z',
    priority_score: 94,
    priority_level: 'critical',
    priority_reason: { change: 'lost', demand: 'high' },
  },
  {
    id: 'a2',
    action_no: 53,
    category: 'growth',
    kind: 'create_content_for_demand',
    impact: 'medium',
    status: 'new',
    outcome: null,
    assignee_id: null,
    due_date: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-15T00:00:00Z',
    priority_score: null,
    priority_level: null,
    priority_reason: null,
  },
];

let actionRows: Record<string, unknown>[] = ACTIONS;

function builder(table: string) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    in: () => chain,
    order: (column: string, options?: Record<string, unknown>) => {
      if (table === 'actions') orders.push([column, options]);
      return chain;
    },
    limit: () => chain,
    maybeSingle: async () => ({
      data:
        table === 'actions'
          ? { ...ACTIONS[0], brand_id: 'brand-1', payload: {} }
          : { id: 'brand-1' },
      error: null,
    }),
    then: (resolve: (v: { data: unknown; error: null }) => void) =>
      resolve({ data: table === 'actions' ? actionRows : [], error: null }),
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => builder(table),
    // The actions' list counts (AC-009): nothing removed unless a test says so.
    rpc: async () => ({ data: entityCounts, error: null }),
  },
}));

const { getActionFor, listActionsFor } = await import('./data');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
};

describe('listActionsFor', () => {
  beforeEach(() => {
    orders = [];
    entityCounts = [];
    actionRows = ACTIONS;
  });

  it('gives each action its priority, or null before it is scored', async () => {
    const rows = await listActionsFor(auth, { brandId: 'brand-1' });
    expect(rows?.map((r) => r.priority)).toEqual([
      { score: 94, level: 'critical', reason: { change: 'lost', demand: 'high' } },
      null,
    ]);
    // Highest priority first, unscored ones last, as the app lists them.
    expect(orders).toEqual([
      ['priority_score', { ascending: false, nullsFirst: false }],
      ['updated_at', { ascending: false }],
    ]);
  });

  it('names the count left in a reason that named the action’s, as get_action does (AC-009)', async () => {
    actionRows = [
      {
        ...ACTIONS[0],
        priority_reason: { subject: { entity: 'prompts', count: 13 }, days: 2 },
        target_entity: 'prompts',
        target_count: 13,
      },
    ];
    entityCounts = [
      { action_id: 'a1', entity_type: 'prompts', total: 13, removed: 1, removed_labels: ['x'] },
    ];
    const rows = await listActionsFor(auth, { brandId: 'brand-1' });
    expect(rows?.[0].priority?.reason).toEqual({
      subject: { entity: 'prompts', count: 12 },
      days: 2,
    });
  });

  it('lists the most recently updated first when asked', async () => {
    await listActionsFor(auth, { brandId: 'brand-1', sort: 'updated' });
    expect(orders).toEqual([['updated_at', { ascending: false }]]);
  });
});

describe('getActionFor', () => {
  it('gives the action its priority', async () => {
    const action = await getActionFor(auth, 'a1');
    expect(action?.priority).toEqual({
      score: 94,
      level: 'critical',
      reason: { change: 'lost', demand: 'high' },
    });
  });
});
