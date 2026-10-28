import { beforeEach, describe, expect, it, vi } from 'vitest';

/** An action's status, and why it was dismissed (learning A5). */

const writes: { table: string; op: string; payload: unknown }[] = [];
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const record = (op: string) => (payload: unknown) => {
        writes.push({ table, op, payload });
        return chain;
      };
      Object.assign(chain, {
        update: record('update'),
        insert: record('insert'),
        eq: () => chain,
        then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      });
      return chain;
    },
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));

const { updateActionStatus } = await import('./action-center');

const update = () => writes.find((w) => w.table === 'actions' && w.op === 'update')!.payload;
const event = () => writes.find((w) => w.table === 'action_events')!.payload;

beforeEach(() => {
  writes.length = 0;
});

describe('updateActionStatus', () => {
  it('keeps why an action was dismissed, and says it on its History line', async () => {
    await updateActionStatus('b1', 'a1', 'dismissed', 'not_now');
    expect(update()).toMatchObject({ status: 'dismissed', dismiss_reason: 'not_now' });
    expect(event()).toMatchObject({
      event: 'status_changed',
      data: { to: 'dismissed', reason: 'not_now' },
    });
  });

  it('clears the reason on any other status, and keeps none it doesn’t know', async () => {
    await updateActionStatus('b1', 'a1', 'in_progress', 'not_now');
    expect(update()).toMatchObject({ status: 'in_progress', dismiss_reason: null });
    expect(event()).toMatchObject({ data: { to: 'in_progress' } });

    writes.length = 0;
    await updateActionStatus('b1', 'a1', 'dismissed', 'bored' as never);
    expect(update()).toMatchObject({ dismiss_reason: null });
  });
});
