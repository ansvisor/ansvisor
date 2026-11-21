import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The History tab reads on a database without 00366: the actions are read
 * without dismiss_reason, and none says why it was dismissed.
 */

let without00366 = false;
/** Any other failure of the read. */
let readError: { code: string; message: string } | null = null;
const selected: string[] = [];

function action(status: string, dismissReason?: string | null) {
  return {
    id: `a-${status}`,
    action_no: 7,
    category: 'recover',
    kind: 'recover_lost_citations',
    status,
    outcome: 'pending_measurement',
    validation: null,
    position_outcome: null,
    payload: {},
    kpi_keys: [],
    assignee_id: null,
    due_date: null,
    created_at: '2026-10-01T00:00:00Z',
    completed_at: null,
    updated_at: '2026-10-02T00:00:00Z',
    priority_score: null,
    priority_level: null,
    ...(dismissReason === undefined ? {} : { dismiss_reason: dismissReason }),
  };
}

let actionRows: Record<string, unknown>[] = [];
/** The `or` filters the actions read was given: History's window. */
const windows: string[] = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      let columns = '';
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: (cols: string) => {
          columns = cols;
          if (table === 'actions') selected.push(cols);
          return chain;
        },
        eq: () => chain,
        in: () => chain,
        gte: () => chain,
        lte: () => chain,
        or: (filter: string) => {
          if (table === 'actions') windows.push(filter);
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        then: (resolve: (v: unknown) => void) => {
          if (table !== 'actions') return resolve({ data: [], error: null });
          if (readError) return resolve({ data: null, error: readError });
          if (without00366 && columns.includes('dismiss_reason')) {
            return resolve({
              data: null,
              error: { code: '42703', message: 'column actions.dismiss_reason does not exist' },
            });
          }
          return resolve({ data: actionRows, error: null });
        },
      });
      return chain;
    },
  })),
}));

vi.mock('@/lib/action-center/entity-counts', () => ({
  readEntityCounts: async () => new Map(),
  withEntityCounts: (payload: Record<string, unknown>) => payload,
}));

const { getActionHistory } = await import('./action-history');

beforeEach(() => {
  without00366 = false;
  readError = null;
  selected.length = 0;
  windows.length = 0;
  actionRows = [];
});

describe('getActionHistory', () => {
  it('reads why a dismissed action was turned down', async () => {
    actionRows = [action('dismissed', 'not_now')];
    const [item] = await getActionHistory('b1');
    expect(item.dismissReason).toBe('not_now');
    expect(selected).toHaveLength(1);
  });

  it('loads on a database without 00366, with no reason given', async () => {
    without00366 = true;
    actionRows = [action('dismissed'), action('completed')];
    const items = await getActionHistory('b1', { from: '2026-09-01T00:00:00Z' });
    expect(items.map((item) => [item.status, item.dismissReason])).toEqual([
      ['dismissed', null],
      ['completed', null],
    ]);
    expect(selected).toHaveLength(2);
    expect(selected[1]).not.toContain('dismiss_reason');
  });

  it('gives no reason to an action that is no longer dismissed', async () => {
    actionRows = [action('completed', 'wrong_data')];
    const [item] = await getActionHistory('b1');
    expect(item.dismissReason).toBeNull();
  });

  it('gives a Visibility score result in points, not percent (AC-02)', async () => {
    actionRows = [
      {
        ...action('completed'),
        validation: {
          metrics: [
            { metric: 'ai_visibility', before: 27.4, after: 29.9, unit: 'percent' },
            { metric: 'share_of_voice', before: 10, after: 12, unit: 'percent' },
          ],
        },
      },
    ];
    const [item] = await getActionHistory('b1');
    expect(item.results.map((m) => [m.metric, m.unit, m.delta])).toEqual([
      ['ai_visibility', 'points', 2.5],
      ['share_of_voice', 'percent', 2],
    ]);
  });

  it('fails on any other error, without reading again', async () => {
    readError = { code: '57014', message: 'canceling statement due to statement timeout' };
    await expect(getActionHistory('b1')).rejects.toThrow('statement timeout');
    expect(selected).toHaveLength(1);
  });

  it('fails on a missing column of another name, without reading again', async () => {
    readError = { code: '42703', message: 'column actions.priority_level does not exist' };
    await expect(getActionHistory('b1')).rejects.toThrow('priority_level');
    expect(selected).toHaveLength(1);
  });

  it('reads the window by when each action was completed or last changed (UX audit AC-60, D13)', async () => {
    await getActionHistory('b1', { from: '2026-09-01T00:00:00Z', to: '2026-09-30T23:59:59Z' });
    expect(windows).toEqual([
      'and(status.eq.completed,completed_at.gte."2026-09-01T00:00:00Z",completed_at.lte."2026-09-30T23:59:59Z"),' +
        'and(status.in.(dismissed,in_progress,on_hold),updated_at.gte."2026-09-01T00:00:00Z",updated_at.lte."2026-09-30T23:59:59Z")',
    ]);
    // Without a range, no window: every action History covers.
    windows.length = 0;
    await getActionHistory('b1');
    expect(windows).toEqual([]);
  });
});
