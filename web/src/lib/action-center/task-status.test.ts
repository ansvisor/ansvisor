import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureForSessionUser = vi.fn();
vi.mock('@/lib/posthog-server', () => ({
  captureForSessionUser: (...args: unknown[]) => captureForSessionUser(...args),
}));

const { writeTaskStatus } = await import('./task-status');

/** A client whose every write succeeds. */
function client() {
  const chain: Record<string, unknown> = {};
  const call = () => chain;
  for (const m of ['update', 'insert', 'eq', 'neq', 'not']) chain[m] = call;
  chain.select = async () => ({ data: [{ id: 't1' }], error: null });
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => chain,
  } as never;
}

const task = { brandId: 'b1', actionId: 'a1', taskId: 't1' };

beforeEach(() => captureForSessionUser.mockReset().mockResolvedValue(undefined));

describe('writeTaskStatus and the funnel', () => {
  it('sends task_completed with ids only when a task is marked completed', async () => {
    const supabase = client();
    await writeTaskStatus(supabase, task, 'completed');
    expect(captureForSessionUser).toHaveBeenCalledWith(supabase, 'task_completed', {
      brand_id: 'b1',
      action_id: 'a1',
      source: 'drawer',
    });
  });

  it('sends nothing for another status', async () => {
    await writeTaskStatus(client(), task, 'skipped', { skipReason: 'not now' });
    expect(captureForSessionUser).not.toHaveBeenCalled();
  });
});

/** A client that records each write on actions and action_events, and moves `moved` actions. */
function recorder(moved: boolean) {
  const writes: { table: string; values?: unknown; filters: [string, unknown][] }[] = [];
  return {
    writes,
    client: {
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      from: (table: string) => {
        const write: { table: string; values?: unknown; filters: [string, unknown][] } = {
          table,
          filters: [],
        };
        const chain: Record<string, unknown> = {};
        chain.update = (values: unknown) => ((write.values = values), writes.push(write), chain);
        chain.insert = (values: unknown) => ((write.values = values), writes.push(write), chain);
        for (const m of ['eq', 'neq', 'not']) {
          chain[m] = (column: string, value: unknown) => (
            write.filters.push([column, value]),
            chain
          );
        }
        chain.select = async () => ({
          data: table === 'actions' && !moved ? [] : [{ id: 'x' }],
          error: null,
        });
        chain.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
        return chain;
      },
    } as never,
  };
}

describe('a task under way starts its action (UX audit AC-24)', () => {
  it('moves only a New action to In progress, and says so in its History', async () => {
    const { client: supabase, writes } = recorder(true);
    await writeTaskStatus(supabase, task, 'in_progress');
    const start = writes.find(
      (w) => w.table === 'actions' && (w.values as { status?: string })?.status === 'in_progress',
    )!;
    expect(start.filters).toContainEqual(['status', 'new']);
    expect(start.filters).toContainEqual(['id', 'a1']);
    expect(
      writes.some(
        (w) =>
          w.table === 'action_events' &&
          (w.values as { event: string; data: { by?: string } }).event === 'status_changed' &&
          (w.values as { data: { by?: string } }).data.by === 'task',
      ),
    ).toBe(true);
  });

  it('logs nothing when the action was not New, and tries nothing for a skipped task', async () => {
    const notNew = recorder(false);
    await writeTaskStatus(notNew.client, task, 'completed');
    expect(
      notNew.writes.some(
        (w) =>
          w.table === 'action_events' && (w.values as { event: string }).event === 'status_changed',
      ),
    ).toBe(false);

    const skipped = recorder(true);
    await writeTaskStatus(skipped.client, task, 'skipped', { skipReason: 'not now' });
    expect(
      skipped.writes.some((w) => (w.values as { status?: string })?.status === 'in_progress'),
    ).toBe(false);
  });
});
