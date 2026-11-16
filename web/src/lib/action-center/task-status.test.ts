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
